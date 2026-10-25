import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "../providers/types";
import { callViewerWithOutputRecovery, viewerDispatchOutcome, viewerOutputAttemptSettings, viewerResponseCompletion } from "./viewerOutputRecovery";
import { StreamingRepetitionRunawayError } from "./streamingRepetitionGuard";

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

  it("uses the same second semantic attempt for a detected repetition runaway", async () => {
    const loop = `Useful evidence\n${"our ".repeat(240)}`;
    const call = vi.fn()
      .mockResolvedValueOnce({ content: loop, finishReason: "stop", usage })
      .mockResolvedValueOnce({ content: "recovered clean answer", finishReason: "stop", usage });
    const incomplete = vi.fn();
    const result = await callViewerWithOutputRecovery({
      model,
      baseSettings: base,
      operationKind: "rv_session_viewer",
      messages: [{ role: "user", content: "same-step" }],
      sessionLanguage: "en",
      call,
      onIncompleteAttempt: incomplete,
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls.map(([settings]) => settings.effective.maxOutputTokens)).toEqual([16384, 32768]);
    expect(incomplete).toHaveBeenCalledWith(expect.objectContaining({ completion: "repetition_runaway", recoveryLevel: 0 }));
    expect(result.response.content).toBe("recovered clean answer");
  });

  it("does not open a third semantic attempt for length followed by repetition", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ content: "partial", finishReason: "length", usage })
      .mockResolvedValueOnce({ content: `still partial\n${"hour ".repeat(240)}`, finishReason: "stop", usage });
    await expect(callViewerWithOutputRecovery({
      model,
      baseSettings: base,
      operationKind: "rv_session_viewer",
      messages: [{ role: "user", content: "same-step" }],
      call,
    })).rejects.toMatchObject({ name: "ViewerOutputIncompleteError", reason: "repetition_runaway", attempts: [{ recoveryLevel: 0 }, { recoveryLevel: 1 }] });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("treats an attempt-local streaming abort as repetition rather than a user Stop", async () => {
    const raw = `Useful evidence\n${"our ".repeat(240)}`;
    const streamingError = new StreamingRepetitionRunawayError({
      rawContent: raw,
      sanitizedContent: "Useful evidence\n\n[OUTPUT TRUNCATED]",
      finding: { severity: "stop", rule: "repeated-tail-block", cutAt: 16 },
      providerRequestId: "req-loop",
      originalLength: raw.length,
      retainedLength: 16,
    });
    const call = vi.fn()
      .mockRejectedValueOnce(streamingError)
      .mockResolvedValueOnce({ content: "clean recovery", finishReason: "stop", usage });
    const incomplete = vi.fn();
    const result = await callViewerWithOutputRecovery({ model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }], call, onIncompleteAttempt: incomplete });
    expect(result.response.content).toBe("clean recovery");
    expect(incomplete).toHaveBeenCalledWith(expect.objectContaining({ completion: "repetition_runaway", providerRequestId: "req-loop", rawOutputSha256: expect.any(String) }));
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

  it("allows the one remaining repetition recovery attempt at the same clamped model ceiling", async () => {
    const small = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    const call = vi.fn()
      .mockResolvedValueOnce({ content: "our ".repeat(240), finishReason: "stop", usage })
      .mockResolvedValueOnce({ content: "clean", finishReason: "stop", usage });
    const result = await callViewerWithOutputRecovery({ model: small, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }], call });
    expect(result.response.content).toBe("clean");
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][0].effective.maxOutputTokens).toBe(8192);
    expect(call.mock.calls[1][0].effective.maxOutputTokens).toBe(8192);
  });

  it("preserves same-ceiling repetition recovery after restart", async () => {
    const small = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    const call = vi.fn().mockResolvedValue({ content: "clean after restart", finishReason: "stop", usage });
    const result = await callViewerWithOutputRecovery({
      model: small, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }],
      startRecoveryLevel: 1, priorEffectiveMaxOutputTokens: 8192, priorIncompleteReason: "repetition_runaway", call,
    });
    expect(result.response.content).toBe("clean after restart");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].effective.maxOutputTokens).toBe(8192);
  });

  it("durably records a known length result but does not start recovery after concurrent Stop", async () => {
    const parent = new AbortController();
    const incomplete = vi.fn();
    const call = vi.fn().mockImplementationOnce(async () => {
      parent.abort(new DOMException("USER STOP", "AbortError"));
      return { content: "known partial", finishReason: "length", usage };
    });
    await expect(callViewerWithOutputRecovery({
      model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }],
      call, onIncompleteAttempt: incomplete, abortSignal: parent.signal,
    })).rejects.toMatchObject({ name: "AbortError", message: "USER STOP" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(incomplete).toHaveBeenCalledTimes(1);
    expect(incomplete).toHaveBeenCalledWith(expect.objectContaining({ completion: "output_limit", recoveryLevel: 0, content: "known partial" }));
  });

  it("returns a known complete result even when Stop races with the provider return", async () => {
    const parent = new AbortController();
    const call = vi.fn().mockImplementationOnce(async () => {
      parent.abort(new DOMException("USER STOP", "AbortError"));
      return { content: "known complete", finishReason: "stop", usage };
    });
    const result = await callViewerWithOutputRecovery({
      model, baseSettings: base, operationKind: "rv_session_viewer", messages: [{ role: "user", content: "step" }],
      call, abortSignal: parent.signal,
    });
    expect(result.response.content).toBe("known complete");
    expect(call).toHaveBeenCalledTimes(1);
  });

});

for(const operationKind of ["rv_session_viewer","training_blind_viewer","research_viewer"] as const) it(`B1 preserves default blind ${operationKind} requests at 16K/32K`,async()=>{
 const budgets:number[]=[];
 await callViewerWithOutputRecovery({model,baseSettings:base,operationKind,messages:[{role:"user",content:"blind"}],call:async settings=>{
  budgets.push(settings.effective.maxOutputTokens!);return {content:"answer",finishReason:budgets.length===1?"length":"stop",usage:{}};
 }});
 expect(budgets).toEqual([16384,32768]);
});
