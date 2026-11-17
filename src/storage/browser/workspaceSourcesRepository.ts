import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../../sources/types";
import type { WorkspaceSourcesRepository } from "../contracts/workspaceSourcesRepository";
import { nowIso } from "../repository";

const WORKSPACE_SOURCES_KEY = "rvh.dev.workspace_sources";
const CHAT_SOURCE_SELECTION_KEY = "rvh.dev.chat_source_selection";

export class BrowserWorkspaceSourcesRepository implements WorkspaceSourcesRepository {
  private readonly storage: Storage;
  constructor(private readonly dependencies: { storage?: Storage; now?: typeof nowIso } = {}) {
    this.storage = dependencies.storage ?? localStorage;
  }
  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private write<T>(key: string, value: T): void {
    this.storage.setItem(key, JSON.stringify(value));
  }
  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async listWorkspaceSources(workspaceId: string): Promise<WorkspaceSource[]> {
    return this.read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, []).filter((source) => source.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource> {
    const source: WorkspaceSource = { id: input.id, workspaceId: input.workspaceId, sourceType: input.sourceType, displayName: input.displayName.trim(), content: input.content, contentHash: input.contentHash, metadata: input.metadata ?? {}, createdAt: this.now() };
    this.write(WORKSPACE_SOURCES_KEY, [source, ...this.read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, [])]);
    return source;
  }

  async deleteWorkspaceSource(id: string): Promise<void> {
    this.write(WORKSPACE_SOURCES_KEY, this.read<WorkspaceSource[]>(WORKSPACE_SOURCES_KEY, []).filter((source) => source.id !== id));
    const selections = this.read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {});
    for (const key of Object.keys(selections)) selections[key] = selections[key].filter((sourceId) => sourceId !== id);
    this.write(CHAT_SOURCE_SELECTION_KEY, selections);
  }

  async listActiveChatSourceIds(threadId: string): Promise<string[]> {
    return this.read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {})[threadId] ?? [];
  }

  async setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void> {
    const all = this.read<Record<string, string[]>>(CHAT_SOURCE_SELECTION_KEY, {});
    const current = all[threadId] ?? [];
    all[threadId] = active ? [...new Set([...current, sourceId])] : current.filter((id) => id !== sourceId);
    this.write(CHAT_SOURCE_SELECTION_KEY, all);
  }
}
