import { describe, expect, it } from "vitest";
import { estimateContextBudget, IMAGE_TOKEN_RESERVE } from "./contextBudget";

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
});
