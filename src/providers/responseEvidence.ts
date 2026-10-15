import type { ProviderUsage } from "./types";

export interface ProviderResponseEvidence {
  version: 1;
  transportOutcome: "response_finished";
  boundary: "body_read" | "sse_done";
  finishReason?: string;
  providerRequestId?: string;
  generationId?: string;
  usage?: ProviderUsage;
}
export type ProviderDispatchOutcome = "not_dispatched" | "response_finished" | "dispatch_unknown";
export interface ProviderAttemptOutcome {
  attemptId: string;
  logicalRequestId: string;
  physicalAttempt: number;
  transportRequestId?: string;
  outcome: ProviderDispatchOutcome;
  validation: "accepted" | "rejected" | "not_evaluated";
  responseEvidence?: ProviderResponseEvidence;
}

/** Whitelist IPC metadata. Never copy response text, reasoning or arbitrary fields. */
export function parseProviderResponseEvidence(value: unknown): ProviderResponseEvidence | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.transportOutcome !== "response_finished" || !["body_read", "sse_done"].includes(String(v.boundary))) return undefined;
  const evidence: ProviderResponseEvidence = { version: 1, transportOutcome: "response_finished", boundary: v.boundary as ProviderResponseEvidence["boundary"] };
  for (const key of ["finishReason", "providerRequestId", "generationId"] as const) {
    if (typeof v[key] === "string" && v[key].length <= 512) evidence[key] = v[key];
  }
  if (v.usage && typeof v.usage === "object") {
    const source = v.usage as Record<string, unknown>, usage: ProviderUsage = {};
    for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "totalTokens", "costUsd"] as const) {
      const number = source[key];
      if (typeof number === "number" && Number.isFinite(number) && number >= 0 && (key === "costUsd" || Number.isSafeInteger(number))) usage[key] = number;
    }
    if (Object.keys(usage).length) evidence.usage = usage;
  }
  return evidence;
}

/** Completion is never inferred from finish_reason, HTTP status, tokens or phase. */
export function classifyProviderAttempt(details?: { phase?: string; responseEvidence?: unknown }): ProviderDispatchOutcome {
  if (details?.phase === "before_dispatch") return "not_dispatched";
  return parseProviderResponseEvidence(details?.responseEvidence) ? "response_finished" : "dispatch_unknown";
}

/** Preserve any earlier ambiguous physical attempt, including across repair requests. */
export function classifyProviderAttempts(attempts: readonly ProviderAttemptOutcome[]): ProviderDispatchOutcome {
  if (!attempts.length || attempts.some(a => a.outcome === "dispatch_unknown")) return "dispatch_unknown";
  return attempts.some(a => a.outcome === "response_finished") ? "response_finished" : "not_dispatched";
}
