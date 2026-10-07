import { describe, expect, it } from "vitest";
import fs from "node:fs";

const panel = fs.readFileSync(new URL("./TelepathicTrainingPanel.tsx", import.meta.url), "utf8");
const screen = fs.readFileSync(new URL("./TrainingScreen.tsx", import.meta.url), "utf8");

describe("STEP 4B stabilization boundary", () => {
  it("raises application busy state synchronously before async work", () => {
    expect(panel).toContain("runGuard.current = true;");
    expect(panel).toContain("onBusyChange?.(true);");
    expect(panel.indexOf("onBusyChange?.(true);")).toBeLessThan(panel.indexOf("setBusy(true);"));
    expect(panel).toContain("onBusyChange?.(false);");
  });

  it("uses a synchronous TrainingScreen guard when leaving telepathic training", () => {
    expect(screen).toContain("const telepathicBusyGuard = useRef(false);");
    expect(screen).toContain("telepathicBusyGuard.current = nextBusy;");
    expect(screen).toContain('if (!telepathicBusyGuard.current) setSurface("standard")');
  });

  it("recovers the concrete series started by the failed operation", () => {
    expect(panel).toContain("recoverySeriesId?: string");
    expect(panel).toContain("const seriesId = recoverySeriesId ?? activeSeriesIdRef.current;");
    expect(panel).toContain("}, seriesId);");
    expect(panel).toContain("await refreshHistory().catch(() => undefined);");
  });

  it("rejects stale polling results by series id and refresh generation", () => {
    expect(panel).toContain("const refreshGenerationRef = useRef(0);");
    expect(panel).toContain("if (activeSeriesIdRef.current !== seriesId) return;");
    expect(panel).toContain("if (refreshGenerationRef.current !== generation) return;");
    expect(panel).toContain("refreshGenerationRef.current += 1;");
  });

  it("requires a visible configuration preflight before Start", () => {
    expect(panel).toContain("preflightTelepathicTrainingConfig");
    expect(panel).toContain("Run preflight");
    expect(panel).toContain("Baseline cost estimate");
    expect(panel).toContain("!configPreflight?.ok");
  });
});
