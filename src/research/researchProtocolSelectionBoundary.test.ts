import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("Research protocol selection boundary", () => {
  it("keeps Full RCP / RV Lite selection and call-count policy centralized", () => {
    const policy = source("src/research/protocolPolicy.ts");
    const builder = source("src/features/research/ResearchBuilder.tsx");
    const preflight = source("src/research/preflight.ts");
    const engine = source("src/research/engine.ts");

    expect(policy).toContain('selection.id === "full-rcp"');
    expect(policy).toContain('selection.id === "rv-lite"');
    expect(policy).toContain('unsupportedResearchProtocol(selection)');
    expect(policy).toContain('getRvLite(language, "extended")');
    expect(builder).toContain("researchProtocolViewerCalls(config.protocol)");
    expect(preflight).toContain("researchProtocolViewerCalls(config.protocol)");
    expect(engine).toContain('protocol.id === "full-rcp"');
    expect(engine).toContain("runAutomaticRvLiteSession");
    expect(builder).not.toContain("sessions * 6");
    expect(preflight).not.toContain("sessionCount * 6");
  });

  it("requires RV Lite Research ownership and recovery linkage in the shared controller", () => {
    const lite = source("src/sessions/rvLiteController.ts");
    expect(lite).toContain("researchProjectId?: string");
    expect(lite).toContain("researchProjectId: input.researchProjectId");
    expect(lite).toContain("onSessionCreated?.(sessionId, sessionCode)");
    expect(lite).toContain("researchConditionInstruction");
  });
});
