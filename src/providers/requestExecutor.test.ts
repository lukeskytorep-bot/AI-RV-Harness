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
