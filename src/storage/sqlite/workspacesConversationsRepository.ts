import type { ChatMessage, ChatMode, ChatThread, CreateWorkspaceInput, Workspace } from "../../types";
import type { WorkspacesConversationsRepository } from "../contracts/workspacesConversationsRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };
type WorkspaceRow = { id: string; profile_id: string; name: string; description: string | null; created_at: string; updated_at: string; last_opened_at: string; archived_at: string | null };
type ChatThreadRow = { id: string; workspace_id: string; mode: ChatMode; thread_group_id: string | null; title: string; formal_rv_state: ChatThread["formalRvState"] | null; created_at: string; updated_at: string; archived_at: string | null };
type ChatMessageRow = { id: string; thread_id: string; role: "user" | "assistant"; content: string; created_at: string };

export interface SqliteWorkspacesConversationsRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  now?: typeof nowIso;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, profileId: row.profile_id, name: row.name, description: row.description ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, lastOpenedAt: row.last_opened_at, ...(row.archived_at ? { archivedAt: row.archived_at } : {}) };
}

function mapChatThread(row: ChatThreadRow): ChatThread {
  return { id: row.id, workspaceId: row.workspace_id, mode: row.mode, threadGroupId: row.thread_group_id ?? undefined, title: row.title, formalRvState: row.formal_rv_state ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.archived_at ? { archivedAt: row.archived_at } : {}) };
}


export class SqliteWorkspacesConversationsRepository implements WorkspacesConversationsRepository {
  constructor(private readonly dependencies: SqliteWorkspacesConversationsRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async listWorkspaces(profileId?: string): Promise<Workspace[]> {
    const rows = profileId
      ? await this.dependencies.select<WorkspaceRow[]>(`SELECT id, profile_id, name, description, created_at, updated_at, last_opened_at, archived_at FROM workspaces WHERE profile_id = $1 AND archived_at IS NULL ORDER BY last_opened_at DESC`, [profileId])
      : await this.dependencies.select<WorkspaceRow[]>(`SELECT id, profile_id, name, description, created_at, updated_at, last_opened_at, archived_at FROM workspaces WHERE archived_at IS NULL ORDER BY last_opened_at DESC`);
    return rows.map(mapWorkspace);
  }

  async listArchivedWorkspaces(): Promise<Workspace[]> {
    return (await this.dependencies.select<WorkspaceRow[]>(`SELECT id, profile_id, name, description, created_at, updated_at, last_opened_at, archived_at FROM workspaces WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`)).map(mapWorkspace);
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const timestamp = this.now();
    const workspace: Workspace = { id: createId("workspace"), profileId: input.profileId, name: input.name.trim(), description: input.description?.trim() || undefined, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp };
    await this.dependencies.executeWrite(`INSERT INTO workspaces (id, profile_id, name, description, created_at, updated_at, last_opened_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [workspace.id, workspace.profileId, workspace.name, workspace.description ?? null, timestamp, timestamp, timestamp]);
    return workspace;
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 160);
    if (!clean) throw new Error("Workspace name is required.");
    const current = await this.dependencies.select<Array<{ profile_id: string }>>("SELECT profile_id FROM workspaces WHERE id = $1 LIMIT 1", [id]);
    if (!current[0]) throw new Error("Workspace not found.");
    const duplicate = await this.dependencies.select<Array<{ id: string }>>("SELECT id FROM workspaces WHERE profile_id = $1 AND id <> $2 AND archived_at IS NULL AND lower(trim(name)) = lower($3) LIMIT 1", [current[0].profile_id, id, clean]);
    if (duplicate[0]) throw new Error("An active Workspace with this name already exists in the Profile.");
    await this.dependencies.executeWrite("UPDATE workspaces SET name = $1, updated_at = $2 WHERE id = $3", [clean, this.now(), id]);
  }

  async archiveWorkspace(id: string): Promise<void> {
    const active = await this.dependencies.select<Array<{ id: string }>>("SELECT id FROM workspaces WHERE id = $1 AND archived_at IS NULL LIMIT 1", [id]);
    if (!active[0]) throw new Error("Active Workspace not found.");
    const timestamp = this.now();
    const result = await this.dependencies.executeWrite(
      `UPDATE workspaces
          SET archived_at = $1, updated_at = $1
        WHERE id = $2
          AND archived_at IS NULL
          AND (SELECT COUNT(*) FROM workspaces sibling WHERE sibling.profile_id = workspaces.profile_id AND sibling.archived_at IS NULL) > 1`,
      [timestamp, id],
    );
    if (result.rowsAffected === 0) throw new Error("A Profile must keep at least one active Workspace.");
  }

  async restoreWorkspace(id: string, name?: string): Promise<void> {
    const current = await this.dependencies.select<Array<{ profile_id: string; name: string }>>("SELECT profile_id, name FROM workspaces WHERE id = $1 AND archived_at IS NOT NULL LIMIT 1", [id]);
    if (!current[0]) throw new Error("Archived Workspace not found.");
    const clean = (name ?? current[0].name).trim().slice(0, 160);
    if (!clean) throw new Error("Workspace name is required.");
    const duplicate = await this.dependencies.select<Array<{ id: string }>>("SELECT id FROM workspaces WHERE profile_id = $1 AND id <> $2 AND archived_at IS NULL AND lower(trim(name)) = lower($3) LIMIT 1", [current[0].profile_id, id, clean]);
    if (duplicate[0]) throw new Error("An active Workspace with this name already exists in the Profile.");
    await this.dependencies.executeWrite("UPDATE workspaces SET name = $1, archived_at = NULL, updated_at = $2 WHERE id = $3", [clean, this.now(), id]);
  }

  async touchWorkspace(id: string): Promise<void> {
    const timestamp = this.now();
    await this.dependencies.executeWrite("UPDATE workspaces SET updated_at = $1, last_opened_at = $1 WHERE id = $2", [timestamp, id]);
  }

  async listChatThreads(workspaceId: string, mode: ChatMode): Promise<ChatThread[]> {
    return (await this.dependencies.select<ChatThreadRow[]>(`SELECT id, workspace_id, mode, thread_group_id, title, formal_rv_state, created_at, updated_at, archived_at FROM chat_threads WHERE workspace_id = $1 AND mode = $2 AND archived_at IS NULL ORDER BY updated_at DESC, created_at DESC`, [workspaceId, mode])).map(mapChatThread);
  }

  async createChatThread(workspaceId: string, mode: ChatMode, title?: string): Promise<ChatThread> {
    const timestamp = this.now();
    const thread: ChatThread = { id: createId("thread"), workspaceId, mode, title: title?.trim().slice(0, 160) || (mode === "conversation" ? "Conversation" : "Manual RV Session"), createdAt: timestamp, updatedAt: timestamp };
    await this.dependencies.executeWrite(`INSERT INTO chat_threads (id, workspace_id, mode, thread_group_id, title, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $5, $5)`, [thread.id, thread.workspaceId, thread.mode, thread.title, timestamp]);
    return thread;
  }

  async getOrCreateChatThread(workspaceId: string, mode: ChatMode): Promise<ChatThread> {
    const existing = (await this.listChatThreads(workspaceId, mode))[0];
    if (!existing) return this.createChatThread(workspaceId, mode);
    await this.touchChatThread(existing.id);
    return { ...existing, updatedAt: this.now() };
  }

  async touchChatThread(threadId: string): Promise<void> {
    await this.dependencies.executeWrite("UPDATE chat_threads SET updated_at = $1 WHERE id = $2 AND archived_at IS NULL", [this.now(), threadId]);
  }

  async renameChatThread(threadId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) throw new Error("Conversation / Manual RV title is required.");
    await this.dependencies.executeWrite("UPDATE chat_threads SET title = $1, updated_at = $2 WHERE id = $3", [clean.slice(0, 160), this.now(), threadId]);
  }

  async archiveChatThread(threadId: string): Promise<void> {
    const rows = await this.dependencies.select<Array<{ id: string }>>("SELECT id FROM chat_threads WHERE id = $1 AND archived_at IS NULL LIMIT 1", [threadId]);
    if (!rows[0]) throw new Error("Conversation / Manual RV not found.");
    const timestamp = this.now();
    await this.dependencies.executeWrite("UPDATE chat_threads SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", [timestamp, threadId]);
  }

  async listArchivedChatThreads(): Promise<ChatThread[]> {
    return (await this.dependencies.select<ChatThreadRow[]>(`SELECT id, workspace_id, mode, thread_group_id, title, formal_rv_state, created_at, updated_at, archived_at FROM chat_threads WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`)).map(mapChatThread);
  }

  async restoreChatThread(threadId: string): Promise<void> {
    const rows = await this.dependencies.select<Array<{ workspace_id: string }>>("SELECT workspace_id FROM chat_threads WHERE id = $1 AND archived_at IS NOT NULL LIMIT 1", [threadId]);
    if (!rows[0]) throw new Error("Archived Conversation not found.");
    const workspace = await this.dependencies.select<Array<{ archived_at: string | null }>>("SELECT archived_at FROM workspaces WHERE id = $1 LIMIT 1", [rows[0].workspace_id]);
    if (!workspace[0] || workspace[0].archived_at) throw new Error("Restore the parent Workspace first.");
    await this.dependencies.executeWrite("UPDATE chat_threads SET archived_at = NULL, updated_at = $1 WHERE id = $2", [this.now(), threadId]);
  }

  async setChatThreadFormalRvState(threadId: string, state?: ChatThread["formalRvState"]): Promise<void> {
    await this.dependencies.executeWrite("UPDATE chat_threads SET formal_rv_state = $1, updated_at = $2 WHERE id = $3 AND mode = 'manual_rv'", [state ?? null, this.now(), threadId]);
  }

  async listChatMessages(threadId: string): Promise<ChatMessage[]> {
    const rows = await this.dependencies.select<ChatMessageRow[]>(`SELECT id, thread_id, role, content, created_at FROM chat_messages WHERE thread_id = $1 AND role IN ('user','assistant') ORDER BY created_at`, [threadId]);
    return rows.map((row) => ({ id: row.id, threadId: row.thread_id, role: row.role, content: row.content, createdAt: row.created_at }));
  }

  async appendChatMessage(threadId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage> {
    const timestamp = this.now();
    const message: ChatMessage = { id: createId("message"), threadId, role, content, createdAt: timestamp };
    await this.dependencies.executeWrite(`INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)`, [message.id, threadId, role, content, timestamp]);
    await this.dependencies.executeWrite("UPDATE chat_threads SET updated_at = $1 WHERE id = $2", [timestamp, threadId]);
    return message;
  }
}
