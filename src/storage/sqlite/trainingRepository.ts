import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../../training/types";
import type { TrainingRepository } from "../contracts/trainingRepository";
import { createId, nowIso } from "../repository";

export interface SqliteTrainingRepositoryDependencies {
  select: <T>(query: string, values?: unknown[]) => Promise<T>;
  executeWrite: (query: string, values?: unknown[]) => Promise<unknown>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class SqliteTrainingRepository implements TrainingRepository {
  constructor(private readonly dependencies: SqliteTrainingRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(): string {
    return (this.dependencies.createId ?? createId)("training");
  }

  async createTrainingRun(input: CreateTrainingRunInput): Promise<TrainingRunRecord> {
    const timestamp = this.now();
    const rows = await this.dependencies.select<Array<{ next_number: number }>>(
      "SELECT COALESCE(MAX(run_number), 0) + 1 AS next_number FROM training_runs",
    );
    const run: TrainingRunRecord = {
      ...input,
      id: this.nextId(),
      runNumber: Number(rows[0]?.next_number ?? 1),
      completedTargetIds: [],
      sessionIds: [],
      currentIndex: 0,
      errors: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.dependencies.executeWrite(
      `INSERT INTO training_runs (id, run_number, status, record_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
      [run.id, run.runNumber, run.status, JSON.stringify(run), timestamp],
    );
    return run;
  }

  async updateTrainingRun(id: string, input: UpdateTrainingRunInput): Promise<void> {
    const rows = await this.dependencies.select<Array<{ record_json: string }>>(
      "SELECT record_json FROM training_runs WHERE id = $1",
      [id],
    );
    if (!rows[0]) throw new Error("Training run not found.");
    const current = JSON.parse(rows[0].record_json) as TrainingRunRecord;
    const updated: TrainingRunRecord = {
      ...current,
      ...input,
      errors: input.error ? [...current.errors, input.error] : current.errors,
      updatedAt: this.now(),
    };
    await this.dependencies.executeWrite(
      "UPDATE training_runs SET status = $1, record_json = $2, updated_at = $3 WHERE id = $4",
      [updated.status, JSON.stringify(updated), updated.updatedAt, id],
    );
  }

  async listTrainingRuns(): Promise<TrainingRunRecord[]> {
    const rows = await this.dependencies.select<Array<{ record_json: string }>>(
      "SELECT record_json FROM training_runs ORDER BY run_number DESC",
    );
    return rows.map((row) => {
      const run = JSON.parse(row.record_json) as TrainingRunRecord;
      return { ...run, sessionIds: run.sessionIds ?? [] };
    });
  }
}
