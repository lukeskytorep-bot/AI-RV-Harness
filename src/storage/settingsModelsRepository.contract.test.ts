import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createDefaultSettings } from "../startupDefaults";
import { BrowserSettingsModelsRepository } from "./browser/settingsModelsRepository";
import { SqliteSettingsModelsRepository } from "./sqlite/settingsModelsRepository";
import type { DatabaseTransactionStatement } from "./databaseNative";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const timestamp = "2026-09-08T00:00:00.000Z";

function provider(id: string, updatedAt: string): ProviderConfig {
  return { id, provider: "openai", label: id, credentialId: `credential-${id}`, enabled: true, createdAt: updatedAt, updatedAt };
}

function model(providerConfigId: string, modelId: string, displayName: string, favorite = false): ProviderModel {
  return {
    providerConfigId, provider: "openai", modelId, displayName, route: modelId,
    capabilities: {
      inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "verified" },
      temperature: { supported: true, confidence: "verified" }, supportedParameters: [], source: "provider", capturedAt: timestamp,
    },
    pricing: {}, recommended: false, favorite, rawMetadata: {}, refreshedAt: timestamp,
  };
}

describe("browser Settings and models repository contract", () => {
  it("round-trips settings without changing the serialized storage key", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserSettingsModelsRepository({ storage, clearProfileReferences: () => undefined });
    const settings = { ...createDefaultSettings(), interfaceLanguage: "pl" as const, maxRetries: 4 };
    await repository.saveSettings(settings);
    expect(await repository.loadSettings()).toEqual(settings);
    expect(storage.getItem("rvh.dev.settings")).toBe(JSON.stringify(settings));
  });

  it("keeps provider ordering, model filtering and favorites stable", async () => {
    const storage = new MemoryStorage();
    storage.setItem("rvh.dev.providers", JSON.stringify([provider("old", "2026-09-07T00:00:00.000Z"), provider("new", timestamp)]));
    storage.setItem("rvh.dev.models", JSON.stringify([model("old", "b", "Beta", true), model("new", "a", "Alpha")]));
    const repository = new BrowserSettingsModelsRepository({ storage, clearProfileReferences: () => undefined });
    expect((await repository.listProviderConfigs()).map((item) => item.id)).toEqual(["new", "old"]);
    expect((await repository.listProviderModels("old")).map((item) => item.modelId)).toEqual(["b"]);
    await repository.replaceProviderModels("old", [model("old", "b", "Beta")]);
    expect((await repository.listProviderModels("old"))[0].favorite).toBe(true);
  });

  it("removes a provider and its models and explicitly requests profile-reference cleanup", async () => {
    const storage = new MemoryStorage();
    const removed = provider("remove", timestamp);
    storage.setItem("rvh.dev.providers", JSON.stringify([removed, provider("keep", timestamp)]));
    storage.setItem("rvh.dev.models", JSON.stringify([model("remove", "a", "A"), model("keep", "b", "B")]));
    const clearProfileReferences = vi.fn();
    const repository = new BrowserSettingsModelsRepository({ storage, now: () => timestamp, clearProfileReferences });
    await repository.deleteProviderConfig("remove");
    expect((await repository.listProviderConfigs()).map((item) => item.id)).toEqual(["keep"]);
    expect((await repository.listProviderModels()).map((item) => item.providerConfigId)).toEqual(["keep"]);
    expect(clearProfileReferences).toHaveBeenCalledWith(removed, timestamp);
  });

  it("keeps credential mutations unavailable in browser preview", async () => {
    const repository = new BrowserSettingsModelsRepository({ storage: new MemoryStorage(), clearProfileReferences: () => undefined });
    await expect(repository.createProviderConfig({ id: "p", provider: "openai", label: "P", credentialId: "c" })).rejects.toThrow("desktop runtime");
    await expect(repository.updateProviderCredentialMetadata("p", "…1234", "hash")).rejects.toThrow("desktop runtime");
  });
});

describe("SQLite Settings and models repository contract", () => {
  it("loads typed settings and saves the complete update as one transaction", async () => {
    const transactions: DatabaseTransactionStatement[][] = [];
    const executeTransaction = async (statements: DatabaseTransactionStatement[]) => { transactions.push(statements); return []; };
    const repository = new SqliteSettingsModelsRepository({
      select: async <T>() => [{ key: "interfaceLanguage", value: "pl" }, { key: "maxRetries", value: "5" }, { key: "animations", value: "false" }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction, now: () => timestamp,
    });
    expect(await repository.loadSettings()).toEqual({ interfaceLanguage: "pl", maxRetries: 5, animations: false });
    await repository.saveSettings(createDefaultSettings());
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toHaveLength(Object.keys(createDefaultSettings()).length);
  });

  it("creates provider and credential metadata atomically", async () => {
    const transactions: DatabaseTransactionStatement[][] = [];
    const executeTransaction = async (statements: DatabaseTransactionStatement[]) => { transactions.push(statements); return []; };
    const repository = new SqliteSettingsModelsRepository({
      select: async <T>() => [] as T, executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction, now: () => timestamp,
    });
    const created = await repository.createProviderConfig({ id: "provider-a", provider: "openai", label: "  Primary  ", credentialId: "credential-a", credentialHint: "…1234", fingerprint: "hash" });
    expect(created).toMatchObject({ id: "provider-a", label: "Primary", credentialFingerprint: "hash" });
    const statements = transactions[0]!;
    expect(statements).toHaveLength(2);
    expect(statements[0].query).toContain("INSERT INTO credentials_metadata");
    expect(statements[1].query).toContain("INSERT INTO provider_configs");
  });

  it("deletes provider metadata and clears profile references in one transaction", async () => {
    const transactions: DatabaseTransactionStatement[][] = [];
    const executeTransaction = async (statements: DatabaseTransactionStatement[]) => { transactions.push(statements); return []; };
    const repository = new SqliteSettingsModelsRepository({
      select: async <T>() => [{ credential_id: "credential-a" }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction, now: () => timestamp,
    });
    await repository.deleteProviderConfig("provider-a");
    const statements = transactions[0]!;
    expect(statements.map((item: { query: string }) => item.query)).toEqual([
      expect.stringContaining("UPDATE profiles"),
      expect.stringContaining("DELETE FROM provider_configs"),
      expect.stringContaining("DELETE FROM credentials_metadata"),
    ]);
  });

  it("replaces a provider model registry atomically and preserves saved favorites", async () => {
    const transactions: DatabaseTransactionStatement[][] = [];
    const executeTransaction = async (statements: DatabaseTransactionStatement[]) => { transactions.push(statements); return []; };
    const repository = new SqliteSettingsModelsRepository({
      select: async <T>() => [{ model_id: "model-a" }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction,
    });
    await repository.replaceProviderModels("provider-a", [model("provider-a", "model-a", "Model A")]);
    const statements = transactions[0]!;
    expect(statements[0].query).toContain("DELETE FROM model_registry");
    expect(statements[1].query).toContain("INSERT INTO model_registry");
    expect(statements[1].values![8]).toBe(1);
  });
});
