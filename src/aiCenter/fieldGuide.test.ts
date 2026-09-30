import { describe, expect, it, vi } from "vitest";

vi.mock("../providers/native", () => ({
  credentialIdentityFingerprint: vi.fn(async () => "secure-fingerprint"),
}));

import type { ProviderConfig, ProviderModel } from "../providers/types";
import { factoryViewerEditablePrompt, factoryViewerFieldGuide, lockedViewerBaseVocabulary, lockedViewerIdentity } from "../resources/systemPrompts";
import type { AppRepository } from "../storage/repository";
import type { Profile } from "../types";
import type { AiIdentity } from "./types";
import type { FieldGuideBundle, FieldGuideLegacyBaseline, FieldGuideVersion } from "./fieldGuideTypes";
import {
  FIELD_GUIDE_DEFAULT_CAPACITY,
  FieldGuideLinkRequiredError,
  prepareFieldGuideForSession,
  viewerSystemPromptSnapshotFromFieldGuide,
} from "./fieldGuide";

const now = "2026-09-17T12:00:00.000Z";
const profile: Profile = { id: "profile", name: "Viewer", createdAt: now, updatedAt: now };
const providerConfig: ProviderConfig = {
  id: "provider", provider: "openrouter", label: "OpenRouter", credentialId: "credential", credentialFingerprint: "fallback-fingerprint",
  enabled: true, createdAt: now, updatedAt: now,
};
const model: ProviderModel = {
  providerConfigId: "provider", provider: "openrouter", modelId: "model-a", displayName: "Model A", route: "openrouter:model-a",
  recommended: false, rawMetadata: {}, refreshedAt: now, pricing: {},
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: now },
};
const identity: AiIdentity = {
  id: "identity", profileId: profile.id, credentialFingerprint: "secure-fingerprint", credentialDisplay: "credential", providerConfigId: providerConfig.id,
  provider: "openrouter", normalizedBaseUrl: "https://openrouter.ai/api/v1", modelId: model.modelId, modelRoute: model.route, modelDisplayName: model.displayName,
  role: "viewer", routeStatus: "available", firstUsedAt: now, lastUsedAt: now, createdAt: now, updatedAt: now,
};

function version(content: string, sourceKind: FieldGuideVersion["sourceSnapshot"]["sourceKind"] = "factory-baseline"): FieldGuideVersion {
  return {
    id: "version-1", aiIdentityId: identity.id, language: "en", versionNumber: 1, content, contentSha256: "a".repeat(64), estimatedTokens: 20,
    estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: 2048, activationStatus: "active",
    sourceSnapshot: { schemaVersion: 1, sourceKind, profileId: profile.id, capturedAt: now, identitySnapshot: { aiIdentityId: identity.id, profileId: profile.id, credentialFingerprint: identity.credentialFingerprint, provider: identity.provider, normalizedBaseUrl: identity.normalizedBaseUrl, modelId: identity.modelId, modelRoute: identity.modelRoute } }, createdAt: now,
  };
}

function bundle(active?: FieldGuideVersion): FieldGuideBundle {
  return {
    identityId: identity.id, language: "en",
    settings: { aiIdentityId: identity.id, language: "en", capacityTokens: FIELD_GUIDE_DEFAULT_CAPACITY, ...(active ? { activeVersionId: active.id } : {}), updatedAt: now },
    ...(active ? { activeVersion: active } : {}), versions: active ? [active] : [], activationEvents: [],
  };
}

function repository(options: { baselines?: FieldGuideLegacyBaseline[]; active?: FieldGuideVersion } = {}) {
  let active = options.active;
  const createFieldGuideVersion = vi.fn(async (input: Parameters<AppRepository["createFieldGuideVersion"]>[0]) => {
    active = { ...version(input.content, input.sourceSnapshot.sourceKind), contentSha256: input.contentSha256, estimatedTokens: input.estimatedTokens, sourceSnapshot: input.sourceSnapshot };
    return active;
  });
  const resolveLegacyFieldGuideBaseline = vi.fn(async (input: Parameters<AppRepository["resolveLegacyFieldGuideBaseline"]>[0]) => {
    active = { ...version(input.content, "legacy-profile-baseline"), contentSha256: input.contentSha256, estimatedTokens: input.estimatedTokens, sourceSnapshot: input.sourceSnapshot };
    return active;
  });
  const repo = {
    ensureAiIdentity: vi.fn(async () => identity),
    getFieldGuideBundle: vi.fn(async () => bundle(active)),
    listFieldGuideLegacyBaselines: vi.fn(async () => options.baselines ?? []),
    createFieldGuideVersion,
    resolveLegacyFieldGuideBaseline,
  } as unknown as AppRepository;
  return { repo, createFieldGuideVersion, resolveLegacyFieldGuideBaseline };
}

describe("Field Guide session foundation", () => {
  it("bootstraps the factory Field Guide without the locked Base Vocabulary and freezes exact Viewer identity provenance", async () => {
    const { repo, createFieldGuideVersion } = repository();
    const snapshot = await prepareFieldGuideForSession({ repository: repo, profile, providerConfig, model, language: "en", now: () => now });
    expect(createFieldGuideVersion).toHaveBeenCalledOnce();
    const input = createFieldGuideVersion.mock.calls[0][0];
    expect(input.content).toBe(factoryViewerFieldGuide("en"));
    expect(input.content).not.toContain(lockedViewerBaseVocabulary("en"));
    expect(snapshot.capacityTokens).toBe(2048);
    expect(input.sourceSnapshot.identitySnapshot).toMatchObject({ profileId: profile.id, credentialFingerprint: "secure-fingerprint", provider: "openrouter", normalizedBaseUrl: "https://openrouter.ai/api/v1", modelId: "model-a", modelRoute: "openrouter:model-a" });
    expect(snapshot).toMatchObject({ aiIdentityId: identity.id, language: "en", versionId: "version-1", modelRoute: model.route, sourceKind: "factory-baseline" });
  });

  it("converts an exact known legacy factory prompt by removing only the exact Locked Base Vocabulary block", async () => {
    const baseline: FieldGuideLegacyBaseline = { id: "legacy", profileId: profile.id, originalContent: factoryViewerEditablePrompt("en"), sourceProfileUpdatedAt: now, resolutionStatus: "unresolved", createdAt: now };
    const { repo, resolveLegacyFieldGuideBaseline } = repository({ baselines: [baseline] });
    await prepareFieldGuideForSession({ repository: repo, profile, providerConfig, model, language: "en", now: () => now });
    expect(resolveLegacyFieldGuideBaseline).toHaveBeenCalledOnce();
    const input = resolveLegacyFieldGuideBaseline.mock.calls[0][0];
    expect(input.content).toBe(factoryViewerFieldGuide("en"));
    expect(input.content).not.toContain(lockedViewerBaseVocabulary("en"));
    expect(input.sourceSnapshot).toMatchObject({ sourceKind: "legacy-profile-baseline", legacyBaselineId: baseline.id });
  });

  it("preserves a custom legacy prompt unresolved instead of guessing identity or language", async () => {
    const baseline: FieldGuideLegacyBaseline = { id: "custom", profileId: profile.id, originalContent: "CUSTOM LEGACY PERCEPTUAL MEMORY", sourceProfileUpdatedAt: now, resolutionStatus: "unresolved", createdAt: now };
    const { repo, createFieldGuideVersion, resolveLegacyFieldGuideBaseline } = repository({ baselines: [baseline] });
    await expect(prepareFieldGuideForSession({ repository: repo, profile, providerConfig, model, language: "en", now: () => now })).rejects.toBeInstanceOf(FieldGuideLinkRequiredError);
    expect(createFieldGuideVersion).not.toHaveBeenCalled();
    expect(resolveLegacyFieldGuideBaseline).not.toHaveBeenCalled();
  });

  it("composes and freezes Locked Core Identity + Locked Base Vocabulary + the exact active Field Guide", async () => {
    const active = version("PERCEPTUAL FIELD GUIDE");
    const snapshot = await viewerSystemPromptSnapshotFromFieldGuide({
      aiIdentityId: identity.id, language: "en", versionId: active.id, versionNumber: 1, content: active.content, contentSha256: active.contentSha256,
      estimatedTokens: active.estimatedTokens, estimatorVersion: "conservative-char-v1", capacityTokens: 2048, modelRoute: model.route, capturedAt: now, sourceKind: "factory-baseline",
    });
    expect(snapshot.content).toBe(`${lockedViewerIdentity("en")}\n\n${lockedViewerBaseVocabulary("en")}\n\nPERCEPTUAL FIELD GUIDE`);
    expect(snapshot.version).toBe("1.5.0:field-guide:version-1");
    expect(snapshot.fieldGuide?.content).toBe("PERCEPTUAL FIELD GUIDE");
  });
});
