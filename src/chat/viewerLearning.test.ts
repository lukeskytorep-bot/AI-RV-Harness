import { describe, expect, it, vi } from "vitest";
import type { EligibleViewerIdentity } from "../aiCenter/viewerIdentitySelection";
import type { AppRepository } from "../storage/repository";
import {
  defaultConversationViewerLearningEnabled,
  loadExistingConversationViewerLearningSnapshot,
  viewerLearningSystemMessages,
} from "./viewerLearning";

const identity = {
  identity: { id: "ai-1", modelRoute: "openrouter:m", modelId: "m" },
  model: { route: "openrouter:m" },
  trained: true,
} as EligibleViewerIdentity;

function repository(options?: { noFieldGuide?: boolean; notesContent?: string }) {
  return {
    getExistingFieldGuideBundle: vi.fn(async () => options?.noFieldGuide ? null : ({
      activeVersion: { id: "fg-v6", versionNumber: 6, content: "FIELD GUIDE BODY", contentSha256: "fg-hash" },
    })),
    getExistingViewerNoteBundle: vi.fn(async () => ({
      activeVersion: options?.notesContent === undefined ? undefined : { id: "vn-v3", versionNumber: 3, content: options.notesContent, contentSha256: "vn-hash" },
    })),
  } as unknown as AppRepository;
}

describe("Conversation Viewer Learning", () => {
  it("loads exact existing versions without creating learning data", async () => {
    const repo = repository({ notesContent: "NOTES BODY" });
    const snapshot = await loadExistingConversationViewerLearningSnapshot({ repository: repo, identity, language: "en", now: () => "now" });
    expect(snapshot).toMatchObject({
      aiIdentityId: "ai-1",
      modelRoute: "openrouter:m",
      capturedAt: "now",
      fieldGuide: { versionId: "fg-v6", versionNumber: 6, contentSha256: "fg-hash" },
      viewerNotes: { versionId: "vn-v3", versionNumber: 3, contentSha256: "vn-hash" },
    });
    expect(repo.getExistingFieldGuideBundle).toHaveBeenCalledTimes(1);
    expect(repo.getExistingViewerNoteBundle).toHaveBeenCalledTimes(1);
  });

  it("accepts an exact Field Guide with valid but currently empty Viewer Notes", async () => {
    const snapshot = await loadExistingConversationViewerLearningSnapshot({ repository: repository(), identity, language: "en" });
    expect(snapshot?.viewerNotes).toMatchObject({ content: "" });
    expect(snapshot?.viewerNotes.versionId).toBeUndefined();
  });

  it("does not synthesize a missing factory Field Guide in Conversation", async () => {
    await expect(loadExistingConversationViewerLearningSnapshot({ repository: repository({ noFieldGuide: true }), identity, language: "en" })).resolves.toBeNull();
  });

  it("defaults trained identities ON, factory-only identities OFF, and honors a saved thread choice", () => {
    expect(defaultConversationViewerLearningEnabled({ packageAvailable: true, trained: true })).toBe(true);
    expect(defaultConversationViewerLearningEnabled({ packageAvailable: true, trained: false })).toBe(false);
    expect(defaultConversationViewerLearningEnabled({ packageAvailable: true, trained: true, saved: false })).toBe(false);
    expect(defaultConversationViewerLearningEnabled({ packageAvailable: true, trained: false, saved: true })).toBe(true);
    expect(defaultConversationViewerLearningEnabled({ packageAvailable: false, trained: true, saved: true })).toBe(false);
  });

  it("builds read-only blocks with exact version/hash provenance and no Lexicon", async () => {
    const snapshot = (await loadExistingConversationViewerLearningSnapshot({ repository: repository({ notesContent: "NOTES BODY" }), identity, language: "en" }))!;
    const messages = viewerLearningSystemMessages(snapshot, "en");
    const packet = messages.map((message) => message.content).join("\n");
    expect(packet).toContain("read-only supporting context");
    expect(packet).toContain("version_id=fg-v6");
    expect(packet).toContain("sha256=fg-hash");
    expect(packet).toContain("version_id=vn-v3");
    expect(packet).toContain("FIELD GUIDE BODY");
    expect(packet).toContain("NOTES BODY");
    expect(packet).not.toContain("Lexicon");
    expect(packet).not.toContain("Słownik Percepcji Pola");
  });
});
