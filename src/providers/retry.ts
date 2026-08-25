export function isRetryableProviderError(cause: unknown): boolean {
  if (cause instanceof DOMException && cause.name === "AbortError") return false;
  const message = cause instanceof Error ? cause.message : String(cause);
  const status = message.match(/\((\d{3})\)/)?.[1];
  if (status) {
    const code = Number(status);
    // 425/429 explicitly tell the client not to process the request yet. Other
    // transport/server failures are ambiguous and require an explicit user retry
    // so a paid generation cannot be duplicated silently.
    return code === 425 || code === 429;
  }
  return false;
}

export function providerRetryDelayMs(failedAttempt: number, cause?: unknown): number {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const retryAfter = Number(message.match(/\[retry-after-ms=(\d+)\]/)?.[1]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(30_000, retryAfter);
  return Math.min(2_000, 150 * 2 ** Math.max(0, failedAttempt));
}

export async function waitBeforeProviderRetry(failedAttempt: number, signal?: AbortSignal, cause?: unknown): Promise<void> {
  if (signal?.aborted) throw new DOMException("Provider request cancelled", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, providerRetryDelayMs(failedAttempt, cause));
    signal?.addEventListener("abort", () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Provider request cancelled", "AbortError"));
    }, { once: true });
  });
}
