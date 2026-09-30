import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "./providers/types";
import {
  findCredentialScopedModelByRouteKey,
  modelRouteKey,
  modelsForCredential,
  modelsForProfile,
  preferredModelOrder,
  profileNeedingInitialSetup,
  resolveRoleDefault,
  resolveViewerDefault,
  splitModelRouteKey,
} from "./profileModelDefaults";
import type { Profile } from "./types";

const provider: ProviderConfig = {
  id: "provider_a",
  provider: "openrouter",
  label: "OpenRouter A",
  credentialId: "credential_a",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const foreignProvider: ProviderConfig = {
  ...provider,
  id: "provider_b",
  label: "OpenRouter B",
  credentialId: "credential_b",
};

const makeModel = (modelId: string, flags: { favorite?: boolean; recommended?: boolean; provider?: ProviderConfig } = {}): ProviderModel => {
  const owner = flags.provider ?? provider;
  return {
    providerConfigId: owner.id,
    provider: owner.provider,
    modelId,
    displayName: modelId,
    route: `openrouter:${modelId}`,
    capabilities: {
      inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: true, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now",
    },
    pricing: {},
    recommended: flags.recommended ?? false,
    favorite: flags.favorite,
    rawMetadata: {},
    refreshedAt: "now",
  };
};

const profile: Profile = {
  id: "profile_a",
  name: "Leo",
  credentialId: provider.credentialId,
  defaultViewerModelId: "viewer",
  defaultMonitorProviderConfigId: provider.id,
  defaultMonitorModelId: "monitor",
  defaultJudgeProviderConfigId: provider.id,
  defaultJudgeModelId: "judge",
  createdAt: "now",
  updatedAt: "now",
};

describe("Profile model defaults", () => {
  it("restores only model routes that still exist for the exact Profile credential", () => {
    const models = [makeModel("viewer"), makeModel("monitor"), makeModel("judge")];
    const providers = [provider, foreignProvider];
    expect(resolveViewerDefault(profile, provider, models)).toBe("viewer");
    expect(resolveRoleDefault(profile, "monitor", providers, models)).toBe("provider_a::monitor");
    expect(resolveRoleDefault(profile, "judge", providers, models)).toBe("provider_a::judge");
    expect(resolveViewerDefault({ ...profile, credentialId: "other" }, provider, models)).toBe("");
    expect(resolveRoleDefault({ ...profile, defaultJudgeModelId: "missing" }, "judge", providers, models)).toBe("");
  });

  it("isolates routes when two Profiles use the same provider type with different credentials", () => {
    const ownJudge = makeModel("judge-a");
    const foreignJudge = makeModel("judge-b", { provider: foreignProvider });
    const models = [ownJudge, foreignJudge];
    const providers = [provider, foreignProvider];

    expect(modelsForCredential(profile.credentialId, providers, models)).toEqual([ownJudge]);
    expect(modelsForProfile(profile, providers, models)).toEqual([ownJudge]);
    expect(resolveRoleDefault({ ...profile, defaultJudgeProviderConfigId: foreignProvider.id, defaultJudgeModelId: foreignJudge.modelId }, "judge", providers, models)).toBe("");
    expect(findCredentialScopedModelByRouteKey("provider_b::judge-b", profile.credentialId, providers, models)).toBeNull();
    expect(findCredentialScopedModelByRouteKey("provider_a::judge-a", profile.credentialId, providers, models)).toBe(ownJudge);
  });

  it("round-trips provider/model keys and puts favorites first", () => {
    expect(splitModelRouteKey(modelRouteKey("provider_a", "vendor/model"))).toEqual({ providerConfigId: "provider_a", modelId: "vendor/model" });
    expect(splitModelRouteKey("invalid")).toBeNull();
    expect(splitModelRouteKey("a")).toBeNull();
    expect(splitModelRouteKey("::model")).toBeNull();
    expect(splitModelRouteKey("provider::")).toBeNull();
    expect(preferredModelOrder([makeModel("plain"), makeModel("recommended", { recommended: true }), makeModel("favorite", { favorite: true })]).map((model) => model.modelId))
      .toEqual(["favorite", "recommended", "plain"]);
  });

  it("requires onboarding only when there is no usable Profile", () => {
    const incomplete = { ...profile, credentialId: undefined, defaultViewerModelId: undefined };
    expect(profileNeedingInitialSetup([])).toBeNull();
    expect(profileNeedingInitialSetup([incomplete])).toBe(incomplete);
    expect(profileNeedingInitialSetup([incomplete, profile])).toBeNull();
  });
});
