import { describe, expect, it } from "vitest";
import type { ProviderContinuationState } from "../providers/continuationContract";
import { estimateContextBudget, IMAGE_TOKEN_RESERVE } from "./contextBudget";


function openRouterState(data = "R".repeat(12_000)): ProviderContinuationState {
  return {
    schemaVersion: 1,
    transport: "openrouter",
    format: "openrouter-reasoning-details",
    replayFingerprint: {
      transport: "openrouter",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      providerConfigId: "provider",
      credentialId: "cred",
      requestedModelId: "m",
      stateFormat: "openrouter-reasoning-details",
      stateFormatVersion: 1,
    },
    reasoningDetails: [{ type: "reasoning.encrypted", data, id: "e1", format: "openai-responses-v1" }],
  };
}

describe("conversation context budget", () => {
  it("uses the same estimate for UI thresholds and the request guard", () => {
    const budget = estimateContextBudget([{ role: "user", content: "x".repeat(10_000) }], 5_000, 1_000);
    expect(budget.estimatedTotalTokens).toBe(budget.estimatedInputTokens + 1_000);
    expect(budget.percent).toBeGreaterThan(75);
  });

  it("reserves a conservative token allowance for images", () => {
    const without = estimateContextBudget([{ role: "user", content: "hello" }], 20_000, 1_000);
    const withImage = estimateContextBudget([{ role: "user", content: "hello", images: [{ mimeType: "image/png", dataBase64: "x" }] }], 20_000, 1_000);
    expect(withImage.estimatedInputTokens - without.estimatedInputTokens).toBe(IMAGE_TOKEN_RESERVE);
  });

  it("reports an unavailable provider limit without inventing a percentage", () => {
    const budget = estimateContextBudget([{ role: "user", content: "hello" }], undefined, 1_000);
    expect(budget.level).toBe("unknown");
    expect(budget.percent).toBeUndefined();
  });
  it("counts validated continuation state in the same request budget used by the provider guard", () => {
    const without = estimateContextBudget([{ role: "assistant", content: "visible" }], 5_000, 500);
    const withState = estimateContextBudget([{ role: "assistant", content: "visible", continuationState: openRouterState() }], 5_000, 500);
    expect(without.exceeded).toBe(false);
    expect(withState.continuationStateBytes).toBeGreaterThan(10_000);
    expect(withState.estimatedContinuationTokens).toBeGreaterThan(0);
    expect(withState.estimatedInputTokens).toBeGreaterThan(without.estimatedInputTokens);
    expect(withState.exceeded).toBe(true);
  });

  it("accepts an explicit in-memory continuation byte contribution for UI preview budgeting", () => {
    const without = estimateContextBudget([{ role: "user", content: "hello" }], 5_000, 500);
    const withMemory = estimateContextBudget([{ role: "user", content: "hello" }], 5_000, 500, { additionalContinuationStateBytes: 12_000 });
    expect(withMemory.continuationStateBytes).toBe(12_000);
    expect(withMemory.estimatedContinuationTokens).toBeGreaterThan(0);
    expect(withMemory.estimatedInputTokens).toBeGreaterThan(without.estimatedInputTokens);
    expect(withMemory.exceeded).toBe(true);
  });
});
