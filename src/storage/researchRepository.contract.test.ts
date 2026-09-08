import { describe, expect, it } from "vitest";
import type { ResearchConfig, ResearchLockPlan, ResearchProjectRecord, ResearchResults } from "../research/types";
import { BrowserResearchRepository } from "./browser/researchRepository";
import { SqliteResearchRepository } from "./sqlite/researchRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const config: ResearchConfig = {
  schemaVersion: 1, name: " Research A ", workspaceId: "workspace-a", templateType: "model", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" },
  targetIds: ["target-a"], repetitions: 1, requireUnusedTargets: false,
  conditions: [{ key: "a", label: "A", profileId: "profile-a", providerConfigId: "provider-a", modelId: "model-a", requestedSettings: {} }],
  judges: [{ providerConfigId: "provider-a", modelId: "judge-a" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
};
const plan: ResearchLockPlan = {
  configHash: "config-hash",
  conditions: [{ id: "condition-a", researchProjectId: "research-1", conditionKey: "a", config: config.conditions[0] }],
  assignments: [{ id: "assignment-a", researchProjectId: "research-1", anonymousSessionId: "Blind-A", targetId: "target-a", executionOrder: 1, judgeOrder: 1, status: "Pending" }],
  mappings: [{ id: "mapping-a", researchProjectId: "research-1", anonymousSessionId: "Blind-A", conditionId: "condition-a", pairKey: "pair-a", mappingHash: "mapping-hash", createdAt: "2026-09-08T20:00:00.000Z" }],
};
const results: ResearchResults = { schemaVersion: 1, projectId: "research-1", templateType: "model", sessions: [], conditions: [], pairwise: [], computedAt: "2026-09-08T20:05:00.000Z" };

function clock() { let n = 0; return () => `2026-09-08T20:00:0${n++}.000Z`; }

describe("Browser Research repository", () => {
  it("creates, filters and transitions projects while freezing timestamps only once", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserResearchRepository({ storage, now: clock(), createId: () => "research-1" });
    const created = await repository.createResearchProject(config);
    expect(created).toMatchObject({ id: "research-1", name: "Research A", state: "Draft" });
    await repository.setResearchProjectState(created.id, "ScoresFrozen");
    const frozen = await repository.getResearchProject(created.id);
    expect(frozen?.scoresFrozenAt).toBeDefined();
    const firstFrozenAt = frozen?.scoresFrozenAt;
    await repository.setResearchProjectState(created.id, "ScoresFrozen");
    expect((await repository.getResearchProject(created.id))?.scoresFrozenAt).toBe(firstFrozenAt);
    expect(repository.isScoresFrozen(created.id)).toBe(true);
    expect((await repository.listResearchProjects("workspace-a"))).toHaveLength(1);
  });

  it("locks methodology and keeps conditions/assignments/blinding mappings in their existing keys", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserResearchRepository({ storage, now: () => "2026-09-08T20:00:00.000Z", createId: () => "research-1" });
    await repository.createResearchProject(config);
    await repository.lockResearchProject("research-1", plan);
    expect((await repository.getResearchProject("research-1"))).toMatchObject({ state: "Locked", configHash: "config-hash" });
    expect(await repository.listResearchConditions("research-1")).toHaveLength(1);
    expect(await repository.listResearchAssignments("research-1")).toHaveLength(1);
    expect(await repository.listBlindingMappings("research-1")).toHaveLength(1);
    expect(storage.getItem("rvh.dev.research_projects")).not.toBeNull();
    expect(storage.getItem("rvh.dev.blinding_mappings")).not.toBeNull();
    expect(repository.hasRecordedTargetUse("target-a")).toBe(true);
  });

  it("preserves assignment updates and immutable Research results", async () => {
    const storage = new MemoryStorage();
    let id = 0;
    const repository = new BrowserResearchRepository({ storage, now: () => "now", createId: (prefix) => `${prefix}-${++id}` });
    await repository.createResearchProject(config);
    const effectivePlan = { ...plan, conditions: plan.conditions.map((x) => ({ ...x, researchProjectId: "research-1" })), assignments: plan.assignments.map((x) => ({ ...x, researchProjectId: "research-1" })), mappings: plan.mappings.map((x) => ({ ...x, researchProjectId: "research-1" })) };
    await repository.lockResearchProject("research-1", effectivePlan);
    await repository.updateResearchAssignment("assignment-a", "session-a", "SessionComplete");
    expect((await repository.listResearchAssignments("research-1"))[0]).toMatchObject({ sessionId: "session-a", status: "SessionComplete" });
    await repository.saveResearchResults("research-1", results, "results-hash");
    expect(await repository.getResearchResults("research-1")).toEqual(results);
    await expect(repository.saveResearchResults("research-1", results, "second")).rejects.toThrow("Research results are immutable once written.");
  });

  it("keeps the existing lock-state guard", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserResearchRepository({ storage, now: () => "now", createId: () => "research-1" });
    await repository.createResearchProject(config);
    await repository.setResearchProjectState("research-1", "Running");
    await expect(repository.lockResearchProject("research-1", plan)).rejects.toThrow("Research project cannot be locked from its current state.");
  });
});

describe("SQLite Research repository", () => {
  it("preserves the project row mapping and create SQL", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteResearchRepository({
      now: () => "2026-09-08T20:00:00.000Z", createId: () => "research-1",
      select: async <T>() => [] as T,
      executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; }, executeTransaction: async () => ({}),
    });
    const created = await repository.createResearchProject(config);
    expect(created).toMatchObject({ id: "research-1", name: "Research A", state: "Draft" });
    expect(writes[0].query).toContain("INSERT INTO research_projects");
  });

  it("locks conditions, assignments, mappings and project state in one transaction", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    const repository = new SqliteResearchRepository({
      now: () => "2026-09-08T20:00:00.000Z", select: async <T>() => [{ state: "Preflight" }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction: async (statements) => { transactions.push(statements); return {}; },
    });
    await repository.lockResearchProject("research-1", plan);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].map((s) => s.query)).toEqual([
      expect.stringContaining("INSERT INTO research_conditions"),
      expect.stringContaining("INSERT INTO research_assignments"),
      expect.stringContaining("INSERT INTO blinding_mappings"),
      expect.stringContaining("UPDATE research_projects SET state = 'Locked'"),
    ]);
  });

  it("preserves ScoresFrozen/Unblinded timestamp SQL and helper lookup", async () => {
    const writes: string[] = [];
    const repository = new SqliteResearchRepository({
      now: () => "now", select: async <T>(query: string) => query.includes("scores_frozen_at") ? [{ scores_frozen_at: "frozen" }] as T : [] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; }, executeTransaction: async () => ({}),
    });
    expect(await repository.isScoresFrozen("research-1")).toBe(true);
    await repository.setResearchProjectState("research-1", "Unblinded");
    expect(writes[0]).toContain("unblinded_at = CASE WHEN $1 = 'Unblinded'");
  });

  it("rejects incomplete locked assignment rows exactly as before", async () => {
    const repository = new SqliteResearchRepository({
      select: async <T>() => [{ id: "a", research_project_id: "r", anonymous_session_id: "Blind", session_id: null, target_id: null, execution_order: 1, judge_order: null, status: "Pending" }] as T,
      executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction: async () => ({}),
    });
    await expect(repository.listResearchAssignments("r")).rejects.toThrow("Locked Research assignment is incomplete.");
  });

  it("keeps Research results insert-once behavior", async () => {
    let exists = false;
    const writes: string[] = [];
    const repository = new SqliteResearchRepository({
      now: () => "now", createId: () => "results-1",
      select: async <T>(query: string) => query.includes("FROM research_results") ? (exists ? [{ id: "results-1" }] : []) as T : [] as T,
      executeWrite: async (query) => { writes.push(query); exists = true; return { rowsAffected: 1 }; }, executeTransaction: async () => ({}),
    });
    await repository.saveResearchResults("research-1", results, "hash");
    expect(writes[0]).toContain("INSERT INTO research_results");
    await expect(repository.saveResearchResults("research-1", results, "hash-2")).rejects.toThrow("Research results are immutable once written.");
  });
});
