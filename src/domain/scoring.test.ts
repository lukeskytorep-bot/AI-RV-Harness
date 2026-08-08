import { describe, expect, it } from "vitest";
import { aggregateJudgeScores, computeJudgeTotal } from "./scoring";

describe("3 + 3 + 2 + 2 Judge scoring", () => {
  it("computes the 0–10 total deterministically", () => {
    expect(
      computeJudgeTotal({ gestalt: 2.5, verifiableFeatures: 2.2, activityFunctionEvent: 1.4, confabulationControl: 1.6 }),
    ).toBe(7.7);
  });

  it("rejects an out-of-range component", () => {
    expect(() =>
      computeJudgeTotal({ gestalt: 3.1, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1 }),
    ).toThrow(RangeError);
  });

  it("aggregates independent Judges without asking a model to calculate totals", () => {
    const aggregate = aggregateJudgeScores([
      { gestalt: 3, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 2 },
      { gestalt: 2, verifiableFeatures: 2.5, activityFunctionEvent: 1.5, confabulationControl: 1 },
      { gestalt: 2.5, verifiableFeatures: 3, activityFunctionEvent: 2, confabulationControl: 1.5 },
    ]);

    expect(aggregate.judgeCount).toBe(3);
    expect(aggregate.mean).toEqual({ gestalt: 2.5, verifiableFeatures: 2.5, activityFunctionEvent: 1.5, confabulationControl: 1.5, total: 8 });
    expect(aggregate.medianTotal).toBe(8);
    expect(aggregate.totalRange).toBe(2);
    expect(aggregate.totalStdDev).toBeGreaterThan(0);
  });
});
