import { describe, expect, it } from "vitest";
import type { RvSession } from "../sessions/types";
import { BrowserMonitorRepository } from "./browser/monitorRepository";
import { SqliteMonitorRepository } from "./sqlite/monitorRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function session(id: string, workspaceId: string, sessionCode: string): RvSession {
  return { id, workspaceId, profileId: "profile-a", sessionCode, state: "BlindRunning", runType: "automatic_monitor", preRevealTranscript: "", postRevealTranscript: "", createdAt: "2026-09-08T12:00:00.000Z", updatedAt: "2026-09-08T12:00:00.000Z" };
}

describe("Browser Monitor repository contract", () => {
  it("keeps storage keys, ordered interventions and workspace/session-code mapping", async () => {
    const storage = new MemoryStorage();
    let tick = 0; let id = 0;
    const repository = new BrowserMonitorRepository({
      storage,
      now: () => `2026-09-08T12:00:0${tick++}.000Z`,
      createId: (prefix) => `${prefix}-${++id}`,
      listRvSessions: async (workspaceId) => workspaceId === "workspace-a" ? [session("session-a", "workspace-a", "RV-001")] : [],
    });
    const runId = await repository.createMonitorRun({ sessionId: "session-a", modelRoute: "route-a", libraryVersion: "1", maxInterventions: 3 });
    await repository.appendMonitorIntervention(runId, { decision: "CONTINUE_PROTOCOL" });
    await repository.appendMonitorIntervention(runId, { decision: "INTERVENE", commandText: "Describe shape." });
    expect(storage.getItem("rvh.dev.monitor_runs")).not.toBeNull();
    expect(storage.getItem("rvh.dev.monitor_interventions")).not.toBeNull();
    expect(await repository.listMonitorInterventions(runId)).toMatchObject([{ sequenceNumber: 1 }, { sequenceNumber: 2 }]);
    expect(await repository.listMonitorRuns("workspace-a")).toMatchObject([{ id: runId, sessionCode: "RV-001", interventionCount: 2 }]);
  });

  it("does not leak runs from sessions outside the selected Workspace", async () => {
    const storage = new MemoryStorage(); let id = 0;
    const repository = new BrowserMonitorRepository({ storage, createId: (prefix) => `${prefix}-${++id}`, now: () => "2026-09-08T12:00:00.000Z", listRvSessions: async () => [] });
    await repository.createMonitorRun({ sessionId: "session-other", modelRoute: "route", libraryVersion: "1", maxInterventions: 1 });
    expect(await repository.listMonitorRuns("workspace-a")).toEqual([]);
  });
});

describe("SQLite Monitor repository contract", () => {
  it("keeps the existing monitor-run INSERT", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteMonitorRepository({ select: async <T>() => [] as T, executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; }, createId: () => "monitor-1", now: () => "2026-09-08T12:00:00.000Z" });
    expect(await repository.createMonitorRun({ sessionId: "session-a", modelRoute: "route-a", promptVersionId: "p1", libraryVersion: "1", maxInterventions: 4 })).toBe("monitor-1");
    expect(writes[0].query).toContain("INSERT INTO monitor_runs");
    expect(writes[0].values).toEqual(["monitor-1", "session-a", "route-a", "p1", "1", 4, "2026-09-08T12:00:00.000Z"]);
  });

  it("keeps atomic next intervention sequencing inside the INSERT SELECT", async () => {
    const writes: string[] = [];
    const repository = new SqliteMonitorRepository({ select: async <T>() => [] as T, executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; }, createId: () => "event-1", now: () => "2026-09-08T12:00:00.000Z" });
    await repository.appendMonitorIntervention("monitor-1", { decision: "INTERVENE", commandText: "Continue." });
    expect(writes[0]).toContain("COALESCE(MAX(sequence_number), 0) + 1");
    expect(writes[0]).toContain("FROM monitor_interventions WHERE monitor_run_id = $2");
  });

  it("maps workspace Monitor runs with session code and intervention count", async () => {
    const repository = new SqliteMonitorRepository({
      select: async <T>(query: string) => query.includes("FROM monitor_runs") ? [{ id: "monitor-1", session_id: "session-a", session_code: "RV-001", model_route: "route", prompt_version_id: null, library_version: "1", max_interventions: 3, created_at: "2026-09-08T12:00:00.000Z", intervention_count: 2 }] as T : [] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
    });
    expect(await repository.listMonitorRuns("workspace-a")).toEqual([{ id: "monitor-1", sessionId: "session-a", sessionCode: "RV-001", modelRoute: "route", libraryVersion: "1", maxInterventions: 3, createdAt: "2026-09-08T12:00:00.000Z", interventionCount: 2 }]);
  });

  it("maps ordered Monitor interventions without inventing optional fields", async () => {
    const repository = new SqliteMonitorRepository({
      select: async <T>() => [{ id: "event-1", monitor_run_id: "monitor-1", sequence_number: 1, decision: "CONTINUE_PROTOCOL", command_id: null, viewer_evidence: null, command_text: null, rationale: null, created_at: "2026-09-08T12:00:00.000Z" }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }),
    });
    expect(await repository.listMonitorInterventions("monitor-1")).toEqual([{ id: "event-1", monitorRunId: "monitor-1", sequenceNumber: 1, decision: "CONTINUE_PROTOCOL", createdAt: "2026-09-08T12:00:00.000Z" }]);
  });
});
