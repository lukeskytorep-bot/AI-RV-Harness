import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEffectiveMonitorPrompt,
  buildEffectiveTelepathicMonitorPrompt,
  factoryMonitorEditablePrompt,
  lockedMonitorExecution,
  lockedTelepathicMonitorExecution,
} from "./resources/systemPrompts";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function sha256(relativePath: string): string {
  return createHash("sha256").update(fs.readFileSync(path.join(process.cwd(), relativePath))).digest("hex");
}

describe("POST-REVEAL-CONTEXT-1 boundaries", () => {
  it("keeps Training, RV Sessions and Research on the shared automatic Viewer review mechanism", () => {
    const training = source("src/features/training/trainingExecution.ts");
    const rvSessions = source("src/features/rvSessions/RvSessionPanel.tsx");
    const research = source("src/research/engine.ts");

    expect(training).toContain('from "../../sessions/postReveal"');
    expect(training).toContain("runAutomaticPostRevealReview({");
    expect(rvSessions).toContain('from "../../sessions/postReveal"');
    expect(rvSessions).toContain("runAutomaticPostRevealReview({");
    expect(research).toContain('from "../sessions/postReveal"');
    expect(research).toContain("runAutomaticPostRevealReview({");
  });

  it("routes RV Lite, Full RCP, Custom and Telepathic session completion through the shared post-Reveal review", () => {
    const rvSessions = source("src/features/rvSessions/RvSessionPanel.tsx");
    for (const runner of ["runAutomaticRvLiteSession", "runAutomaticRcpSession", "runAutomaticCustomSession", "runAutomaticTelepathicSession"]) {
      expect(rvSessions).toContain(`${runner}({`);
    }
    expect(rvSessions.match(/await finishRevealedSession\(result\);/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(rvSessions).toContain("await automaticReview(progress.sessionId, true);");
  });

  it("keeps Research free of Viewer Notes reflection during the automatic post-Reveal review", () => {
    const research = source("src/research/engine.ts");
    expect(research).not.toContain("runViewerNoteReflection");
    expect(research).not.toContain("commitViewerNoteReflection");
    const call = research.match(/await runAutomaticPostRevealReview\(\{[\s\S]*?\n      \}\);/)?.[0] ?? "";
    expect(call).toContain("runAutomaticPostRevealReview");
    expect(call).not.toContain("afterViewerReview");
  });

  it("keeps the target-surroundings methodology in one production source", () => {
    const productionFiles = [
      ...fs.readdirSync(path.join(process.cwd(), "src/sessions"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx"))
        .map((entry) => `src/sessions/${entry.name}`),
      "src/features/training/trainingExecution.ts",
      "src/features/rvSessions/RvSessionPanel.tsx",
      "src/research/engine.ts",
    ];
    const hits = productionFiles.filter((file) => source(file).includes("plausible but unverified contextual correspondence"));
    expect(hits).toEqual(["src/sessions/postReveal.ts"]);
  });

  it("does not add a write path to sealed pre-Reveal evidence", () => {
    const postReveal = source("src/sessions/postReveal.ts");
    expect(postReveal).toContain('type PostRevealRepository = Pick<AppRepository, "appendPostRevealTurn" | "getReveal" | "getSessionSnapshot" | "getViewerEvidence" | "listTargetClarifications">;');
    expect(postReveal).not.toContain("updateRvSessionPreReveal");
    expect(postReveal).not.toContain("appendSessionEvent");
  });

  it("leaves Monitor prompt behavior unchanged while allowing Viewer-only Field Guide wiring", () => {
    const monitorContract = JSON.stringify((["pl", "en"] as const).map((language) => ({
      language,
      editable: factoryMonitorEditablePrompt(language),
      monitorExecution: lockedMonitorExecution(language),
      telepathicExecution: lockedTelepathicMonitorExecution(language),
      monitorPrompt: buildEffectiveMonitorPrompt(language),
      telepathicPrompt: buildEffectiveTelepathicMonitorPrompt(language),
    })));
    expect(createHash("sha256").update(monitorContract).digest("hex")).toBe("40388dc3bc9b21f9105d94c5f77b8db4bf9d3eff8375ec877e92252e441b32c2");

    const telepathicWithoutFieldGuideWiring = source("src/sessions/telepathicController.ts")
      .replace("  lockedViewerBaseVocabulary,\n", "")
      .replace("  LOCKED_BASE_VOCABULARY_VERSION,\n", "")
      .replace(/^\s*\{ id: "locked-viewer-base-vocabulary"[^\n]*\n/m, "")
      .replace(/^\s*\.\.\.\(input\.rvSystemPrompt\.fieldGuide[^\n]*\n/m, "");
    expect(createHash("sha256").update(telepathicWithoutFieldGuideWiring).digest("hex")).toBe("66abdc5a23016803c32422ed9bd1d68666da1f1147fee5819c89cf158c99d248");
  });

  it("leaves AI Judge prompt, rubric, scoring, packet and frozen-score engine byte-identical to the accepted base", () => {
    const expected = new Map<string, string>([
      ["src/judge/prompt.ts", "dc2af6fe6b478360cab414c4e4d9bc3f3a4d9fae95819f8420f116c8652df492"],
      ["src/judge/types.ts", "51b2377b3e44cf909a799eb4ad94d384db89e2ef8c278c5e421da346293b12ef"],
      ["src/judge/engine.ts", "df0f40bb7747f36f184f89211c170b2edef2484a8b07b0920390c1dd8dfa8b7d"],
      ["src/domain/scoring.ts", "c73c8950219b6bf0e0698d96a36524ee421f2ad64cf388e8124f1937d7b1f408"],
      ["src/domain/judgePacket.ts", "98a4bc19840da6219858fe63a51615d37911711cd22f4642bb424eea12f15dcb"],
    ]);
    for (const [file, hash] of expected) expect(sha256(file)).toBe(hash);
  });
});
