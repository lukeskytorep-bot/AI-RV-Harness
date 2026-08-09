import { describe, expect, it } from "vitest";
import { runResearchPreflight, type ResearchPreflightInventory } from "./preflight";
import type { ResearchConfig } from "./types";

const FIXED_SYSTEM_PROMPT = {
  id: "profile_viewer_prompt_profile",
  version: "now",
  content: "Use the same fixed Viewer instructions in every condition.",
  contentSha256: "a".repeat(64),
};

describe("Research preflight", () => {
  it("blocks unsupported reasoning conditions instead of simulating them", () => {
    const config: ResearchConfig = {
      schemaVersion: 1, name: "R", workspaceId: "w", templateType: "reasoning", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "low", label: "LOW", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: { reasoningEffort: "low" }, systemPrompt: FIXED_SYSTEM_PROMPT },
        { key: "high", label: "HIGH", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: { reasoningEffort: "high" }, systemPrompt: FIXED_SYSTEM_PROMPT },
      ], judges: [{ providerConfigId: "pc", modelId: "m" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const result = runResearchPreflight(config, {
      profiles: [{ id: "profile", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
      providerConfigs: [{ id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" }],
      models: [{ providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: true, efforts: ["low"], confidence: "provider_metadata" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["reasoning"], contextTokens: 100000, maxOutputTokens: 4096, source: "provider", capturedAt: "now" }, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
      targets: [{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }], targetUsage: [],
    });
    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.level === "fail" && check.message.includes("unsupported"))).toBe(true);
  });

  it("blocks a non-vision Judge when selected targets require image evidence", () => {
    const config: ResearchConfig = {
      schemaVersion: 1, name: "Vision", workspaceId: "w", templateType: "model", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["image"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "a", label: "A", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" }, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
        { key: "b", label: "B", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" }, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
      ], judges: [{ providerConfigId: "pc", modelId: "m" }], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" as const }, temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: [], contextTokens: 100000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now" };
    const result = runResearchPreflight(config, {
      profiles: [{ id: "profile", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
      providerConfigs: [{ id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" }],
      models: [{ providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
      targets: [{ id: "image", collection: "user", title: "Image", revealArtifacts: [{ artifactId: "a", path: "/managed/a.png", originalFileName: "a.png", mimeType: "image/png", size: 1, sha256: "a".repeat(64) }], tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }], targetUsage: [],
    });
    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.id === "judge:0:vision" && check.level === "fail")).toBe(true);
  });

  it("passes explicit save-only mode without requiring a Judge route", () => {
    const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" as const }, temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: [], contextTokens: 100000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now" };
    const config: ResearchConfig = {
      schemaVersion: 1, name: "External evaluation", workspaceId: "w", templateType: "model", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["image"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "a", label: "A", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
        { key: "b", label: "B", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
      ], evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const result = runResearchPreflight(config, {
      profiles: [{ id: "profile", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
      providerConfigs: [{ id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" }],
      models: [{ providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
      targets: [{ id: "image", collection: "user", title: "Image", revealArtifacts: [{ artifactId: "a", path: "/managed/a.png", originalFileName: "a.png", mimeType: "image/png", size: 1, sha256: "a".repeat(64) }], tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }], targetUsage: [],
    });
    expect(result.ok).toBe(true);
    expect(result.estimatedJudgeCalls).toBe(0);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "judge_mode", level: "pass" }));
    expect(result.checks.some((check) => check.id.includes(":vision"))).toBe(false);
  });

  it("blocks a model comparison when System Prompt changes between conditions", () => {
    const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" as const }, temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: [], contextTokens: 100000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now" };
    const config: ResearchConfig = {
      schemaVersion: 1, name: "Confounded", workspaceId: "w", templateType: "model", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "a", label: "A", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
        { key: "b", label: "B", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: capabilities, effectiveSettings: { requested: {}, effective: {}, omitted: [] }, systemPrompt: { ...FIXED_SYSTEM_PROMPT, content: "A different prompt", contentSha256: "b".repeat(64) } },
      ], evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const result = runResearchPreflight(config, {
      profiles: [{ id: "profile", name: "P", credentialId: "cred", createdAt: "now", updatedAt: "now" }],
      providerConfigs: [{ id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" }],
      models: [{ providerConfigId: "pc", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" }],
      targets: [{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }], targetUsage: [],
    });
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "system_prompt_constant", level: "fail" }));
  });

  it("blocks a Profile comparison when a supposedly fixed Viewer control differs", () => {
    const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: true, efforts: ["medium" as const], confidence: "provider_metadata" as const }, temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" as const }, supportedParameters: ["reasoning", "temperature"], contextTokens: 100000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now" };
    const config: ResearchConfig = {
      schemaVersion: 1, name: "Profiles", workspaceId: "w", templateType: "profile", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      viewerControl: {
        model: { mode: "fixed", modelId: "m" }, systemPrompt: { mode: "fixed", source: "custom", contentSha256: FIXED_SYSTEM_PROMPT.contentSha256 },
        reasoning: { mode: "fixed", value: "medium" }, temperature: { mode: "fixed", value: 0.9 }, maxOutputTokens: 4096,
      },
      conditions: [
        { key: "a", label: "A", profileId: "a", providerConfigId: "pa", modelId: "m", requestedSettings: { reasoningEffort: "medium", temperature: 0.9, maxOutputTokens: 4096 }, capabilitySnapshot: capabilities, effectiveSettings: { requested: { reasoningEffort: "medium", temperature: 0.9, maxOutputTokens: 4096 }, effective: { reasoningEffort: "medium", temperature: 0.9, maxOutputTokens: 4096 }, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
        { key: "b", label: "B", profileId: "b", providerConfigId: "pb", modelId: "m", requestedSettings: { reasoningEffort: "medium", temperature: 1.1, maxOutputTokens: 4096 }, capabilitySnapshot: capabilities, effectiveSettings: { requested: { reasoningEffort: "medium", temperature: 1.1, maxOutputTokens: 4096 }, effective: { reasoningEffort: "medium", temperature: 1.1, maxOutputTokens: 4096 }, omitted: [] }, systemPrompt: FIXED_SYSTEM_PROMPT },
      ], evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const inventory = {
      profiles: [
        { id: "a", name: "A", credentialId: "ca", createdAt: "now", updatedAt: "now" },
        { id: "b", name: "B", credentialId: "cb", createdAt: "now", updatedAt: "now" },
      ],
      providerConfigs: [
        { id: "pa", provider: "openrouter", label: "A", credentialId: "ca", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" },
        { id: "pb", provider: "openrouter", label: "B", credentialId: "cb", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" },
      ],
      models: [
        { providerConfigId: "pa", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" },
        { providerConfigId: "pb", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", capabilities, pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now" },
      ],
      targets: [{ id: "t", collection: "user", title: "T", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }], targetUsage: [],
    } satisfies ResearchPreflightInventory;
    const result = runResearchPreflight(config, inventory);
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "controlled_variables", level: "fail" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "viewer_control_lock", level: "fail" }));

    const corrected = structuredClone(config);
    corrected.conditions[1].requestedSettings.temperature = 0.9;
    corrected.conditions[1].effectiveSettings = {
      requested: { reasoningEffort: "medium", temperature: 0.9, maxOutputTokens: 4096 },
      effective: { reasoningEffort: "medium", temperature: 0.9, maxOutputTokens: 4096 },
      omitted: [],
    };
    const correctedResult = runResearchPreflight(corrected, inventory);
    expect(correctedResult.ok).toBe(true);
    expect(correctedResult.checks).toContainEqual(expect.objectContaining({ id: "controlled_variables", level: "pass" }));
    expect(correctedResult.checks).toContainEqual(expect.objectContaining({ id: "viewer_control_lock", level: "pass" }));
  });
});
