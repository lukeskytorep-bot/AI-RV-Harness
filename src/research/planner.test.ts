import { describe, expect, it } from "vitest";
import { buildResearchLockPlan } from "./planner";
import type { ResearchConfig } from "./types";

const config: ResearchConfig = {
  schemaVersion: 1, name: "Practice", workspaceId: "w", templateType: "practice", sessionLanguage: "en",
  protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t1", "t2"], repetitions: 1, requireUnusedTargets: false,
  conditions: [
    { key: "first", label: "FIRST", practiceOrder: "FIRST", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {} },
    { key: "second", label: "SECOND", practiceOrder: "SECOND", profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {} },
  ],
  judges: [{ providerConfigId: "jpc", modelId: "jm" }],
  randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
};

describe("Research lock planner", () => {
  it("keeps FIRST/SECOND only in the Blinding Key and emits neutral Judge IDs", async () => {
    const plan = await buildResearchLockPlan("research_1", config);
    expect(plan.assignments).toHaveLength(4);
    expect(new Set(plan.assignments.map((item) => item.executionOrder)).size).toBe(4);
    for (const assignment of plan.assignments) {
      expect(assignment.anonymousSessionId).toMatch(/^BlindSession_[A-F0-9]{12}$/);
      expect(assignment.anonymousSessionId).not.toMatch(/FIRST|SECOND|MODEL|HIGH|LOW/);
    }
    expect(plan.mappings.map((item) => item.pairOrder).sort()).toEqual(["FIRST", "FIRST", "SECOND", "SECOND"]);
    const pairCounts = new Map<string, number>();
    for (const mapping of plan.mappings) pairCounts.set(mapping.pairKey, (pairCounts.get(mapping.pairKey) ?? 0) + 1);
    expect([...pairCounts.values()]).toEqual([2, 2]);
  });
});
