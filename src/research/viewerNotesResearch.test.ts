import { describe, expect, it } from "vitest";
import type { ViewerNotesSessionSnapshot } from "../aiCenter/types";
import type { EffectiveGenerationSettings } from "../providers/types";
import { runResearchPreflight } from "./preflight";
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
});
