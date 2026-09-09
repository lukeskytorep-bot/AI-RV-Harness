import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../../training/types";
import type { TrainingRepository } from "../contracts/trainingRepository";
import { createId, nowIso } from "../repository";

export interface SqliteTrainingRepositoryDependencies {
  select: <T>(query: string, values?: unknown[]) => Promise<T>;
  executeWrite: (query: string, values?: unknown[]) => Promise<unknown>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

type TrainingRow = { record_json: string; archived_at: string | null };

export class SqliteTrainingRepository implements TrainingRepository {
  constructor(private readonly dependencies: SqliteTrainingRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(): string {
    return (this.dependencies.createId ?? createId)("training");
  }

  private mapRow(row: TrainingRow): TrainingRunRecord {
    const run = JSON.parse(row.record_json) as TrainingRunRecord;
    return { ...run, sessionIds: run.sessionIds ?? [], archivedAt: row.archived_at ?? run.archivedAt ?? undefined };
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
      `INSERT INTO training_runs (id, run_number, status, record_json, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, $5, $5, NULL)`,
      [run.id, run.runNumber, run.status, JSON.stringify(run), timestamp],
    );
    return run;
  }

  async updateTrainingRun(id: string, input: UpdateTrainingRunInput): Promise<void> {
    const rows = await this.dependencies.select<TrainingRow[]>(
      "SELECT record_json, archived_at FROM training_runs WHERE id = $1 AND archived_at IS NULL",
      [id],
    );
    if (!rows[0]) throw new Error("Active Training run not found.");
    const current = this.mapRow(rows[0]);
    const updated: TrainingRunRecord = {
      ...current,
      ...input,
      errors: input.error ? [...current.errors, input.error] : current.errors,
      updatedAt: this.now(),
    };
    await this.dependencies.executeWrite(
      "UPDATE training_runs SET status = $1, record_json = $2, updated_at = $3 WHERE id = $4 AND archived_at IS NULL",
      [updated.status, JSON.stringify(updated), updated.updatedAt, id],
    );
  }

  async listTrainingRuns(): Promise<TrainingRunRecord[]> {
    const rows = await this.dependencies.select<TrainingRow[]>(
      "SELECT record_json, archived_at FROM training_runs WHERE archived_at IS NULL ORDER BY run_number DESC",
    );
    return rows.map((row) => this.mapRow(row));
  }

  async listArchivedTrainingRuns(): Promise<TrainingRunRecord[]> {
    const rows = await this.dependencies.select<TrainingRow[]>(
      "SELECT record_json, archived_at FROM training_runs WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, run_number DESC",
    );
    return rows.map((row) => this.mapRow(row));
  }

  async archiveTrainingRun(id: string): Promise<void> {
    const rows = await this.dependencies.select<TrainingRow[]>("SELECT record_json, archived_at FROM training_runs WHERE id = $1 AND archived_at IS NULL", [id]);
    if (!rows[0]) throw new Error("Active Training run not found.");
    const timestamp = this.now();
    const run = { ...this.mapRow(rows[0]), archivedAt: timestamp, updatedAt: timestamp };
    await this.dependencies.executeWrite(
      "UPDATE training_runs SET record_json = $1, archived_at = $2, updated_at = $2 WHERE id = $3 AND archived_at IS NULL",
      [JSON.stringify(run), timestamp, id],
    );
  }

  async restoreTrainingRun(id: string): Promise<void> {
    const rows = await this.dependencies.select<TrainingRow[]>(
      "SELECT record_json, archived_at FROM training_runs WHERE id = $1 AND archived_at IS NOT NULL",
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error("Archived Training run not found.");
    const current = this.mapRow(row);
    const parents = await this.dependencies.select<Array<{ workspace_id: string }>>(
      `SELECT w.id AS workspace_id FROM workspaces w JOIN profiles p ON p.id = w.profile_id
        WHERE w.id = $1 AND w.profile_id = $2 AND w.archived_at IS NULL AND p.archived_at IS NULL`,
      [current.workspaceId, current.profileId],
    );
    if (!parents[0]) throw new Error("Restore the parent Profile and Workspace first.");
    const timestamp = this.now();
    const run = { ...current, archivedAt: undefined, updatedAt: timestamp };
    await this.dependencies.executeWrite(
      "UPDATE training_runs SET record_json = $1, archived_at = NULL, updated_at = $2 WHERE id = $3 AND archived_at IS NOT NULL",
      [JSON.stringify(run), timestamp, id],
    );
  }
}
