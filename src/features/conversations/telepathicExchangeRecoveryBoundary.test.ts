import { describe, expect, it } from "vitest";
import panel from "./TelepathicExchangePanel.tsx?raw";

describe("STEP 3B recovery/history boundary", () => {
  it("keeps a selectable series history and separate blocked recovery paths", () => {
    expect(panel).toContain("seriesHistory.map");
    expect(panel).toContain("resumeBlockedTelepathicSeries");
    expect(panel).toContain("allowRetryForUncertainTelepathicCall");
    expect(panel).toContain("Treat attempt as failed");
  });
});
