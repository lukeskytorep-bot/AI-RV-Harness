import { describe, expect, it } from "vitest";
import type { CreateJudgeRunInput, FrozenJudgeScoreInput } from "../judge/types";
import { BrowserJudgeRepository } from "./browser/judgeRepository";
import { SqliteJudgeRepository } from "./sqlite/judgeRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function run(id: string, sessionId: string, judgeIndex: number): CreateJudgeRunInput {
  return { id, sessionId, judgeIndex, modelRoute: `openrouter:judge-${judgeIndex}`, rubricVersion: "3-3-2-2/v1", anonymousSessionId: `Blind-${sessionId}`, packetHash: `packet-${id}` };
}
function score(id: string, runId: string, gestalt = 2): FrozenJudgeScoreInput {
  return { id, judgeRunId: runId, gestalt, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1, narrative: { strongestMatches: ["structure"], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "R" } };
}

describe("Browser Judge repository", () => {
  it("keeps the existing keys, computes totals and lists scores in judge order", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserJudgeRepository({ storage, now: () => "2026-09-08T20:00:00.000Z" });
    await repository.recordFrozenJudgeResults([
      { run: run("run-2", "session-a", 2), score: score("score-2", "run-2", 1) },
      { run: run("run-1", "session-a", 1), score: score("score-1", "run-1", 2) },
    ]);
    expect(storage.getItem("rvh.dev.judge_runs")).not.toBeNull();
    expect(storage.getItem("rvh.dev.judge_scores")).not.toBeNull();
    const listed = await repository.listJudgeScores("session-a");
    expect(listed.map((item) => item.judgeIndex)).toEqual([1, 2]);
    expect(listed[0]).toMatchObject({ total: 6, modelRoute: "openrouter:judge-1", frozenAt: "2026-09-08T20:00:00.000Z" });
  });

  it("rejects duplicate judge indexes without adding a second frozen result", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserJudgeRepository({ storage, now: () => "now" });
    await repository.recordFrozenJudgeResult(run("run-1", "session-a", 1), score("score-1", "run-1"));
    await expect(repository.recordFrozenJudgeResult(run("run-x", "session-a", 1), score("score-x", "run-x"))).rejects.toThrow("Judge index is already recorded");
    expect((await repository.listJudgeScores("session-a"))).toHaveLength(1);
  });

  it("preserves the empty batch as a no-op", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserJudgeRepository({ storage });
    expect(await repository.recordFrozenJudgeResults([])).toEqual([]);
    expect(storage.length).toBe(0);
  });
});

describe("SQLite Judge repository", () => {
  it("persists each run+score pair in one transaction preserving frozen metadata", async () => {
    const transactions: Array<Array<{ query: string; values?: unknown[] }>> = [];
    const repository = new SqliteJudgeRepository({
      now: () => "2026-09-08T20:00:00.000Z",
      select: async <T>() => [] as T,
      executeTransaction: async (statements) => { transactions.push(statements); return {}; },
    });
    const result = await repository.recordFrozenJudgeResults([
      { run: run("run-1", "session-a", 1), score: score("score-1", "run-1") },
      { run: run("run-2", "session-a", 2), score: score("score-2", "run-2") },
    ]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toHaveLength(4);
    expect(transactions[0][0].query).toContain("INSERT INTO judge_runs");
    expect(transactions[0][1].query).toContain("INSERT INTO judge_scores");
    expect(result.map((item) => item.judgeIndex)).toEqual([1, 2]);
  });

  it("maps the existing join result including narrative JSON", async () => {
    const row = { id: "score-1", judge_run_id: "run-1", judge_index: 1, model_route: "openrouter:judge-1", gestalt: 2, verifiable_features: 2, activity_function_event: 1, confabulation_control: 1, total: 6, rationale_json: JSON.stringify(score("score-1", "run-1").narrative), frozen_at: "frozen", created_at: "created" };
    const repository = new SqliteJudgeRepository({ select: async <T>() => [row] as T, executeTransaction: async () => ({}) });
    expect(await repository.listJudgeScores("session-a")).toEqual([expect.objectContaining({ id: "score-1", judgeIndex: 1, total: 6, narrative: score("score-1", "run-1").narrative })]);
  });
});
