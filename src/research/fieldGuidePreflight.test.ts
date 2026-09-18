import { describe, expect, it } from "vitest";
import { buildEffectiveViewerPrompt, LOCKED_BASE_VOCABULARY_VERSION, LOCKED_IDENTITY_VERSION } from "../resources/systemPrompts";
import { runResearchPreflight, type ResearchPreflightInventory } from "./preflight";
import type { ResearchConfig, ResearchFieldGuideSnapshot } from "./types";

const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" as const }, temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: [], contextTokens: 100000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now" };
const inventory: ResearchPreflightInventory = {
  profiles: [{ id: "p", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
  providerConfigs: [{ id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" }],
  models: [{ providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
  targets: [{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }],
  targetUsage: [],
};

function guide(versionNumber = 3): ResearchFieldGuideSnapshot {
  return {
    aiIdentityId: "identity", language: "en", versionId: `fg-${versionNumber}`, versionNumber, versionCreatedAt: `2026-09-${String(versionNumber).padStart(2, "0")}T00:00:00Z`, content: `guide ${versionNumber}`, contentSha256: String(versionNumber).padStart(64, "0"), estimatedTokens: 3,
    estimatorVersion: "conservative-char-v1", capacityTokens: 4096, capacityTokensAtCreation: 4096, modelRoute: "openrouter:m", capturedAt: "lock", sourceKind: "training-reflection", sourceTrainingRunId: `training-${versionNumber}`, sourceSessionId: `session-${versionNumber}`,
    sourceSnapshot: { schemaVersion: 1, sourceKind: "training-reflection", profileId: "p", capturedAt: "source", sourceTrainingRunId: `training-${versionNumber}`, sourceSessionId: `session-${versionNumber}` },
    identity: { aiIdentityId: "identity", profileId: "p", credentialFingerprint: "fp", providerConfigId: "pc", provider: "openrouter", modelId: "m", modelRoute: "openrouter:m" },
  };
}

const notes = { enabled: true, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, versionId: "notes-2", versionNumber: 2, content: "notes", contentSha256: "n".repeat(64), estimatedTokens: 2, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 1024 as const, modelRoute: "openrouter:m", capturedAt: "lock" };

function ordinary(notesOn: boolean, fieldGuideOn: boolean): ResearchConfig {
  const fg = fieldGuideOn ? guide() : undefined;
  const content = buildEffectiveViewerPrompt("en", fg?.content ?? "");
  const prompt = { id: "viewer", version: "frozen", content, contentSha256: fieldGuideOn ? "f".repeat(64) : "o".repeat(64), ...(fg ? { fieldGuide: fg } : {}) };
  const base = { profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: prompt, ...(fg ? { fieldGuide: fg, promptSource: "active_field_guide" as const } : { promptSource: "locked_only" as const }), ...(notesOn ? { viewerNotes: notes } : {}) };
  return {
    schemaVersion: 1, name: "R", workspaceId: "w", templateType: "practice", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
    conditions: [{ key: "first", label: "FIRST", practiceOrder: "FIRST", ...base }, { key: "second", label: "SECOND", practiceOrder: "SECOND", ...base }],
    fieldGuideControl: { mode: fieldGuideOn ? "current" : "off", source: fieldGuideOn ? "active" : "none", language: "en", lockedCoreIdentityVersion: LOCKED_IDENTITY_VERSION, lockedBaseVocabularyVersion: LOCKED_BASE_VOCABULARY_VERSION },
    viewerNotesControl: { mode: notesOn ? "current" : "off" }, evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
  };
}

describe("VIEWER-LEARNING-3 Research preflight", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]] as const)("accepts independent Viewer Notes=%s / Field Guide=%s controls", (notesOn, fieldGuideOn) => {
    const result = runResearchPreflight(ordinary(notesOn, fieldGuideOn), inventory);
    expect(result.checks.find((check) => check.id === "field_guide_control")?.level).toBe("pass");
    expect(result.checks.find((check) => check.id === "viewer_notes_control")?.level).toBe("pass");
    expect(result.ok).toBe(true);
  });

  it("rejects Field Guide OFF if the locked Core/Base composition is removed", () => {
    const config = ordinary(false, false);
    config.conditions = config.conditions.map((condition) => ({ ...condition, systemPrompt: { ...condition.systemPrompt!, content: "manual raw prompt without locked blocks" } }));
    expect(runResearchPreflight(config, inventory).checks).toContainEqual(expect.objectContaining({ id: "field_guide_control", level: "fail" }));
  });

  it("accepts 2–4 historical versions only when Field Guide is the sole prompt variable", () => {
    const versions = [guide(6), guide(3), guide(1)];
    const conditions = versions.map((fg) => ({ key: `fg_${fg.versionNumber}`, label: `Field Guide v${fg.versionNumber}`, profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, fieldGuide: fg, promptSource: "historical_field_guide" as const, systemPrompt: { id: `p-${fg.versionNumber}`, version: `fg:${fg.versionId}`, content: buildEffectiveViewerPrompt("en", fg.content), contentSha256: String(fg.versionNumber + 10).padStart(64, "0"), fieldGuide: fg } }));
    const config: ResearchConfig = {
      schemaVersion: 1, name: "History", workspaceId: "w", templateType: "system_prompt", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions, fieldGuideControl: { mode: "history", source: "history", language: "en", lockedCoreIdentityVersion: LOCKED_IDENTITY_VERSION, lockedBaseVocabularyVersion: LOCKED_BASE_VOCABULARY_VERSION, identityId: "identity", selectedVersionIds: versions.map((item) => item.versionId) }, viewerNotesControl: { mode: "off" }, promptResearchSource: "field_guide_history", evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const result = runResearchPreflight(config, inventory);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "field_guide_history_design", level: "pass" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "controlled_variables", level: "pass" }));
    expect(result.ok).toBe(true);

    const confounded = structuredClone(config);
    confounded.conditions[1].modelId = "another-model";
    expect(runResearchPreflight(confounded, inventory).ok).toBe(false);
  });

  it("keeps manual prompt variants supported without treating them as Field Guide versions", () => {
    const manual = ["alpha", "beta"].map((body, index) => ({ key: `p${index}`, label: `Prompt ${index + 1}`, profileId: "p", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, promptSource: "manual_research_prompt" as const, systemPrompt: { id: `manual-${index}`, version: "manual", content: body, contentSha256: String(index + 30).padStart(64, "0") } }));
    const config: ResearchConfig = {
      schemaVersion: 1, name: "Manual", workspaceId: "w", templateType: "system_prompt", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false, conditions: manual,
      fieldGuideControl: { mode: "off", source: "none", language: "en", lockedCoreIdentityVersion: LOCKED_IDENTITY_VERSION, lockedBaseVocabularyVersion: LOCKED_BASE_VOCABULARY_VERSION }, viewerNotesControl: { mode: "off" }, promptResearchSource: "manual", evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const result = runResearchPreflight(config, inventory);
    expect(result.ok).toBe(true);
    expect(config.conditions.every((condition) => condition.fieldGuide === undefined)).toBe(true);
  });

  it("includes frozen Field Guide prompt size in context preflight and cost planning inputs", () => {
    const config = ordinary(false, true);
    const tinyInventory = structuredClone(inventory);
    tinyInventory.models[0].capabilities.contextTokens = 64;
    const body = "field-guide-context ".repeat(600);
    const snapshot = guide(9);
    snapshot.content = body;
    snapshot.estimatedTokens = 3000;
    config.conditions.forEach((condition) => {
      condition.fieldGuide = structuredClone(snapshot);
      condition.systemPrompt = {
        id: `fg-${condition.key}`,
        version: `field-guide:${snapshot.versionId}`,
        content: buildEffectiveViewerPrompt("en", body),
        contentSha256: "f".repeat(64),
        fieldGuide: structuredClone(snapshot),
      };
      condition.promptSource = "active_field_guide";
    });
    const result = runResearchPreflight(config, tinyInventory);
    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.id.includes(":context") && check.level === "fail")).toBe(true);
    expect(result.estimatedViewerCalls).toBeGreaterThan(0);
  });

  it("preserves existing legacy Research configs with an explicit compatibility warning", () => {
    const legacy = ordinary(false, false);
    delete legacy.fieldGuideControl;
    delete legacy.viewerNotesControl;
    const result = runResearchPreflight(legacy, inventory);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "field_guide_control", level: "warning" }));
  });
});
