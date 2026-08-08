import { describe, expect, it } from "vitest";
import { runResearchPreflight } from "./preflight";
import type { ResearchConfig } from "./types";

describe("Research preflight", () => {
  it("blocks unsupported reasoning conditions instead of simulating them", () => {
    const config: ResearchConfig = {
      schemaVersion: 1, name: "R", workspaceId: "w", templateType: "reasoning", sessionLanguage: "en", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["t"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "low", label: "LOW", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: { reasoningEffort: "low" } },
        { key: "high", label: "HIGH", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: { reasoningEffort: "high" } },
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
        { key: "a", label: "A", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" }, effectiveSettings: { requested: {}, effective: {}, omitted: [] } },
        { key: "b", label: "B", profileId: "profile", providerConfigId: "pc", modelId: "m", requestedSettings: {}, capabilitySnapshot: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" }, effectiveSettings: { requested: {}, effective: {}, omitted: [] } },
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
});
