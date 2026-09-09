import type {
  CreateTargetInput,
  TargetRecord,
  TargetUsageInput,
  TargetUsageRecord,
  UpdateTargetInput,
} from "../../targets/types";
import type { TargetsRepository } from "../contracts/targetsRepository";
import { createId, nowIso } from "../repository";

type TargetRow = {
  id: string;
  collection: TargetRecord["collection"];
  title: string;
  reveal_text: string | null;
  reveal_artifact_path: string | null;
  reveal_artifact_manifest_json: string;
  tags_json: string;
  source_metadata_json: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type WriteResult = { rowsAffected: number };

export interface SqliteTargetsRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  createId?: typeof createId;
  now?: typeof nowIso;
}

function mapTarget(row: TargetRow): TargetRecord {
  return {
    id: row.id,
    collection: row.collection,
    title: row.title,
    revealText: row.reveal_text ?? undefined,
    revealArtifactPath: row.reveal_artifact_path ?? undefined,
    revealArtifacts: JSON.parse(row.reveal_artifact_manifest_json) as NonNullable<TargetRecord["revealArtifacts"]>,
    tags: JSON.parse(row.tags_json) as string[],
    sourceMetadata: JSON.parse(row.source_metadata_json) as Record<string, unknown>,
    contentHash: row.content_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  };
}

const TARGET_COLUMNS = `id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json,
                  content_hash, created_at, updated_at, archived_at`;

export class SqliteTargetsRepository implements TargetsRepository {
  constructor(private readonly dependencies: SqliteTargetsRepositoryDependencies) {}

  async listTargets(collection?: TargetRecord["collection"]): Promise<TargetRecord[]> {
    const rows = collection
      ? await this.dependencies.select<TargetRow[]>(
          `SELECT ${TARGET_COLUMNS} FROM targets WHERE collection = $1 AND retired_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC`,
          [collection],
        )
      : await this.dependencies.select<TargetRow[]>(
          `SELECT ${TARGET_COLUMNS} FROM targets WHERE retired_at IS NULL AND archived_at IS NULL ORDER BY collection, updated_at DESC`,
        );
    return rows.map(mapTarget);
  }

  async listArchivedTargets(): Promise<TargetRecord[]> {
    const rows = await this.dependencies.select<TargetRow[]>(
      `SELECT ${TARGET_COLUMNS} FROM targets WHERE collection = 'user' AND archived_at IS NOT NULL ORDER BY archived_at DESC`,
    );
    return rows.map(mapTarget);
  }

  async createTarget(input: CreateTargetInput): Promise<TargetRecord> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    const target: TargetRecord = {
      id: input.id,
      collection: input.collection,
      title: input.title.trim(),
      revealText: input.revealText?.trim() || undefined,
      revealArtifactPath: input.revealArtifactPath,
      revealArtifacts: input.revealArtifacts ?? [],
      tags: input.tags ?? [],
      sourceMetadata: input.sourceMetadata ?? {},
      contentHash: input.contentHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.dependencies.executeWrite(
      `INSERT INTO targets
       (id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash, created_at, updated_at, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NULL)`,
      [target.id, target.collection, target.title, target.revealText ?? null, target.revealArtifactPath ?? null, JSON.stringify(target.revealArtifacts ?? []), JSON.stringify(target.tags), JSON.stringify(target.sourceMetadata), target.contentHash ?? null, timestamp],
    );
    return target;
  }

  async updateTarget(id: string, input: UpdateTargetInput): Promise<TargetRecord> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    await this.dependencies.executeWrite(
      `UPDATE targets
          SET title = $1, reveal_text = $2, tags_json = $3, content_hash = $4, updated_at = $5
        WHERE id = $6 AND collection = 'user' AND archived_at IS NULL`,
      [input.title.trim(), input.revealText?.trim() || null, JSON.stringify(input.tags), input.contentHash, timestamp, id],
    );
    const target = (await this.listTargets("user")).find((item) => item.id === id);
    if (!target) throw new Error("Active user target not found.");
    return target;
  }

  async archiveTarget(id: string): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    const result = await this.dependencies.executeWrite(
      "UPDATE targets SET archived_at = $1, updated_at = $1 WHERE id = $2 AND collection = 'user' AND archived_at IS NULL",
      [timestamp, id],
    );
    if (result.rowsAffected !== 1) throw new Error("Active user target not found.");
  }

  async restoreTarget(id: string): Promise<void> {
    const timestamp = (this.dependencies.now ?? nowIso)();
    const result = await this.dependencies.executeWrite(
      "UPDATE targets SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND collection = 'user' AND archived_at IS NOT NULL",
      [timestamp, id],
    );
    if (result.rowsAffected !== 1) throw new Error("Archived user target not found.");
  }

  async recordTargetUsage(input: TargetUsageInput): Promise<void> {
    await this.dependencies.executeWrite(
      `INSERT INTO target_usage (id, target_id, profile_id, research_project_id, session_id, used_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [(this.dependencies.createId ?? createId)("target_usage"), input.targetId, input.profileId ?? null, input.researchProjectId ?? null, input.sessionId ?? null, (this.dependencies.now ?? nowIso)()],
    );
  }

  async listTargetUsage(): Promise<TargetUsageRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; target_id: string; profile_id: string | null; research_project_id: string | null; session_id: string | null; used_at: string }>>(
      "SELECT id, target_id, profile_id, research_project_id, session_id, used_at FROM target_usage ORDER BY used_at DESC",
    );
    return rows.map((row) => ({ id: row.id, targetId: row.target_id, profileId: row.profile_id ?? undefined, researchProjectId: row.research_project_id ?? undefined, sessionId: row.session_id ?? undefined, usedAt: row.used_at }));
  }
}
