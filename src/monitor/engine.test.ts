import { describe, expect, it } from "vitest";
import { validateMonitorDecision } from "./engine";

describe("AI Monitor no-leading guard", () => {
  const transcript = "Phase 2: I perceive a large hard angular structure beside a wide open area. Several people are moving nearby.";

  it("accepts a structure deepening only when quoted evidence exists", () => {
    const decision = validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "STRUCTURE_MATERIAL", viewer_evidence: "large hard angular structure" }), transcript, "en");
    expect(decision.decision).toBe("INTERVENE");
    if (decision.decision === "INTERVENE") expect(decision.commandText).toContain("material");
  });

  it("blocks a subject/event/structure command grounded in invented evidence", () => {
    expect(() => validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "EVENT_CAUSE", viewer_evidence: "major explosion event" }), transcript, "en")).toThrow(/prerequisite failed/);
  });

  it("blocks parameterized locations not copied from the Viewer transcript", () => {
    expect(() => validateMonitorDecision(JSON.stringify({ decision: "INTERVENE", command_id: "NEW_REPORTED_LOCATION", viewer_evidence: "wide open area", argument: "underground station" }), transcript, "en")).toThrow(/argument is not grounded/);
  });

  it("accepts CONTINUE_PROTOCOL without inventing a command", () => {
    expect(validateMonitorDecision('{"decision":"CONTINUE_PROTOCOL"}', transcript, "en")).toEqual({ decision: "CONTINUE_PROTOCOL" });
  });
});
