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

  it("wires the shared checkpoint refresh to Training's series, Workspace and action revision", () => {
    expect(panel).toContain("const refresh = useTelepathicCheckpointRefresh({");
    expect(panel).toContain("seriesId: activeSeries?.config.seriesId");
    expect(panel).toContain("workspaceId: activeSeries?.config.seriesWorkspaceId");
    expect(panel).toContain("revision: refreshGenerationRef");
    expect(panel).toContain("refreshGenerationRef.current += 1;");
  });

  it("starts without a visible cost preflight and keeps authoritative engine validation", () => {
    expect(panel).not.toContain("Run preflight");
    expect(panel).not.toContain("Baseline cost estimate");
    expect(panel).toContain("resolveTelepathicAiRouteFromRepository");
    expect(panel).toContain("createTelepathicAiTrainingSeries");
  });
});
