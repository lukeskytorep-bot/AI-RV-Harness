import { describe, expect, it } from "vitest";
import type {
  CreateTrainingRunInput,
  TrainingExecutionSnapshot,
  TrainingRunRecord,
  TrainingTargetCheckpoint,
} from "../training/types";
import { BrowserTrainingRepository } from "./browser/trainingRepository";
import type { TrainingRepository } from "./contracts/trainingRepository";
import { SqliteTrainingRepository } from "./sqlite/trainingRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

interface ContractHarness {
  repository: TrainingRepository;
  seed(runs: Array<TrainingRunRecord | Omit<TrainingRunRecord, "sessionIds">>): void;
}

function sequenceClock() {
  let tick = 0;
  return () => `2026-09-08T10:00:0${tick++}.000Z`;
}

function input(name = "Training A"): CreateTrainingRunInput {
  return {
    name,
    status: "Planned",
    mode: "partial",
    profileId: "profile-a",
    workspaceId: "workspace-a",
    modelRoute: "provider-a::model-a",
    protocolVariant: "core",
    targetIds: ["target-a", "target-b"],
    categories: [],
    judgeModelRoutes: ["provider-a::judge-a"],
    pauseAfterBlock: false,
    viewerNotesEnabled: true,
  };
}

function record(id: string, runNumber: number, overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  const timestamp = `2026-09-0${Math.min(8, runNumber)}T00:00:00.000Z`;
  return {
    ...input(`Training ${runNumber}`),
    id,
    runNumber,
    completedTargetIds: [],
    sessionIds: [],
    currentIndex: 0,
    errors: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function browserHarness(): ContractHarness & { storage: MemoryStorage } {
  const storage = new MemoryStorage();
  let id = 0;
  const repository = new BrowserTrainingRepository({
    storage,
    now: sequenceClock(),
    createId: () => `training-${++id}`,
  });
  return {
    repository,
    storage,
    seed: (runs) => storage.setItem("rvh.dev.training_runs", JSON.stringify(runs)),
  };
}

function sqliteHarness(): ContractHarness & { selects: string[]; writes: string[] } {
  let rows: Array<{ run_number: number; status: string; record_json: string }> = [];
  const selects: string[] = [];
  const writes: string[] = [];
  let id = 0;
  const repository = new SqliteTrainingRepository({
    now: sequenceClock(),
    createId: () => `training-${++id}`,
    select: async <T>(query: string, values: unknown[] = []) => {
      selects.push(query);
      if (query.includes("MAX(run_number)")) {
        return [{ next_number: Math.max(0, ...rows.map((row) => row.run_number)) + 1 }] as T;
      }
      if (query.includes("WHERE id = $1")) {
        const wanted = String(values[0]);
        return rows.filter((row) => (JSON.parse(row.record_json) as TrainingRunRecord).id === wanted)
          .map((row) => ({ record_json: row.record_json })) as T;
      }
      if (query.includes("ORDER BY run_number DESC")) {
        return [...rows].sort((a, b) => b.run_number - a.run_number)
          .map((row) => ({ record_json: row.record_json })) as T;
      }
      throw new Error(`Unexpected select: ${query}`);
    },
    executeWrite: async (query: string, values: unknown[] = []) => {
      writes.push(query);
      if (query.startsWith("INSERT INTO training_runs")) {
        rows.push({ run_number: Number(values[1]), status: String(values[2]), record_json: String(values[3]) });
        return { rowsAffected: 1 };
      }
      if (query.startsWith("UPDATE training_runs")) {
        const idValue = String(values[3]);
        const index = rows.findIndex((row) => (JSON.parse(row.record_json) as TrainingRunRecord).id === idValue);
        if (index >= 0) rows[index] = { run_number: rows[index].run_number, status: String(values[0]), record_json: String(values[1]) };
        return { rowsAffected: index >= 0 ? 1 : 0 };
      }
      throw new Error(`Unexpected write: ${query}`);
    },
  });
  return {
    repository,
    selects,
    writes,
    seed: (runs) => {
      rows = runs.map((run) => {
        const normalized = run as TrainingRunRecord;
        return { run_number: normalized.runNumber, status: normalized.status, record_json: JSON.stringify(run) };
      });
    },
  };
}

for (const [name, makeHarness] of [["browser", browserHarness], ["sqlite", sqliteHarness]] as const) {
  describe(`${name} Training repository contract`, () => {
    it("creates a run with the next run number and durable fields initialized", async () => {
      const harness = makeHarness();
      harness.seed([record("existing", 7)]);
      const created = await harness.repository.createTrainingRun(input());
      expect(created).toMatchObject({
        id: "training-1",
        runNumber: 8,
        status: "Planned",
        completedTargetIds: [],
        sessionIds: [],
        currentIndex: 0,
        errors: [],
        createdAt: "2026-09-08T10:00:00.000Z",
        updatedAt: "2026-09-08T10:00:00.000Z",
      });
    });

    it("persists checkpoints and snapshots while appending new errors", async () => {
      const harness = makeHarness();
      harness.seed([record("run-a", 1, { errors: ["old error"] })]);
      const checkpoint: TrainingTargetCheckpoint = { targetId: "target-a", sessionId: "session-a", stage: "review_completed" };
      const executionSnapshot: TrainingExecutionSnapshot = {
        language: "en",
        generationSettings: { temperature: 0.5, reasoningEffort: "medium", maxOutputTokens: 2048 },
        transport: { maxRetries: 2, requestTimeoutMs: 60_000, sessionCodePrefix: "TR", maxSessionCostUsd: 1 },
      };
      await harness.repository.updateTrainingRun("run-a", {
        status: "Interrupted",
        completedTargetIds: ["target-a"],
        sessionIds: ["session-a"],
        currentIndex: 1,
        activeTargetCheckpoint: checkpoint,
        executionSnapshot,
        error: "new error",
      });
      expect((await harness.repository.listTrainingRuns())[0]).toMatchObject({
        status: "Interrupted",
        completedTargetIds: ["target-a"],
        sessionIds: ["session-a"],
        currentIndex: 1,
        activeTargetCheckpoint: checkpoint,
        executionSnapshot,
        errors: ["old error", "new error"],
      });
    });

    it("lists newest run numbers first and normalizes legacy missing sessionIds", async () => {
      const harness = makeHarness();
      const { sessionIds: _legacySessionIds, ...legacy } = record("legacy", 2);
      harness.seed([record("old", 1), legacy, record("new", 3, { sessionIds: ["session-new"] })]);
      const listed = await harness.repository.listTrainingRuns();
      expect(listed.map((run) => run.id)).toEqual(["new", "legacy", "old"]);
      expect(listed.find((run) => run.id === "legacy")?.sessionIds).toEqual([]);
      expect(listed.find((run) => run.id === "new")?.sessionIds).toEqual(["session-new"]);
    });
  });
}

describe("Training repository adapter details", () => {
  it("keeps the browser storage key unchanged", async () => {
    const harness = browserHarness();
    await harness.repository.createTrainingRun(input());
    expect(harness.storage.getItem("rvh.dev.training_runs")).not.toBeNull();
  });

  it("keeps SQLite run-number allocation and record-json writes unchanged", async () => {
    const harness = sqliteHarness();
    harness.seed([record("old", 4)]);
    const created = await harness.repository.createTrainingRun(input());
    await harness.repository.updateTrainingRun(created.id, { status: "Running" });
    expect(harness.selects).toEqual([
      expect.stringContaining("MAX(run_number)"),
      expect.stringContaining("WHERE id = $1"),
    ]);
    expect(harness.writes).toEqual([
      expect.stringContaining("INSERT INTO training_runs"),
      expect.stringContaining("UPDATE training_runs SET status"),
    ]);
  });

  it("preserves the existing SQLite missing-run error", async () => {
    const harness = sqliteHarness();
    await expect(harness.repository.updateTrainingRun("missing", { status: "Paused" })).rejects.toThrow("Training run not found.");
  });
});
