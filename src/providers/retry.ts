export type ProviderRetryCategory = "standard" | "single_recovery" | "never";

export function providerRetryCategory(cause: unknown): ProviderRetryCategory {
  if (cause instanceof DOMException && cause.name === "AbortError") return "never";
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  const status = message.match(/\((\d{3})\)/)?.[1];
  if (status) {
    const code = Number(status);
    if ([425, 429, 502, 503, 504].includes(code)) return "standard";
    return "never";
  }
  const payloadCode = Number(message.match(/\bcode=(\d{3})\b/)?.[1]);
  if (Number.isFinite(payloadCode)) return [425, 429, 502, 503, 504].includes(payloadCode) ? "standard" : "never";
  if (/content[_ -]?filter|safety|blocked|block reason|prompt feedback|context length|context window|maximum context|invalid model|model not found|unauthorized|forbidden|api key|credential|permission|route mismatch|cancelled|canceled|user stop|cost limit/.test(message)) return "never";
  if (/decod(?:e|ing).*response body|response body.*(?:incomplete|closed|read)|invalid json|empty (?:assistant|provider) response|reasoning without a final assistant response|incomplete assistant response|timed? out|timeout|connection reset|connection closed|unexpected eof|network error|error sending request|connect error|dns error|temporarily unavailable|overloaded/.test(message)) return "single_recovery";
  return "never";
}

export function providerRetryAllowance(cause: unknown, configuredRetries: number): number {
  const configured = Math.max(0, Math.min(Math.floor(configuredRetries), 5));
  if (configured === 0) return 0;
  const category = providerRetryCategory(cause);
  return category === "standard" ? configured : category === "single_recovery" ? 1 : 0;
}

export function shouldRetryProviderError(cause: unknown, failedAttempt: number, configuredRetries: number): boolean {
  return failedAttempt < providerRetryAllowance(cause, configuredRetries);
}

export function isRetryableProviderError(cause: unknown): boolean {
  return providerRetryCategory(cause) !== "never";
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
