import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderModel } from "./providers/types";
import { modelRouteKey, preferredModelOrder, profileNeedingInitialSetup, resolveRoleDefault, resolveViewerDefault, splitModelRouteKey } from "./profileModelDefaults";
import type { Profile } from "./types";

const provider: ProviderConfig = {
  id: "provider_a",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential_a",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const makeModel = (modelId: string, flags: { favorite?: boolean; recommended?: boolean } = {}): ProviderModel => ({
  providerConfigId: provider.id,
  provider: provider.provider,
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
});

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
  it("restores only model routes that still exist for the exact Profile connection", () => {
    const models = [makeModel("viewer"), makeModel("monitor"), makeModel("judge")];
    expect(resolveViewerDefault(profile, provider, models)).toBe("viewer");
    expect(resolveRoleDefault(profile, "monitor", models)).toBe("provider_a::monitor");
    expect(resolveRoleDefault(profile, "judge", models)).toBe("provider_a::judge");
    expect(resolveViewerDefault({ ...profile, credentialId: "other" }, provider, models)).toBe("");
    expect(resolveRoleDefault({ ...profile, defaultJudgeModelId: "missing" }, "judge", models)).toBe("");
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
