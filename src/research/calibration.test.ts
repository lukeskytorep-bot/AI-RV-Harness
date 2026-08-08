import { describe, expect, it } from "vitest";
import { buildCalibrationHistory } from "./calibration";
import type { ProviderConfig } from "../providers/types";
import type { ResearchProjectRecord, ResearchResults } from "./types";
import type { Profile } from "../types";

describe("Calibration History", () => {
  it("keeps calibration tied to the exact profile credential route and labels an old binding historical", () => {
    const profile = { id: "profile_a", name: "Leo", credentialId: "cred_new", createdAt: "", updatedAt: "" } satisfies Profile;
    const providers = [
      { id: "provider_old", provider: "openai", label: "Old key", credentialId: "cred_old", enabled: true, createdAt: "", updatedAt: "" },
      { id: "provider_new", provider: "openai", label: "New key", credentialId: "cred_new", enabled: true, createdAt: "", updatedAt: "" },
    ] satisfies ProviderConfig[];
    const project = {
      id: "research_1", workspaceId: "workspace_1", name: "Reasoning calibration", templateType: "reasoning", state: "Complete",
      config: { schemaVersion: 1, name: "Reasoning calibration", workspaceId: "workspace_1", templateType: "reasoning", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t1"], repetitions: 1, requireUnusedTargets: false,
        conditions: [
          { key: "low", label: "LOW", profileId: "profile_a", providerConfigId: "provider_old", modelId: "gpt-test", requestedSettings: { reasoningEffort: "low" } },
          { key: "high", label: "HIGH", profileId: "profile_a", providerConfigId: "provider_old", modelId: "gpt-test", requestedSettings: { reasoningEffort: "high" } },
        ], judges: [{ providerConfigId: "provider_new", modelId: "judge" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true } },
      createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z",
    } satisfies ResearchProjectRecord;
    const results = { schemaVersion: 1, projectId: project.id, templateType: "reasoning", sessions: [], pairwise: [], computedAt: "2026-08-02T12:00:00Z", conditions: [
      { conditionKey: "low", label: "LOW", n: 6, meanTotal: 7.2, medianTotal: 7.2, stdDevTotal: 0.5, minTotal: 6, maxTotal: 8, meanComponents: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1.5, confabulationControl: 1.7 } },
      { conditionKey: "high", label: "HIGH", n: 6, meanTotal: 6.4, medianTotal: 6.4, stdDevTotal: 0.6, minTotal: 5, maxTotal: 8, meanComponents: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1.2, confabulationControl: 1.2 } },
    ] } satisfies ResearchResults;

    const history = buildCalibrationHistory([project], new Map([[project.id, results]]), profile, providers);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ modelId: "gpt-test", tested: ["LOW", "HIGH"], bestObserved: ["LOW"], n: 12, historical: true });
  });
});
