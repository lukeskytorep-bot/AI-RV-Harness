import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "../providers/types";
import { callViewerWithOutputRecovery, viewerDispatchOutcome, viewerOutputAttemptSettings, viewerResponseCompletion } from "./viewerOutputRecovery";

const model: ProviderModel = {
  providerConfigId: "pc",
  provider: "openrouter",
  modelId: "m",
  displayName: "M",
  route: "m",
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" },
    supportedParameters: ["max_tokens"], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now",
  },
  pricing: {},
  recommended: false,
  rawMetadata: {},
  refreshedAt: "now",
};
const base = { requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] as never[] };
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

describe("Viewer output recovery", () => {
  it("normalizes length-like finish reasons as incomplete", () => {
    expect(viewerResponseCompletion({ content: "partial", finishReason: "length", usage })).toBe("output_limit");
    expect(viewerResponseCompletion({ content: "partial", finishReason: "max_tokens", usage })).toBe("output_limit");
    expect(viewerResponseCompletion({ content: "complete", finishReason: "stop", usage })).toBe("complete");
    expect(viewerResponseCompletion({ content: "partial", finishReason: "error", usage })).toBe("provider_error");
    expect(viewerResponseCompletion({ content: "partial", finishReason: "content_filter", usage })).toBe("refusal");
  });

  it("uses 16K then 32K for the same logical Viewer step", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ content: "partial", finishReason: "length", usage })
      .mockResolvedValueOnce({ content: "complete", finishReason: "stop", usage });
    const incomplete = vi.fn();
    const result = await callViewerWithOutputRecovery({ model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "same-step" }], call, onIncompleteAttempt: incomplete });
    expect(call.mock.calls.map(([settings]) => settings.effective.maxOutputTokens)).toEqual([16384, 32768]);
    expect(result.response.content).toBe("complete");
    expect(incomplete).toHaveBeenCalledTimes(1);
  });

  it("stops after a second length result instead of looping or advancing", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ content: "partial one", finishReason: "length", usage })
      .mockResolvedValueOnce({ content: "partial two", finishReason: "length", usage });
    await expect(callViewerWithOutputRecovery({ model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "same-step" }], call }))
      .rejects.toMatchObject({ name: "ViewerOutputIncompleteError", reason: "output_limit", attempts: [{ semanticAttempt: 1 }, { semanticAttempt: 2 }] });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not retry a completed stop response", async () => {
    const call = vi.fn().mockResolvedValue({ content: "complete", finishReason: "stop", usage });
    const result = await callViewerWithOutputRecovery({ model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }], call });
    expect(result.response.content).toBe("complete");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not silently lower an explicitly larger Viewer budget", () => {
    const larger = { requested: { maxOutputTokens: 50000 }, effective: { maxOutputTokens: 50000 }, omitted: [] as never[] };
    expect(viewerOutputAttemptSettings({ model, baseSettings: larger, operationKind: "rv_session_viewer", recoveryLevel: 0 }).effective.maxOutputTokens).toBe(50000);
  });

  it("does not bypass a known model output cap while seeking the standard budget", () => {
    const capped = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    expect(viewerOutputAttemptSettings({ model: capped, baseSettings: base, operationKind: "rv_session_viewer", recoveryLevel: 0 }).effective.maxOutputTokens).toBe(8192);
  });

  it("blocks an attempt when its actual output reservation exceeds the known context window", async () => {
    const tiny = { ...model, capabilities: { ...model.capabilities, contextTokens: 8192, maxOutputTokens: 65536 } };
    const call = vi.fn();
    await expect(callViewerWithOutputRecovery({ model: tiny, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "short" }], call }))
      .rejects.toMatchObject({ name: "ViewerOutputIncompleteError", reason: "context_limit" });
    expect(call).not.toHaveBeenCalled();
  });

  it("does not retry or accept explicit provider error and refusal finish reasons", async () => {
    for (const finishReason of ["error", "content_filter"] as const) {
      const call = vi.fn().mockResolvedValue({ content: "partial", finishReason, usage });
      await expect(callViewerWithOutputRecovery({ model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }], call }))
        .rejects.toMatchObject({ name: "ViewerOutputIncompleteError" });
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("can preserve a frozen Research output budget", () => {
    expect(viewerOutputAttemptSettings({ model, baseSettings: base, operationKind: "research_viewer", recoveryLevel: 0, preserveConfiguredBudget: true }).effective.maxOutputTokens).toBe(8192);
  });
  it("can resume directly at the one allowed recovery attempt without repeating primary", async () => {
    const call = vi.fn().mockResolvedValue({ content: "recovered", finishReason: "stop", usage });
    const result = await callViewerWithOutputRecovery({
      model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "same-step" }],
      startRecoveryLevel: 1, priorEffectiveMaxOutputTokens: 16384, call,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].effective.maxOutputTokens).toBe(32768);
    expect(call.mock.calls[0][2]).toEqual(expect.objectContaining({ semanticAttempt: 2, recoveryLevel: 1 }));
    expect(result.semanticAttempt).toBe(2);
  });

  it("does not treat a generic AbortError as proof that dispatch never happened", () => {
    expect(viewerDispatchOutcome(new DOMException("cancelled", "AbortError"))).toBe("unknown");
  });

  it("unwraps executor causeError when before_dispatch is explicitly known", () => {
    const wrapped = {
      name: "ProviderExecutionError",
      causeError: { details: { code: "cancelled", message: "cancelled before dispatch", phase: "before_dispatch" } },
    };
    expect(viewerDispatchOutcome(wrapped)).toBe("not_dispatched");
  });

  it("does not dispatch a resumed recovery when the effective budget cannot exceed the persisted primary budget", async () => {
    const capped = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 16384 } };
    const call = vi.fn();
    await expect(callViewerWithOutputRecovery({
      model: capped, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "same-step" }],
      startRecoveryLevel: 1, priorEffectiveMaxOutputTokens: 16384, call,
    })).rejects.toMatchObject({ name: "ViewerOutputIncompleteError", reason: "no_larger_recovery_budget" });
    expect(call).not.toHaveBeenCalled();
  });

});
