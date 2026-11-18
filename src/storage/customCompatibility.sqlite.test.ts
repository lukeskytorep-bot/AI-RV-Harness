import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { SqliteSettingsModelsRepository } from "./sqlite/settingsModelsRepository";
import { BrowserSettingsModelsRepository } from "./browser/settingsModelsRepository";

it("round-trips legacy/new compatibility on real SQLite, survives reconnect, rolls back errors and removes only its own setting", async () => {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../src-tauri/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, directory), "utf8"));
  let fail = false;
  const params = (values: unknown[] = []) => Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v]));
  const dependencies = {
    select: async <T>(sql: string, values?: unknown[]) => db.prepare(sql).all(params(values) as never) as T,
    executeWrite: async (sql: string, values?: unknown[]) => ({ rowsAffected: Number(db.prepare(sql).run(params(values) as never).changes) }),
    executeTransaction: async (statements: { query: string; values?: unknown[] }[]) => {
      db.exec("BEGIN");
      try { for (const s of statements) { db.prepare(s.query).run(params(s.values) as never); if (fail) throw new Error("injected failure"); } db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }, now: () => "t",
  };
  const repository = new SqliteSettingsModelsRepository(dependencies);
  try {
    const input = { id: "p", provider: "custom_openai" as const, label: "Pod", credentialId: "k", baseUrl: "https://example.test/v1", customStreamingEnabled: true, customOutputTokenField: "max_completion_tokens" as const };
    expect((await repository.createProviderConfig(input)).customCompatibilityProfile).toBe("generic");
    expect((await repository.listProviderConfigs())[0].customCompatibilityProfile).toBe("generic");
    await repository.updateProviderCustomCompatibilityProfile("p", "llama_cpp");
    const reopened = new SqliteSettingsModelsRepository(dependencies);
    expect((await reopened.listProviderConfigs())[0]).toMatchObject({ id: "p", credentialId: "k", baseUrl: input.baseUrl, customStreamingEnabled: true, customOutputTokenField: input.customOutputTokenField, customCompatibilityProfile: "llama_cpp" });
    fail = true;
    await expect(repository.updateProviderCustomCompatibilityProfile("p", "generic")).rejects.toThrow("injected");
    expect((await reopened.listProviderConfigs())[0].customCompatibilityProfile).toBe("llama_cpp");
    fail = false;
    await repository.updateProviderCustomCompatibilityProfile("p", "generic");
    expect((await reopened.listProviderConfigs())[0].customCompatibilityProfile).toBe("generic");
    await repository.createProviderConfig({ id: "other", provider: "openrouter", label: "Other", credentialId: "other-key" });
    await expect(repository.updateProviderCustomCompatibilityProfile("other", "llama_cpp")).rejects.toThrow("only for Custom");
    await repository.deleteProviderConfig("p");
    expect(db.prepare("SELECT * FROM app_settings WHERE key LIKE 'provider.customCompatibilityProfile.%'").all()).toEqual([]);
    expect((await reopened.listProviderConfigs()).map(c => c.id)).toEqual(["other"]);
  } finally { db.close(); }
});

it("browser preview keeps legacy Generic and saves both choices without affecting other providers", async () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } } as Storage;
  storage.setItem("rvh.dev.providers", JSON.stringify([{ id: "p", provider: "custom_openai", updatedAt: "t" }, { id: "other", provider: "openrouter", updatedAt: "t" }]));
  const repository = new BrowserSettingsModelsRepository({ storage, clearProfileReferences: () => undefined });
  expect((await repository.listProviderConfigs())[0].customCompatibilityProfile).toBe("generic");
  for (const profile of ["llama_cpp", "generic"] as const) {
    await repository.updateProviderCustomCompatibilityProfile("p", profile);
    expect((await new BrowserSettingsModelsRepository({ storage, clearProfileReferences: () => undefined }).listProviderConfigs())[0].customCompatibilityProfile).toBe(profile);
  }
  expect((await repository.listProviderConfigs())[1].customCompatibilityProfile).toBeUndefined();
  await expect(repository.updateProviderCustomCompatibilityProfile("other", "llama_cpp")).rejects.toThrow("only for Custom");
});
