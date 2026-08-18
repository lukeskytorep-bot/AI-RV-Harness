import { describe, expect, it } from "vitest";
import { emptySessionRequestMetrics, recordProviderRequest, snapshotSessionMetrics } from "./metrics";

describe("session operational metrics", () => {
  it("adds only provider-reported usage and keeps request/session duration separate", () => {
    let metrics = emptySessionRequestMetrics();
    metrics = recordProviderRequest(metrics, { inputTokens: 100, outputTokens: 25, totalTokens: 125, costUsd: 0.004 }, 410.4);
    metrics = recordProviderRequest(metrics, undefined, 90.2);
    expect(snapshotSessionMetrics(metrics, 1_000, 2_500)).toEqual({
      requestCount: 2,
      requestDurationMs: 500,
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      costUsd: 0.004,
      sessionDurationMs: 1_500,
    });
  });
});
