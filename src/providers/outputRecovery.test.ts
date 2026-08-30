import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "./types";
import { analyticalOutputBudget, callWithAnalyticalOutputRecovery, isOutputLimitFailure } from "./outputRecovery";

const model: ProviderModel = {
  providerConfigId: "pc",
  provider: "openrouter",
  modelId: "reasoner",
  displayName: "Reasoner",
  route: "openrouter:reasoner",
  capabilities: {
    contextTokens: 100_000,
    maxOutputTokens: 32_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsVision: false,
    supportsStreaming: true,
    reasoning: { supported: true, efforts: ["high"], confidence: "verified" },
    temperature: { supported: false, confidence: "unknown" },
    supportedParameters: ["max_tokens"],
    source: "provider",
    capturedAt: "now",
  },
  pricing: {},
  recommended: false,
  rawMetadata: {},
  refreshedAt: "now",
};

describe("analytical output recovery", () => {
  it("uses 8192 first and 16384 once after a reasoning-only length failure", async () => {
    const budgets: number[] = [];
    const call = vi.fn(async (settings) => {
      budgets.push(settings.effective.maxOutputTokens ?? 0);
      if (budgets.length === 1) throw new Error("provider returned reasoning without a final assistant response [finish-reason=length]");
      return { content: "final answer", usage: {} };
    });
    const result = await callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "Evaluate" }], call });
    expect(budgets).toEqual([8192, 16384]);
    expect(result.attempt).toBe(1);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("treats successful content marked length as incomplete", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ content: '{"partial":true}', finishReason: "length", usage: {} })
      .mockResolvedValueOnce({ content: '{"complete":true}', finishReason: "stop", usage: {} });
    const result = await callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "JSON" }], call });
    expect(result.response.content).toContain("complete");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not retry ordinary provider or schema failures", async () => {
    const call = vi.fn().mockRejectedValue(new Error("unauthorized"));
    await expect(callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "Evaluate" }], call })).rejects.toThrow("unauthorized");
    expect(call).toHaveBeenCalledTimes(1);
    expect(isOutputLimitFailure(new Error("Judge returned invalid JSON."))).toBe(false);
  });

  it("protects the context window and refuses an unusably small remainder", () => {
    const smallContext = { ...model, capabilities: { ...model.capabilities, contextTokens: 1300 } };
    expect(() => analyticalOutputBudget({ model: smallContext, messages: [{ role: "user", content: "x".repeat(1400) }], attempt: 0 }))
      .toThrow(/available context/);
  });
});
