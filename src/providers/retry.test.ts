import { describe, expect, it } from "vitest";
import { isRetryableProviderError, providerRetryAllowance, providerRetryCategory, providerRetryDelayMs, shouldRetryProviderError } from "./retry";

describe("provider retry policy", () => {
  it("automatically retries only explicit not-yet-processed and throttling responses", () => {
    expect(isRetryableProviderError(new Error("network connection reset"))).toBe(true);
    expect(isRetryableProviderError(new Error("provider request failed (429): rate limit"))).toBe(true);
    expect(isRetryableProviderError(new Error("provider request failed (425): too early"))).toBe(true);
    expect(isRetryableProviderError(new Error("provider request failed (503): unavailable"))).toBe(true);
  });

  it("limits ambiguous transport recovery to one retry", () => {
    const error = new Error("error decoding response body");
    expect(providerRetryCategory(error)).toBe("single_recovery");
    expect(providerRetryAllowance(error, 5)).toBe(1);
    expect(shouldRetryProviderError(error, 0, 5)).toBe(true);
    expect(shouldRetryProviderError(error, 1, 5)).toBe(false);
    expect(providerRetryCategory(new Error("provider returned reasoning without a final assistant response [finish-reason=length]"))).toBe("single_recovery");
    expect(providerRetryCategory(new Error("provider returned an incomplete assistant response [finish-reason=max_tokens]"))).toBe("single_recovery");
  });

  it("retries transient gateway statuses according to the configured count", () => {
    const error = new Error("provider request failed (504): gateway timeout");
    expect(providerRetryAllowance(error, 3)).toBe(3);
    expect(shouldRetryProviderError(error, 2, 3)).toBe(true);
    expect(shouldRetryProviderError(error, 3, 3)).toBe(false);
    expect(providerRetryAllowance(new Error("provider error payload code=503 type=upstream_unavailable: try again"), 2)).toBe(2);
  });

  it("does not retry safety, configuration, or credential failures", () => {
    for (const message of ["content_filter", "context length exceeded", "invalid model id", "API key invalid", "provider request failed (401): unauthorized"]) {
      expect(providerRetryCategory(new Error(message))).toBe("never");
      expect(providerRetryAllowance(new Error(message), 5)).toBe(0);
    }
  });

  it("does not retry permanent authentication and request errors", () => {
    expect(isRetryableProviderError(new Error("provider request failed (401): unauthorized"))).toBe(false);
    expect(isRetryableProviderError(new Error("invalid model id"))).toBe(false);
  });

  it("uses bounded exponential backoff", () => {
    expect([0, 1, 2, 8].map(providerRetryDelayMs)).toEqual([150, 300, 600, 2000]);
    expect(providerRetryDelayMs(0, new Error("provider request failed (429) [retry-after-ms=4500]: wait"))).toBe(4500);
    expect(providerRetryDelayMs(0, new Error("provider request failed (429) [retry-after-ms=999999]: wait"))).toBe(30_000);
  });
});
