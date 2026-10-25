import { describe, expect, it } from "vitest";
import type { EffectiveGenerationSettings, ProviderModel } from "../providers/types";
import { CostGuardStop, SessionCostGuard, withEstimatedCost } from "./costGuard";

const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: true, confidence: "unknown" }, supportedParameters: ["max_tokens"], maxOutputTokens: 100, source: "provider", capturedAt: "now" },
  pricing: { promptPerToken: 0.001, completionPerToken: 0.01, currency: "USD" }, recommended: false, rawMetadata: {}, refreshedAt: "now",
};
const settings: EffectiveGenerationSettings = { requested: { maxOutputTokens: 10 }, effective: { maxOutputTokens: 10 }, omitted: [] };

describe("hard session cost guard", () => {
  it("derives cost from tokens when the provider omits a cost field", () => {
    expect(withEstimatedCost({ inputTokens: 10, outputTokens: 2 }, model).costUsd).toBeCloseTo(0.03);
  });

  it("blocks a request before it can exceed the configured upper bound", () => {
    const guard = new SessionCostGuard(0.05);
    guard.validateModel(model);
    expect(() => guard.authorize(model, [{ role: "user", content: "1234567890" }], settings)).toThrow(CostGuardStop);
  });

  it("reserves the maximum request cost after an unreported failed call", () => {
    const guard = new SessionCostGuard(0.2);
    const first = guard.authorize(model, [{ role: "user", content: "1234567890" }], settings);
    first.failure();
    expect(() => guard.authorize(model, [{ role: "user", content: "1234567890" }], settings)).toThrow(CostGuardStop);
  });

  it("refuses to call a pricing-unknown route when hard limit is enabled", () => {
    const guard = new SessionCostGuard(1);
    expect(() => guard.validateModel({ ...model, pricing: {} })).toThrow(/pricing is unavailable/i);
  });
});
