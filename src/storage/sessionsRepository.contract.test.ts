import { describe, expect, it } from "vitest";
import { BrowserSessionsRepository } from "./browser/sessionsRepository";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";
import type { SessionSnapshot } from "../sessions/types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const timestamp = "2026-09-08T15:00:00.000Z";

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
const sessionInput = {
  id: "session-a",
  workspaceId: "workspace-a",
  profileId: "profile-a",
  sessionCode: "RV-1234",
  runType: "automatic" as const,
  targetId: "target-a",
};

function minimalSnapshot(): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId: "session-a",
    sessionCode: "RV-1234",
    profileId: "profile-a",
    workspaceId: "workspace-a",
    providerConfigId: "provider-a",
    credentialId: "credential-a",
    provider: "openrouter",
    modelId: "model-a",
    modelRoute: "provider-a::model-a",
    capabilitySnapshot: {},
    capabilityCapturedAt: timestamp,
    generationSettings: { requested: { reasoningEffort: "none", temperature: 0.2, maxOutputTokens: 1024 }, effective: { reasoningEffort: "none", temperature: 0.2, maxOutputTokens: 1024 }, omitted: [] },
    sessionLanguage: "en",
    protocol: { id: "rcp", version: "1", language: "en", contentSha256: "protocol-hash", fullContent: "protocol" },
    controllerPrompt: { id: "controller", version: "1", language: "en" },
    revealSource: "automatic",
    targetId: "target-a",
    applicationVersion: "0.7.13",
    createdAt: timestamp,
  };
}

describe("browser Sessions repository contract", () => {
  it("preserves session keys, state, sealing, Reveal and target-use visibility", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserSessionsRepository({ storage, now: () => timestamp, isResearchScoresFrozen: () => true });
    const session = await repository.createRvSession(sessionInput);
    expect(session).toMatchObject({ state: "Draft", preRevealTranscript: "", postRevealTranscript: "", targetId: "target-a" });
    expect(repository.hasRecordedTargetUse("target-a")).toBe(true);

    await repository.updatePreRevealTranscript(session.id, "blind evidence");
    const evidenceHash = await sha256Text("blind evidence");
    await repository.sealPreReveal(session.id, "blind evidence", evidenceHash);
    await repository.acceptReveal(session.id, { source: "automatic_target", text: "target", hash: "reveal-hash" });

    expect((await repository.listRvSessions("workspace-a"))[0]).toMatchObject({ state: "Revealed", preRevealHash: evidenceHash });
    expect(await repository.getViewerEvidence(session.id)).toBe("blind evidence");
    expect(await repository.getReveal(session.id)).toEqual({ source: "automatic_target", text: "target", hash: "reveal-hash" });
    expect(JSON.parse(storage.getItem("rvh.dev.rv_sessions") ?? "[]")).toHaveLength(1);
    expect(JSON.parse(storage.getItem("rvh.dev.reveals") ?? "[]")).toHaveLength(1);
  });

  it("keeps snapshots immutable and event ordering stable", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserSessionsRepository({ storage, now: () => timestamp, isResearchScoresFrozen: () => true });
    await repository.createRvSession(sessionInput);
    await repository.saveSessionSnapshot("session-a", minimalSnapshot(), "snapshot-hash");
    await expect(repository.saveSessionSnapshot("session-a", minimalSnapshot(), "snapshot-hash-2")).rejects.toThrow("immutable");
    await repository.appendSessionEvent("session-a", { eventType: "ONE", role: "controller" });
    await repository.appendSessionEvent("session-a", { eventType: "TWO", role: "assistant", content: "data" });
    expect((await repository.listSessionEvents("session-a")).map((item) => [item.sequenceNumber, item.eventType])).toEqual([[1, "ONE"], [2, "TWO"]]);
  });


  it("returns the same bounded recent-session order across active Workspace scope", async () => {
    const storage = new MemoryStorage();
    storage.setItem("rvh.dev.rv_sessions", JSON.stringify([
      { ...sessionInput, id: "session-a1", sessionCode: "A1", state: "Draft", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", createdAt: "2026-09-08T10:00:00.000Z", updatedAt: "2026-09-08T12:00:00.000Z" },
      { ...sessionInput, id: "session-b1", workspaceId: "workspace-b", sessionCode: "B1", state: "Draft", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", createdAt: "2026-09-08T11:00:00.000Z", updatedAt: "2026-09-08T12:00:00.000Z" },
      { ...sessionInput, id: "session-a2", sessionCode: "A2", state: "Draft", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", createdAt: "2026-09-08T09:00:00.000Z", updatedAt: "2026-09-08T09:00:00.000Z" },
      { ...sessionInput, id: "session-archived-scope", workspaceId: "workspace-c", sessionCode: "C1", state: "Draft", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", createdAt: "2026-09-08T13:00:00.000Z", updatedAt: "2026-09-08T13:00:00.000Z" },
    ]));
    const repository = new BrowserSessionsRepository({ storage, now: () => timestamp, isResearchScoresFrozen: () => true });
    expect((await repository.listRecentRvSessions(["workspace-b", "workspace-a"], 2)).map((session) => session.id)).toEqual(["session-b1", "session-a1"]);
    expect(await repository.listRecentRvSessions(["workspace-a"], 0)).toEqual([]);
  });

  it("preserves Research frozen-score guards for post-Reveal turns and clarifications", async () => {
    let frozen = false;
    const storage = new MemoryStorage();
    const repository = new BrowserSessionsRepository({ storage, now: () => timestamp, isResearchScoresFrozen: () => frozen });
    await repository.createRvSession({ ...sessionInput, researchProjectId: "research-a" });
    await repository.sealPreReveal("session-a", "evidence", "hash");
    await repository.acceptReveal("session-a", { source: "automatic_target", hash: "reveal" });
    await expect(repository.appendPostRevealTurn("session-a", "user", "question")).rejects.toThrow("frozen scores");
    await expect(repository.addTargetClarification("session-a", "detail")).rejects.toThrow("frozen Judge scores");
    frozen = true;
    expect(await repository.appendPostRevealTurn("session-a", "user", "question")).toContain("question");
    expect(await repository.addTargetClarification("session-a", " detail ")).toMatchObject({ content: "detail" });
  });
});

describe("SQLite Sessions repository contract", () => {
  it("keeps session row mapping, creation SQL and ordering stable", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteSessionsRepository({
      select: async <T>(query: string) => query.includes("FROM rv_sessions WHERE workspace_id") ? [{ id: "session-a", workspace_id: "workspace-a", profile_id: "profile-a", session_code: "RV-1234", state: "Draft", run_type: "automatic", pre_reveal_transcript: "", pre_reveal_hash: null, pre_reveal_sealed_at: null, post_reveal_transcript: "", target_id: "target-a", research_project_id: null, created_at: timestamp, updated_at: timestamp, completed_at: null }] as T : [] as T,
      executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; },
      isResearchScoresFrozen: async () => true,
      now: () => timestamp,
    });
    expect(await repository.createRvSession(sessionInput)).toMatchObject({ id: "session-a", state: "Draft", targetId: "target-a" });
    expect(writes[0]?.query).toContain("INSERT INTO rv_sessions");
    expect((await repository.listRvSessions("workspace-a"))[0]).toMatchObject({ id: "session-a", targetId: "target-a" });
  });


  it("uses one bounded SQLite query for recent sessions across the supplied Workspace order", async () => {
    const selects: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteSessionsRepository({
      select: async <T>(query: string, values?: unknown[]) => {
        selects.push({ query, values });
        return [{ id: "session-b1", workspace_id: "workspace-b", profile_id: "profile-a", session_code: "B1", state: "Draft", run_type: "automatic", pre_reveal_transcript: "", pre_reveal_hash: null, pre_reveal_sealed_at: null, post_reveal_transcript: "", target_id: "target-a", research_project_id: null, created_at: "2026-09-08T11:00:00.000Z", updated_at: "2026-09-08T12:00:00.000Z", completed_at: null }] as T;
      },
      executeWrite: async () => ({ rowsAffected: 1 }),
      isResearchScoresFrozen: async () => true,
      now: () => timestamp,
    });
    expect((await repository.listRecentRvSessions(["workspace-b", "workspace-a"], 2)).map((session) => session.id)).toEqual(["session-b1"]);
    expect(selects).toHaveLength(1);
    expect(selects[0]?.query).toContain("WHERE workspace_id IN ($1, $2)");
    expect(selects[0]?.query).toContain("ORDER BY updated_at DESC");
    expect(selects[0]?.query).toContain("CASE workspace_id WHEN $1 THEN 0 WHEN $2 THEN 1");
    expect(selects[0]?.query).toContain("LIMIT $3");
    expect(selects[0]?.values).toEqual(["workspace-b", "workspace-a", 2]);
  });

  it("preserves atomic-Reveal ownership in SQLite as a single reveal insert", async () => {
    const writes: string[] = [];
    const repository = new SqliteSessionsRepository({
      select: async <T>() => [] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      isResearchScoresFrozen: async () => true,
      now: () => timestamp,
    });
    await repository.acceptReveal("session-a", { source: "external_text", text: "target", hash: "reveal-hash" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("INSERT INTO reveals");
    expect(writes[0]).not.toContain("UPDATE rv_sessions");
  });

  it("preserves Research post-Reveal guard and the transcript-plus-event write sequence", async () => {
    const writes: string[] = [];
    let frozen = false;
    const repository = new SqliteSessionsRepository({
      select: async <T>(query: string) => query.startsWith("SELECT state") ? [{ state: "Revealed", post_reveal_transcript: "", research_project_id: "research-a" }] as T : [] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      isResearchScoresFrozen: async () => frozen,
      now: () => timestamp,
    });
    await expect(repository.appendPostRevealTurn("session-a", "assistant", "review")).rejects.toThrow("frozen scores");
    frozen = true;
    expect(await repository.appendPostRevealTurn("session-a", "assistant", "review")).toContain("review");
    expect(writes.map((query) => query.includes("session_events") ? "event" : query.includes("post_reveal_transcript") ? "transcript" : "other")).toEqual(["transcript", "event"]);
  });

  it("keeps target clarification persistence delegated to the database guards", async () => {
    const writes: string[] = [];
    const repository = new SqliteSessionsRepository({
      select: async <T>() => [] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      isResearchScoresFrozen: async () => true,
      now: () => timestamp,
    });
    expect(await repository.addTargetClarification("session-a", " detail ")).toMatchObject({ content: "detail", createdAt: timestamp });
    expect(writes[0]).toContain("INSERT INTO target_clarifications");
  });
});
