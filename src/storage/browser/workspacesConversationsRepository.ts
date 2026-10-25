import type { ChatMessage, ChatMode, ChatThread, CreateWorkspaceInput, Workspace } from "../../types";
import type { WorkspacesConversationsRepository } from "../contracts/workspacesConversationsRepository";
import { canArchiveWorkspace, normalizeWorkspaceKind } from "../../domain/workspaceKind";
import type { ProviderContinuationState } from "../../providers/continuationContract";
import { BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY, browserChatMessageProviderStateFreshKey, browserChatMessageProviderStateResetKey, prepareProviderContinuationState, ProviderContinuationPersistenceError, restoreProviderContinuationState, type PersistedProviderContinuationStateRow, type ProviderContinuationStateBinding } from "../providerContinuationState";
import { createId, nowIso } from "../repository";

const WORKSPACES_KEY = "rvh.dev.workspaces";
const CHAT_THREADS_KEY = "rvh.dev.chat_threads";
const CHAT_MESSAGES_KEY = "rvh.dev.chat_messages";

type BrowserChatMessageProviderState = Omit<PersistedProviderContinuationStateRow, "ownerId"> & { messageId: string };

export interface BrowserWorkspacesConversationsRepositoryDependencies {
  storage?: Storage;
  now?: typeof nowIso;
}

export class BrowserWorkspacesConversationsRepository implements WorkspacesConversationsRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserWorkspacesConversationsRepositoryDependencies = {}) {
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

  private providerStateResetKey(threadId: string): string {
    return browserChatMessageProviderStateResetKey(threadId);
  }

  private providerStateFreshKey(threadId: string): string {
    return browserChatMessageProviderStateFreshKey(threadId);
  }

  private hasProviderStateResetBoundary(threadId: string): boolean {
    return this.storage.getItem(this.providerStateResetKey(threadId)) !== null;
  }

  private readProviderStateRowsStrictFromKey(key: string): BrowserChatMessageProviderState[] {
    const raw = this.storage.getItem(key);
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProviderContinuationPersistenceError("storage", "persistence_integrity", "Persisted Conversation continuation state storage is malformed.");
    }
    if (!Array.isArray(parsed) || parsed.some((candidate) => !candidate || typeof candidate !== "object" || !("messageId" in candidate) || typeof candidate.messageId !== "string")) {
      throw new ProviderContinuationPersistenceError("storage", "persistence_integrity", "Persisted Conversation continuation state row is malformed.");
    }
    return parsed as BrowserChatMessageProviderState[];
  }

  private readProviderStateRowsStrict(threadId: string): BrowserChatMessageProviderState[] {
    if (this.hasProviderStateResetBoundary(threadId)) {
      return this.readProviderStateRowsStrictFromKey(this.providerStateFreshKey(threadId));
    }
    return this.readProviderStateRowsStrictFromKey(BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY);
  }

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private readWorkspaces(): Workspace[] {
    return this.read<Array<Workspace & { kind?: unknown }>>(WORKSPACES_KEY, [])
      .map((workspace) => ({ ...workspace, kind: normalizeWorkspaceKind(workspace.kind) }));
  }

  async listWorkspaces(profileId?: string): Promise<Workspace[]> {
    return this.readWorkspaces()
      .filter((workspace) => !workspace.archivedAt && (!profileId || workspace.profileId === profileId))
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async listArchivedWorkspaces(): Promise<Workspace[]> {
    return this.readWorkspaces()
      .filter((workspace) => Boolean(workspace.archivedAt))
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const all = this.readWorkspaces();
    const timestamp = this.now();
    const workspace: Workspace = {
      id: createId("workspace"), profileId: input.profileId, name: input.name.trim(),
      description: input.description?.trim() || undefined, kind: input.kind, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp,
    };
    this.write(WORKSPACES_KEY, [workspace, ...all]);
    return workspace;
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 160);
    if (!clean) throw new Error("Workspace name is required.");
    const all = this.readWorkspaces();
    const current = all.find((workspace) => workspace.id === id);
    if (!current) throw new Error("Workspace not found.");
    if (all.some((workspace) => workspace.id !== id && workspace.profileId === current.profileId && !workspace.archivedAt && workspace.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("An active Workspace with this name already exists in the Profile.");
    const timestamp = this.now();
    this.write(WORKSPACES_KEY, all.map((workspace) => workspace.id === id ? { ...workspace, name: clean, updatedAt: timestamp } : workspace));
  }

  async archiveWorkspace(id: string): Promise<void> {
    const all = this.readWorkspaces();
    const current = all.find((workspace) => workspace.id === id && !workspace.archivedAt);
    if (!current) throw new Error("Active Workspace not found.");
    const activeForProfile = all.filter((workspace) => workspace.profileId === current.profileId && !workspace.archivedAt);
    if (!canArchiveWorkspace(current, activeForProfile)) throw new Error("A Profile must keep at least one active compatible Workspace of each required type.");
    const timestamp = this.now();
    this.write(WORKSPACES_KEY, all.map((workspace) => workspace.id === id ? { ...workspace, archivedAt: timestamp, updatedAt: timestamp } : workspace));
  }

  async restoreWorkspace(id: string, name?: string): Promise<void> {
    const all = this.readWorkspaces();
    const current = all.find((workspace) => workspace.id === id && workspace.archivedAt);
    if (!current) throw new Error("Archived Workspace not found.");
    const clean = (name ?? current.name).trim().slice(0, 160);
    if (!clean) throw new Error("Workspace name is required.");
    if (all.some((workspace) => workspace.id !== id && workspace.profileId === current.profileId && !workspace.archivedAt && workspace.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("An active Workspace with this name already exists in the Profile.");
    const timestamp = this.now();
    this.write(WORKSPACES_KEY, all.map((workspace) => workspace.id === id ? { ...workspace, name: clean, archivedAt: undefined, updatedAt: timestamp } : workspace));
  }

  async touchWorkspace(id: string): Promise<void> {
    const timestamp = this.now();
    this.write(WORKSPACES_KEY, this.readWorkspaces().map((workspace) =>
      workspace.id === id ? { ...workspace, updatedAt: timestamp, lastOpenedAt: timestamp } : workspace));
  }

  async listChatThreads(workspaceId: string, mode: ChatMode): Promise<ChatThread[]> {
    return this.read<ChatThread[]>(CHAT_THREADS_KEY, []).filter((thread) => thread.workspaceId === workspaceId && thread.mode === mode && !thread.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
  }

  async createChatThread(workspaceId: string, mode: ChatMode, title?: string): Promise<ChatThread> {
    const all = this.read<ChatThread[]>(CHAT_THREADS_KEY, []);
    const timestamp = this.now();
    const thread: ChatThread = { id: createId("thread"), workspaceId, mode, title: title?.trim().slice(0, 160) || (mode === "conversation" ? "Conversation" : "Manual RV Session"), createdAt: timestamp, updatedAt: timestamp };
    this.write(CHAT_THREADS_KEY, [...all, thread]);
    return thread;
  }

  async getOrCreateChatThread(workspaceId: string, mode: ChatMode): Promise<ChatThread> {
    const existing = (await this.listChatThreads(workspaceId, mode))[0];
    if (!existing) return this.createChatThread(workspaceId, mode);
    await this.touchChatThread(existing.id);
    return { ...existing, updatedAt: this.now() };
  }

  async touchChatThread(threadId: string): Promise<void> {
    const timestamp = this.now();
    this.write(CHAT_THREADS_KEY, this.read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId && !thread.archivedAt ? { ...thread, updatedAt: timestamp } : thread));
  }

  async renameChatThread(threadId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) throw new Error("Conversation / Manual RV title is required.");
    this.write(CHAT_THREADS_KEY, this.read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId ? { ...thread, title: clean.slice(0, 160), updatedAt: this.now() } : thread));
  }

  async archiveChatThread(threadId: string): Promise<void> {
    const threads = this.read<ChatThread[]>(CHAT_THREADS_KEY, []);
    const thread = threads.find((item) => item.id === threadId && !item.archivedAt);
    if (!thread) throw new Error("Conversation / Manual RV not found.");
    const timestamp = this.now();
    this.write(CHAT_THREADS_KEY, threads.map((item) => item.id === threadId ? { ...item, archivedAt: timestamp, updatedAt: timestamp } : item));
  }

  async listArchivedChatThreads(): Promise<ChatThread[]> {
    return this.read<ChatThread[]>(CHAT_THREADS_KEY, []).filter((thread) => Boolean(thread.archivedAt)).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }

  async restoreChatThread(threadId: string): Promise<void> {
    const threads = this.read<ChatThread[]>(CHAT_THREADS_KEY, []);
    const thread = threads.find((item) => item.id === threadId && item.archivedAt);
    if (!thread) throw new Error("Archived Conversation not found.");
    const workspace = this.read<Workspace[]>(WORKSPACES_KEY, []).find((item) => item.id === thread.workspaceId);
    if (!workspace || workspace.archivedAt) throw new Error("Restore the parent Workspace first.");
    const timestamp = this.now();
    this.write(CHAT_THREADS_KEY, threads.map((item) => item.id === threadId ? { ...item, archivedAt: undefined, updatedAt: timestamp } : item));
  }

  async setChatThreadFormalRvState(threadId: string, state?: ChatThread["formalRvState"]): Promise<void> {
    this.write(CHAT_THREADS_KEY, this.read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId && thread.mode === "manual_rv" ? { ...thread, formalRvState: state, updatedAt: this.now() } : thread));
  }

  async listChatMessages(threadId: string): Promise<ChatMessage[]> {
    return this.read<ChatMessage[]>(CHAT_MESSAGES_KEY, []).filter((message) => message.threadId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async appendChatMessage(threadId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage> {
    const message: ChatMessage = { id: createId("message"), threadId, role, content, createdAt: this.now() };
    this.write(CHAT_MESSAGES_KEY, [...this.read<ChatMessage[]>(CHAT_MESSAGES_KEY, []), message]);
    const timestamp = this.now();
    this.write(CHAT_THREADS_KEY, this.read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId ? { ...thread, updatedAt: timestamp } : thread));
    return message;
  }

  async appendAssistantMessageWithProviderState(threadId: string, content: string, state: ProviderContinuationState): Promise<ChatMessage> {
    const prepared = await prepareProviderContinuationState(state);
    const timestamp = this.now();
    const message: ChatMessage = { id: createId("message"), threadId, role: "assistant", content, createdAt: timestamp };
    const stateKey = this.hasProviderStateResetBoundary(threadId) ? this.providerStateFreshKey(threadId) : BROWSER_CHAT_MESSAGE_PROVIDER_STATE_KEY;
    const messagesBefore = this.storage.getItem(CHAT_MESSAGES_KEY);
    const stateBefore = this.storage.getItem(stateKey);
    const threadsBefore = this.storage.getItem(CHAT_THREADS_KEY);
    try {
      const states = this.readProviderStateRowsStrict(threadId);
      if (states.some((entry) => entry.messageId === message.id && entry.format === prepared.format && entry.formatVersion === prepared.formatVersion)) {
        throw new Error("Provider continuation state already exists for this assistant message.");
      }
      this.write(CHAT_MESSAGES_KEY, [...this.read<ChatMessage[]>(CHAT_MESSAGES_KEY, []), message]);
      this.write(stateKey, [...states, {
        messageId: message.id,
        format: prepared.format,
        formatVersion: prepared.formatVersion,
        transport: prepared.transport,
        replayFingerprintJson: prepared.replayFingerprintJson,
        payloadJson: prepared.payloadJson,
        payloadSha256: prepared.payloadSha256,
        payloadSizeBytes: prepared.payloadSizeBytes,
        createdAt: timestamp,
      }]);
      this.write(CHAT_THREADS_KEY, this.read<ChatThread[]>(CHAT_THREADS_KEY, []).map((thread) => thread.id === threadId ? { ...thread, updatedAt: timestamp } : thread));
      return message;
    } catch (cause) {
      for (const [key, previous] of [[CHAT_MESSAGES_KEY, messagesBefore], [stateKey, stateBefore], [CHAT_THREADS_KEY, threadsBefore]] as const) {
        if (previous === null) this.storage.removeItem(key); else this.storage.setItem(key, previous);
      }
      throw cause;
    }
  }

  async listChatMessageProviderStates(threadId: string): Promise<ProviderContinuationStateBinding[]> {
    const messageIds = new Set(this.read<ChatMessage[]>(CHAT_MESSAGES_KEY, []).filter((message) => message.threadId === threadId && message.role === "assistant").map((message) => message.id));
    const rows = this.readProviderStateRowsStrict(threadId);
    const result: ProviderContinuationStateBinding[] = [];
    for (const row of rows) {
      if (!messageIds.has(row.messageId)) continue;
      result.push(await restoreProviderContinuationState({ ...row, ownerId: row.messageId }));
    }
    return result;
  }

  async resetChatMessageProviderStates(threadId: string): Promise<void> {
    const resetKey = this.providerStateResetKey(threadId);
    const freshKey = this.providerStateFreshKey(threadId);
    const resetBefore = this.storage.getItem(resetKey);
    const freshBefore = this.storage.getItem(freshKey);
    try {
      this.storage.setItem(resetKey, "1");
      this.storage.removeItem(freshKey);
    } catch (cause) {
      if (resetBefore === null) this.storage.removeItem(resetKey); else this.storage.setItem(resetKey, resetBefore);
      if (freshBefore === null) this.storage.removeItem(freshKey); else this.storage.setItem(freshKey, freshBefore);
      throw cause;
    }
  }
}
