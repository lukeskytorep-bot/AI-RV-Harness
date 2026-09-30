import { describe, expect, it } from "vitest";
import {
  applyModelReasoningRegistry,
  applyReasoningRegistryToProviderModel,
  findReasoningOption,
  reasoningOptions,
} from "./modelReasoningRegistry";
import type { ProviderModel, ReasoningCapability, ReasoningEffort } from "./types";

const undiscovered: ReasoningCapability = {
  supported: false,
  efforts: [],
  confidence: "unknown",
};

function capability(modelId: string) {
  return applyModelReasoningRegistry("openrouter", modelId, undiscovered);
}

function efforts(modelId: string) {
  return capability(modelId).efforts;
}

function transport(modelId: string, effort: ReasoningEffort) {
  return findReasoningOption(capability(modelId), effort)?.transport;
}

const exactRegistryCases: Array<[string, ReasoningEffort[], boolean]> = [
  ["meta/muse-spark-1.3", ["minimal", "low", "medium", "high", "xhigh", "max"], true],
  ["meta/muse-glimmer-30b", ["low", "medium", "high", "xhigh"], true],
  ["openai/gpt-5.6-sol", ["none", "low", "medium", "high", "xhigh", "max"], false],
  ["openai/gpt-5.6-terra", ["none", "low", "medium", "high", "xhigh", "max"], false],
  ["openai/gpt-5.6-luna", ["none", "low", "medium", "high", "xhigh", "max"], false],
  ["openai/gpt-6-astra", ["low", "medium", "high", "xhigh", "max"], true],
  ["mistralai/mistral-medium-3-5", ["none", "high"], false],
  ["mistralai/mistral-small-2603", ["none", "high"], false],
  ["mistralai/devstral-2512", [], false],
  ["mistralai/mistral-large-2512", [], false],
  ["qwen/qwen-max", [], false],
  ["qwen/qwen3-max", [], false],
  ["qwen/qwen3.8-max-0902", ["minimal", "low", "medium", "high", "xhigh"], true],
  ["qwen/qwen3.8-27b", ["none", "low", "medium", "xhigh"], false],
  ["qwen/qwen3.8-2.4t-a95b", ["low", "medium", "xhigh"], true],
  ["z-ai/glm-5.3", ["low", "high", "max"], true],
  ["z-ai/glm-5.3-flash", ["low", "high", "max"], true],
  ["z-ai/glm-5.3-flashx", ["low", "high", "max"], true],
  ["deepseek/deepseek-v4-pro", ["none", "high", "xhigh"], false],
  ["deepseek/deepseek-v4-pro-0813", ["none", "low", "high", "max"], false],
  ["deepseek/deepseek-v4.1-flash", ["none", "low", "high", "max"], false],
  ["deepseek/deepseek-v4-flash-0731", ["none", "low", "high", "max"], false],
  ["tencent/hy4-preview", ["none", "low", "high"], false],
];

describe("model reasoning registry v2", () => {
  it.each(exactRegistryCases)("matches the verified contract for %s", (modelId, expectedEfforts, mandatory) => {
    const resolved = capability(modelId);
    expect(resolved.efforts).toEqual(expectedEfforts);
    expect(resolved.mandatory).toBe(mandatory);
    expect(resolved.registryStatus).toBe("known");
    expect(resolved.registryModelId).toBe(modelId);
    expect(resolved.registryVersion).toBe("2.1.0");
    expect(resolved.verifiedAt).toBe("2026-09-19");
  });

  it("maps two-state Gemma controls to provider-specific payloads", () => {
    const openRouter = applyModelReasoningRegistry("openrouter", "google/gemma-4-31b-it:free", undiscovered);
    expect(reasoningOptions(openRouter)).toEqual([
      expect.objectContaining({ value: "none", label: "NONE / OFF", verification: "registry", transport: { kind: "enabled_boolean", value: "false" } }),
      expect.objectContaining({ value: "high", label: "ENABLED / ON", verification: "registry", transport: { kind: "enabled_boolean", value: "true" } }),
    ]);

    const google = applyModelReasoningRegistry("google", "models/gemma-4-31b-it", undiscovered);
    expect(reasoningOptions(google).map((option) => option.transport)).toEqual([
      { kind: "thinking_level", value: "minimal" },
      { kind: "thinking_level", value: "high" },
    ]);
  });

  it("uses boolean disable only when OpenRouter exposes reasoning as optional without NONE effort", () => {
    expect(transport("nousresearch/hermes-4-405b", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
    expect(transport("google/gemma-4-31b-it", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
    expect(transport("z-ai/glm-5.2", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
    expect(transport("deepseek/deepseek-v4-pro", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
    expect(transport("deepseek/deepseek-v4.1-flash", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
    expect(transport("qwen/qwen3.8-27b", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
    expect(transport("nvidia/nemotron-3-ultra-550b-a55b", "none")).toEqual({ kind: "enabled_boolean", value: "false" });
  });

  it("keeps explicit NONE effort where OpenRouter documents NONE as an effort", () => {
    expect(transport("mistralai/mistral-medium-3-5", "none")).toEqual({ kind: "effort", value: "none" });
    expect(transport("openai/gpt-5.6-luna", "none")).toEqual({ kind: "effort", value: "none" });
    expect(transport("tencent/hy4-preview", "none")).toEqual({ kind: "effort", value: "none" });
  });

  it("keeps moving OpenRouter latest aliases dynamic while stable route variants remain collision-free", () => {
    for (const alias of [
      "~openai/gpt-sol-latest",
      "~openai/gpt-terra-latest",
      "~openai/gpt-luna-latest",
      "~openai/gpt-astra-latest",
      "~deepseek/deepseek-pro-latest",
      "~deepseek/deepseek-flash-latest",
      "~z-ai/glm-latest",
      "~z-ai/glm-flash-latest",
    ]) {
      expect(capability(alias).registryStatus).toBe("unknown");
      expect(capability(alias).registryModelId).toBeUndefined();
    }

    const latestFromProvider = applyModelReasoningRegistry("openrouter", "~deepseek/deepseek-pro-latest", {
      supported: true,
      efforts: ["max", "high", "low"],
      mandatory: false,
      confidence: "provider_metadata",
    });
    expect(latestFromProvider.registryStatus).toBe("unknown");
    expect(latestFromProvider.efforts).toEqual(["max", "high", "low"]);
    expect(reasoningOptions(latestFromProvider).every((option) => option.verification === "provider_metadata")).toBe(true);

    expect(capability("meta/muse-spark-1.3:batch").registryModelId).toBe("meta/muse-spark-1.3");
    expect(capability("meta/muse-glimmer-30b:batch").registryModelId).toBe("meta/muse-glimmer-30b");
    expect(capability("meta/muse-spark-1.3-contributor").registryStatus).toBe("unknown");
  });

  it("does not alias the legacy Qwen 3.8 Max registry key to the dated 0902 route", () => {
    expect(capability("qwen/qwen3.8-max").registryModelId).toBe("qwen/qwen3.8-max");
    expect(capability("qwen/qwen3.8-max-0902").registryModelId).toBe("qwen/qwen3.8-max-0902");
  });

  it("keeps token-budget-only Qwen 3.8 Flash on provider-default reasoning without inventing effort controls", () => {
    const resolved = applyModelReasoningRegistry("openrouter", "qwen/qwen3.8-flash", {
      supported: true,
      efforts: [],
      mandatory: false,
      confidence: "provider_metadata",
    });
    expect(resolved.supported).toBe(true);
    expect(resolved.efforts).toEqual([]);
    expect(resolved.options).toEqual([]);
    expect(resolved.registryStatus).toBe("unknown");
    expect(resolved.registryModelId).toBeUndefined();
  });

  it("rejects unsupported verified levels instead of inventing them", () => {
    expect(findReasoningOption(capability("meta/muse-spark-1.3"), "none")).toBeUndefined();
    expect(findReasoningOption(capability("meta/muse-glimmer-30b"), "max")).toBeUndefined();
    expect(findReasoningOption(capability("deepseek/deepseek-v4-pro"), "low")).toBeUndefined();
    expect(findReasoningOption(capability("deepseek/deepseek-v4-pro-0813"), "xhigh")).toBeUndefined();
    expect(findReasoningOption(capability("qwen/qwen3.8-27b"), "high")).toBeUndefined();
    expect(findReasoningOption(capability("mistralai/devstral-2512"), "high")).toBeUndefined();
  });

  it("does not force reasoning for verified optional models", () => {
    for (const modelId of [
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "google/gemini-3-flash-preview",
      "mistralai/mistral-medium-3-5",
      "qwen/qwen3.8-27b",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-pro-0813",
      "deepseek/deepseek-v4.1-flash",
      "tencent/hy4-preview",
    ]) {
      expect(capability(modelId).mandatory).toBe(false);
    }
  });

  it("covers all five models in the official OpenRouter current Top Models table", () => {
    const topFive = [
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4.1-flash",
      "tencent/hy4-preview",
      "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4-flash-0731",
    ];
    expect(topFive.map((modelId) => capability(modelId).registryStatus)).toEqual(["known", "known", "known", "known", "known"]);
  });

  it("preserves verified existing contracts that remain correct", () => {
    expect(efforts("openai/gpt-5.5")).toEqual(["none", "low", "medium", "high", "xhigh"]);
    expect(efforts("inclusionai/ring-2.6-1t")).toEqual(["high", "xhigh"]);
    expect(efforts("cohere/command-a")).toEqual([]);
    expect(capability("cohere/command-a").supported).toBe(false);
  });

  it("updates targeted existing OpenRouter contracts without making reasoning mandatory", () => {
    expect(efforts("z-ai/glm-5.2")).toEqual(["none", "high", "xhigh"]);
    expect(efforts("deepseek/deepseek-v4-pro")).toEqual(["none", "high", "xhigh"]);
    expect(efforts("deepseek/deepseek-v4-pro-0813")).toEqual(["none", "low", "high", "max"]);
    expect(efforts("nvidia/nemotron-3-ultra-550b-a55b")).toEqual(["none", "medium", "high"]);
    expect(capability("z-ai/glm-5.2").mandatory).toBe(false);
    expect(capability("deepseek/deepseek-v4-pro").mandatory).toBe(false);
  });

  it("reduces known non-reasoning models to AUTO only", () => {
    for (const modelId of ["cohere/command-a", "mistralai/devstral-2512", "mistralai/mistral-large-2512", "qwen/qwen-max", "qwen/qwen3-max"]) {
      const resolved = applyModelReasoningRegistry("openrouter", modelId, {
        supported: true,
        efforts: ["high"],
        confidence: "provider_metadata",
      });
      expect(resolved.supported).toBe(false);
      expect(resolved.efforts).toEqual([]);
      expect(resolved.options).toEqual([]);
      expect(resolved.registryStatus).toBe("known");
    }
  });

  it("exposes only provider-advertised effort levels for unknown models", () => {
    const resolved = applyModelReasoningRegistry("openrouter", "vendor/future-model", {
      supported: true,
      efforts: ["low", "high"],
      confidence: "provider_metadata",
    });
    expect(resolved.efforts).toEqual(["low", "high"]);
    expect(reasoningOptions(resolved)).toEqual([
      expect.objectContaining({ value: "low", verification: "provider_metadata", transport: { kind: "effort", value: "low" } }),
      expect.objectContaining({ value: "high", verification: "provider_metadata", transport: { kind: "effort", value: "high" } }),
    ]);
  });

  it("does not invent reasoning support or levels for unknown non-reasoning models", () => {
    const resolved = applyModelReasoningRegistry("openrouter", "vendor/plain-model", {
      supported: false,
      efforts: [],
      confidence: "unknown",
    });
    expect(resolved.supported).toBe(false);
    expect(resolved.efforts).toEqual([]);
    expect(resolved.options).toEqual([]);
    expect(resolved.registryStatus).toBe("unknown");
  });


  it("upgrades unsafe v2.0 unknown-model fallback snapshots to provider-advertised controls only", () => {
    const cached: ProviderModel = {
      providerConfigId: "provider",
      provider: "openrouter",
      modelId: "qwen/qwen3.8-flash",
      displayName: "Qwen 3.8 Flash",
      route: "openrouter:qwen/qwen3.8-flash",
      capabilities: {
        inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
        reasoning: {
          supported: true,
          efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
          options: [
            { value: "high", label: "HIGH", verification: "unverified", transport: { kind: "effort", value: "high" } },
          ],
          confidence: "provider_metadata",
          registryStatus: "unknown",
          registryVersion: "2.0.0",
          providerEfforts: [],
        },
        temperature: { supported: false, confidence: "unknown" }, supportedParameters: ["reasoning"], source: "provider", capturedAt: "now",
      },
      pricing: {}, recommended: true, rawMetadata: {}, refreshedAt: "now",
    };
    const upgraded = applyReasoningRegistryToProviderModel(cached);
    expect(upgraded.capabilities.reasoning.supported).toBe(true);
    expect(upgraded.capabilities.reasoning.efforts).toEqual([]);
    expect(upgraded.capabilities.reasoning.options).toEqual([]);
    expect(upgraded.capabilities.reasoning.registryVersion).toBe("2.1.0");
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
    expect(upgraded.capabilities.reasoning.registryVersion).toBe("2.1.0");
    expect(applyReasoningRegistryToProviderModel(upgraded)).toEqual(upgraded);
  });
});
