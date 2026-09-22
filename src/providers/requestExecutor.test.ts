import { describe, expect, it, vi } from "vitest";
import { ProviderCallError } from "./providerError";
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
