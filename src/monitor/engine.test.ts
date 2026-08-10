import { describe, expect, it } from "vitest";
import { MonitorDecisionError, validateMonitorDecision } from "./engine";

describe("AI Monitor no-leading guard", () => {
  const transcript = "Phase 2: I perceive a large hard angular structure beside a wide open area. Several people are moving nearby.";

  it("accepts a structure deepening only when quoted evidence exists", () => {
    const decision = validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "STRUCTURE_MATERIAL", viewer_evidence: "large hard angular structure" }), transcript, "en");
    expect(decision.decision).toBe("INTERVENE");
    if (decision.decision === "INTERVENE") expect(decision.commandText).toContain("material");
  });

  it("blocks a subject/event/structure command grounded in invented evidence", () => {
    expect(() => validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "EVENT_CAUSE", viewer_evidence: "major explosion event" }), transcript, "en")).toThrow(/not a verbatim|prerequisite failed/);
  });

  it("blocks parameterized locations not copied from the Viewer transcript", () => {
    expect(() => validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "NEW_REPORTED_LOCATION", viewer_evidence: "wide open area", argument: "underground station" }), transcript, "en")).toThrow(/argument is not grounded/);
  });

  it("accepts CONTINUE_PROTOCOL without inventing a command", () => {
    expect(validateMonitorDecision('{"decision":"CONTINUE_PROTOCOL"}', transcript, "en")).toEqual({ decision: "CONTINUE_PROTOCOL" });
  });

  it.each(["wall", "walls", "interior", "corridor structure"])("accepts English structure evidence: %s", (viewerEvidence) => {
    const source = `Phase 2: angular ${viewerEvidence} with hard edges.`;
    expect(validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "STRUCTURE_INTERIOR", viewer_evidence: viewerEvidence }), source, "en").decision).toBe("INTERVENE");
  });

  it.each(["ściana", "ściany", "wewnętrzne ściany", "wnętrze", "konstrukcja", "korytarz"])("accepts Polish inflection: %s", (viewerEvidence) => {
    const source = `Faza 2: twarda ${viewerEvidence}, nieruchoma i kanciasta.`;
    expect(validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "STRUCTURE_SHAPE", viewer_evidence: viewerEvidence }), source, "pl").decision).toBe("INTERVENE");
  });

  it("preserves the raw rejected response for the audit trail", () => {
    const raw = '{"decision":"INTERVENE","command_id":"EVENT_CAUSE","viewer_evidence":"large hard angular structure"}';
    try {
      validateMonitorDecision(raw, transcript, "en");
      throw new Error("expected rejection");
    } catch (cause) {
      expect(cause).toBeInstanceOf(MonitorDecisionError);
      expect((cause as MonitorDecisionError).rawResponse).toBe(raw);
      expect((cause as MonitorDecisionError).code).toBe("PREREQUISITE_MISMATCH");
    }
  });
});
