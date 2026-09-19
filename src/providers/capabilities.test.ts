import { describe, expect, it } from "vitest";
import { isRecommendedModel, normalizeModelDiscovery, resolveGenerationSettings } from "./capabilities";
import type { ProviderConfig } from "./types";

const config: ProviderConfig = {
  id: "provider_1",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential_1",
  enabled: true,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

describe("dynamic provider capabilities", () => {
  it("normalizes OpenRouter advertised parameters without inventing unsupported controls", () => {
    const [model] = normalizeModelDiscovery(
      config,
      {
        data: [
          {
            id: "qwen/qwen3.8-max-0902",
            name: "Qwen 3.8 Max (0902)",
            context_length: 1_000_000,
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            top_provider: { max_completion_tokens: 131_072 },
            supported_parameters: ["temperature", "reasoning_effort", "max_tokens"],
            reasoning: { mandatory: true, default_enabled: true, supported_efforts: ["xhigh", "high", "medium", "low", "minimal"], default_effort: "xhigh" },
            pricing: { prompt: "0.000002", completion: "0.000006" },
          },
        ],
      },
      "2026-08-08T12:00:00.000Z",
    );

    expect(model.capabilities.contextTokens).toBe(1_000_000);
    expect(model.capabilities.maxOutputTokens).toBe(131_072);
    expect(model.capabilities.supportsVision).toBe(true);
    expect(model.capabilities.reasoning.efforts).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    expect(model.capabilities.reasoning.registryStatus).toBe("known");
    expect(model.capabilities.temperature.supported).toBe(true);
    expect(model.pricing.completionPerToken).toBe(0.000006);
  });

  it("keeps an unknown Google thinking model on provider-default reasoning until exact levels are known", () => {
    const google = { ...config, id: "google_1", provider: "google" as const };
    const [model] = normalizeModelDiscovery(google, {
      models: [{ baseModelId: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", inputTokenLimit: 1_000_000, outputTokenLimit: 65_536, thinking: true, maxTemperature: 2, temperature: 1 }],
    });
    expect(model.capabilities.reasoning.supported).toBe(true);
    expect(model.capabilities.reasoning.efforts).toEqual([]);
    expect(model.capabilities.reasoning.options).toEqual([]);
    expect(model.capabilities.reasoning.registryStatus).toBe("unknown");
    expect(model.capabilities.temperature.max).toBe(2);
  });

  it("keeps unknown OpenRouter models on provider default when supported_efforts is null", () => {
    const [model] = normalizeModelDiscovery(config, {
      data: [{
        id: "vendor/reasoner-with-unspecified-levels",
        supported_parameters: ["reasoning", "temperature"],
        reasoning: { supported_efforts: null, mandatory: true, default_effort: "medium" },
      }],
    });
    expect(model.capabilities.reasoning.supported).toBe(true);
    expect(model.capabilities.reasoning.efforts).toEqual([]);
    expect(model.capabilities.reasoning.options).toEqual([]);
    expect(model.capabilities.reasoning.mandatory).toBe(true);
    expect(model.capabilities.reasoning.registryStatus).toBe("unknown");

    const resolved = resolveGenerationSettings(model.capabilities, { reasoningEffort: "high" });
    expect(resolved.effective.reasoningEffort).toBeUndefined();
    expect(resolved.omitted).toContain("reasoningEffort");
    expect(resolved.reasoningResolution).toBeUndefined();
  });

  it("keeps moving OpenRouter latest aliases on live provider metadata instead of static registry bindings", () => {
    const [model] = normalizeModelDiscovery(config, {
      data: [{
        id: "~deepseek/deepseek-pro-latest",
        supported_parameters: ["reasoning", "reasoning_effort", "max_tokens"],
        reasoning: { mandatory: false, supported_efforts: ["max", "high", "low"], default_effort: "high" },
      }],
    });
    expect(model.capabilities.reasoning.registryStatus).toBe("unknown");
    expect(model.capabilities.reasoning.registryModelId).toBeUndefined();
    expect(model.capabilities.reasoning.efforts).toEqual(["max", "high", "low"]);
    expect(model.capabilities.reasoning.options?.every((option) => option.verification === "provider_metadata")).toBe(true);
  });

  it("does not invent reasoning for an unknown model that does not advertise it", () => {
    const [model] = normalizeModelDiscovery(config, {
      data: [{ id: "plain/model", supported_parameters: ["max_tokens"], architecture: { input_modalities: ["text"] } }],
    });
    const resolved = resolveGenerationSettings(model.capabilities, { reasoningEffort: "high", temperature: 1.5, maxOutputTokens: 1000 });
    expect(model.capabilities.reasoning.supported).toBe(false);
    expect(model.capabilities.reasoning.efforts).toEqual([]);
    expect(resolved.effective).toEqual({ maxOutputTokens: 1000 });
    expect(resolved.omitted).toEqual(["reasoningEffort", "temperature"]);
    expect(resolved.reasoningResolution).toBeUndefined();
  });

  it("keeps max-tokens-only reasoning models on provider default and rejects fabricated effort requests", () => {
    const [model] = normalizeModelDiscovery(config, {
      data: [{
        id: "qwen/qwen3.8-flash",
        supported_parameters: ["reasoning", "max_tokens", "temperature"],
        reasoning: { mandatory: false, default_enabled: true, supports_max_tokens: true },
      }],
    });
    expect(model.capabilities.reasoning.supported).toBe(true);
    expect(model.capabilities.reasoning.efforts).toEqual([]);
    expect(model.capabilities.reasoning.options).toEqual([]);
    expect(model.capabilities.reasoning.registryStatus).toBe("unknown");

    const resolved = resolveGenerationSettings(model.capabilities, { reasoningEffort: "high" });
    expect(resolved.effective.reasoningEffort).toBeUndefined();
    expect(resolved.omitted).toContain("reasoningEffort");
    expect(resolved.reasoningResolution).toBeUndefined();
  });

  it("never recommends GPT-OSS 120B", () => {
    expect(isRecommendedModel("openai/gpt-oss-120b")).toBe(false);
    expect(isRecommendedModel("google/gemini-3.1-pro")).toBe(true);
  });
});
