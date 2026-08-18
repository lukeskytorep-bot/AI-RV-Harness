import { describe, expect, it } from "vitest";
import { parseMonitorDecision } from "./engine";

describe("autonomous AI Monitor decisions", () => {
  it("accepts a natural-language instruction without a command library or evidence gate", () => {
    expect(parseMonitorDecision("Move 200 meters above the target and describe the spatial arrangement.")).toEqual({
      decision: "INTERVENE",
      commandText: "Move 200 meters above the target and describe the spatial arrangement.",
      rawResponse: "Move 200 meters above the target and describe the spatial arrangement.",
    });
  });

  it("recognizes the only controller sentinel", () => {
    expect(parseMonitorDecision("CONTINUE_PROTOCOL")).toEqual({ decision: "CONTINUE_PROTOCOL" });
    expect(parseMonitorDecision("Continue.")).toEqual({ decision: "CONTINUE_PROTOCOL" });
  });

  it("does not treat JSON as a privileged command format", () => {
    expect(parseMonitorDecision('{"decision":"INTERVENE","command_id":"CENTER"}').decision).toBe("INTERVENE");
  });
});
