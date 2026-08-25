import { describe, expect, it } from "vitest";
import { canSelectMonitor, canSelectProtocol, isRunModeCompatible } from "./modeCompatibility";

describe("Automatic session mode compatibility", () => {
  it("blocks RV Lite → AI Monitor", () => {
    expect(canSelectMonitor("lite")).toBe(false);
    expect(isRunModeCompatible("monitor", "lite")).toBe(false);
  });

  it("blocks AI Monitor → RV Lite instead of silently switching modes", () => {
    expect(canSelectProtocol("monitor", "lite")).toBe(false);
    expect(canSelectProtocol("monitor", "custom")).toBe(false);
    expect(canSelectProtocol("monitor", "rcp")).toBe(true);
    expect(canSelectProtocol("monitor", "telepathic")).toBe(true);
    expect(canSelectMonitor("telepathic")).toBe(true);
  });
});
