import type { AppRepository } from "../storage/repository";
import type { Workspace } from "../types";

type WorkspaceRepository = Pick<AppRepository, "renameWorkspace" | "archiveWorkspace">;

export async function renameWorkspaceAndRefresh(
  repository: WorkspaceRepository,
  workspace: Workspace,
  ownerProfileId: string,
  name: string,
  refresh: () => Promise<void>,
): Promise<void> {
  if (workspace.profileId !== ownerProfileId) throw new Error("Workspace does not belong to the selected Profile.");
  await repository.renameWorkspace(workspace.id, name);
  await refresh();
}

export async function archiveWorkspaceAndRefresh(
  repository: WorkspaceRepository,
  workspace: Workspace,
  ownerProfileId: string,
  refresh: () => Promise<void>,
): Promise<void> {
  if (workspace.profileId !== ownerProfileId) throw new Error("Workspace does not belong to the selected Profile.");
  await repository.archiveWorkspace(workspace.id);
  await refresh();
}
