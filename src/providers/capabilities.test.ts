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
            id: "qwen/qwen3.8-max",
            name: "Qwen 3.8 Max",
            context_length: 1_000_000,
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            top_provider: { max_completion_tokens: 131_072 },
            supported_parameters: ["temperature", "reasoning_effort", "max_tokens"],
            reasoning: { mandatory: true, supported_efforts: ["low", "medium", "high", "xhigh"], default_effort: "xhigh" },
            pricing: { prompt: "0.000002", completion: "0.000006" },
          },
        ],
      },
      "2026-08-08T12:00:00.000Z",
    );

    expect(model.capabilities.contextTokens).toBe(1_000_000);
    expect(model.capabilities.maxOutputTokens).toBe(131_072);
    expect(model.capabilities.supportsVision).toBe(true);
    expect(model.capabilities.reasoning.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(model.capabilities.temperature.supported).toBe(true);
    expect(model.pricing.completionPerToken).toBe(0.000006);
  });

  it("keeps Google reasoning levels unknown when the Models API only advertises thinking=true", () => {
    const google = { ...config, id: "google_1", provider: "google" as const };
    const [model] = normalizeModelDiscovery(google, {
      models: [{ baseModelId: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", inputTokenLimit: 1_000_000, outputTokenLimit: 65_536, thinking: true, maxTemperature: 2, temperature: 1 }],
    });
    expect(model.capabilities.reasoning.supported).toBe(true);
    expect(model.capabilities.reasoning.efforts).toEqual([]);
    expect(model.capabilities.temperature.max).toBe(2);
  });

  it("uses the full OpenRouter gateway effort list when supported_efforts is null and removes NONE for mandatory reasoning", () => {
    const [model] = normalizeModelDiscovery(config, {
      data: [{
        id: "openai/reasoner",
        supported_parameters: ["reasoning", "temperature"],
        reasoning: { supported_efforts: null, mandatory: true, default_effort: "medium" },
      }],
    });
    expect(model.capabilities.reasoning.efforts).toEqual(["max", "xhigh", "high", "medium", "low", "minimal"]);
    expect(model.capabilities.reasoning.mandatory).toBe(true);
  });

  it("omits controls that are not demonstrably supported", () => {
    const [model] = normalizeModelDiscovery(config, {
      data: [{ id: "plain/model", supported_parameters: ["max_tokens"], architecture: { input_modalities: ["text"] } }],
    });
    const resolved = resolveGenerationSettings(model.capabilities, { reasoningEffort: "high", temperature: 1.5, maxOutputTokens: 1000 });
    expect(resolved.effective).toEqual({ maxOutputTokens: 1000 });
    expect(resolved.omitted).toEqual(["reasoningEffort", "temperature"]);
  });

  it("never recommends GPT-OSS 120B", () => {
    expect(isRecommendedModel("openai/gpt-oss-120b")).toBe(false);
    expect(isRecommendedModel("google/gemini-3.1-pro")).toBe(true);
  });
});
