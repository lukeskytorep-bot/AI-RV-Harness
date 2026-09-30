import type { ExportRepository } from "../contracts/exportRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };

export interface SqliteExportRepositoryDependencies {
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class SqliteExportRepository implements ExportRepository {
  constructor(private readonly dependencies: SqliteExportRepositoryDependencies) {}

  async recordExport(workspaceId: string, researchProjectId: string | undefined, exportType: string, artifactPath: string, manifestHash: string): Promise<void> {
    await this.dependencies.executeWrite(
      `INSERT INTO exports (id, workspace_id, research_project_id, export_type, artifact_path, manifest_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [(this.dependencies.createId ?? createId)("export"), workspaceId, researchProjectId ?? null, exportType, artifactPath, manifestHash, (this.dependencies.now ?? nowIso)()],
    );
  }
}
