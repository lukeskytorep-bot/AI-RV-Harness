import type { Profile, Workspace } from "../types";

export interface WorkspaceDirectoryGroup {
  profile: Profile;
  workspaces: Workspace[];
}

export function filterWorkspaceDirectory(workspaces: Workspace[], profiles: Profile[], query: string): WorkspaceDirectoryGroup[] {
  const needle = normalize(query);
  return [...profiles]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((profile) => {
      const profileMatches = !needle || normalize(profile.name).includes(needle);
      const owned = workspaces
        .filter((workspace) => workspace.profileId === profile.id)
        .filter((workspace) => profileMatches || normalize(`${workspace.name} ${workspace.description ?? ""}`).includes(needle))
        .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.name.localeCompare(b.name));
      return { profile, workspaces: owned };
    })
    .filter((group) => group.workspaces.length > 0);
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}
