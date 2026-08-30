import { describe, expect, it } from "vitest";
import { assertViewerNoteBasePair, viewerNoteBaseFromSnapshot } from "./baseVersion";
import type { ViewerNotesSessionSnapshot } from "./types";

const emptySnapshot: ViewerNotesSessionSnapshot = {
  enabled: true,
  aiIdentityId: "identity",
  noteType: "viewer_self_notes",
  content: "",
  contentSha256: "empty-hash",
  estimatedTokens: 0,
  estimatorVersion: "conservative-char-v1",
  capacityTokens: 1024,
  modelRoute: "openrouter:model",
  capturedAt: "now",
};

describe("Viewer Notes base version pair", () => {
  it("does not turn the empty-content hash into a base for the first version", () => {
    expect(viewerNoteBaseFromSnapshot(emptySnapshot)).toEqual({});
  });

  it("returns the active version and hash together", () => {
    expect(viewerNoteBaseFromSnapshot({ ...emptySnapshot, versionId: "v1", versionNumber: 1, content: "notes", contentSha256: "notes-hash" }))
      .toEqual({ baseVersionId: "v1", baseContentSha256: "notes-hash" });
  });

  it("rejects every half-populated pair", () => {
    expect(() => assertViewerNoteBasePair({ baseVersionId: "v1" })).toThrow(/supplied together/);
    expect(() => assertViewerNoteBasePair({ baseContentSha256: "hash" })).toThrow(/supplied together/);
    expect(() => assertViewerNoteBasePair({})).not.toThrow();
  });
});
