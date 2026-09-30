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

  it("allows ORP1 resource wiring while preserving learning/read-only and Monitor-prompt boundaries", () => {
    const postReveal = source("src/sessions/postReveal.ts");
    const fieldGuideUpdate = source("src/aiCenter/fieldGuideUpdate.ts");
    const research = source("src/research/engine.ts");
    expect(postReveal).toContain('operationKind: "post_reveal_viewer"');
    expect(postReveal).toContain('operationKind: "post_reveal_monitor"');
    expect(fieldGuideUpdate).toContain("buildFieldGuideUpdatePrompt");
    expect(fieldGuideUpdate).toContain('operationKind: "field_guide_update"');
    expect(fieldGuideUpdate).toContain("learningObjectCapacityTokens: frozen.capacityTokens");
    expect(research).toContain('operationKind: "research_viewer"');
    expect(research).not.toContain("runFieldGuideUpdate");
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
