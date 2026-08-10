import { describe, expect, it } from "vitest";
import { applyModelReasoningRegistry, applyReasoningRegistryToProviderModel, reasoningOptions } from "./modelReasoningRegistry";
import type { ProviderModel, ReasoningCapability } from "./types";

const undiscovered: ReasoningCapability = {
  supported: false,
  efforts: [],
  confidence: "unknown",
};

describe("model reasoning registry", () => {
  it("maps two-state Gemma controls to provider-specific payloads", () => {
    const openRouter = applyModelReasoningRegistry("openrouter", "google/gemma-4-31b-it:free", undiscovered);
    expect(reasoningOptions(openRouter)).toEqual([
      expect.objectContaining({ value: "none", label: "NONE / OFF", verification: "registry", transport: { kind: "effort", value: "none" } }),
      expect.objectContaining({ value: "high", label: "ENABLED / ON", verification: "registry", transport: { kind: "enabled_boolean", value: "true" } }),
    ]);

    const google = applyModelReasoningRegistry("google", "models/gemma-4-31b-it", undiscovered);
    expect(reasoningOptions(google).map((option) => option.transport)).toEqual([
      { kind: "thinking_level", value: "minimal" },
      { kind: "thinking_level", value: "high" },
    ]);
  });

  it("keeps only verified levels for known optional and mandatory models", () => {
    expect(applyModelReasoningRegistry("openrouter", "z-ai/glm-5.2", undiscovered).efforts).toEqual(["none", "high", "xhigh"]);
    const mandatory = applyModelReasoningRegistry("openrouter", "inclusionai/ring-2.6-1t", undiscovered);
    expect(mandatory.efforts).toEqual(["high", "xhigh"]);
    expect(mandatory.mandatory).toBe(true);
  });

  it("reduces known non-reasoning models to AUTO only", () => {
    const capability = applyModelReasoningRegistry("openrouter", "cohere/command-a", {
      supported: true,
      efforts: ["high"],
      confidence: "provider_metadata",
    });
    expect(capability.supported).toBe(false);
    expect(capability.efforts).toEqual([]);
    expect(capability.options).toEqual([]);
    expect(capability.registryStatus).toBe("known");
  });

  it("combines provider levels with clearly marked standard candidates for unknown models", () => {
    const capability = applyModelReasoningRegistry("openrouter", "vendor/future-model", {
      supported: true,
      efforts: ["low", "high"],
      confidence: "provider_metadata",
    });
    expect(capability.efforts).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
    expect(reasoningOptions(capability).find((option) => option.value === "low")?.verification).toBe("provider_metadata");
    expect(reasoningOptions(capability).find((option) => option.value === "medium")?.verification).toBe("unverified");
  });

  it("upgrades cached pre-registry models and leaves current snapshots stable", () => {
    const cached: ProviderModel = {
      providerConfigId: "provider",
      provider: "openrouter",
      modelId: "google/gemma-4-31b-it",
      displayName: "Gemma",
      route: "openrouter:google/gemma-4-31b-it",
      capabilities: {
        inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
        reasoning: { supported: true, efforts: ["high"], confidence: "provider_metadata" },
        temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["reasoning"], source: "provider", capturedAt: "now",
      },
      pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now",
    };
    const upgraded = applyReasoningRegistryToProviderModel(cached);
    expect(upgraded.capabilities.reasoning.efforts).toEqual(["none", "high"]);
    expect(applyReasoningRegistryToProviderModel(upgraded)).toEqual(upgraded);
  });
});
