import { describe, expect, it } from "vitest";
import { isRetryableProviderError, providerRetryDelayMs } from "./retry";

describe("provider retry policy", () => {
  it("automatically retries only explicit not-yet-processed and throttling responses", () => {
    expect(isRetryableProviderError(new Error("network connection reset"))).toBe(false);
    expect(isRetryableProviderError(new Error("provider request failed (429): rate limit"))).toBe(true);
    expect(isRetryableProviderError(new Error("provider request failed (425): too early"))).toBe(true);
    expect(isRetryableProviderError(new Error("provider request failed (503): unavailable"))).toBe(false);
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
