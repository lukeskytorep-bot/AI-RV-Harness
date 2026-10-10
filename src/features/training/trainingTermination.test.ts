import { describe, expect, it } from "vitest";
import { BrowserTrainingRepository } from "../../storage/browser/trainingRepository";
import type { TrainingRunRecord } from "../../training/types";
import { endTrainingRun } from "./trainingTermination";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function run(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    id: "run-1", runNumber: 1, name: "Training", status: "Interrupted", mode: "partial",
    profileId: "p", workspaceId: "w", modelRoute: "route", protocolVariant: "extended",
    targetIds: ["t1", "t2"], completedTargetIds: ["t1"], sessionIds: ["s1"], currentIndex: 1,
    categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, errors: [],
    activeTargetCheckpoint: { targetId: "t2", sessionId: "s2", stage: "blind_running" },
    createdAt: "now", updatedAt: "now", ...overrides,
  };
}

describe("endTrainingRun", () => {
  it("persists a terminal marker without fabricating completion or clearing recovery evidence", async () => {
    const storage = new MemoryStorage();
    const original = run();
    storage.setItem("rvh.dev.training_runs", JSON.stringify([original]));
    const repository = new BrowserTrainingRepository({ storage, now: () => "updated" });
    const ended = await endTrainingRun(repository as never, original.id, "2026-10-10T12:00:00.000Z");
    expect(ended).toMatchObject({
      status: "Interrupted",
      currentIndex: 1,
      completedTargetIds: ["t1"],
      sessionIds: ["s1"],
      activeTargetCheckpoint: original.activeTargetCheckpoint,
      termination: { reason: "user_finished", endedAt: "2026-10-10T12:00:00.000Z" },
    });
    expect(ended.completedAt).toBeUndefined();
  });

  it("is idempotent and preserves the original termination time", async () => {
    const storage = new MemoryStorage();
    const original = run();
    storage.setItem("rvh.dev.training_runs", JSON.stringify([original]));
    const repository = new BrowserTrainingRepository({ storage, now: () => "updated" });
    await endTrainingRun(repository as never, original.id, "first");
    const second = await endTrainingRun(repository as never, original.id, "second");
    expect(second.termination?.endedAt).toBe("first");
  });
  it("does not convert a completed run into a user-finished interruption", async () => {
    const storage = new MemoryStorage();
    const completed = run({
      status: "Completed",
      currentIndex: 2,
      completedTargetIds: ["t1", "t2"],
      completedAt: "completed",
    });
    storage.setItem("rvh.dev.training_runs", JSON.stringify([completed]));
    const repository = new BrowserTrainingRepository({ storage, now: () => "updated" });
    await expect(endTrainingRun(repository as never, completed.id, "later")).rejects.toThrow("cannot be ended");
    const stored = (await repository.listTrainingRuns())[0];
    expect(stored.status).toBe("Completed");
    expect(stored.termination).toBeUndefined();
  });

});
