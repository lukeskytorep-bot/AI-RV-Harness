import type { AppRepository } from "../../storage/repository";
import type { Workspace } from "../../types";

type WorkspaceRepository = Pick<AppRepository, "renameWorkspace" | "archiveWorkspace">;

export async function renameWorkspaceAndRefresh(repository: WorkspaceRepository, workspaceId: string, name: string, refresh: () => Promise<void>): Promise<void> {
  await repository.renameWorkspace(workspaceId, name);
  await refresh();
}

export async function archiveWorkspaceAndRefresh(
  repository: WorkspaceRepository,
  workspace: Workspace,
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
  onActiveArchived: (nextId: string | null) => void,
  refresh: () => Promise<void>,
): Promise<void> {
  await repository.archiveWorkspace(workspace.id);
  if (workspace.id === activeWorkspaceId) {
    onActiveArchived(workspaces.find((item) => item.id !== workspace.id && item.profileId === workspace.profileId)?.id ?? null);
  }
  await refresh();
}
