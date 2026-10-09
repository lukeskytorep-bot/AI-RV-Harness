import { describe, expect, it } from "vitest";
import { withEstimatedCost } from "./costGuard";
import type { ProviderModel } from "../providers/types";

const model = { pricing: { promptPerToken: 0.001, completionPerToken: 0.002 } } as ProviderModel;

describe("session cost reporting", () => {
  it("keeps provider-reported cost unchanged", () => {
    expect(withEstimatedCost({ inputTokens: 10, outputTokens: 20, costUsd: 0.123 }, model).costUsd).toBe(0.123);
  });

  it("estimates a display cost when provider cost is unavailable", () => {
    expect(withEstimatedCost({ inputTokens: 10, outputTokens: 20 }, model).costUsd).toBeCloseTo(0.05);
  });
});
