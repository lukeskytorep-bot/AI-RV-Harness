import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AiIdentity } from "./types";
import { ensureProfileViewerIdentity, listEligibleViewerIdentities, preferredViewerIdentityId, requireExistingViewerIdentity, viewerIdentityLabel } from "./viewerIdentitySelection";

const nativeCredentialFingerprints = vi.hoisted(() => new Map<string, string>());
const credentialIdentityFingerprintMock = vi.hoisted(() => vi.fn(async (credentialId: string) => {
  const fingerprint = nativeCredentialFingerprints.get(credentialId);
  if (!fingerprint) throw new Error("credential unavailable");
  return fingerprint;
}));
vi.mock("../providers/native", () => ({ credentialIdentityFingerprint: credentialIdentityFingerprintMock }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));

const now = "2026-09-28T00:00:00Z";
const config = (id: string, credentialId = `cred-${id}`, fingerprint = `fp-${id}`): ProviderConfig => ({
  id, provider: "openrouter", label: id, credentialId, credentialFingerprint: fingerprint, enabled: true,
  lastStatus: "ok", createdAt: now, updatedAt: now,
});
const model = (providerConfigId: string, modelId: string): ProviderModel => ({
  providerConfigId, provider: "openrouter", modelId, displayName: modelId, route: `openrouter:${modelId}`,
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: true, efforts: ["high"], confidence: "provider_metadata" }, temperature: { supported: true, confidence: "provider_metadata" }, supportedParameters: [], source: "provider", capturedAt: now },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: now,
});
const identity = (id: string, providerConfig: ProviderConfig, providerModel: ProviderModel, fingerprint = `native-${providerConfig.credentialId}`): AiIdentity => ({
  id, profileId: "profile", credentialFingerprint: fingerprint, credentialDisplay: "…ABCD",
  providerConfigId: providerConfig.id, provider: providerConfig.provider, modelId: providerModel.modelId,
  modelRoute: providerModel.route, modelDisplayName: providerModel.displayName, role: "viewer", routeStatus: "available",
  firstUsedAt: now, lastUsedAt: now, createdAt: now, updatedAt: now,
});

function repo(input: { identities?: AiIdentity[]; trainedIdentityId?: string; completedIdentityId?: string } = {}): AppRepository {
  const identities = input.identities ?? [];
  return {
    listAiIdentities: vi.fn(async () => identities),
    listTrainingRuns: vi.fn(async () => input.completedIdentityId ? [{ profileId: "profile", completedTargetIds: ["t"], executionSnapshot: { rvSystemPrompt: { fieldGuide: { aiIdentityId: input.completedIdentityId } } } }] : []),
    listArchivedTrainingRuns: vi.fn(async () => []),
    getExistingFieldGuideBundle: vi.fn(async (id: string) => ({
      identityId: id, language: "en", settings: { aiIdentityId: id, language: "en", capacityTokens: 2048, updatedAt: now },
      activeVersion: { id: `fg-${id}`, aiIdentityId: id, language: "en", versionNumber: 3, content: "guide", contentSha256: "a".repeat(64), estimatedTokens: 1, estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: 2048, activationStatus: "active", sourceSnapshot: { schemaVersion: 1, sourceKind: input.trainedIdentityId === id ? "training-reflection" : "factory-baseline", profileId: "profile", capturedAt: now }, createdAt: now },
      versions: [{ id: `fg-${id}`, aiIdentityId: id, language: "en", versionNumber: 3, content: "guide", contentSha256: "a".repeat(64), estimatedTokens: 1, estimatorVersion: "conservative-char-v1", capacityTokensAtCreation: 2048, activationStatus: "active", sourceSnapshot: { schemaVersion: 1, sourceKind: input.trainedIdentityId === id ? "training-reflection" : "factory-baseline", profileId: "profile", capturedAt: now }, createdAt: now }], activationEvents: [],
    })),
    getExistingViewerNoteBundle: vi.fn(async (id: string) => ({ identity: identities.find((item) => item.id === id)!, settings: { aiIdentityId: id, noteType: "viewer_self_notes", capacityTokens: 1024, defaultEnabled: true, experimentalStatus: "experimental", activeVersionId: `vn-${id}`, updatedAt: now }, activeVersion: { id: `vn-${id}`, aiIdentityId: id, versionNumber: 2 }, versions: [], activationEvents: [], reflectionRuns: [] })),
  } as unknown as AppRepository;
}

describe("Viewer identity route selection", () => {
  beforeEach(() => {
    nativeCredentialFingerprints.clear();
    credentialIdentityFingerprintMock.mockClear();
  });

  function bind(...configs: ProviderConfig[]) {
    for (const item of configs) nativeCredentialFingerprints.set(item.credentialId, `native-${item.credentialId}`);
  }
  it("auto-selects the only eligible identity", async () => {
    const c = config("pc"); bind(c); const m = model(c.id, "gemma"); const i = identity("ai-gemma", c, m);
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [i] }), profileId: "profile", language: "en", providerConfigs: [c], models: [m] });
    expect(items.map((item) => item.identity.id)).toEqual([i.id]);
    expect(preferredViewerIdentityId(items)).toBe(i.id);
  });

  it("does not silently choose between multiple identities when the Profile default is ambiguous", async () => {
    const c1 = config("pc-1", "cred-1", "fp-1"); const c2 = config("pc-2", "cred-2", "fp-2"); bind(c1, c2);
    const m1 = model(c1.id, "same"); const m2 = model(c2.id, "same");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [identity("ai-1", c1, m1), identity("ai-2", c2, m2)] }), profileId: "profile", language: "en", providerConfigs: [c1, c2], models: [m1, m2] });
    expect(preferredViewerIdentityId(items, "same")).toBe("");
  });

  it("does not silently choose the first identity when multiple eligible identities have no Profile default", async () => {
    const c = config("pc"); bind(c);
    const gemma = model(c.id, "gemma"); const qwen = model(c.id, "qwen");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [identity("ai-g", c, gemma), identity("ai-q", c, qwen)] }), profileId: "profile", language: "en", providerConfigs: [c], models: [gemma, qwen] });
    expect(preferredViewerIdentityId(items)).toBe("");
  });

  it("auto-selects the one identity that uniquely matches the Profile default model", async () => {
    const c = config("pc"); bind(c);
    const gemma = model(c.id, "gemma"); const qwen = model(c.id, "qwen");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [identity("ai-g", c, gemma), identity("ai-q", c, qwen)] }), profileId: "profile", language: "en", providerConfigs: [c], models: [gemma, qwen] });
    expect(preferredViewerIdentityId(items, "qwen")).toBe("ai-q");
  });

  it("shows exactly the Profile's two exact identities and excludes an unbound cached model", async () => {
    const c = config("pc"); bind(c); const gemma = model(c.id, "gemma"); const qwen = model(c.id, "qwen"); const stray = model(c.id, "stray");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [identity("ai-g", c, gemma), identity("ai-q", c, qwen)] }), profileId: "profile", language: "en", providerConfigs: [c], models: [gemma, qwen, stray] });
    expect(items.map((item) => item.model.modelId).sort()).toEqual(["gemma", "qwen"]);
  });

  it("treats the same model slug through another credential as a different identity", async () => {
    const c1 = config("pc-1", "cred-1", "fp-1"); const c2 = config("pc-2", "cred-2", "fp-2"); bind(c1, c2);
    const m1 = model(c1.id, "same"); const m2 = model(c2.id, "same");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [identity("ai-1", c1, m1), identity("ai-2", c2, m2)] }), profileId: "profile", language: "en", providerConfigs: [c1, c2], models: [m1, m2] });
    expect(items.map((item) => item.identity.id).sort()).toEqual(["ai-1", "ai-2"]);
  });

  it("uses the native identity HMAC rather than the ProviderConfig metadata fingerprint", async () => {
    const c = config("pc", "cred-pc", "frontend-sha16"); bind(c);
    const m = model(c.id, "gemma");
    const i = identity("ai", c, m, "native-cred-pc");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [i] }), profileId: "profile", language: "en", providerConfigs: [c], models: [m] });
    expect(items.map((item) => item.identity.id)).toEqual([i.id]);
    expect(credentialIdentityFingerprintMock).toHaveBeenCalledWith(c.credentialId);
  });

  it("fails closed after credential rebind changes the native identity HMAC", async () => {
    const c = config("pc", "cred-pc", "frontend-sha16"); bind(c);
    const m = model(c.id, "gemma");
    const i = identity("ai", c, m, "native-cred-pc");
    nativeCredentialFingerprints.set(c.credentialId, "native-rebound");
    const rebound = await listEligibleViewerIdentities({ repository: repo({ identities: [i] }), profileId: "profile", language: "en", providerConfigs: [c], models: [m] });
    expect(rebound).toEqual([]);
    await expect(requireExistingViewerIdentity({ repository: { listAiIdentities: vi.fn(async () => [i]) } as unknown as AppRepository, profileId: "profile", identityId: i.id, providerConfig: c, model: m })).rejects.toThrow("selected Viewer identity");
  });

  it("fails closed when the desktop credential fingerprint cannot be read", async () => {
    const c = config("pc", "cred-missing", "frontend-sha16");
    const m = model(c.id, "gemma");
    const i = identity("ai", c, m, "native-old");
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [i] }), profileId: "profile", language: "en", providerConfigs: [c], models: [m] });
    expect(items).toEqual([]);
  });

  it("marks only the exact identity with completed Training or a Training Field Guide as trained", async () => {
    const c = config("pc"); bind(c); const gemma = model(c.id, "gemma"); const qwen = model(c.id, "qwen");
    const g = identity("ai-g", c, gemma); const q = identity("ai-q", c, qwen);
    const items = await listEligibleViewerIdentities({ repository: repo({ identities: [g, q], trainedIdentityId: q.id, completedIdentityId: g.id }), profileId: "profile", language: "en", providerConfigs: [c], models: [gemma, qwen] });
    expect(items.find((item) => item.identity.id === g.id)?.trained).toBe(true);
    expect(items.find((item) => item.identity.id === q.id)?.trained).toBe(true);
    expect(viewerIdentityLabel({ ...items[0], trained: false }, "en")).toContain("Training incomplete");
  });

  it("refuses to resolve another model or credential as the selected identity", async () => {
    const c = config("pc"); bind(c); const gemma = model(c.id, "gemma"); const qwen = model(c.id, "qwen"); const i = identity("ai-g", c, gemma);
    const repository = { listAiIdentities: vi.fn(async () => [i]) } as unknown as AppRepository;
    await expect(requireExistingViewerIdentity({ repository, profileId: "profile", identityId: i.id, providerConfig: c, model: qwen })).rejects.toThrow("selected Viewer identity");
  });

  it("bootstraps a durable factory-only identity from Profile Setup without Training", async () => {
    const c = config("pc"); bind(c); const m = model(c.id, "gemma");
    const ensureAiIdentity = vi.fn(async (input) => ({ ...identity("created", c, m), credentialFingerprint: input.credentialFingerprint }));
    const repository = { listProviderConfigs: vi.fn(async () => [c]), listProviderModels: vi.fn(async () => [m]), ensureAiIdentity } as unknown as AppRepository;
    const created = await ensureProfileViewerIdentity({ repository, profileId: "profile", credentialId: c.credentialId, modelId: m.modelId });
    expect(created?.id).toBe("created");
    expect(ensureAiIdentity).toHaveBeenCalledTimes(1);
  });
});
