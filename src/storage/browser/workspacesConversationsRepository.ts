import type { ChatMessage, ChatMode, ChatThread, CreateWorkspaceInput, Workspace } from "../../types";
import type { WorkspacesConversationsRepository } from "../contracts/workspacesConversationsRepository";
import { createId, nowIso } from "../repository";

const WORKSPACES_KEY = "rvh.dev.workspaces";
const CHAT_THREADS_KEY = "rvh.dev.chat_threads";
const CHAT_MESSAGES_KEY = "rvh.dev.chat_messages";

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

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async listWorkspaces(profileId?: string): Promise<Workspace[]> {
    return this.read<Workspace[]>(WORKSPACES_KEY, [])
      .filter((workspace) => !workspace.archivedAt && (!profileId || workspace.profileId === profileId))
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async listArchivedWorkspaces(): Promise<Workspace[]> {
    return this.read<Workspace[]>(WORKSPACES_KEY, [])
      .filter((workspace) => Boolean(workspace.archivedAt))
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const all = this.read<Workspace[]>(WORKSPACES_KEY, []);
    const timestamp = this.now();
    const workspace: Workspace = {
      id: createId("workspace"), profileId: input.profileId, name: input.name.trim(),
      description: input.description?.trim() || undefined, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp,
    };
    this.write(WORKSPACES_KEY, [workspace, ...all]);
    return workspace;
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 160);
    if (!clean) throw new Error("Workspace name is required.");
    const all = this.read<Workspace[]>(WORKSPACES_KEY, []);
    const current = all.find((workspace) => workspace.id === id);
    if (!current) throw new Error("Workspace not found.");
    if (all.some((workspace) => workspace.id !== id && workspace.profileId === current.profileId && !workspace.archivedAt && workspace.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("An active Workspace with this name already exists in the Profile.");
    const timestamp = this.now();
    this.write(WORKSPACES_KEY, all.map((workspace) => workspace.id === id ? { ...workspace, name: clean, updatedAt: timestamp } : workspace));
  }

  async archiveWorkspace(id: string): Promise<void> {
    const all = this.read<Workspace[]>(WORKSPACES_KEY, []);
    const current = all.find((workspace) => workspace.id === id && !workspace.archivedAt);
    if (!current) throw new Error("Active Workspace not found.");
    const activeForProfile = all.filter((workspace) => workspace.profileId === current.profileId && !workspace.archivedAt);
    if (activeForProfile.length <= 1) throw new Error("A Profile must keep at least one active Workspace.");
    const timestamp = this.now();
    this.write(WORKSPACES_KEY, all.map((workspace) => workspace.id === id ? { ...workspace, archivedAt: timestamp, updatedAt: timestamp } : workspace));
  }

  async restoreWorkspace(id: string, name?: string): Promise<void> {
    const all = this.read<Workspace[]>(WORKSPACES_KEY, []);
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
    this.write(WORKSPACES_KEY, this.read<Workspace[]>(WORKSPACES_KEY, []).map((workspace) =>
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
}
