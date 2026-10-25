import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCallError } from "./providerError";
import { clearOpenRouterEndpointCapabilityCache } from "./openRouterEndpointCapability";
import { createProviderChatExecutor, executeProviderChat, executeProviderRequest, ProviderExecutionError } from "./requestExecutor";

const failure = (code: ConstructorParameters<typeof ProviderCallError>[0]["code"], extras: Partial<ConstructorParameters<typeof ProviderCallError>[0]> = {}) =>
  new ProviderCallError({ code, message: code, phase: "reading_body", ...extras });

describe("provider request executor", () => {
  it("recovers once from an ambiguous body decode and never multiplies the configured retry count", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(failure("response_body_decode"))
      .mockResolvedValueOnce("ok");
    const result = await executeProviderRequest({
      operationId: "test.body-decode",
      configuredRetries: 5,
      executeAttempt: attempt,
      sleep: async () => undefined,
    });
    expect(result.value).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(result.report).toMatchObject({ physicalAttempts: 2, recoveredFrom: "response_body_decode", ambiguousBillingAttempts: 1 });
  });

  it("uses all configured transient-service retries", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(failure("http_status", { httpStatus: 503 }))
      .mockRejectedValueOnce(failure("http_status", { httpStatus: 503 }))
      .mockResolvedValueOnce("ok");
    const result = await executeProviderRequest({
      operationId: "test.503",
      configuredRetries: 2,
      executeAttempt: attempt,
      sleep: async () => undefined,
    });
    expect(result.value).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("does not perform a transport retry after a semantic assistant response has already been returned", async () => {
    const attempt = vi.fn().mockResolvedValue({
      content: "Partial but already-delivered semantic response.",
      finishReason: "length",
      usage: {},
    });
    const response = await executeProviderChat({
      config: { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages: [{ role: "user", content: "test" }],
      settings: { requested: {}, effective: {}, omitted: [] },
      configuredRetries: 5,
      attempt,
    });
    expect(response.content).toContain("already-delivered semantic response");
    expect(response.finishReason).toBe("length");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not retry a physical streaming failure after semantic output started", async () => {
    const attempt = vi.fn().mockRejectedValue(failure("timeout", { semanticOutputStarted: true }));
    await expect(executeProviderRequest({
      operationId: "test.stream-semantic-timeout",
      configuredRetries: 5,
      executeAttempt: attempt,
      sleep: async () => undefined,
    })).rejects.toMatchObject({ name: "ProviderExecutionError", report: { physicalAttempts: 1 } });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("performs exactly one call when retries are disabled or the error is permanent", async () => {
    const disabled = vi.fn().mockRejectedValue(failure("connect"));
    await expect(executeProviderRequest({ operationId: "test.off", configuredRetries: 0, executeAttempt: disabled, sleep: async () => undefined })).rejects.toBeInstanceOf(ProviderExecutionError);
    expect(disabled).toHaveBeenCalledTimes(1);

    const permanent = vi.fn().mockRejectedValue(failure("http_status", { httpStatus: 401 }));
    await expect(executeProviderRequest({ operationId: "test.401", configuredRetries: 5, executeAttempt: permanent, sleep: async () => undefined })).rejects.toBeInstanceOf(ProviderExecutionError);
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After and stops before dispatch when cancelled during backoff", async () => {
    const controller = new AbortController();
    const attempt = vi.fn().mockRejectedValue(failure("http_status", { httpStatus: 429, retryAfterMs: 4_500 }));
    const sleep = vi.fn(async (_milliseconds: number) => {
      controller.abort();
      throw new DOMException("Provider request cancelled", "AbortError");
    });
    await expect(executeProviderRequest({ operationId: "test.cancel", configuredRetries: 2, signal: controller.signal, executeAttempt: attempt, sleep })).rejects.toMatchObject({ name: "AbortError" });
    expect(sleep).toHaveBeenCalledWith(4_500, controller.signal);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("cancels an active physical attempt without dispatching a retry", async () => {
    const controller = new AbortController();
    const attempt = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Provider request cancelled", "AbortError");
    });
    await expect(executeProviderRequest({ operationId: "test.active-cancel", configuredRetries: 5, signal: controller.signal, executeAttempt: attempt })).rejects.toMatchObject({ name: "AbortError" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("resolves one immutable I1 transport envelope and reuses it across physical retries", async () => {
    const envelopes: unknown[] = [];
    const attempt = vi.fn(async (request) => {
      envelopes.push(structuredClone(request.transportEnvelope));
      if (request.transportEnvelope) request.transportEnvelope.presentationMode = "hidden";
      if (envelopes.length === 1) throw failure("http_status", { httpStatus: 503 });
      return { content: "ok", usage: {} };
    });
    await executeProviderChat({
      config: { id: "pc-i1-envelope", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages: [{ role: "user", content: "test" }],
      settings: { requested: { maxOutputTokens: 4096 }, effective: { maxOutputTokens: 4096 }, omitted: [] },
      operationKind: "conversation",
      streamWorkflowContext: "conversation",
      configuredRetries: 1,
      endpointDiscovery: vi.fn(),
      attempt,
    });
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]).toEqual(envelopes[1]);
    expect(envelopes[0]).toMatchObject({
      operationKind: "conversation",
      modelId: "model",
      presentationMode: "live",
      streamingMode: "streaming",
      timeoutClass: "interactive",
      routeCertainty: "not_required",
    });
  });

  it("resolves ORP1 timeoutClass into one immutable S1 timeout policy per logical call", async () => {
    const policies: unknown[] = [];
    const attempt = vi.fn(async (request) => {
      policies.push(structuredClone(request.timeoutPolicy));
      if (policies.length === 1) throw failure("http_status", { httpStatus: 503 });
      return { content: "ok", usage: {} };
    });
    await executeProviderChat({
      config: { id: "pc-timeout", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages: [{ role: "user", content: "test" }],
      settings: { requested: {}, effective: {}, omitted: [] },
      timeoutMs: 120_000,
      operationKind: "judge",
      configuredRetries: 1,
      endpointDiscovery: async () => ({ data: { endpoints: [{ tag: "route", context_length: 131_072 }] } }),
      attempt,
    });
    expect(policies).toEqual([
      { timeoutClass: "long_reasoning", firstEventTimeoutMs: 300_000, idleTimeoutMs: 180_000, absoluteEmergencyTimeoutMs: 3_600_000, nonStreamingTimeoutMs: 300_000 },
      { timeoutClass: "long_reasoning", firstEventTimeoutMs: 300_000, idleTimeoutMs: 180_000, absoluteEmergencyTimeoutMs: 3_600_000, nonStreamingTimeoutMs: 300_000 },
    ]);
  });

  it("sends an identical immutable payload on every physical retry", async () => {
    const messages = [{ role: "user" as const, content: "original" }];
    const settings = { requested: { maxOutputTokens: 64 }, effective: { maxOutputTokens: 64 }, omitted: [] as [] };
    const payloads: string[] = [];
    const attempt = vi.fn(async (request) => {
      payloads.push(JSON.stringify({ messages: request.messages, settings: request.settings }));
      request.messages[0].content = "attempt mutation";
      request.settings.effective.maxOutputTokens = 999;
      if (payloads.length === 1) throw failure("http_status", { httpStatus: 503 });
      return { content: "ok", usage: {} };
    });
    const promise = executeProviderChat({
      config: { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages,
      settings,
      configuredRetries: 1,
      attempt,
    });
    messages[0].content = "caller mutation";
    const response = await promise;
    expect(response.content).toBe("ok");
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toBe(payloads[1]);
    expect(payloads[0]).toContain("original");
    expect(payloads[0]).not.toContain("999");
  });


  it("deep-clones continuation state so physical retries replay byte-equivalent provider state", async () => {
    const messages = [{
      id: "a1",
      role: "assistant" as const,
      content: "visible",
      continuationState: {
        schemaVersion: 1 as const,
        transport: "openrouter" as const,
        format: "openrouter-reasoning-details" as const,
        replayFingerprint: {
          transport: "openrouter" as const,
          normalizedEndpoint: "https://openrouter.ai/api/v1",
          providerConfigId: "pc",
          credentialId: "c",
          requestedModelId: "model",
          stateFormat: "openrouter-reasoning-details",
          stateFormatVersion: 1,
        },
        reasoningDetails: [{ type: "reasoning.text" as const, text: "hidden", signature: "sig", id: "r1", format: "openai-responses-v1" as const }],
      },
    }];
    const payloads: string[] = [];
    const attempt = vi.fn(async (request) => {
      payloads.push(JSON.stringify(request.messages));
      const state = request.messages[0].continuationState;
      if (state?.transport === "openrouter") state.reasoningDetails[0].id = "mutated";
      if (payloads.length === 1) throw failure("http_status", { httpStatus: 503 });
      return { content: "ok", usage: {} };
    });
    await executeProviderChat({
      config: { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages,
      settings: { requested: {}, effective: {}, omitted: [] },
      configuredRetries: 1,
      attempt,
    });
    messages[0].continuationState.reasoningDetails[0].id = "caller-mutated";
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toBe(payloads[1]);
    expect(payloads[0]).toContain('"id":"r1"');
  });

  it("reports every failed physical attempt to the audit callback", async () => {
    const onAttemptFailure = vi.fn();
    const attempt = vi.fn().mockRejectedValue(failure("response_body_read"));
    await expect(executeProviderRequest({ operationId: "test.audit", configuredRetries: 5, executeAttempt: attempt, onAttemptFailure, sleep: async () => undefined })).rejects.toBeInstanceOf(ProviderExecutionError);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onAttemptFailure).toHaveBeenCalledTimes(2);
    expect(onAttemptFailure.mock.calls.map((call) => call[1].physicalAttempt)).toEqual([1, 2]);
  });

  it("rejects accidental executor nesting before making a provider call", async () => {
    const physical = vi.fn().mockResolvedValue({ content: "ok", usage: {} });
    const inner = createProviderChatExecutor({ attempt: physical });
    await expect(executeProviderChat({
      config: { id: "pc", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" },
      modelId: "model",
      messages: [{ role: "user", content: "test" }],
      settings: { requested: {}, effective: {}, omitted: [] },
      attempt: inner,
    })).rejects.toThrow("Nested provider retry executor");
    expect(physical).not.toHaveBeenCalled();
  });
});

describe("E1 OpenRouter endpoint-capability integration", () => {
  beforeEach(() => clearOpenRouterEndpointCapabilityCache());
  const config = { id: "pc-e1", provider: "openrouter" as const, label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
  const response = { content: "ok", usage: {} };
  const largeMessage = { role: "user" as const, content: "x".repeat(100_000) };

  it("does not discover or restrict endpoints for an ordinary small request", async () => {
    const endpointDiscovery = vi.fn();
    const attempt = vi.fn().mockResolvedValue(response);
    await executeProviderChat({
      config,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "small" }],
      settings: { requested: { maxOutputTokens: 4096 }, effective: { maxOutputTokens: 4096 }, omitted: [] },
      endpointDiscovery,
      attempt,
    });
    expect(endpointDiscovery).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0][0].providerRouting).toBeUndefined();
  });

  it("uses ORP1 prefer_verified_fit to request E1 capacity protection without duplicating routing logic", async () => {
    const attempt = vi.fn().mockResolvedValue(response);
    const endpointDiscovery = vi.fn(async () => ({ data: { endpoints: [
      { tag: "small-route", context_length: 6_000, max_completion_tokens: 4_096 },
      { tag: "large-route", context_length: 65_536, max_completion_tokens: 8_192 },
    ] } }));
    await executeProviderChat({
      config,
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "small but protected operation" }],
      settings: { requested: { maxOutputTokens: 4096 }, effective: { maxOutputTokens: 4096 }, omitted: [] },
      operationKind: "judge",
      endpointDiscovery,
      attempt,
    });
    expect(endpointDiscovery).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0][0].providerRouting).toEqual({ only: ["large-route"], allowFallbacks: true });
  });

  it("keeps ORP1 default_auto operations on ordinary routing when the request is small", async () => {
    const endpointDiscovery = vi.fn();
    const attempt = vi.fn().mockResolvedValue(response);
    await executeProviderChat({
      config: { ...config, id: "pc-e1-default-auto" },
      modelId: "qwen/qwen3-32b",
      messages: [{ role: "user", content: "small training turn" }],
      settings: { requested: { maxOutputTokens: 4096 }, effective: { maxOutputTokens: 4096 }, omitted: [] },
      operationKind: "training_blind_viewer",
      endpointDiscovery,
      attempt,
    });
    expect(endpointDiscovery).not.toHaveBeenCalled();
    expect(attempt.mock.calls[0][0].providerRouting).toBeUndefined();
  });

  it("routes a large request only through verified fitting endpoint tags", async () => {
    const attempt = vi.fn().mockResolvedValue(response);
    await executeProviderChat({
      config,
      modelId: "qwen/qwen3-32b",
      messages: [largeMessage],
      settings: { requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "deepinfra", context_length: 40_960, max_completion_tokens: 8_192 },
        { tag: "siliconflow", context_length: 131_072, max_completion_tokens: 16_384 },
      ] } }),
      attempt,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0][0].providerRouting).toEqual({ only: ["siliconflow"], allowFallbacks: true });
  });

  it("stops locally when every discovered route is proven too small", async () => {
    const attempt = vi.fn().mockResolvedValue(response);
    await expect(executeProviderChat({
      config,
      modelId: "qwen/qwen3-32b",
      messages: [largeMessage],
      settings: { requested: { maxOutputTokens: 16_384 }, effective: { maxOutputTokens: 16_384 }, omitted: [] },
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "small-a", context_length: 40_960, max_completion_tokens: 8_192 },
        { tag: "small-b", context_length: 49_152, max_completion_tokens: 8_192 },
      ] } }),
      attempt,
    })).rejects.toMatchObject({ name: "ProviderCallError", details: { code: "configuration", phase: "before_dispatch" } });
    expect(attempt).not.toHaveBeenCalled();
  });

  it("allows one UNKNOWN-capacity logical attempt and humanizes a real context rejection without blind retry", async () => {
    const attempt = vi.fn().mockRejectedValue(new ProviderCallError({
      code: "http_status",
      httpStatus: 400,
      phase: "awaiting_headers",
      message: "maximum context length exceeded for this provider",
    }));
    await expect(executeProviderChat({
      config,
      modelId: "qwen/qwen3-32b",
      messages: [largeMessage],
      settings: { requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] },
      configuredRetries: 5,
      endpointDiscovery: async () => ({ data: { endpoints: [
        { tag: "unknown-route", provider_name: "Provider X" },
      ] } }),
      attempt,
    })).rejects.toMatchObject({
      name: "ProviderExecutionError",
      causeError: { details: { message: expect.stringContaining("could not verify another route with enough capacity") } },
      report: { physicalAttempts: 1 },
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("falls through to one normal OpenRouter attempt when endpoint discovery is unavailable", async () => {
    const attempt = vi.fn().mockResolvedValue(response);
    await executeProviderChat({
      config: { ...config, id: "pc-e1-discovery-down" },
      modelId: "qwen/qwen3-32b",
      messages: [largeMessage],
      settings: { requested: { maxOutputTokens: 8192 }, effective: { maxOutputTokens: 8192 }, omitted: [] },
      endpointDiscovery: async () => { throw new Error("metadata unavailable"); },
      attempt,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0][0].providerRouting).toBeUndefined();
  });
});

describe("S2 stream presentation integration", () => {
  const config = { id: "pc-s2", provider: "openai" as const, label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
  const settings = { requested: {}, effective: {}, omitted: [] };
  const response = { content: "ok", usage: {} };

  it("forwards a live stream callback for visible Conversation work", async () => {
    const onStreamEvent = vi.fn();
    const attempt = vi.fn(async (request) => {
      expect(request.onStreamEvent).toBe(onStreamEvent);
      return response;
    });
    await executeProviderChat({
      config,
      modelId: "model",
      messages: [{ role: "user", content: "hello" }],
      settings,
      operationKind: "conversation",
      streamWorkflowContext: "conversation",
      onStreamEvent,
      attempt,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("suppresses callbacks for Research Judge even when a caller supplies one", async () => {
    const onStreamEvent = vi.fn();
    const attempt = vi.fn(async (request) => {
      expect(request.onStreamEvent).toBeUndefined();
      return response;
    });
    await executeProviderChat({
      config,
      modelId: "model",
      messages: [{ role: "user", content: "judge" }],
      settings,
      operationKind: "judge",
      streamWorkflowContext: "research",
      onStreamEvent,
      attempt,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("keeps RV Session Judge structured-final instead of forwarding provisional JSON", async () => {
    const onStreamEvent = vi.fn();
    const attempt = vi.fn(async (request) => {
      expect(request.onStreamEvent).toBeUndefined();
      return response;
    });
    await executeProviderChat({
      config,
      modelId: "model",
      messages: [{ role: "user", content: "judge" }],
      settings,
      operationKind: "judge",
      streamWorkflowContext: "rv_session",
      onStreamEvent,
      attempt,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
