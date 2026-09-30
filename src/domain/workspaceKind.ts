import type { NewWorkspaceKind, Workspace, WorkspaceKind } from "../types";

export function normalizeWorkspaceKind(kind: unknown): WorkspaceKind {
  return kind === "conversation" || kind === "rv" || kind === "legacy_combined" ? kind : "legacy_combined";
}

export function isWorkspaceCompatible(workspace: Pick<Workspace, "kind">, kind: NewWorkspaceKind): boolean {
  return workspace.kind === kind || workspace.kind === "legacy_combined";
}

export function compatibleWorkspaces(
  workspaces: readonly Workspace[],
  kind: NewWorkspaceKind,
  profileId?: string | null,
): Workspace[] {
  return workspaces.filter((workspace) =>
    !workspace.archivedAt
    && (!profileId || workspace.profileId === profileId)
    && isWorkspaceCompatible(workspace, kind));
}

export function latestCompatibleWorkspace(
  workspaces: readonly Workspace[],
  kind: NewWorkspaceKind,
  profileId?: string | null,
): Workspace | null {
  return compatibleWorkspaces(workspaces, kind, profileId)
    .sort((left, right) =>
      right.lastOpenedAt.localeCompare(left.lastOpenedAt)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id))[0] ?? null;
}

export function canArchiveWorkspace(workspace: Workspace, activeWorkspaces: readonly Workspace[]): boolean {
  const siblings = activeWorkspaces.filter((item) =>
    item.profileId === workspace.profileId
    && item.id !== workspace.id
    && !item.archivedAt);
  if (workspace.kind === "conversation") return siblings.some((item) => isWorkspaceCompatible(item, "conversation"));
  if (workspace.kind === "rv") return siblings.some((item) => isWorkspaceCompatible(item, "rv"));
  return siblings.some((item) => isWorkspaceCompatible(item, "conversation"))
    && siblings.some((item) => isWorkspaceCompatible(item, "rv"));
}

export function workspaceKindLabelKey(kind: WorkspaceKind): "conversationWorkspace" | "rvWorkspace" | "legacyCombinedWorkspace" {
  if (kind === "conversation") return "conversationWorkspace";
  if (kind === "rv") return "rvWorkspace";
  return "legacyCombinedWorkspace";
}
