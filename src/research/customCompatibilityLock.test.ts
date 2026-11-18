import { expect, it } from "vitest";
import { freezeResearchCompatibility, freezeResearchViewerOutputPolicy } from "./engine";
import { buildResearchLockPlan } from "./planner";
import type { ResearchConfig } from "./types";
import type { ResearchPreflightInventory } from "./preflight";
import type { ProviderConfig, ProviderModel } from "../providers/types";
const provider: ProviderConfig = { id: "pc", provider: "custom_openai", customCompatibilityProfile: "llama_cpp", label: "Pod", credentialId: "k", enabled: true, createdAt: "t", updatedAt: "t" };
const model: ProviderModel = { providerConfigId: "pc", provider: "custom_openai", modelId: "m", route: "custom:m", displayName: "M", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "t", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, contextTokens: 131072, maxOutputTokens: 65536, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "t" } };
const config: ResearchConfig = { schemaVersion: 1, name: "Test", workspaceId: "w", templateType: "practice", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false, conditions: ["FIRST", "SECOND"].map(order => ({ key: order, label: order, practiceOrder: order as "FIRST" | "SECOND", profileId: "person", providerConfigId: "pc", modelId: "m", requestedSettings: { maxOutputTokens: 32768 } })), judges: [{ providerConfigId: "pc", modelId: "m" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true } };

it.each(["generic", "llama_cpp"] as const)("new Research freezes %s for Viewer and Judge before Experiment Lock", async profile => {
  const inventory = { providerConfigs: [{ ...provider, customCompatibilityProfile: profile }], models: [model] } as ResearchPreflightInventory;
  const frozen = freezeResearchViewerOutputPolicy(freezeResearchCompatibility(config, inventory), [model]);
  const restored: ResearchConfig = JSON.parse(JSON.stringify(frozen));
  inventory.providerConfigs[0].customCompatibilityProfile = profile === "llama_cpp" ? "generic" : "llama_cpp";
  for (const condition of restored.conditions) {
    expect(condition.requestedSettings.customCompatibilityProfile).toBe(profile);
    expect(condition.effectiveSettings?.effective.customCompatibilityProfile).toBe(profile);
  }
  expect(restored.judges[0].generationSettings?.customCompatibilityProfile).toBe(profile);
  // Planner accepts and hashes the frozen discriminator, without reading live configs.
  const plan = await buildResearchLockPlan("research", restored);
  expect(plan.assignments).toHaveLength(2);
  expect(config.conditions[0].requestedSettings.customCompatibilityProfile).toBeUndefined();
  // A separately created project uses today's connection choice, even when cloning an older draft.
  expect(freezeResearchCompatibility(restored, inventory).conditions[0].requestedSettings.customCompatibilityProfile).toBe(inventory.providerConfigs[0].customCompatibilityProfile);
});
