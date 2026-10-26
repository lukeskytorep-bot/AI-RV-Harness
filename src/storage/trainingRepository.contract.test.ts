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
      if (query.startsWith("UPDATE training_runs SET status = 'Interrupted', record_json = json_set")) {
        const idValue = String(values[2]);
        const index = rows.findIndex((row) => (JSON.parse(row.record_json) as TrainingRunRecord).id === idValue);
        if (index < 0) return { rowsAffected: 0 };
        const current = JSON.parse(rows[index].record_json) as TrainingRunRecord;
        if (current.termination?.reason === "user_finished") return { rowsAffected: 0 };
        if (!(current.status === "Paused" || current.status === "Interrupted" || current.status === "Running")
          || current.currentIndex >= current.targetIds.length) return { rowsAffected: 0 };
        const termination = JSON.parse(String(values[0]));
        const updated = { ...current, status: "Interrupted", termination, updatedAt: String(values[1]) };
        rows[index] = { run_number: rows[index].run_number, status: "Interrupted", record_json: JSON.stringify(updated) };
        return { rowsAffected: 1 };
      }
      if (query.startsWith("UPDATE training_runs SET status")) {
        const idValue = String(values[3]);
        const index = rows.findIndex((row) => (JSON.parse(row.record_json) as TrainingRunRecord).id === idValue);
        if (index < 0) return { rowsAffected: 0 };
        const current = JSON.parse(rows[index].record_json) as TrainingRunRecord;
        if (query.includes("termination.reason") && current.termination?.reason === "user_finished") return { rowsAffected: 0 };
        rows[index] = { run_number: rows[index].run_number, status: String(values[0]), record_json: String(values[1]) };
        return { rowsAffected: 1 };
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

    it("round-trips the Stage 3 Full Training planner contract and exact frozen order without a schema-specific column", async () => {
      const harness = makeHarness();
      const frozenOrder = Array.from({ length: 24 }, (_, index) => `target-${index + 1}`);
      const created = await harness.repository.createTrainingRun({
        ...input("Stage 3 Full"),
        mode: "full",
        curriculumId: "factory-training-curriculum",
        curriculumVersion: "2.0.0",
        plannerVersion: "full-rounds-v1",
        roundSize: 8,
        roundCount: 3,
        targetRepeatPolicy: "avoid_profile",
        targetIds: frozenOrder,
      });
      const listed = (await harness.repository.listTrainingRuns()).find((run) => run.id === created.id);
      expect(listed).toMatchObject({ plannerVersion: "full-rounds-v1", roundSize: 8, roundCount: 3, targetRepeatPolicy: "avoid_profile" });
      expect(listed?.targetIds).toEqual(frozenOrder);
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

    it("persists user termination and never lets a later active-execution update restore Running", async () => {
      const harness = makeHarness();
      harness.seed([record("run-terminal", 1, { status: "Interrupted" })]);
      const termination = { reason: "user_finished" as const, endedAt: "2026-10-10T12:00:00.000Z" };
      await harness.repository.updateTrainingRun("run-terminal", { status: "Interrupted", termination });
      await expect(harness.repository.updateTrainingRun("run-terminal", { status: "Running" })).rejects.toThrow("ended by the user");
      const stored = (await harness.repository.listTrainingRuns()).find((run) => run.id === "run-terminal");
      expect(stored?.status).toBe("Interrupted");
      expect(stored?.termination).toEqual(termination);
      await expect(harness.repository.updateTrainingRun("run-terminal", { status: "Interrupted", termination: { ...termination, endedAt: "later" } })).resolves.toBeUndefined();
      expect((await harness.repository.listTrainingRuns()).find((run) => run.id === "run-terminal")?.termination).toEqual(termination);
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

  it("archives Training as one active-list unit and requires active parents for Restore", async () => {
    const harness = browserHarness();
    harness.seed([record("run-a", 1, { sessionIds: ["session-a"] })]);
    harness.storage.setItem("rvh.dev.profiles", JSON.stringify([{ id: "profile-a", name: "Profile", createdAt: "t", updatedAt: "t" }]));
    harness.storage.setItem("rvh.dev.workspaces", JSON.stringify([{ id: "workspace-a", profileId: "profile-a", name: "Workspace", createdAt: "t", updatedAt: "t", lastOpenedAt: "t" }]));
    await harness.repository.archiveTrainingRun("run-a");
    expect(await harness.repository.listTrainingRuns()).toEqual([]);
    expect((await harness.repository.listArchivedTrainingRuns()).map((run) => run.id)).toEqual(["run-a"]);
    harness.storage.setItem("rvh.dev.workspaces", "[]");
    await expect(harness.repository.restoreTrainingRun("run-a")).rejects.toThrow("Restore the parent Profile and Workspace first.");
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
    await expect(harness.repository.updateTrainingRun("missing", { status: "Paused" })).rejects.toThrow("Active Training run not found.");
  });
  it("prevents a stale SQLite Running write from overwriting a termination committed after its read", async () => {
    let row = record("race", 1, { status: "Interrupted" });
    let staleReached!: () => void;
    let releaseStale!: () => void;
    const staleAtWrite = new Promise<void>((resolve) => { staleReached = resolve; });
    const staleRelease = new Promise<void>((resolve) => { releaseStale = resolve; });

    const repository = new SqliteTrainingRepository({
      now: sequenceClock(),
      select: async <T>(query: string, values: unknown[] = []) => {
        if (query.includes("WHERE id = $1")) {
          return String(values[0]) === row.id ? [{ record_json: JSON.stringify(row), archived_at: null }] as T : [] as T;
        }
        throw new Error(`Unexpected select: ${query}`);
      },
      executeWrite: async (query: string, values: unknown[] = []) => {
        if (query.startsWith("UPDATE training_runs SET status = 'Interrupted', record_json = json_set")) {
          if (row.termination?.reason === "user_finished") return { rowsAffected: 0 };
          row = {
            ...row,
            status: "Interrupted",
            termination: JSON.parse(String(values[0])),
            updatedAt: String(values[1]),
          };
          return { rowsAffected: 1 };
        }
        if (!query.startsWith("UPDATE training_runs SET status")) throw new Error(`Unexpected write: ${query}`);
        const incoming = JSON.parse(String(values[1])) as TrainingRunRecord;
        const isStaleRunning = incoming.status === "Running" && !incoming.termination;
        if (isStaleRunning) {
          staleReached();
          await staleRelease;
        }
        if (row.termination?.reason === "user_finished") return { rowsAffected: 0 };
        row = incoming;
        return { rowsAffected: 1 };
      },
    });

    const staleWrite = repository.updateTrainingRun(row.id, { status: "Running" });
    await staleAtWrite;
    const termination = { reason: "user_finished" as const, endedAt: "2026-10-10T12:00:00.000Z" };
    await repository.updateTrainingRun(row.id, { status: "Interrupted", termination });
    releaseStale();
    await expect(staleWrite).rejects.toThrow("ended by the user");
    expect(row.status).toBe("Interrupted");
    expect(row.termination).toEqual(termination);
  });

  it("refuses a stale user-finish write after the run became Completed", async () => {
    let row = record("completed-race", 1, { status: "Interrupted", currentIndex: 1 });
    let writeReached!: () => void;
    let releaseWrite!: () => void;
    const reached = new Promise<void>((resolve) => { writeReached = resolve; });
    const released = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const repository = new SqliteTrainingRepository({
      now: sequenceClock(),
      select: async <T>(query: string, values: unknown[] = []) => {
        if (query.includes("WHERE id = $1")) return String(values[0]) === row.id
          ? [{ record_json: JSON.stringify(row), archived_at: null }] as T
          : [] as T;
        throw new Error(`Unexpected select: ${query}`);
      },
      executeWrite: async (query: string, values: unknown[] = []) => {
        if (!query.startsWith("UPDATE training_runs SET status = 'Interrupted', record_json = json_set")) {
          throw new Error(`Unexpected write: ${query}`);
        }
        writeReached();
        await released;
        if (row.status === "Completed" || row.currentIndex >= row.targetIds.length || row.termination) return { rowsAffected: 0 };
        row = {
          ...row,
          status: "Interrupted",
          termination: JSON.parse(String(values[0])),
          updatedAt: String(values[1]),
        };
        return { rowsAffected: 1 };
      },
    });

    const ending = repository.updateTrainingRun(row.id, {
      status: "Interrupted",
      termination: { reason: "user_finished", endedAt: "2026-10-10T12:00:00.000Z" },
    });
    await reached;
    row = { ...row, status: "Completed", currentIndex: row.targetIds.length, completedTargetIds: [...row.targetIds], completedAt: "completed" };
    releaseWrite();
    await expect(ending).rejects.toThrow("cannot be ended in its current state");
    expect(row.status).toBe("Completed");
    expect(row.termination).toBeUndefined();
  });

  it("archives the current JSON atomically so a concurrent termination survives archive and restore", async () => {
    let row = record("archive-race", 1, { status: "Interrupted", currentIndex: 1 });
    let archivedAt: string | null = null;
    let archiveReached!: () => void;
    let releaseArchive!: () => void;
    const reached = new Promise<void>((resolve) => { archiveReached = resolve; });
    const released = new Promise<void>((resolve) => { releaseArchive = resolve; });
    const repository = new SqliteTrainingRepository({
      now: sequenceClock(),
      select: async <T>(query: string, values: unknown[] = []) => {
        if (query.includes("FROM training_runs WHERE id = $1")) {
          if (String(values[0]) !== row.id) return [] as T;
          if (query.includes("archived_at IS NULL") && archivedAt !== null) return [] as T;
          if (query.includes("archived_at IS NOT NULL") && archivedAt === null) return [] as T;
          return [{ record_json: JSON.stringify(row), archived_at: archivedAt }] as T;
        }
        if (query.includes("FROM workspaces w JOIN profiles p")) return [{ workspace_id: row.workspaceId }] as T;
        throw new Error(`Unexpected select: ${query}`);
      },
      executeWrite: async (query: string, values: unknown[] = []) => {
        if (query.startsWith("UPDATE training_runs SET record_json = json_set(record_json, '$.archivedAt'")) {
          archiveReached();
          await released;
          if (archivedAt !== null) return { rowsAffected: 0 };
          archivedAt = String(values[0]);
          row = { ...row, archivedAt, updatedAt: archivedAt };
          return { rowsAffected: 1 };
        }
        if (query.startsWith("UPDATE training_runs SET status = 'Interrupted', record_json = json_set")) {
          if (archivedAt !== null || row.termination) return { rowsAffected: 0 };
          row = { ...row, status: "Interrupted", termination: JSON.parse(String(values[0])), updatedAt: String(values[1]) };
          return { rowsAffected: 1 };
        }
        if (query.startsWith("UPDATE training_runs SET record_json = $1, archived_at = NULL")) {
          if (archivedAt === null) return { rowsAffected: 0 };
          row = JSON.parse(String(values[0])) as TrainingRunRecord;
          archivedAt = null;
          return { rowsAffected: 1 };
        }
        throw new Error(`Unexpected write: ${query}`);
      },
    });

    const archive = repository.archiveTrainingRun(row.id);
    await reached;
    const termination = { reason: "user_finished" as const, endedAt: "2026-10-10T12:00:00.000Z" };
    await repository.updateTrainingRun(row.id, { status: "Interrupted", termination });
    releaseArchive();
    await archive;
    expect(row.termination).toEqual(termination);
    expect(archivedAt).not.toBeNull();

    await repository.restoreTrainingRun(row.id);
    expect(archivedAt).toBeNull();
    expect(row.termination).toEqual(termination);
  });

});
