import { describe, expect, it } from "vitest";
import { createResearchProtocolSelection, researchProtocolLabel, researchProtocolViewerCalls, resolveResearchProtocol } from "./protocolPolicy";
import type { ResearchProtocolSelection } from "./types";

describe("Research protocol policy", () => {
  it("keeps legacy Full RCP Research records valid and counts six Viewer calls", () => {
    const legacy = { id: "full-rcp", version: "1.5a" } as const;
    const resource = resolveResearchProtocol(legacy, "en");
    expect(resource.id).toBe("full-rcp");
    expect(resource.version).toBe("1.5a");
    expect(researchProtocolViewerCalls(legacy)).toBe(6);
    expect(researchProtocolLabel(legacy)).toBe("Full RCP 1.5a");
  });

  it("freezes the approved Extended RV Lite resource and counts four Viewer calls", () => {
    const selection = createResearchProtocolSelection("rv-lite", "pl");
    expect(selection).toMatchObject({ id: "rv-lite", version: "1.1.0", variant: "extended" });
    const resource = resolveResearchProtocol(selection, "pl");
    expect(resource.id).toBe("rv-lite");
    if (resource.id !== "rv-lite") {
      throw new Error("Expected RV Lite protocol resource.");
    }
    expect(resource.variant).toBe("extended");
    expect(resource.contentSha256).toBe(selection.contentSha256);
    expect(researchProtocolViewerCalls(selection)).toBe(4);
    expect(researchProtocolLabel(selection)).toBe("RV Lite 1.1.0");
  });

  it("rejects protocol drift after Experiment Lock instead of silently using a different bundled resource", () => {
    const selection = createResearchProtocolSelection("rv-lite", "en");
    expect(() => resolveResearchProtocol({ ...selection, contentSha256: "0".repeat(64) }, "en")).toThrow("no longer matches");
  });

  it("rejects an unknown protocol id instead of reinterpreting it as RV Lite or Full RCP", () => {
    const rvLite = createResearchProtocolSelection("rv-lite", "en");
    const malformed = {
      ...rvLite,
      id: "something-else",
    } as unknown as ResearchProtocolSelection;

    expect(() => resolveResearchProtocol(malformed, "en")).toThrow("Unsupported Research protocol: something-else.");
    expect(() => researchProtocolViewerCalls(malformed)).toThrow("Unsupported Research protocol: something-else.");
    expect(() => researchProtocolLabel(malformed)).toThrow("Unsupported Research protocol: something-else.");
  });
});
