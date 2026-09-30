import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOpenRouterEndpointCapabilityCache } from "./openRouterEndpointCapability";
import { estimateProviderInputTokens } from "./inputTokenEstimate";
import { resolveEffectiveRequestEnvelope } from "./effectiveRequestEnvelope";
import type { ProviderConfig, ProviderMessage } from "./types";

const openrouter: ProviderConfig = {
  id: "pc-i1",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "cred",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const openai: ProviderConfig = { ...openrouter, id: "pc-openai", provider: "openai" };
const settings = (maxOutputTokens = 4096) => ({
  requested: { maxOutputTokens },
  effective: { maxOutputTokens },
  omitted: [] as [],
});

beforeEach(() => clearOpenRouterEndpointCapabilityCache());

describe("I1 effective request envelope", () => {
  it("keeps a small Conversation on ordinary routing while resolving S1/S2/ORP1 in one envelope", async () => {
    const discover = vi.fn();
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "hello" }],
      settings: settings(),
      operationKind: "conversation",
      streamWorkflowContext: "conversation",
      endpointDiscovery: discover,
      timeoutMs: 120_000,
    });

    expect(discover).not.toHaveBeenCalled();
    expect(result.envelope).toMatchObject({
      operationKind: "conversation",
      capacityRoutingPolicy: "default_auto",
      routeCertainty: "not_required",
      streamingMode: "streaming",
      timeoutClass: "interactive",
      retryClass: "configured_transport",
      presentationMode: "live",
      eligibleProviderRoutes: [],
      unknownProviderRoutes: [],
    });
    expect(result.timeoutPolicy.timeoutClass).toBe("interactive");
    expect(result.providerRouting).toBeUndefined();
  });

  it("uses the complete continuation-bearing logical payload for sizing before endpoint routing", async () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: "visible",
        continuationState: {
          schemaVersion: 1,
          transport: "openrouter",
          format: "openrouter-reasoning-details",
          replayFingerprint: {
            transport: "openrouter",
            normalizedEndpoint: "https://openrouter.ai/api/v1",
            providerConfigId: "pc-i1",
            credentialId: "cred",
            requestedModelId: "qwen/qwen3-32b",
            stateFormat: "openrouter-reasoning-details",
            stateFormatVersion: 1,
          },
          reasoningDetails: [{ type: "reasoning.text", text: "hidden", signature: "sig", id: "r1", format: "openai-responses-v1" }],
        },
      },
    ];
    const expected = estimateProviderInputTokens(messages).estimatedInputTokens;
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages,
      settings: settings(),
      operationKind: "conversation",
      streamWorkflowContext: "conversation",
      endpointDiscovery: vi.fn(),
    });
    expect(result.envelope.estimatedInputTokens).toBe(expected);
    expect(expected).toBeGreaterThan(estimateProviderInputTokens([{ role: "user", content: "question" }, { role: "assistant", content: "visible" }]).estimatedInputTokens);
  });

  it("combines Judge capacity protection, verified endpoint routing, long timeout and structured-final presentation", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "reasoning/model",
      messages: [{ role: "user", content: "x".repeat(80_000) }],
      settings: settings(16_384),
      operationKind: "judge",
      streamWorkflowContext: "rv_session",
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "small", context_length: 40_960, max_completion_tokens: 16_384 },
        { tag: "large", context_length: 131_072, max_completion_tokens: 32_768 },
      ] } }),
      timeoutMs: 120_000,
    });

    expect(result.providerRouting).toEqual({ only: ["large"], allowFallbacks: true });
    expect(result.envelope).toMatchObject({
      operationKind: "judge",
      capacityRoutingPolicy: "prefer_verified_fit",
      eligibleProviderRoutes: ["large"],
      routeCertainty: "verified_fit",
      streamingMode: "streaming",
      timeoutClass: "long_reasoning",
      retryClass: "analytical_output_recovery",
      presentationMode: "structured-final",
    });
    expect(result.timeoutPolicy.timeoutClass).toBe("long_reasoning");
  });

  it("keeps Research Judge hidden while preserving the same resource and capacity decisions", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "reasoning/model",
      messages: [{ role: "user", content: "judge" }],
      settings: settings(16_384),
      operationKind: "judge",
      streamWorkflowContext: "research",
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "large", context_length: 131_072, max_completion_tokens: 32_768 },
      ] } }),
    });
    expect(result.envelope.presentationMode).toBe("hidden");
    expect(result.envelope.timeoutClass).toBe("long_reasoning");
    expect(result.envelope.capacityRoutingPolicy).toBe("prefer_verified_fit");
  });

  it("reports only routes still eligible after existing provider restrictions are intersected", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { only: ["provider-a"], allowFallbacks: false },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a/region-1", context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "provider-b", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.envelope.eligibleProviderRoutes).toEqual(["provider-a/region-1"]);
    expect(result.providerRouting?.only).toEqual(["provider-a"]);
    expect(result.providerRouting?.allowFallbacks).toBe(false);
  });

  it("represents UNKNOWN fallback without converting it to a rejection", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "conversation",
      streamWorkflowContext: "conversation",
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "known-small", context_length: 40_960, max_completion_tokens: 8192 },
        { tag: "unknown-route", provider_name: "Provider X" },
      ] } }),
    });
    expect(result.endpointRoutingMode).toBe("unknown_attempt");
    expect(result.envelope.routeCertainty).toBe("unknown");
    expect(result.envelope.unknownProviderRoutes).toEqual(["unknown-route"]);
    expect(result.providerRouting).toEqual({ ignore: ["known-small"], allowFallbacks: true });
    expect(result.localStopMessage).toBeUndefined();
  });

  it("returns a blocked envelope instead of dispatch parameters when every route is PROVEN_NO", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(16_384),
      operationKind: "judge",
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "small-a", context_length: 40_960, max_completion_tokens: 8192 },
        { tag: "small-b", context_length: 49_152, max_completion_tokens: 8192 },
      ] } }),
    });
    expect(result.endpointRoutingMode).toBe("local_stop");
    expect(result.envelope.routeCertainty).toBe("blocked");
    expect(result.localStopMessage).toContain("larger context window");
  });

  it("stays neutral for non-OpenRouter transports while resolving the same ORP1/S2/S1 metadata", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openai,
      modelId: "gpt-compatible",
      messages: [{ role: "user", content: "hello" }],
      settings: settings(),
      operationKind: "manual_rv_viewer",
      streamWorkflowContext: "manual_rv",
      timeoutMs: 120_000,
    });
    expect(result.envelope).toMatchObject({
      operationKind: "manual_rv_viewer",
      routeCertainty: "not_applicable",
      streamingMode: "non_streaming",
      timeoutClass: "interactive",
      presentationMode: "live",
    });
    expect(result.endpointRoutingMode).toBeUndefined();
    expect(result.providerRouting).toBeUndefined();
  });

  it("treats hard order without fallbacks as the final allowed provider set", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { order: ["provider-a"], allowFallbacks: false },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a/region-1", context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "provider-b", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.envelope.eligibleProviderRoutes).toEqual(["provider-a/region-1"]);
    expect(result.envelope.routeCertainty).toBe("verified_fit");
    expect(result.providerRouting?.order).toEqual(["provider-a"]);
    expect(result.providerRouting?.allowFallbacks).toBe(false);
  });

  it("keeps a hard-selected provider absent from discovery as UNKNOWN for one attempt", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { order: ["provider-z"], allowFallbacks: false },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a", context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "provider-b", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.endpointRoutingMode).toBe("unknown_attempt");
    expect(result.envelope.routeCertainty).toBe("unknown");
    expect(result.envelope.eligibleProviderRoutes).toEqual([]);
    expect(result.envelope.unknownProviderRoutes).toEqual(["provider-z"]);
    expect(result.providerRouting).toMatchObject({ order: ["provider-z"], allowFallbacks: false });
    expect(result.localStopMessage).toBeUndefined();
  });

  it("matches a hard base-provider selector to a discovered endpoint variant", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { order: ["provider-a"], allowFallbacks: false },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a/region-1", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.envelope.eligibleProviderRoutes).toEqual(["provider-a/region-1"]);
    expect(result.envelope.routeCertainty).toBe("verified_fit");
  });

  it("honors a full endpoint slug in a hard order", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { order: ["provider-a/region-1"], allowFallbacks: false },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a/region-1", context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "provider-a/region-2", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.envelope.eligibleProviderRoutes).toEqual(["provider-a/region-1"]);
  });

  it("local-stops when the only hard-order route is PROVEN_NO", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(16_384),
      operationKind: "judge",
      providerRouting: { order: ["provider-a"], allowFallbacks: false },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a", context_length: 40_960, max_completion_tokens: 8192 },
        { tag: "provider-b", context_length: 131_072, max_completion_tokens: 32_768 },
      ] } }),
    });
    expect(result.endpointRoutingMode).toBe("local_stop");
    expect(result.envelope.routeCertainty).toBe("blocked");
    expect(result.envelope.eligibleProviderRoutes).toEqual([]);
    expect(result.localStopMessage).toBeTruthy();
  });

  it("does not remain verified_fit when ignore removes every discovered fitting route", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { ignore: ["provider-a", "provider-b"] },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a", context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "provider-b", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.endpointRoutingMode).toBe("local_stop");
    expect(result.envelope.routeCertainty).toBe("blocked");
    expect(result.envelope.eligibleProviderRoutes).toEqual([]);
  });

  it("treats order as preference when fallbacks remain enabled", async () => {
    const result = await resolveEffectiveRequestEnvelope({
      config: openrouter,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "x".repeat(100_000) }],
      settings: settings(8192),
      operationKind: "judge",
      providerRouting: { order: ["provider-a"], allowFallbacks: true },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "provider-a/region-1", context_length: 131_072, max_completion_tokens: 16_384 },
        { tag: "provider-b", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
    });
    expect(result.envelope.eligibleProviderRoutes).toEqual(["provider-a/region-1", "provider-b"]);
    expect(result.envelope.routeCertainty).toBe("verified_fit");
  });

});
