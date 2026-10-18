import { describe, expect, it } from "vitest";
import type { ProviderModel } from "../providers/types";
import type { Profile } from "../types";
import { assertResearchSamplingSupported, researchRequestedSamplingValue, researchSamplingFromProfile } from "./samplingPolicy";

const now = "2026-10-18T00:00:00.000Z";
function model(supported: string[] | undefined, route = "openrouter:model-a"): ProviderModel {
  return {
    providerConfigId: "pc", provider: "openrouter", modelId: route.split(":").at(-1)!, displayName: route, route,
    capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
      reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: true, confidence: "provider_metadata" },
      supportedParameters: supported ?? [], maxOutputTokens: 32768, source: "provider", capturedAt: now },
    pricing: {}, recommended: true, rawMetadata: supported === undefined ? {} : { supported_parameters: supported }, refreshedAt: now,
  };
}
function profile(settings?: Profile["defaultViewerOpenRouterSampling"]): Profile {
  return { id: "p", name: "P", credentialId: "c", defaultViewerOpenRouterSampling: settings, createdAt: now, updatedAt: now };
}

describe("Research sampling policy", () => {
  it("reads raw enabled profile intent and preserves explicit zero", () => {
    expect(researchSamplingFromProfile(profile({ enabled: true, topP: 0.9, topK: 0, seed: 123 }), "openrouter").requested)
      .toEqual({ topP: 0.9, topK: 0, seed: 123 });
  });
  it("treats disabled and all-Auto as omitted", () => {
    expect(researchSamplingFromProfile(profile({ enabled: false, topP: 0.9, topK: 40, seed: 123 }), "openrouter").requested).toEqual({});
    expect(researchSamplingFromProfile(profile({ enabled: true }), "openrouter").requested).toEqual({});
  });
  it("does not reactivate retained OpenRouter values on another provider", () => {
    expect(researchSamplingFromProfile(profile({ enabled: true, topP: 0.9, topK: 40, seed: 123 }), "mistral").requested).toEqual({});
  });
  it("requires every compared Viewer route to confirm every manual parameter", () => {
    const requested = { topP: 0.9, topK: 40, seed: 123 };
    expect(() => assertResearchSamplingSupported(requested, [model(["top_p", "top_k", "seed"]), model(["top_p", "top_k", "seed"], "openrouter:model-b")])).not.toThrow();
    expect(() => assertResearchSamplingSupported(requested, [model(["top_p", "top_k", "seed"]), model(["top_p", "top_k"], "openrouter:model-b")])).toThrow(/seed is unsupported.*model-b/);
    expect(() => assertResearchSamplingSupported({ seed: 123 }, [model(undefined)])).toThrow(/seed is unknown/);
  });
});

it("prefers frozen requested sampler values and falls back to structural legacy values without losing zero", () => {
  expect(researchRequestedSamplingValue({ topP: 0.04, topK: 0, seed: 42 }, { topP: 0.9, topK: 100, seed: 7 }, "topP")).toBe(0.04);
  expect(researchRequestedSamplingValue({ topK: 0 }, { topK: 100 }, "topK")).toBe(0);
  expect(researchRequestedSamplingValue(undefined, { topK: 100 }, "topK")).toBe(100);
  expect(researchRequestedSamplingValue({}, undefined, "seed")).toBeUndefined();
});
