import { describe, expect, it } from "vitest";
import { buildResearchLockPlan, validateConfig } from "./planner";
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

    const mappingBySession = new Map(plan.mappings.map((item) => [item.anonymousSessionId, item]));
    const execution = [...plan.assignments].sort((left, right) => left.executionOrder - right.executionOrder);
    for (let index = 0; index < execution.length; index += 2) {
      const first = mappingBySession.get(execution[index].anonymousSessionId)!;
      const second = mappingBySession.get(execution[index + 1].anonymousSessionId)!;
      expect(first.pairKey).toBe(second.pairKey);
      expect([first.pairOrder, second.pairOrder]).toEqual(["FIRST", "SECOND"]);
      expect(execution[index].targetId).toBe(execution[index + 1].targetId);
    }
  });

  it("locks explicit save-only Research without configuring an AI Judge", async () => {
    const saveOnly: ResearchConfig = { ...config, evaluationMode: "save_only", judges: [] };
    expect(() => validateConfig(saveOnly)).not.toThrow();
    await expect(buildResearchLockPlan("research_save_only", saveOnly)).resolves.toMatchObject({ assignments: expect.any(Array) });
  });

  it("does not silently reinterpret a legacy no-Judge configuration as save-only", () => {
    const legacy: ResearchConfig = { ...config, judges: [] };
    expect(() => validateConfig(legacy)).toThrow(/Legacy Research configuration requires/);
  });
  it("freezes the exact Field Guide snapshot into Experiment Lock and includes it in the config hash", async () => {
    const fieldGuide = {
      aiIdentityId: "identity", language: "en" as const, versionId: "fg-v4", versionNumber: 4, versionCreatedAt: "2026-09-18T10:00:00Z", content: "trained guide", contentSha256: "f".repeat(64), estimatedTokens: 3,
      estimatorVersion: "conservative-char-v1" as const, capacityTokens: 4096 as const, capacityTokensAtCreation: 2048 as const, modelRoute: "openrouter:m", capturedAt: "lock", sourceKind: "training-reflection" as const, sourceTrainingRunId: "training-4", sourceSessionId: "session-4",
      sourceSnapshot: { schemaVersion: 1 as const, sourceKind: "training-reflection" as const, profileId: "p", capturedAt: "source", sourceTrainingRunId: "training-4", sourceSessionId: "session-4" },
      identity: { aiIdentityId: "identity", profileId: "p", credentialFingerprint: "fp", providerConfigId: "pc", provider: "openrouter" as const, modelId: "m", modelRoute: "openrouter:m" },
    };
    const lockedConfig: ResearchConfig = {
      ...config,
      fieldGuideControl: { mode: "current", source: "active", language: "en", lockedCoreIdentityVersion: "1.1.0", lockedBaseVocabularyVersion: "1.0.0" },
      viewerNotesControl: { mode: "off" },
      conditions: config.conditions.map((condition) => ({ ...condition, fieldGuide: structuredClone(fieldGuide), promptSource: "active_field_guide" })),
    };
    const plan = await buildResearchLockPlan("research_fg", lockedConfig);
    expect(plan.conditions.every((condition) => condition.config.fieldGuide?.versionId === "fg-v4")).toBe(true);
    expect(plan.conditions[0].config.fieldGuide).toEqual(fieldGuide);
    fieldGuide.content = "mutated after lock";
    expect(plan.conditions[0].config.fieldGuide?.content).toBe("trained guide");

    const changedVersion = structuredClone(lockedConfig);
    changedVersion.conditions.forEach((condition) => { condition.fieldGuide!.versionId = "fg-v5"; });
    const changedPlan = await buildResearchLockPlan("research_fg_2", changedVersion);
    expect(changedPlan.configHash).not.toBe(plan.configHash);
  });

});
