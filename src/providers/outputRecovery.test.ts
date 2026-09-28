import { describe, expect, it, vi } from "vitest";
import type { ProviderChatResponse, ProviderConfig, ProviderModel } from "./types";
import { analyticalOutputBudget, callWithAnalyticalOutputRecovery, isOutputLimitFailure } from "./outputRecovery";
import { ProviderCallError } from "./providerError";
import { executeProviderChat, executeProviderRequest } from "./requestExecutor";
import { getOperationResourceProfile } from "./operationResourceProfiles";

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
    reasoning: { supported: true, efforts: ["high"], supportsMaxTokens: true, confidence: "verified" },
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
    const result = await callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "Evaluate" }], operationKind: "judge", call });
    expect(budgets).toEqual([8192, 16384]);
    expect(result.attempt).toBe(1);
    expect(call).toHaveBeenCalledTimes(2);
  });


  it("uses exact reasoning max only on the second attempt when the route advertises support", async () => {
    const seen: Array<{ effort?: string; reasoningMax?: number; output?: number; prompt: string }> = [];
    const call = vi.fn(async (settings, attempt, messages) => {
      seen.push({
        effort: settings.effective.reasoningEffort,
        reasoningMax: settings.effective.reasoningMaxTokens,
        output: settings.effective.maxOutputTokens,
        prompt: messages.at(-1)?.content ?? "",
      });
      if (attempt === 0) return { content: "", reasoningContent: "thinking", finishReason: "length", usage: {} };
      return { content: "complete", finishReason: "stop", usage: {} };
    });
    await callWithAnalyticalOutputRecovery({
      model,
      messages: [{ role: "user", content: "Frozen packet" }],
      operationKind: "post_reveal_viewer",
      requestedSettings: { reasoningEffort: "high" },
      recoveryInstruction: "RECOVERY ONLY",
      recoveryReasoningMaxTokens: 10_000,
      recoveryReasoningMaxTokensSupported: true,
      call,
    });
    expect(seen[0]).toMatchObject({ effort: "high", reasoningMax: undefined, output: 8192 });
    expect(seen[0].prompt).toBe("Frozen packet");
    expect(seen[1]).toMatchObject({ effort: undefined, reasoningMax: 10_000, output: 16384 });
    expect(seen[1].prompt).toContain("Frozen packet");
    expect(seen[1].prompt).toContain("RECOVERY ONLY");
  });

  it("does not invent exact reasoning max when route support is absent", async () => {
    const unsupported = { ...model, capabilities: { ...model.capabilities, reasoning: { ...model.capabilities.reasoning, supportsMaxTokens: undefined } } };
    const settingsSeen: Array<{ effort?: string; reasoningMax?: number }> = [];
    const call = vi.fn(async (settings, attempt) => {
      settingsSeen.push({ effort: settings.effective.reasoningEffort, reasoningMax: settings.effective.reasoningMaxTokens });
      if (attempt === 0) throw new Error("provider returned an incomplete assistant response [finish-reason=length]");
      return { content: "complete", usage: {} };
    });
    await callWithAnalyticalOutputRecovery({
      model: unsupported,
      messages: [{ role: "user", content: "Frozen packet" }],
      operationKind: "post_reveal_viewer",
      requestedSettings: { reasoningEffort: "high" },
      recoveryReasoningMaxTokens: 10_000,
      recoveryReasoningMaxTokensSupported: false,
      call,
    });
    expect(settingsSeen).toEqual([{ effort: "high", reasoningMax: undefined }, { effort: "high", reasoningMax: undefined }]);
  });

  it("treats successful content marked length as incomplete", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ content: '{"partial":true}', finishReason: "length", usage: {} })
      .mockResolvedValueOnce({ content: '{"complete":true}', finishReason: "stop", usage: {} });
    const result = await callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "JSON" }], operationKind: "judge", call });
    expect(result.response.content).toContain("complete");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not retry ordinary provider or schema failures", async () => {
    const call = vi.fn().mockRejectedValue(new Error("unauthorized"));
    await expect(callWithAnalyticalOutputRecovery({ model, messages: [{ role: "user", content: "Evaluate" }], operationKind: "judge", call })).rejects.toThrow("unauthorized");
    expect(call).toHaveBeenCalledTimes(1);
    expect(isOutputLimitFailure(new Error("Judge returned invalid JSON."))).toBe(false);
  });

  it("keeps output recovery separate from transport retry (three physical calls, not multiplied)", async () => {
    const physical = vi.fn()
      .mockResolvedValueOnce({ content: "partial", finishReason: "length", usage: {} })
      .mockRejectedValueOnce(new ProviderCallError({ code: "response_body_decode", message: "decode", phase: "reading_body" }))
      .mockResolvedValueOnce({ content: "complete", finishReason: "stop", usage: {} });
    const result = await callWithAnalyticalOutputRecovery({
      model,
      messages: [{ role: "user", content: "Evaluate" }],
      operationKind: "judge",
      call: async () => (await executeProviderRequest<ProviderChatResponse>({
        operationId: "test.output-and-transport",
        configuredRetries: 5,
        executeAttempt: physical as () => Promise<ProviderChatResponse>,
        sleep: async () => undefined,
      })).value,
    });
    expect(result.response.content).toBe("complete");
    expect(physical).toHaveBeenCalledTimes(3);
  });

  it("uses capacity + 8192 first and capacity + 16384 once for learning-object output recovery", async () => {
    const budgets: number[] = [];
    const call = vi.fn(async (settings) => {
      budgets.push(settings.effective.maxOutputTokens ?? 0);
      if (budgets.length === 1) throw new Error("provider returned an incomplete assistant response [finish-reason=length]");
      return { content: '{"decision":"NO_CHANGE"}', usage: {} };
    });
    const result = await callWithAnalyticalOutputRecovery({
      model,
      messages: [{ role: "user", content: "Reflect" }],
      operationKind: "viewer_notes_reflection",
      learningObjectCapacityTokens: 1024,
      call,
    });
    expect(budgets).toEqual([9216, 17408]);
    expect(result.attempt).toBe(1);
  });

  it("defers the OpenRouter recovery output ceiling to endpoint discovery", () => {
    const modelLevel8192 = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    expect(analyticalOutputBudget({
      model: modelLevel8192,
      messages: [{ role: "user", content: "Review" }],
      operationKind: "post_reveal_viewer",
      attempt: 0,
    })).toBe(8192);
    expect(analyticalOutputBudget({
      model: modelLevel8192,
      messages: [{ role: "user", content: "Review" }],
      operationKind: "post_reveal_viewer",
      attempt: 1,
      allowOpenRouterEndpointRecoveryEscalation: true,
    })).toBe(16384);

    const learningModelLevel10240 = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 10240 } };
    expect(analyticalOutputBudget({
      model: learningModelLevel10240,
      messages: [{ role: "user", content: "Update" }],
      operationKind: "field_guide_update",
      learningObjectCapacityTokens: 2048,
      attempt: 0,
    })).toBe(10240);
    expect(analyticalOutputBudget({
      model: learningModelLevel10240,
      messages: [{ role: "user", content: "Update" }],
      operationKind: "field_guide_update",
      learningObjectCapacityTokens: 2048,
      attempt: 1,
      allowOpenRouterEndpointRecoveryEscalation: true,
    })).toBe(18432);
  });

  it("keeps ordinary OpenRouter recovery clamped unless the Stage 1 endpoint escalation is explicitly enabled", () => {
    const limitedModel = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    expect(analyticalOutputBudget({
      model: limitedModel,
      messages: [{ role: "user", content: "Existing capacity retry" }],
      operationKind: "field_guide_update",
      learningObjectCapacityTokens: 2048,
      attempt: 1,
    })).toBe(8192);
  });

  it("keeps the model-level output ceiling hard for non-OpenRouter providers", () => {
    const nonOpenRouter = { ...model, provider: "openai" as const, route: "openai:reasoner", capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    expect(analyticalOutputBudget({
      model: nonOpenRouter,
      messages: [{ role: "user", content: "Review" }],
      operationKind: "post_reveal_viewer",
      attempt: 1,
    })).toBe(8192);

    const learningNonOpenRouter = { ...nonOpenRouter, capabilities: { ...nonOpenRouter.capabilities, maxOutputTokens: 10240 } };
    expect(analyticalOutputBudget({
      model: learningNonOpenRouter,
      messages: [{ role: "user", content: "Reflect" }],
      operationKind: "viewer_notes_reflection",
      learningObjectCapacityTokens: 2048,
      attempt: 1,
    })).toBe(10240);
  });

  it("routes Viewer Review recovery 16384 past model-level 8192 to a PROVEN_FIT OpenRouter endpoint", async () => {
    const limitedModel = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    const config: ProviderConfig = { id: "pc-review-routing", provider: "openrouter", label: "OR", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const endpointDiscovery = vi.fn(async () => ({ data: { endpoints: [
      { tag: "small-route", context_length: 65536, max_completion_tokens: 8192, supported_parameters: ["reasoning"] },
      { tag: "large-route", context_length: 131072, max_completion_tokens: 32768, supported_parameters: ["reasoning"] },
    ] } }));
    const dispatched: Array<{ output?: number; routing?: string[]; required?: number }> = [];
    let physical = 0;
    const result = await callWithAnalyticalOutputRecovery({
      model: limitedModel,
      messages: [{ role: "user", content: "Frozen review packet" }],
      operationKind: "post_reveal_viewer",
      allowOpenRouterEndpointRecoveryEscalation: true,
      recoveryReasoningMaxTokens: 10_000,
      recoveryReasoningMaxTokensSupported: true,
      call: (settings, attempt) => executeProviderChat({
        config,
        modelId: limitedModel.modelId,
        messages: [{ role: "user", content: "Frozen review packet" }],
        settings,
        operationKind: "post_reveal_viewer",
        endpointDiscovery,
        attempt: async (request) => {
          physical += 1;
          dispatched.push({ output: request.settings.effective.maxOutputTokens, routing: request.providerRouting?.only, required: request.transportEnvelope?.requestedCompletionAllowance });
          return physical === 1
            ? { content: "", reasoningContent: "thinking", finishReason: "length", usage: {} }
            : { content: "complete", finishReason: "stop", usage: {} };
        },
      }),
    });
    expect(result.attempt).toBe(1);
    expect(dispatched[0]).toMatchObject({ output: 8192, required: 8192 });
    expect(dispatched[1]).toMatchObject({ output: 16384, required: 16384, routing: ["large-route"] });
    // Endpoint metadata stay fresh-cached between the two analytical attempts.
    // Recovery reclassifies the cached snapshot for the larger budget; it must
    // not require a second discovery network call.
    expect(endpointDiscovery).toHaveBeenCalledTimes(1);
  });

  it("routes learning-object recovery capacity+16384 past model-level capacity+8192", async () => {
    const learningModel = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 10240 } };
    const config: ProviderConfig = { id: "pc-learning-routing", provider: "openrouter", label: "OR", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const endpointDiscovery = vi.fn(async () => ({ data: { endpoints: [
      { tag: "small-route", context_length: 65536, max_completion_tokens: 10240 },
      { tag: "large-route", context_length: 131072, max_completion_tokens: 32768 },
    ] } }));
    const outputs: number[] = [];
    const routed: Array<string[] | undefined> = [];
    let physical = 0;
    await callWithAnalyticalOutputRecovery({
      model: learningModel,
      messages: [{ role: "user", content: "Frozen Field Guide packet" }],
      operationKind: "field_guide_update",
      learningObjectCapacityTokens: 2048,
      allowOpenRouterEndpointRecoveryEscalation: true,
      call: (settings, attempt) => executeProviderChat({
        config,
        modelId: learningModel.modelId,
        messages: [{ role: "user", content: "Frozen Field Guide packet" }],
        settings,
        operationKind: "field_guide_update",
        endpointDiscovery,
        attempt: async (request) => {
          physical += 1;
          outputs.push(request.transportEnvelope?.requestedCompletionAllowance ?? 0);
          routed.push(request.providerRouting?.only);
          return physical === 1
            ? { content: "partial", finishReason: "length", usage: {} }
            : { content: '{"decision":"NO_CHANGE"}', finishReason: "stop", usage: {} };
        },
      }),
    });
    expect(outputs).toEqual([10240, 18432]);
    expect(routed[1]).toEqual(["large-route"]);
  });

  it("preserves the existing UNKNOWN one-attempt policy for OpenRouter analytical recovery", async () => {
    const limitedModel = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    const config: ProviderConfig = { id: "pc-unknown-fit", provider: "openrouter", label: "OR", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const endpointDiscovery = vi.fn(async () => ({ data: { endpoints: [
      { tag: "unknown-route", provider_name: "Unknown Capacity Provider" },
    ] } }));
    const dispatchedBudgets: number[] = [];
    let physical = 0;
    const result = await callWithAnalyticalOutputRecovery({
      model: limitedModel,
      messages: [{ role: "user", content: "Review" }],
      operationKind: "post_reveal_viewer",
      allowOpenRouterEndpointRecoveryEscalation: true,
      call: (settings) => executeProviderChat({
        config,
        modelId: limitedModel.modelId,
        messages: [{ role: "user", content: "Review" }],
        settings,
        operationKind: "post_reveal_viewer",
        endpointDiscovery,
        attempt: async (request) => {
          physical += 1;
          dispatchedBudgets.push(request.settings.effective.maxOutputTokens ?? 0);
          return physical === 1
            ? { content: "", reasoningContent: "thinking", finishReason: "length", usage: {} }
            : { content: "complete", finishReason: "stop", usage: {} };
        },
      }),
    });
    expect(result.attempt).toBe(1);
    expect(physical).toBe(2);
    expect(dispatchedBudgets).toEqual([8192, 16384]);
    expect(endpointDiscovery).toHaveBeenCalledTimes(1);
  });

  it("still local-stops analytical recovery when every allowed OpenRouter endpoint is PROVEN_NO", async () => {
    const limitedModel = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 8192 } };
    const config: ProviderConfig = { id: "pc-all-proven-no", provider: "openrouter", label: "OR", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const endpointDiscovery = vi.fn(async () => ({ data: { endpoints: [
      { tag: "small-route", context_length: 65536, max_completion_tokens: 8192 },
    ] } }));
    const dispatchedBudgets: number[] = [];
    let physical = 0;
    await expect(callWithAnalyticalOutputRecovery({
      model: limitedModel,
      messages: [{ role: "user", content: "Review" }],
      operationKind: "post_reveal_viewer",
      allowOpenRouterEndpointRecoveryEscalation: true,
      call: (settings) => executeProviderChat({
        config,
        modelId: limitedModel.modelId,
        messages: [{ role: "user", content: "Review" }],
        settings,
        operationKind: "post_reveal_viewer",
        endpointDiscovery,
        attempt: async (request) => {
          physical += 1;
          dispatchedBudgets.push(request.settings.effective.maxOutputTokens ?? 0);
          return { content: "", reasoningContent: "thinking", finishReason: "length", usage: {} };
        },
      }),
    })).rejects.toMatchObject({ name: "ProviderCallError", details: { code: "configuration", phase: "before_dispatch" } });
    expect(physical).toBe(1);
    expect(dispatchedBudgets).toEqual([8192]);
    expect(endpointDiscovery).toHaveBeenCalledTimes(1);
  });

  it("keeps all three recovery operation profiles on capacity-protected routing", () => {
    for (const operationKind of ["post_reveal_viewer", "field_guide_update", "viewer_notes_reflection"] as const) {
      const profile = getOperationResourceProfile(operationKind);
      expect(profile.retryClass).toBe("analytical_output_recovery");
      expect(profile.capacityRoutingPolicy).toBe("prefer_verified_fit");
    }
  });

  it("stops after the single semantic recovery when the second learning-object response is still incomplete", async () => {
    const call = vi.fn().mockResolvedValue({ content: '{"partial":true}', finishReason: "length", usage: {} });
    await expect(callWithAnalyticalOutputRecovery({
      model,
      messages: [{ role: "user", content: "Reflect" }],
      operationKind: "viewer_notes_reflection",
      learningObjectCapacityTokens: 1024,
      call,
    })).rejects.toThrow(/incomplete assistant response/);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("protects the context window and refuses an unusably small remainder", () => {
    const smallContext = { ...model, capabilities: { ...model.capabilities, contextTokens: 1300 } };
    expect(() => analyticalOutputBudget({ model: smallContext, messages: [{ role: "user", content: "x".repeat(1400) }], operationKind: "judge", attempt: 0 }))
      .toThrow(/available context/);
  });
});
