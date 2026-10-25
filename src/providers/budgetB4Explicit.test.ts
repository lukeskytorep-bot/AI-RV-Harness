import { describe, expect, it, vi } from "vitest";
import { analyticalOutputBudget, callWithAnalyticalOutputRecovery } from "./outputRecovery";
import { learningObjectOutputAllowance, type LearningBudgetPolicy } from "./operationResourceProfiles";
import type { ProviderModel } from "./types";

const model: ProviderModel = {
  providerConfigId: "provider", modelId: "viewer", displayName: "Viewer", route: "openrouter:viewer", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  provider: "openrouter",
  capabilities: { contextTokens: 200_000, maxOutputTokens: 8192, inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: false, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now" },
};

// Compiled by the real project typecheck, never dispatched. These errors must remain errors.
function compileTimeContract() {
  // @ts-expect-error Learning allowance requires an explicit policy.
  learningObjectOutputAllowance(2048, 0);
  // @ts-expect-error An analytical policy cannot select learning headroom.
  learningObjectOutputAllowance(2048, 0, "default");
  // @ts-expect-error Learning recovery requires a policy even when capacity is known.
  void callWithAnalyticalOutputRecovery({ model, messages: [], operationKind: "field_guide_update", learningObjectCapacityTokens: 2048, call: vi.fn() });
  // @ts-expect-error Research analytical compatibility cannot select learning budgets.
  analyticalOutputBudget({ model, messages: [], operationKind: "viewer_notes_reflection", learningObjectCapacityTokens: 1024, budgetPolicy: "legacy_analytical", attempt: 0 });
}
void compileTimeContract;

describe("B4 explicit learning contract", () => {
  for (const operationKind of ["field_guide_update", "viewer_notes_reflection"] as const) {
    it.each([undefined, "default", "legacy_analytical", "frozen_analytical_v1", false, "training_reveal_v2"])(`${operationKind} rejects policy %s before transport`, async invalid => {
      const call = vi.fn();
      // Deliberately simulate an untyped caller crossing the runtime boundary.
      const budgetPolicy = invalid as LearningBudgetPolicy;
      expect(() => learningObjectOutputAllowance(2048, 0, budgetPolicy)).toThrow(/explicit training_reveal/);
      expect(() => analyticalOutputBudget({ model, messages: [], operationKind, learningObjectCapacityTokens: 2048, budgetPolicy, attempt: 0 })).toThrow(/explicit training_reveal/);
      await expect(callWithAnalyticalOutputRecovery({ model, messages: [], operationKind, learningObjectCapacityTokens: 2048, budgetPolicy, call })).rejects.toThrow(/explicit training_reveal/);
      expect(call).not.toHaveBeenCalled();
    });
    it.each([1024, 2048, 4096, 8192])(`${operationKind} dispatches current headroom with C=%i`, async capacity => {
      const outputs: number[] = [];
      await callWithAnalyticalOutputRecovery({ model, messages: [], operationKind, learningObjectCapacityTokens: capacity, budgetPolicy: "training_reveal", call: async settings => {
        outputs.push(settings.effective.maxOutputTokens!);
        return { content: "result", finishReason: outputs.length === 1 ? "length" : "stop", usage: {} };
      } });
      expect(outputs).toEqual([capacity + 32768, capacity + 49152]);
    });
  }
  it.each([NaN, Infinity, -1, 0, 0.5])("rejects invalid capacity %s without dispatch", async capacity => {
    const call = vi.fn();
    await expect(callWithAnalyticalOutputRecovery({ model, messages: [], operationKind: "field_guide_update", learningObjectCapacityTokens: capacity, budgetPolicy: "training_reveal", call })).rejects.toThrow(/capacity/);
    expect(call).not.toHaveBeenCalled();
  });
  it("retains independent analytical Research legacy budgets", () => {
    const large = { ...model, provider: "openai" as const, capabilities: { ...model.capabilities, maxOutputTokens: 100_000 } };
    expect([0, 1].map(attempt => analyticalOutputBudget({ model: large, messages: [], operationKind: "judge", budgetPolicy: "legacy_analytical", attempt: attempt as 0 | 1 }))).toEqual([8192, 16384]);
    expect([0, 1].map(attempt => analyticalOutputBudget({ model: large, messages: [], operationKind: "judge", budgetPolicy: "frozen_analytical_v1", attempt: attempt as 0 | 1 }))).toEqual([16384, 32768]);
  });
});
