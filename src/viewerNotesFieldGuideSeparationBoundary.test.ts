import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function sha256(relativePath: string): string {
  return createHash("sha256").update(fs.readFileSync(path.join(process.cwd(), relativePath))).digest("hex");
}

describe("VIEWER-NOTES-FIELD-GUIDE-SEPARATION-1 boundaries", () => {
  it("preserves Training order as Post-Reveal Review -> Field Guide Update -> Viewer Notes Reflection", () => {
    const training = source("src/features/training/trainingExecution.ts");
    const review = training.indexOf("runAutomaticPostRevealReview({");
    const fieldGuide = training.indexOf("runFieldGuideUpdate({");
    const viewerNotes = training.indexOf("runViewerNoteReflection({");
    expect(review).toBeGreaterThan(0);
    expect(fieldGuide).toBeGreaterThan(review);
    expect(viewerNotes).toBeGreaterThan(fieldGuide);
  });

  it("keeps Research read-only for Viewer Notes and Field Guide learning", () => {
    const research = source("src/research/engine.ts");
    expect(research).not.toContain("runViewerNoteReflection");
    expect(research).not.toContain("commitViewerNoteReflection");
    expect(research).not.toContain("runFieldGuideUpdate");
    expect(research).not.toContain("createFieldGuideVersion(");
  });

  it("leaves sealed evidence/Post-Reveal Review, Field Guide Update prompt, Research engine and Monitor prompt byte-identical", () => {
    expect(sha256("src/sessions/postReveal.ts")).toBe("412456ee59f47ef01a11bce5999bfe318c6ef8b418c7396e8aa9c1fb59676a8a");
    expect(sha256("src/aiCenter/fieldGuideUpdate.ts")).toBe("122c5c8ef69afab5ec33238f83ebaa68397a79c4b22371ac1fe642c48c85428b");
    expect(sha256("src/research/engine.ts")).toBe("a00eacd6acfc11a9e21f9b06df5f130d8544ba6c77a12623b7796c1b907ea223");
    expect(sha256("src/monitor/prompt.ts")).toBe("3eda515707b2a6e356e49b3b04d191397a760de248a0ba0c46391e950609dc85");
  });

  it("requires the v2 packet to carry the exact session prompt and post-training Field Guide provenance", () => {
    const viewerNotes = source("src/aiCenter/viewerNotes.ts");
    expect(viewerNotes).toContain('packetVersion: "viewer-notes-reflection-v2"');
    expect(viewerNotes).toContain("EFFECTIVE VIEWER PROMPT USED IN THIS SESSION");
    expect(viewerNotes).toContain("FIELD GUIDE AFTER THIS TRAINING UPDATE");
    expect(viewerNotes).toContain("fieldGuideAfterTrainingUpdate");
    expect(viewerNotes).toContain("frozenPrompt.fullContent");
  });
});
