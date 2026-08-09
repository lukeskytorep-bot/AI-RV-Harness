import { describe, expect, it } from "vitest";
import type { ProviderModel } from "../providers/types";
import { sharedResearchCapabilities } from "./studyControls";

function model(
  id: string,
  options: {
    reasoning?: ProviderModel["capabilities"]["reasoning"]["efforts"];
    temperature?: { min?: number; max?: number };
    maxOutputTokens?: number;
  } = {},
): ProviderModel {
  return {
    providerConfigId: "provider",
    provider: "openrouter",
    modelId: id,
    displayName: id,
    route: `openrouter:${id}`,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: true,
      reasoning: {
        supported: Boolean(options.reasoning?.length),
        efforts: options.reasoning ?? [],
        confidence: options.reasoning?.length ? "provider_metadata" : "unknown",
      },
      temperature: {
        supported: Boolean(options.temperature),
        ...options.temperature,
        confidence: options.temperature ? "provider_metadata" : "unknown",
      },
      maxOutputTokens: options.maxOutputTokens,
      supportedParameters: [],
      source: "provider",
      capturedAt: "now",
    },
    pricing: {},
    recommended: false,
    rawMetadata: {},
    refreshedAt: "now",
  };
}

describe("shared Research Viewer capabilities", () => {
  it("keeps only reasoning levels supported by every compared route", () => {
    const shared = sharedResearchCapabilities([
      model("a", { reasoning: ["low", "medium", "high"] }),
      model("b", { reasoning: ["medium", "high", "xhigh"] }),
    ]);
    expect(shared.reasoningEfforts).toEqual(["medium", "high"]);
  });

  it("computes the common temperature range and safest output limit", () => {
    const shared = sharedResearchCapabilities([
      model("a", { temperature: { min: 0, max: 2 }, maxOutputTokens: 8192 }),
      model("b", { temperature: { min: 0.2, max: 1.5 }, maxOutputTokens: 4096 }),
    ]);
    expect(shared).toMatchObject({ temperatureSupported: true, temperatureMin: 0.2, temperatureMax: 1.5, maxOutputTokens: 4096 });
  });

  it("disables temperature when any compared route cannot honor it", () => {
    const shared = sharedResearchCapabilities([
      model("a", { temperature: { min: 0, max: 2 } }),
      model("b"),
    ]);
    expect(shared.temperatureSupported).toBe(false);
  });

  it("disables temperature when advertised route ranges do not overlap", () => {
    const shared = sharedResearchCapabilities([
      model("a", { temperature: { min: 0, max: 0.5 } }),
      model("b", { temperature: { min: 1, max: 2 } }),
    ]);
    expect(shared.temperatureSupported).toBe(false);
  });
});
