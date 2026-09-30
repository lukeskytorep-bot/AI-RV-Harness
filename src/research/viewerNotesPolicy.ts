import type { ViewerNotesSessionSnapshot } from "../aiCenter/types";
import { stableStringify } from "./planner";

export function viewerNotesSnapshotSignature(snapshot: ViewerNotesSessionSnapshot | undefined): string {
  return snapshot ? stableStringify(snapshot) : "__none__";
}

export function activeViewerNotesControlSignature(snapshot: ViewerNotesSessionSnapshot | undefined): string {
  return snapshot?.enabled ? viewerNotesSnapshotSignature(snapshot) : "__disabled__";
}

export function sameFrozenViewerNotesVersion(
  left: ViewerNotesSessionSnapshot | undefined,
  right: ViewerNotesSessionSnapshot | undefined,
): boolean {
  if (!left || !right) return false;
  return left.aiIdentityId === right.aiIdentityId
    && left.noteType === right.noteType
    && left.versionId === right.versionId
    && left.versionNumber === right.versionNumber
    && left.estimatorVersion === right.estimatorVersion
    && left.capacityTokens === right.capacityTokens
    && left.modelRoute === right.modelRoute
    && left.capturedAt === right.capturedAt;
}
