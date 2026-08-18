import type { ProviderUsage } from "../providers/types";

export interface SessionRequestMetrics {
  requestCount: number;
  requestDurationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface SessionRunMetrics extends SessionRequestMetrics {
  sessionDurationMs: number;
}

export function emptySessionRequestMetrics(): SessionRequestMetrics {
  return { requestCount: 0, requestDurationMs: 0 };
}

export function recordProviderRequest(current: SessionRequestMetrics, usage: ProviderUsage | undefined, durationMs: number): SessionRequestMetrics {
  const next: SessionRequestMetrics = {
    ...current,
    requestCount: current.requestCount + 1,
    requestDurationMs: current.requestDurationMs + Math.max(0, Math.round(durationMs)),
  };
  addOptional(next, current, usage, "inputTokens");
  addOptional(next, current, usage, "outputTokens");
  addOptional(next, current, usage, "reasoningTokens");
  addOptional(next, current, usage, "totalTokens");
  addOptional(next, current, usage, "costUsd");
  return next;
}

export function snapshotSessionMetrics(current: SessionRequestMetrics, startedAtMs: number, nowMs = Date.now()): SessionRunMetrics {
  return { ...current, sessionDurationMs: Math.max(0, Math.round(nowMs - startedAtMs)) };
}

function addOptional(
  target: SessionRequestMetrics,
  current: SessionRequestMetrics,
  usage: ProviderUsage | undefined,
  key: "inputTokens" | "outputTokens" | "reasoningTokens" | "totalTokens" | "costUsd",
): void {
  const value = usage?.[key];
  if (value === undefined || !Number.isFinite(value)) return;
  target[key] = (current[key] ?? 0) + value;
}
