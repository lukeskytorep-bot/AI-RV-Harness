import { describe, expect, it } from "vitest";
import { computeConditionStatistics, computePairwiseStatistics } from "./statistics";
import type { UnblindedSessionResult } from "./types";

const row = (conditionKey: string, pairKey: string, total: number): UnblindedSessionResult => ({
  anonymousSessionId: `BlindSession_${conditionKey}${pairKey}`, sessionId: `${conditionKey}${pairKey}`, targetId: pairKey, pairKey,
  conditionKey, conditionLabel: conditionKey.toUpperCase(), total, judgeCount: 2, judgeTotalRange: 1, judgeTotalStdDev: .5,
  gestalt: total * .3, verifiableFeatures: total * .3, activityFunctionEvent: total * .2, confabulationControl: total * .2,
});

describe("Research statistics", () => {
  it("computes descriptive and matched comparisons deterministically", () => {
    const sessions = [row("a", "p1", 8), row("b", "p1", 6), row("a", "p2", 7), row("b", "p2", 7)];
    const conditions = computeConditionStatistics(sessions);
    const pairwise = computePairwiseStatistics(sessions);
    expect(conditions.find((item) => item.conditionKey === "a")?.meanTotal).toBe(7.5);
    expect(pairwise[0]).toMatchObject({ pairedN: 2, winsA: 1, ties: 1, winsB: 0, meanPairedDifference: 1 });
  });
  it("handles the maximum 125-condition sampling grid without changing matched-pair semantics", () => {
    const sessions: UnblindedSessionResult[] = [];
    for (let condition = 0; condition < 125; condition += 1) {
      for (let target = 0; target < 10; target += 1) sessions.push(row(`c${String(condition).padStart(3, "0")}`, `p${target}`, (condition + target) % 11));
    }
    const pairwise = computePairwiseStatistics(sessions);
    expect(pairwise).toHaveLength((125 * 124) / 2);
    expect(pairwise.every((pair) => pair.pairedN === 10)).toBe(true);
  });

});
