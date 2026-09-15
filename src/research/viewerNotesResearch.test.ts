import { describe, expect, it } from "vitest";
import type { ViewerNotesSessionSnapshot } from "../aiCenter/types";
import type { EffectiveGenerationSettings } from "../providers/types";
import { runResearchPreflight } from "./preflight";
import { buildResearchLockPlan } from "./planner";
import type { ResearchConfig } from "./types";

const capabilities = {
  inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
  reasoning: { supported: false, efforts: [], confidence: "unknown" as const },
  temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: [],
  contextTokens: 100000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now",
};
const effective: EffectiveGenerationSettings = { requested: { maxOutputTokens: 4096 }, effective: { maxOutputTokens: 4096 }, omitted: [] };
const prompt = { id: "p", version: "1", content: "Fixed Viewer prompt", contentSha256: "p".repeat(64) };
const frozen: ViewerNotesSessionSnapshot = { enabled: true, aiIdentityId: "ai", noteType: "viewer_self_notes", versionId: "v5", versionNumber: 5, content: "Describe low-level sensory impressions first.", contentSha256: "n".repeat(64), estimatedTokens: 15, estimatorVersion: "conservative-char-v1", capacityTokens: 1024, modelRoute: "openrouter:m", capturedAt: "now" };
const off: ViewerNotesSessionSnapshot = { ...frozen, enabled: false, content: "", contentSha256: "e".repeat(64), estimatedTokens: 0 };

function config(): ResearchConfig {
  return {
    schemaVersion: 1, name: "Notes", workspaceId: "w", templateType: "viewer_notes", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
    viewerControl: { model: { mode: "fixed", modelId: "m" }, systemPrompt: { mode: "fixed", source: "profile", contentSha256: prompt.contentSha256 }, reasoning: { mode: "provider_default" }, temperature: { mode: "provider_default" }, maxOutputTokens: 4096 },
    conditions: [
      { key: "no_notes", label: "No Notes", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: { maxOutputTokens: 4096 }, effectiveSettings: effective, capabilitySnapshot: capabilities, systemPrompt: prompt, viewerNotes: off },
      { key: "frozen_notes", label: "Frozen Notes v5", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: { maxOutputTokens: 4096 }, effectiveSettings: effective, capabilitySnapshot: capabilities, systemPrompt: prompt, viewerNotes: frozen },
    ], evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
  };
}

const inventory = {
  profiles: [{ id: "profile", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
  providerConfigs: [{ id: "pc", provider: "openrouter" as const, label: "P", credentialId: "cred", enabled: true, lastStatus: "ok" as const, createdAt: "now", updatedAt: "now" }],
  models: [{ providerConfigId: "pc", provider: "openrouter" as const, modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
  targets: [{ id: "t", collection: "user" as const, title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }],
  targetUsage: [],
};

describe("Viewer Notes Research", () => {
  it("accepts one locked No Notes/Frozen Notes pair", () => {
    const result = runResearchPreflight(config(), inventory);
    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_design", level: "pass" }));
  });

  it("rejects an empty or drifting frozen condition", () => {
    const broken = config();
    broken.conditions[1].viewerNotes = { ...frozen, content: "", versionId: "different" };
    const result = runResearchPreflight(broken, inventory);
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_design", level: "fail" }));
  });

  it("accepts ordinary Research with Viewer Notes disabled across all conditions", () => {
    const ordinary = config();
    ordinary.templateType = "model";
    ordinary.viewerControl!.model = { mode: "condition_variable" };
    ordinary.conditions = ordinary.conditions.map(({ viewerNotes: _viewerNotes, ...condition }, index) => ({ ...condition, key: `model_${index}`, label: `Model ${index}` }));
    const result = runResearchPreflight(ordinary, inventory);
    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_control", level: "pass" }));
  });

  it("accepts one identical current Viewer Notes snapshot as an ordinary study-wide constant", () => {
    const ordinary = config();
    ordinary.templateType = "model";
    ordinary.viewerControl!.model = { mode: "condition_variable" };
    ordinary.conditions = ordinary.conditions.map((condition, index) => ({ ...condition, key: `model_${index}`, label: `Model ${index}`, viewerNotes: structuredClone(frozen) }));
    const result = runResearchPreflight(ordinary, inventory);
    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_control", level: "pass" }));
  });

  it("accepts identity-specific current Viewer Notes for Profile comparison only when routes match", () => {
    const profileStudy = config();
    profileStudy.templateType = "profile";
    profileStudy.conditions = profileStudy.conditions.map((condition, index) => ({
      ...condition,
      key: `profile_${index}`,
      label: `Profile ${index}`,
      profileId: `profile-${index}`,
      viewerNotes: { ...structuredClone(frozen), aiIdentityId: `ai-${index}`, versionId: `v-${index}`, modelRoute: "openrouter:m" },
    }));
    expect(runResearchPreflight(profileStudy, inventory).checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_control", level: "pass" }));

    profileStudy.conditions[1].viewerNotes!.modelRoute = "openrouter:other";
    expect(runResearchPreflight(profileStudy, inventory).checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_control", level: "fail" }));
  });

  it("rejects ordinary Research when Viewer Notes are missing, empty, or drift between conditions", () => {
    const drifting = config();
    drifting.templateType = "model";
    drifting.viewerControl!.model = { mode: "condition_variable" };
    drifting.conditions = drifting.conditions.map((condition, index) => ({ ...condition, key: `model_${index}`, label: `Model ${index}`, viewerNotes: structuredClone(frozen) }));
    drifting.conditions[1].viewerNotes = { ...frozen, versionId: "v6", versionNumber: 6, contentSha256: "b".repeat(64) };
    expect(runResearchPreflight(drifting, inventory).checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_control", level: "fail" }));

    const empty = structuredClone(drifting);
    empty.conditions[1].viewerNotes = { ...frozen, content: "", contentSha256: "e".repeat(64) };
    expect(runResearchPreflight(empty, inventory).checks).toContainEqual(expect.objectContaining({ id: "viewer_notes_control", level: "fail" }));
  });

  it("includes Viewer Notes content in the Viewer cost estimate", () => {
    const pricedInventory = structuredClone(inventory);
    pricedInventory.models[0].pricing = { promptPerToken: 0.000001, completionPerToken: 0.000002 };
    const without = config();
    without.templateType = "model";
    without.viewerControl!.model = { mode: "condition_variable" };
    without.conditions = without.conditions.map(({ viewerNotes: _viewerNotes, ...condition }, index) => ({ ...condition, key: `model_${index}`, label: `Model ${index}` }));
    const withNotes = structuredClone(without);
    const largeNotes = { ...frozen, content: "procedural memory ".repeat(500), contentSha256: "c".repeat(64), estimatedTokens: 2500 };
    withNotes.conditions = withNotes.conditions.map((condition) => ({ ...condition, viewerNotes: structuredClone(largeNotes) }));
    const baselineCost = runResearchPreflight(without, pricedInventory).estimatedCostUsd!;
    const notesCost = runResearchPreflight(withNotes, pricedInventory).estimatedCostUsd!;
    expect(notesCost).toBeGreaterThan(baselineCost);
  });

  it("copies the frozen Viewer Notes snapshot into the immutable Experiment Lock plan", async () => {
    const lockedConfig = config();
    const originalContent = lockedConfig.conditions[1].viewerNotes!.content;
    const plan = await buildResearchLockPlan("research-notes", lockedConfig);
    const frozenRecord = plan.conditions.find((condition) => condition.conditionKey === "frozen_notes")!;
    expect(frozenRecord.config.viewerNotes).toEqual(frozen);
    lockedConfig.conditions[1].viewerNotes!.content = "mutated after lock planning";
    expect(frozenRecord.config.viewerNotes?.content).toBe(originalContent);
  });

});
