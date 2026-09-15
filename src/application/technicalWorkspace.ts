import type { Workspace } from "../types";

/**
 * Resolve the stable technical Workspace used by flows that no longer expose a
 * Workspace selector. The earliest active Workspace belonging to the selected
 * Profile wins; id is the deterministic tie-breaker. Archived or foreign
 * Workspaces are never eligible.
 */
export function resolveTechnicalWorkspaceForProfile(workspaces: readonly Workspace[], profileId: string | undefined | null): Workspace | null {
  if (!profileId) return null;
  return workspaces
    .filter((workspace) => workspace.profileId === profileId && !workspace.archivedAt)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0] ?? null;
}
