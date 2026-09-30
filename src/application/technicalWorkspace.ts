import { isWorkspaceCompatible } from "../domain/workspaceKind";
import type { Workspace } from "../types";

/**
 * Resolve the stable technical Workspace used by Training and Research.
 * Only RV-compatible Workspaces are eligible: rv or legacy_combined.
 * The earliest active compatible Workspace belonging to the selected Profile
 * wins; id is the deterministic tie-breaker.
 */
export function resolveTechnicalWorkspaceForProfile(workspaces: readonly Workspace[], profileId: string | undefined | null): Workspace | null {
  if (!profileId) return null;
  return workspaces
    .filter((workspace) => workspace.profileId === profileId && !workspace.archivedAt && isWorkspaceCompatible(workspace, "rv"))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0] ?? null;
}
