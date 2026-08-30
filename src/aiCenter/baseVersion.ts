import type { ViewerNotesSessionSnapshot } from "./types";

export interface ViewerNoteBasePair {
  baseVersionId?: string;
  baseContentSha256?: string;
}

export function viewerNoteBaseFromSnapshot(snapshot: ViewerNotesSessionSnapshot): ViewerNoteBasePair {
  if (!snapshot.versionId) return {};
  return { baseVersionId: snapshot.versionId, baseContentSha256: snapshot.contentSha256 };
}

export function assertViewerNoteBasePair(value: ViewerNoteBasePair): void {
  const hasVersion = Boolean(value.baseVersionId);
  const hasHash = Boolean(value.baseContentSha256);
  if (hasVersion !== hasHash) {
    throw new Error("Viewer Notes baseVersionId and baseContentSha256 must be supplied together.");
  }
}
