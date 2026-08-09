import { describe, expect, it } from "vitest";
import type { ProviderModel } from "./providers/types";
import type { Profile } from "./types";
import { defaultTemperatureForModel, profileGenerationDefaults, profileSystemPromptSnapshot, reasoningEffortForModel } from "./profileViewerDefaults";

function model(overrides: Partial<ProviderModel["capabilities"]> = {}): ProviderModel {
  return {
    providerConfigId: "provider",
    provider: "openrouter",
    modelId: "viewer",
    displayName: "Viewer",
    route: "openrouter:viewer",
    capabilities: {
      inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
      reasoning: { supported: true, efforts: ["low", "medium", "high"], confidence: "provider_metadata" },
      temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
      supportedParameters: ["reasoning", "temperature"], source: "provider", capturedAt: "now", ...overrides,
    },
    pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now",
  };
}

const profile: Profile = {
  id: "profile", name: "Leo", defaultViewerModelId: "viewer", defaultViewerReasoningEffort: "high",
  defaultViewerTemperature: 1.1, defaultViewerSystemPrompt: "  Stay in Shadow Zone.  ", createdAt: "before", updatedAt: "now",
};

describe("Profile Viewer defaults", () => {
  it("uses calibrated settings only for the configured model and starts other supported models at temperature 0.9", () => {
    expect(profileGenerationDefaults(profile, model())).toEqual({ reasoningEffort: "high", temperature: 1.1 });
    expect(profileGenerationDefaults(profile, { ...model(), modelId: "other" })).toEqual({ temperature: 0.9 });
  });

  it("omits unsupported controls and clamps the initial temperature to advertised bounds", () => {
    const fixed = model({ reasoning: { supported: false, efforts: [], confidence: "provider_metadata" }, temperature: { supported: false, confidence: "provider_metadata" } });
    expect(profileGenerationDefaults(profile, fixed)).toEqual({});
    expect(reasoningEffortForModel(fixed, "high")).toBeUndefined();
    expect(defaultTemperatureForModel(model({ temperature: { supported: true, min: 1, max: 2, confidence: "provider_metadata" } }))).toBe(1);
  });

  it("freezes the trimmed Profile prompt with a stable content hash", async () => {
    const snapshot = await profileSystemPromptSnapshot(profile);
    expect(snapshot?.content).toBe("Stay in Shadow Zone.");
    expect(snapshot?.id).toBe("profile_viewer_prompt_profile");
    expect(snapshot?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
