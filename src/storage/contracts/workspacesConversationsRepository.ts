import type {
  ChatMessage,
  ChatMode,
  ChatThread,
  CreateWorkspaceInput,
  Workspace,
} from "../../types";

/** Internal persistence contract for Workspaces and their Conversation / Manual RV hierarchy. */
export interface WorkspacesConversationsRepository {
  listWorkspaces(profileId?: string): Promise<Workspace[]>;
  listArchivedWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  renameWorkspace(id: string, name: string): Promise<void>;
  archiveWorkspace(id: string): Promise<void>;
  restoreWorkspace(id: string, name?: string): Promise<void>;
  touchWorkspace(id: string): Promise<void>;
  listChatThreads(workspaceId: string, mode: ChatMode): Promise<ChatThread[]>;
  createChatThread(workspaceId: string, mode: ChatMode, title?: string): Promise<ChatThread>;
  getOrCreateChatThread(workspaceId: string, mode: ChatMode): Promise<ChatThread>;
  touchChatThread(threadId: string): Promise<void>;
  renameChatThread(threadId: string, title: string): Promise<void>;
  archiveChatThread(threadId: string): Promise<void>;
  listArchivedChatThreads(): Promise<ChatThread[]>;
  restoreChatThread(threadId: string): Promise<void>;
  setChatThreadFormalRvState(threadId: string, state?: ChatThread["formalRvState"]): Promise<void>;
  listChatMessages(threadId: string): Promise<ChatMessage[]>;
  appendChatMessage(threadId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage>;
}
