import { describe, expect, it, vi } from "vitest";
import type { AiIdentity } from "../aiCenter/types";
import type { FieldGuideBundle, FieldGuideVersion } from "../aiCenter/fieldGuideTypes";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { factoryViewerFieldGuide, lockedViewerBaseVocabulary, lockedViewerIdentity } from "../resources/systemPrompts";
import type { AppRepository } from "../storage/repository";
import {
  captureCurrentResearchFieldGuide,
  listResearchFieldGuideHistory,
  lockedOnlyResearchPrompt,
  manualResearchPromptSnapshot,
  researchPromptFromFieldGuide,
  validateResearchFieldGuideSelection,
} from "./fieldGuidePolicy";

const identity: AiIdentity = {
  id: "identity-viewer", profileId: "profile", credentialFingerprint: "fp", credentialDisplay: "key…1234",
  providerConfigId: "pc", provider: "openrouter", modelId: "model", modelRoute: "openrouter:model", modelDisplayName: "Model",
  role: "viewer", routeStatus: "available", firstUsedAt: "2026-09-01T00:00:00Z", lastUsedAt: "2026-09-18T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-18T00:00:00Z",
};
const provider: ProviderConfig = { id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "pc", provider: "openrouter", modelId: "model", displayName: "Model", route: "openrouter:model",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100000, maxOutputTokens: 4096, source: "provider", capturedAt: "now" },
  pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now",
};

function version(n: number, language: "pl" | "en" = "en", aiIdentityId = identity.id): FieldGuideVersion {
  return {
    id: `fg-${n}`, aiIdentityId, language, versionNumber: n, content: `guide ${n}`, contentSha256: String(n).padStart(64, "0"), estimatedTokens: 10 + n,
    estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: 4096, activationStatus: n === 8 ? "active" : "historical",
    sourceTrainingRunId: `training-${n}`, sourceSessionId: `session-${n}`,
    sourceSnapshot: { schemaVersion: 1, sourceKind: "training-reflection", profileId: "profile", capturedAt: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`, sourceTrainingRunId: `training-${n}`, sourceSessionId: `session-${n}`, identitySnapshot: { aiIdentityId, profileId: "profile", credentialFingerprint: "fp", provider: "openrouter", modelId: "model", modelRoute: "openrouter:model" } },
    createdAt: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`,
  };
}

function bundle(): FieldGuideBundle {
  const versions = Array.from({ length: 8 }, (_, index) => version(8 - index));
  return {
    identityId: identity.id, language: "en",
    settings: { aiIdentityId: identity.id, language: "en", capacityTokens: 4096, activeVersionId: "fg-8", updatedAt: "now" },
    activeVersion: versions[0], versions, activationEvents: [],
  };
}

function repoFor(value = bundle()): AppRepository {
  return {
    listAiIdentities: vi.fn().mockResolvedValue([identity]),
    getExistingFieldGuideBundle: vi.fn().mockResolvedValue(value),
  } as unknown as AppRepository;
}

describe("VIEWER-LEARNING-3 Research Field Guide policy", () => {
  it("keeps Locked Core Identity and Locked Base Vocabulary when trained Field Guide is OFF", async () => {
    const prompt = await lockedOnlyResearchPrompt("en");
    expect(prompt.content).toContain(lockedViewerIdentity("en"));
    expect(prompt.content).toContain(lockedViewerBaseVocabulary("en"));
    expect(prompt.content).not.toContain(factoryViewerFieldGuide("en"));
    expect(prompt.fieldGuide).toBeUndefined();
  });

  it("captures the exact active Field Guide read-only with identity, capacity and provenance", async () => {
    const repository = repoFor();
    const snapshot = await captureCurrentResearchFieldGuide({ repository, profileId: "profile", providerConfig: provider, model, language: "en", capturedAt: "lock" });
    expect(snapshot.versionId).toBe("fg-8");
    expect(snapshot.contentSha256).toBe(version(8).contentSha256);
    expect(snapshot.capacityTokens).toBe(4096);
    expect(snapshot.sourceTrainingRunId).toBe("training-8");
    expect(snapshot.sourceSnapshot.sourceSessionId).toBe("session-8");
    expect(snapshot.identity).toMatchObject({ aiIdentityId: identity.id, profileId: "profile", providerConfigId: "pc", modelRoute: "openrouter:model" });
    expect(repository.listAiIdentities).toHaveBeenCalledTimes(1);
    expect(repository.getExistingFieldGuideBundle).toHaveBeenCalledTimes(1);
  });

  it("lists only the latest six versions for the exact identity and language without auto-selecting any", async () => {
    const versions = await listResearchFieldGuideHistory({ repository: repoFor(), profileId: "profile", providerConfig: provider, model, language: "en" });
    expect(versions.map((item) => item.versionNumber)).toEqual([8, 7, 6, 5, 4, 3]);
    expect(versions).toHaveLength(6);
    expect(versions.every((item) => item.aiIdentityId === identity.id && item.language === "en")).toBe(true);
  });

  it("accepts any explicit 2–4 history selections and rejects 1 or 5", async () => {
    const versions = await listResearchFieldGuideHistory({ repository: repoFor(), profileId: "profile", providerConfig: provider, model, language: "en" });
    expect(validateResearchFieldGuideSelection(versions, ["fg-8", "fg-5", "fg-3"], identity.id, "en").map((item) => item.versionId)).toEqual(["fg-8", "fg-5", "fg-3"]);
    expect(() => validateResearchFieldGuideSelection(versions, ["fg-8"], identity.id, "en")).toThrow(/between 2 and 4/);
    expect(() => validateResearchFieldGuideSelection(versions, ["fg-8", "fg-7", "fg-6", "fg-5", "fg-4"], identity.id, "en")).toThrow(/between 2 and 4/);
  });

  it("rejects a history selection from another identity or language", async () => {
    const versions = await listResearchFieldGuideHistory({ repository: repoFor(), profileId: "profile", providerConfig: provider, model, language: "en" });
    const foreignIdentity = { ...versions[1], aiIdentityId: "foreign" };
    expect(() => validateResearchFieldGuideSelection([versions[0], foreignIdentity], [versions[0].versionId, foreignIdentity.versionId], identity.id, "en")).toThrow(/another Viewer identity/);
    const foreignLanguage = { ...versions[1], language: "pl" as const };
    expect(() => validateResearchFieldGuideSelection([versions[0], foreignLanguage], [versions[0].versionId, foreignLanguage.versionId], identity.id, "en")).toThrow(/another language/);
  });

  it("composes historical Field Guide content with locked blocks and keeps manual prompt provenance separate", async () => {
    const snapshot = await captureCurrentResearchFieldGuide({ repository: repoFor(), profileId: "profile", providerConfig: provider, model, language: "en" });
    const historical = await researchPromptFromFieldGuide(snapshot);
    expect(historical.content).toContain(lockedViewerIdentity("en"));
    expect(historical.content).toContain(lockedViewerBaseVocabulary("en"));
    expect(historical.content).toContain(snapshot.content);
    expect(historical.fieldGuide?.versionId).toBe(snapshot.versionId);

    const manual = await manualResearchPromptSnapshot("en", "manual experimental body", "manual-1");
    expect(manual.content).toBe("manual experimental body");
    expect(manual.content).not.toContain(lockedViewerBaseVocabulary("en"));
    expect(manual.fieldGuide).toBeUndefined();
  });

  it("fails instead of creating an identity or Field Guide when Viewer Learning state is missing", async () => {
    const repository = { listAiIdentities: vi.fn().mockResolvedValue([]), getExistingFieldGuideBundle: vi.fn() } as unknown as AppRepository;
    await expect(captureCurrentResearchFieldGuide({ repository, profileId: "profile", providerConfig: provider, model, language: "en" })).rejects.toThrow(/read-only/);
    expect(repository.getExistingFieldGuideBundle).not.toHaveBeenCalled();
  });
});
