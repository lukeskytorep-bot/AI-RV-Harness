import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../../sources/types";
import type { WorkspaceSourcesRepository } from "../contracts/workspaceSourcesRepository";
import { nowIso } from "../repository";

type WorkspaceSourceRow = { id: string; workspace_id: string; source_type: "text" | "markdown" | "pdf" | "docx"; display_name: string; content_text: string | null; content_hash: string | null; metadata_json: string; created_at: string };

export class SqliteWorkspaceSourcesRepository implements WorkspaceSourcesRepository {
  constructor(private readonly dependencies: {
    select<T>(query: string, values?: unknown[]): Promise<T>;
    executeWrite(query: string, values?: unknown[]): Promise<{ rowsAffected: number }>;
    now?: typeof nowIso;
  }) {}
  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async listWorkspaceSources(workspaceId: string): Promise<WorkspaceSource[]> {
    const rows = await this.dependencies.select<WorkspaceSourceRow[]>(
      `SELECT id, workspace_id, source_type, display_name, content_text, content_hash, metadata_json, created_at
         FROM workspace_sources WHERE workspace_id = $1 AND content_text IS NOT NULL ORDER BY created_at DESC`, [workspaceId],
    );
    return rows.map((row) => ({ id: row.id, workspaceId: row.workspace_id, sourceType: row.source_type, displayName: row.display_name, content: row.content_text ?? "", contentHash: row.content_hash ?? "", metadata: JSON.parse(row.metadata_json) as Record<string, unknown>, createdAt: row.created_at }));
  }

  async createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource> {
    const timestamp = this.now();
    const source: WorkspaceSource = { id: input.id, workspaceId: input.workspaceId, sourceType: input.sourceType, displayName: input.displayName.trim(), content: input.content, contentHash: input.contentHash, metadata: input.metadata ?? {}, createdAt: timestamp };
    await this.dependencies.executeWrite(
      `INSERT INTO workspace_sources (id, workspace_id, source_type, display_name, content_hash, metadata_json, content_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [source.id, source.workspaceId, source.sourceType, source.displayName, source.contentHash, JSON.stringify(source.metadata), source.content, timestamp],
    );
    return source;
  }

  async deleteWorkspaceSource(id: string): Promise<void> {
    await this.dependencies.executeWrite("DELETE FROM workspace_sources WHERE id = $1", [id]);
  }

  async listActiveChatSourceIds(threadId: string): Promise<string[]> {
    const rows = await this.dependencies.select<{ source_id: string }[]>("SELECT source_id FROM chat_thread_sources WHERE thread_id = $1 AND active = 1", [threadId]);
    return rows.map((row) => row.source_id);
  }

  async setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void> {
    await this.dependencies.executeWrite(
      `INSERT INTO chat_thread_sources (thread_id, source_id, active, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT(thread_id, source_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
      [threadId, sourceId, active ? 1 : 0, this.now()],
    );
  }
}
