import { describe, expect, it } from "vitest";
import type { CommitViewerNoteReflectionInput, EnsureAiIdentityInput, ViewerNoteReflectionRun } from "../aiCenter/types";
import { BrowserAiCenterRepository } from "./browser/aiCenterRepository";
import { SqliteAiCenterRepository } from "./sqlite/aiCenterRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function sequenceClock() {
  let tick = 0;
  return () => `2026-09-08T12:00:${String(tick++).padStart(2, "0")}.000Z`;
}

function identityInput(role: "viewer" | "monitor" | "judge" = "viewer"): EnsureAiIdentityInput {
  return {
    profileId: "profile-a",
    credentialFingerprint: "cred-a",
    credentialDisplay: "…AAAA",
    providerConfigId: "provider-config-a",
    provider: "openrouter",
    baseUrl: "HTTPS://EXAMPLE.TEST/v1///",
    modelId: `${role}-model`,
    modelRoute: `openrouter:${role}-model`,
    modelDisplayName: `${role} model`,
    role,
  };
}

function updateInput(aiIdentityId: string, runId = "reflection-a", baseVersionId?: string, baseContentSha256?: string): CommitViewerNoteReflectionInput {
  return {
    runId,
    aiIdentityId,
    sourceSessionId: "session-a",
    sourceWorkspaceId: "workspace-a",
    ...(baseVersionId ? { baseVersionId } : {}),
    ...(baseContentSha256 ? { baseContentSha256 } : {}),
    decision: "UPDATE",
    notes: "Prefer concrete sensory descriptions.",
    contentSha256: "notes-sha",
    estimatedTokens: 12,
    capacityTokens: 1024,
    protocolId: "full-rcp",
    sessionRunType: "automatic",
    changeSummary: "Created notes.",
    reflectionPacketSha256: "packet-sha",
    modelRouteSnapshot: "openrouter:viewer-model",
    generationSettingsSnapshot: { requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] },
    rawFinalResponseSha256: "response-sha",
  };
}

function browserHarness() {
  const storage = new MemoryStorage();
  let id = 0;
  return {
    storage,
    repository: new BrowserAiCenterRepository({
      storage,
      now: sequenceClock(),
      createId: (prefix) => `${prefix}-${++id}`,
    }),
  };
}

describe("Browser AI Center repository contract", () => {
  it("keeps AI identity keys stable, normalizes base URLs and upserts the same identity", async () => {
    const { repository, storage } = browserHarness();
    const first = await repository.ensureAiIdentity(identityInput());
    const second = await repository.ensureAiIdentity({ ...identityInput(), providerConfigId: "provider-config-b", credentialDisplay: "…BBBB" });
    expect(second.id).toBe(first.id);
    expect(second.normalizedBaseUrl).toBe("https://example.test/v1");
    expect(second.providerConfigId).toBe("provider-config-b");
    expect(JSON.parse(storage.getItem("rvh.dev.ai_identities") ?? "[]")).toHaveLength(1);
    expect(JSON.parse(storage.getItem("rvh.dev.ai_note_settings") ?? "[]")).toMatchObject([{ aiIdentityId: first.id, capacityTokens: 1024, defaultEnabled: true }]);
  });

  it("does not create Viewer Notes settings for Monitor/Judge identities", async () => {
    const { repository, storage } = browserHarness();
    await repository.ensureAiIdentity(identityInput("monitor"));
    await repository.ensureAiIdentity(identityInput("judge"));
    expect(JSON.parse(storage.getItem("rvh.dev.ai_note_settings") ?? "[]")).toEqual([]);
  });

  it("bootstraps missing Viewer Notes settings when reading an existing viewer identity", async () => {
    const { repository, storage } = browserHarness();
    const identity = await repository.ensureAiIdentity(identityInput());
    storage.removeItem("rvh.dev.ai_note_settings");
    const bundle = await repository.getViewerNoteBundle(identity.id);
    expect(bundle?.settings).toMatchObject({ aiIdentityId: identity.id, capacityTokens: 1024, defaultEnabled: true });
    expect(storage.getItem("rvh.dev.ai_note_settings")).not.toBeNull();
  });

  it("creates the first Viewer Notes version, activation and active pointer exactly once", async () => {
    const { repository } = browserHarness();
    const identity = await repository.ensureAiIdentity(identityInput());
    await repository.beginViewerNoteReflection({ id: "reflection-a", aiIdentityId: identity.id, sourceSessionId: "session-a", sourceWorkspaceId: "workspace-a", reflectionPacketSha256: "packet-sha", packetJson: "{}" });
    const first = await repository.commitViewerNoteReflection(updateInput(identity.id));
    const second = await repository.commitViewerNoteReflection(updateInput(identity.id));
    const bundle = await repository.getViewerNoteBundle(identity.id);
    expect(first.status).toBe("UPDATE");
    expect(second.version?.id).toBe(first.version?.id);
    expect(bundle?.versions).toHaveLength(1);
    expect(bundle?.activationEvents).toHaveLength(1);
    expect(bundle?.activationEvents[0].activationSource).toBe("initial_version");
    expect(bundle?.activeVersion?.id).toBe(first.version?.id);
  });

  it("returns STALE_BASE without creating a second version when active notes changed", async () => {
    const { repository } = browserHarness();
    const identity = await repository.ensureAiIdentity(identityInput());
    await repository.beginViewerNoteReflection({ id: "reflection-a", aiIdentityId: identity.id, sourceSessionId: "session-a", sourceWorkspaceId: "workspace-a", reflectionPacketSha256: "packet-sha", packetJson: "{}" });
    const first = await repository.commitViewerNoteReflection(updateInput(identity.id));
    await repository.beginViewerNoteReflection({ id: "reflection-b", aiIdentityId: identity.id, sourceSessionId: "session-b", sourceWorkspaceId: "workspace-a", baseVersionId: first.version!.id, baseContentSha256: first.version!.contentSha256, reflectionPacketSha256: "packet-b", packetJson: "{}" });
    const stale = await repository.commitViewerNoteReflection({ ...updateInput(identity.id, "reflection-b", "wrong-version", "wrong-sha"), sourceSessionId: "session-b" });
    expect(stale).toEqual({ status: "STALE_BASE" });
    expect(await repository.listViewerNoteVersions(identity.id)).toHaveLength(1);
    expect((await repository.listViewerNoteReflectionRuns(identity.id)).find((run) => run.id === "reflection-b")?.status).toBe("STALE_BASE");
  });

  it("preserves NO_CHANGE and failed-reflection attempt accounting", async () => {
    const { repository } = browserHarness();
    const identity = await repository.ensureAiIdentity(identityInput());
    await repository.beginViewerNoteReflection({ id: "no-change", aiIdentityId: identity.id, sourceSessionId: "session-nc", sourceWorkspaceId: "workspace-a", reflectionPacketSha256: "packet-nc", packetJson: "{}" });
    const noChange = await repository.commitViewerNoteReflection({ ...updateInput(identity.id, "no-change"), sourceSessionId: "session-nc", decision: "NO_CHANGE", notes: undefined, contentSha256: undefined, estimatedTokens: undefined });
    expect(noChange).toEqual({ status: "NO_CHANGE" });
    await repository.beginViewerNoteReflection({ id: "failed", aiIdentityId: identity.id, sourceSessionId: "session-f", sourceWorkspaceId: "workspace-a", reflectionPacketSha256: "packet-f", packetJson: "{}" });
    await repository.failViewerNoteReflection("failed", "FAILED_PROVIDER", "network", "req-1", "raw-sha", 2);
    expect((await repository.listViewerNoteReflectionRuns(identity.id)).find((run) => run.id === "failed")).toMatchObject({ status: "FAILED_PROVIDER", attemptCount: 2, providerRequestId: "req-1", rawFinalResponseSha256: "raw-sha" });
  });

  it("blocks capacity reductions below active notes and records human restores", async () => {
    const { repository } = browserHarness();
    const identity = await repository.ensureAiIdentity(identityInput());
    await repository.beginViewerNoteReflection({ id: "reflection-a", aiIdentityId: identity.id, sourceSessionId: "session-a", sourceWorkspaceId: "workspace-a", reflectionPacketSha256: "packet-sha", packetJson: "{}" });
    const first = await repository.commitViewerNoteReflection({ ...updateInput(identity.id), estimatedTokens: 1500, capacityTokens: 2048 });
    await repository.setViewerNoteCapacity(identity.id, 2048);
    await expect(repository.setViewerNoteCapacity(identity.id, 1024)).rejects.toThrow("Capacity cannot be reduced");
    await repository.restoreViewerNoteVersion(identity.id, first.version!.id, "workspace-restore");
    expect((await repository.listViewerNoteActivationEvents(identity.id))[0]).toMatchObject({ activationSource: "human_restore", workspaceId: "workspace-restore", toVersionId: first.version!.id });
  });
});

function identityRow() {
  return {
    id: "ai-1", profile_id: "profile-a", credential_fingerprint: "cred-a", credential_display: "…AAAA", provider_config_id: "provider-config-a",
    provider: "openrouter", normalized_base_url: "https://example.test/v1", model_id: "viewer-model", model_route: "openrouter:viewer-model", model_display_name: "viewer model",
    role: "viewer", route_status: "available", first_used_at: "2026-09-08T12:00:00.000Z", last_used_at: "2026-09-08T12:00:00.000Z", created_at: "2026-09-08T12:00:00.000Z", updated_at: "2026-09-08T12:00:00.000Z",
  };
}

function reflectionRow(status: ViewerNoteReflectionRun["status"] = "PENDING") {
  return { id: "reflection-a", ai_identity_id: "ai-1", note_type: "viewer_self_notes", source_session_id: "session-a", source_workspace_id: "workspace-a", base_version_id: null, base_content_sha256: null, reflection_packet_sha256: "packet-sha", packet_json: "{}", attempt_count: 0, status, provider_request_id: null, raw_final_response_sha256: null, change_summary: null, failure_message: null, created_at: "2026-09-08T12:00:00.000Z", completed_at: null };
}

function versionRow() {
  return { id: "ai_note_version-1", ai_identity_id: "ai-1", version_number: 1, content: "Prefer concrete sensory descriptions.", content_sha256: "notes-sha", estimated_tokens: 12, estimator_version: "conservative-char-v1", capacity_tokens_at_creation: 1024, source_session_id: "session-a", source_workspace_id: "workspace-a", protocol_id: "full-rcp", session_run_type: "automatic", change_summary: "Created notes.", base_version_id: null, base_content_sha256: null, reflection_run_id: "reflection-a", reflection_packet_sha256: "packet-sha", model_route_snapshot: "openrouter:viewer-model", generation_settings_json: JSON.stringify({ requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] }), upstream_provider_snapshot: null, created_at: "2026-09-08T12:00:01.000Z" };
}

describe("SQLite AI Center repository contract", () => {
  it("creates viewer identities and default note settings in one transaction", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    const repository = new SqliteAiCenterRepository({
      now: () => "2026-09-08T12:00:00.000Z", createId: () => "ai-1",
      select: async <T>() => [] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (statements) => { transactions.push(statements); return {}; },
    });
    const created = await repository.ensureAiIdentity(identityInput());
    expect(created.normalizedBaseUrl).toBe("https://example.test/v1");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toHaveLength(2);
    expect(transactions[0][0].query).toContain("INSERT INTO ai_identities");
    expect(transactions[0][1].query).toContain("INSERT INTO ai_note_settings");
  });

  it("updates an existing AI identity without creating a second row", async () => {
    const writes: string[] = [];
    const repository = new SqliteAiCenterRepository({
      now: () => "2026-09-08T12:01:00.000Z", select: async <T>() => [identityRow()] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      executeTransaction: async () => ({}),
    });
    const updated = await repository.ensureAiIdentity({ ...identityInput(), credentialDisplay: "…BBBB" });
    expect(writes).toEqual([expect.stringContaining("UPDATE ai_identities")]);
    expect(updated).toMatchObject({ id: "ai-1", credentialDisplay: "…BBBB", routeStatus: "available" });
  });

  it("keeps begin-reflection idempotent for an existing identity/session pair", async () => {
    const writes: string[] = [];
    const repository = new SqliteAiCenterRepository({
      select: async <T>() => [reflectionRow()] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      executeTransaction: async () => ({}),
    });
    const run = await repository.beginViewerNoteReflection({ id: "another-id", aiIdentityId: "ai-1", sourceSessionId: "session-a", sourceWorkspaceId: "workspace-a", reflectionPacketSha256: "packet-sha", packetJson: "{}" });
    expect(run.id).toBe("reflection-a");
    expect(writes).toEqual([]);
  });

  it("commits UPDATE as the existing four-statement transaction and returns the persisted version", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    const repository = new SqliteAiCenterRepository({
      now: () => "2026-09-08T12:00:01.000Z", createId: (prefix) => `${prefix}-1`,
      select: async <T>(query: string) => {
        if (query.includes("FROM ai_note_reflection_runs WHERE id")) return [reflectionRow()] as T;
        if (query.includes("MAX(version_number)")) return [{ next_number: 1 }] as T;
        if (query.includes("FROM ai_note_versions WHERE id")) return [versionRow()] as T;
        return [] as T;
      },
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (statements) => { transactions.push(statements); return {}; },
    });
    const result = await repository.commitViewerNoteReflection(updateInput("ai-1"));
    expect(result).toMatchObject({ status: "UPDATE", version: { id: "ai_note_version-1", versionNumber: 1 } });
    expect(transactions[0].map((statement) => statement.query)).toEqual([
      expect.stringContaining("INSERT INTO ai_note_versions"),
      expect.stringContaining("INSERT INTO ai_note_activation_events"),
      expect.stringContaining("UPDATE ai_note_settings SET active_version_id"),
      expect.stringContaining("UPDATE ai_note_reflection_runs SET status = 'UPDATE'"),
    ]);
  });

  it("translates the SQLite STALE_BASE guard into a durable reflection status", async () => {
    const writes: string[] = [];
    const repository = new SqliteAiCenterRepository({
      now: () => "2026-09-08T12:00:01.000Z", createId: (prefix) => `${prefix}-1`,
      select: async <T>(query: string) => query.includes("MAX(version_number)") ? [{ next_number: 2 }] as T : [reflectionRow()] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      executeTransaction: async () => { throw new Error("STALE_BASE"); },
    });
    const result = await repository.commitViewerNoteReflection(updateInput("ai-1"));
    expect(result).toEqual({ status: "STALE_BASE" });
    expect(writes).toEqual([expect.stringContaining("SET status = 'STALE_BASE'")]);
  });

  it("keeps the capacity preflight before the settings write", async () => {
    const writes: string[] = [];
    const repository = new SqliteAiCenterRepository({
      select: async <T>() => [{ estimated_tokens: 1500 }] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      executeTransaction: async () => ({}),
    });
    await expect(repository.setViewerNoteCapacity("ai-1", 1024)).rejects.toThrow("Capacity cannot be reduced");
    expect(writes).toEqual([]);
  });

  it("restores a version with the existing settings+activation transaction and capacity guard", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    const repository = new SqliteAiCenterRepository({
      now: () => "2026-09-08T12:03:00.000Z", createId: () => "activation-1",
      select: async <T>() => [{ active_version_id: "old-version", capacity_tokens: 2048, estimated_tokens: 1200 }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (statements) => { transactions.push(statements); return {}; },
    });
    await repository.restoreViewerNoteVersion("ai-1", "version-1", "workspace-a");
    expect(transactions[0]).toHaveLength(2);
    expect(transactions[0][0].query).toContain("UPDATE ai_note_settings SET active_version_id");
    expect(transactions[0][1].query).toContain("'human_restore'");
  });
});
