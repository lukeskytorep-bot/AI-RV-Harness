import type { CreateWorkspaceSourceInput, WorkspaceSource } from "../../sources/types";

export interface WorkspaceSourcesRepository {
  listWorkspaceSources(workspaceId: string): Promise<WorkspaceSource[]>;
  createWorkspaceSource(input: CreateWorkspaceSourceInput): Promise<WorkspaceSource>;
  deleteWorkspaceSource(id: string): Promise<void>;
  listActiveChatSourceIds(threadId: string): Promise<string[]>;
  setChatSourceActive(threadId: string, sourceId: string, active: boolean): Promise<void>;
}
