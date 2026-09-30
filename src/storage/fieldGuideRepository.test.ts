import { describe, expect, it, vi } from "vitest";
import type { AiIdentity } from "../aiCenter/types";
import { BrowserFieldGuideRepository } from "./browser/fieldGuideRepository";
import { SqliteFieldGuideRepository } from "./sqlite/fieldGuideRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const now = "2026-09-17T12:00:00.000Z";
function identity(id: string, modelId: string): AiIdentity {
  return { id, profileId: "profile", credentialFingerprint: `fp-${id}`, credentialDisplay: `key-${id}`, providerConfigId: `provider-${id}`, provider: "openrouter", normalizedBaseUrl: "https://openrouter.ai/api/v1", modelId, modelRoute: `openrouter:${modelId}`, modelDisplayName: modelId, role: "viewer", routeStatus: "available", firstUsedAt: now, lastUsedAt: now, createdAt: now, updatedAt: now };
}

function source(profileId = "profile") {
  return { schemaVersion: 1 as const, sourceKind: "factory-baseline" as const, profileId, capturedAt: now };
}

function repository() {
  const storage = new MemoryStorage();
  storage.setItem("rvh.dev.ai_identities", JSON.stringify([identity("ai-a", "model-a"), identity("ai-b", "model-b")]));
  let sequence = 0;
  return { storage, repo: new BrowserFieldGuideRepository({ storage, now: () => now, createId: (prefix) => `${prefix}-${++sequence}` }) };
}

describe("Field Guide repository foundation", () => {
  it("provides a truly read-only existing-bundle lookup for Research", async () => {
    const { repo, storage } = repository();
    const before = storage.getItem("rvh.dev.field_guide_settings");
    expect(await repo.getExistingFieldGuideBundle("ai-a", "en")).toBeNull();
    expect(storage.getItem("rvh.dev.field_guide_settings")).toBe(before);

    await repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "en", content: "existing", contentSha256: "r".repeat(64), estimatedTokens: 3, sourceSnapshot: source(), activationSource: "initial_version" });
    const frozen = storage.getItem("rvh.dev.field_guide_settings");
    expect((await repo.getExistingFieldGuideBundle("ai-a", "en"))?.activeVersion?.content).toBe("existing");
    expect(storage.getItem("rvh.dev.field_guide_settings")).toBe(frozen);
  });

  it("keeps the SQLite Research lookup read-only when Field Guide settings do not exist", async () => {
    const executeWrite = vi.fn();
    const repository = new SqliteFieldGuideRepository({
      select: async <T>(query: string) => {
        if (query.includes("FROM ai_identities")) return [{ id: "ai-a", profile_id: "profile", role: "viewer" }] as T;
        if (query.includes("FROM field_guide_settings")) return [] as T;
        return [] as T;
      },
      executeWrite: async (query, values) => { executeWrite(query, values); return { rowsAffected: 1 }; },
      executeTransaction: async () => ({}),
    });
    expect(await repository.getExistingFieldGuideBundle("ai-a", "en")).toBeNull();
    expect(executeWrite).not.toHaveBeenCalled();
  });

  it("separates exact AI identities and Polish/English state with 2048-token defaults", async () => {
    const { repo } = repository();
    const en = await repo.getFieldGuideBundle("ai-a", "en");
    const pl = await repo.getFieldGuideBundle("ai-a", "pl");
    const other = await repo.getFieldGuideBundle("ai-b", "en");
    expect(en?.settings.capacityTokens).toBe(2048);
    expect(pl?.settings.capacityTokens).toBe(2048);
    expect(other?.settings.capacityTokens).toBe(2048);

    await repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "en", content: "EN signal", contentSha256: "e".repeat(64), estimatedTokens: 10, sourceSnapshot: source(), activationSource: "initial_version" });
    expect((await repo.getFieldGuideBundle("ai-a", "en"))?.activeVersion?.content).toBe("EN signal");
    expect((await repo.getFieldGuideBundle("ai-a", "pl"))?.activeVersion).toBeUndefined();
    expect((await repo.getFieldGuideBundle("ai-b", "en"))?.activeVersion).toBeUndefined();
  });

  it("keeps versions immutable and restore creates a new active version without overwriting history", async () => {
    const { repo } = repository();
    const v1 = await repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "en", content: "first", contentSha256: "1".repeat(64), estimatedTokens: 5, sourceSnapshot: source(), activationSource: "initial_version" });
    const v2 = await repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "en", content: "second", contentSha256: "2".repeat(64), estimatedTokens: 6, sourceSnapshot: source(), activationSource: "training_reflection" });
    const restored = await repo.restoreFieldGuideVersion("ai-a", "en", v1.id);
    const bundle = await repo.getFieldGuideBundle("ai-a", "en");
    expect(restored.versionNumber).toBe(3);
    expect(restored.id).not.toBe(v1.id);
    expect(restored.restoredFromVersionId).toBe(v1.id);
    expect(bundle?.versions.map((item) => item.content)).toEqual(["first", "second", "first"]);
    expect(bundle?.versions.find((item) => item.id === v2.id)?.activationStatus).toBe("historical");
    expect(bundle?.activeVersion?.id).toBe(restored.id);
  });

  it("supports only 2048/4096/8192 capacity and only changes settings, not historical versions", async () => {
    const { repo } = repository();
    const v1 = await repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "pl", content: "sygnał", contentSha256: "a".repeat(64), estimatedTokens: 8, sourceSnapshot: source(), activationSource: "initial_version" });
    for (const capacity of [4096, 8192, 2048] as const) {
      await repo.setFieldGuideCapacity("ai-a", "pl", capacity);
      expect((await repo.getFieldGuideBundle("ai-a", "pl"))?.settings.capacityTokens).toBe(capacity);
    }
    await expect(repo.setFieldGuideCapacity("ai-a", "pl", 3000 as 2048)).rejects.toThrow("Unsupported Field Guide capacity");
    expect((await repo.listFieldGuideVersions("ai-a", "pl")).find((item) => item.id === v1.id)?.capacityTokensAtCreation).toBe(2048);
  });

  it("preserves a custom legacy Profile prompt unresolved until the user explicitly links identity and language", async () => {
    const { repo, storage } = repository();
    storage.setItem("rvh.dev.profiles", JSON.stringify([{ id: "profile", defaultViewerSystemPrompt: "CUSTOM LEGACY VIEWER BODY", updatedAt: now }]));
    const baselines = await repo.listFieldGuideLegacyBaselines("profile");
    expect(baselines).toHaveLength(1);
    expect(baselines[0]).toMatchObject({ originalContent: "CUSTOM LEGACY VIEWER BODY", resolutionStatus: "unresolved" });
    expect(baselines[0].resolvedAiIdentityId).toBeUndefined();
    expect(baselines[0].resolvedLanguage).toBeUndefined();

    const resolved = await repo.resolveLegacyFieldGuideBaseline({ baselineId: baselines[0].id, aiIdentityId: "ai-a", language: "en", content: baselines[0].originalContent, contentSha256: "c".repeat(64), estimatedTokens: 7, sourceSnapshot: { schemaVersion: 1, sourceKind: "legacy-profile-baseline", profileId: "profile", capturedAt: now, legacyBaselineId: baselines[0].id } });
    expect(resolved.content).toBe("CUSTOM LEGACY VIEWER BODY");
    expect((await repo.listFieldGuideLegacyBaselines("profile"))[0]).toMatchObject({ resolutionStatus: "resolved", resolvedAiIdentityId: "ai-a", resolvedLanguage: "en", resolvedVersionId: resolved.id });
  });
  it("rejects cross-identity lineage and non-Viewer identities", async () => {
    const { repo, storage } = repository();
    const v1 = await repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "en", content: "first", contentSha256: "1".repeat(64), estimatedTokens: 5, sourceSnapshot: source(), activationSource: "initial_version" });
    await expect(repo.createFieldGuideVersion({ aiIdentityId: "ai-b", language: "en", content: "cross", contentSha256: "2".repeat(64), estimatedTokens: 5, sourceSnapshot: source(), previousVersionId: v1.id, activationSource: "initial_version" })).rejects.toThrow("lineage cannot cross Viewer identity or language");

    const identities = JSON.parse(storage.getItem("rvh.dev.ai_identities") ?? "[]") as AiIdentity[];
    storage.setItem("rvh.dev.ai_identities", JSON.stringify([...identities, { ...identity("ai-monitor", "monitor-model"), role: "monitor" }]));
    expect(await repo.getFieldGuideBundle("ai-monitor", "en")).toBeNull();
    await expect(repo.createFieldGuideVersion({ aiIdentityId: "ai-monitor", language: "en", content: "no", contentSha256: "3".repeat(64), estimatedTokens: 1, sourceSnapshot: source(), activationSource: "initial_version" })).rejects.toThrow("exact Viewer identity");
  });

  it("resolves only an unresolved legacy baseline and never links it across Profiles", async () => {
    const { repo, storage } = repository();
    const baseline = { id: "legacy-a", profileId: "profile", originalContent: "CUSTOM", sourceProfileUpdatedAt: now, resolutionStatus: "factory-equivalent", createdAt: now };
    storage.setItem("rvh.dev.field_guide_legacy_baselines", JSON.stringify([baseline]));
    await expect(repo.resolveLegacyFieldGuideBaseline({ baselineId: baseline.id, aiIdentityId: "ai-a", language: "en", content: "CUSTOM", contentSha256: "4".repeat(64), estimatedTokens: 2, sourceSnapshot: { schemaVersion: 1, sourceKind: "legacy-profile-baseline", profileId: "profile", capturedAt: now } })).rejects.toThrow("already resolved");

    storage.setItem("rvh.dev.field_guide_legacy_baselines", JSON.stringify([{ ...baseline, resolutionStatus: "unresolved", profileId: "another-profile" }]));
    await expect(repo.createFieldGuideVersion({ aiIdentityId: "ai-a", language: "en", content: "CUSTOM", contentSha256: "5".repeat(64), estimatedTokens: 2, sourceSnapshot: source("another-profile"), activationSource: "legacy_profile_baseline", legacyBaselineId: baseline.id })).rejects.toThrow("same Profile");
  });

});
