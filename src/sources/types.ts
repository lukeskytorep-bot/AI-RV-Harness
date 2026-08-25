export interface WorkspaceSource {
  id: string;
  workspaceId: string;
  sourceType: "text" | "markdown" | "pdf" | "docx";
  displayName: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateWorkspaceSourceInput {
  id: string;
  workspaceId: string;
  sourceType: WorkspaceSource["sourceType"];
  displayName: string;
  content: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}
