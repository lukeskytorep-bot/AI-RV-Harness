import { describe, expect, it } from "vitest";
import {
  OPENROUTER_SEED_MAX,
  hasManualOpenRouterSampling,
  validateOpenRouterAdditionalSamplingSettings,
  validateOpenRouterSamplingForProvider,
} from "./openRouterSamplingSettings";

describe("OpenRouter additional sampling profile contract", () => {
  it("accepts Auto, zero values, precise top_p and the maximum safe seed", () => {
    expect(validateOpenRouterAdditionalSamplingSettings({ enabled: true })).toEqual({ enabled: true });
    expect(validateOpenRouterAdditionalSamplingSettings({ enabled: true, topP: 0.04, topK: 0, seed: 0 }))
      .toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 0 });
    expect(validateOpenRouterAdditionalSamplingSettings({ enabled: false, seed: OPENROUTER_SEED_MAX }).seed)
      .toBe(OPENROUTER_SEED_MAX);
  });

  it("requires a real boolean enabled flag for untrusted runtime data", () => {
    expect(validateOpenRouterAdditionalSamplingSettings({ enabled: true, topK: 64 })).toEqual({ enabled: true, topK: 64 });
    expect(validateOpenRouterAdditionalSamplingSettings({ enabled: false, topK: 64 })).toEqual({ enabled: false, topK: 64 });

    for (const settings of [
      { enabled: "false", topK: 64 },
      { enabled: 1, topK: 64 },
      { enabled: null, topK: 64 },
      { topK: 64 },
      null,
      [],
    ]) {
      expect(() => validateOpenRouterAdditionalSamplingSettings(settings)).toThrow();
    }
  });

  it("rejects invalid numeric values", () => {
    for (const topP of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateOpenRouterAdditionalSamplingSettings({ enabled: true, topP })).toThrow();
    }
    for (const topK of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateOpenRouterAdditionalSamplingSettings({ enabled: true, topK })).toThrow();
    }
    for (const seed of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateOpenRouterAdditionalSamplingSettings({ enabled: true, seed })).toThrow();
    }
  });

  it("allows the shared sampling contract for OpenRouter and Custom without changing other providers", () => {
    expect(validateOpenRouterSamplingForProvider("openrouter", { enabled: true, seed: 42 })).toEqual({ enabled: true, seed: 42 });
    expect(validateOpenRouterSamplingForProvider("custom_openai", { enabled: true, topP: 0.04, topK: 0, seed: 42 })).toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });
    expect(validateOpenRouterSamplingForProvider("mistral", { enabled: true, topP: 0.04, topK: 0, seed: 42 }))
      .toEqual({ enabled: true, topP: 0.04, topK: 0, seed: 42 });
    expect(validateOpenRouterSamplingForProvider("mistral", undefined)).toBeUndefined();
  });

  it("distinguishes enabled Auto from manual values and disabled stored values", () => {
    expect(hasManualOpenRouterSampling({ enabled: true })).toBe(false);
    expect(hasManualOpenRouterSampling({ enabled: true, topK: 0 })).toBe(true);
    expect(hasManualOpenRouterSampling({ enabled: false, topP: 0.8 })).toBe(false);
  });
});
