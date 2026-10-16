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

/** Read executor reports through wrappers, including cancellation and repair errors. */
export function providerAttemptOutcomes(cause: unknown): ProviderAttemptOutcome[] {
  const seen = new Set<object>();
  const visit = (value: unknown): ProviderAttemptOutcome[] => {
    if (!value || typeof value !== "object" || seen.has(value)) return [];
    seen.add(value);
    const v = value as Record<string, unknown>;
    const report = v.report && typeof v.report === "object" ? v.report as Record<string, unknown> : undefined;
    const execution = v.execution && typeof v.execution === "object" ? v.execution as Record<string, unknown> : undefined;
    const details = v.details && typeof v.details === "object" ? v.details as Record<string, unknown> : undefined;
    const records = v.providerAttemptOutcomes ?? report?.attemptOutcomes ?? execution?.attemptOutcomes
      ?? (details && typeof details.attemptId === "string" ? [{ ...details, outcome: classifyProviderAttempt(details), validation: details.responseEvidence ? "rejected" : "not_evaluated" }] : undefined);
    if (Array.isArray(records) && records.length) return records.map(record => {
      const a = record && typeof record === "object" ? record as Record<string, unknown> : {};
      const evidence = parseProviderResponseEvidence(a.responseEvidence);
      return {
        attemptId: String(a.attemptId ?? ""), logicalRequestId: String(a.logicalRequestId ?? ""), physicalAttempt: Number(a.physicalAttempt),
        ...(typeof a.transportRequestId === "string" ? { transportRequestId: a.transportRequestId } : {}),
        // A persisted label alone is not proof that the whole response was read.
        outcome: a.outcome === "not_dispatched" ? "not_dispatched" : evidence ? "response_finished" : "dispatch_unknown",
        validation: a.validation === "accepted" || a.validation === "rejected" ? a.validation : "not_evaluated",
        ...(evidence ? { responseEvidence: evidence } : {}),
      };
    });
    for (const nested of [v.causeError, v.cause, v.providerResponse]) {
      const outcomes = visit(nested);
      if (outcomes.length) return outcomes;
    }
    return [];
  };
  return visit(cause);
}

/** A later completed response never closes an earlier ambiguous physical call. */
export function classifyProviderFailure(cause: unknown): ProviderDispatchOutcome {
  const attempts = providerAttemptOutcomes(cause);
  if (attempts.length) return classifyProviderAttempts(attempts);
  const seen = new Set<object>();
  const visit = (value: unknown): ProviderDispatchOutcome => {
    if (!value || typeof value !== "object" || seen.has(value)) return "dispatch_unknown";
    seen.add(value);
    const v = value as Record<string, unknown>;
    const details = v.details && typeof v.details === "object" ? v.details as Record<string, unknown> : v;
    if (typeof details.phase === "string" || details.responseEvidence) return classifyProviderAttempt(details);
    for (const nested of [v.causeError, v.cause, v.providerResponse]) {
      const outcome = visit(nested);
      if (outcome !== "dispatch_unknown") return outcome;
    }
    return "dispatch_unknown";
  };
  return visit(cause);
}
