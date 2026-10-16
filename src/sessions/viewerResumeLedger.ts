import { classifyProviderFailure, providerAttemptOutcomes } from "../providers/responseEvidence";
import type { ProviderMessage } from "../providers/types";
import type { SessionEventRecord } from "./types";

/** A conservative, read-only interpretation of durable Viewer output attempts.
 * This module never authorizes a provider dispatch by itself.
 */
export type ViewerResumeLedgerDecision =
  | { kind: "fresh" }
  | { kind: "authorized"; eventId: string; stepKey: string }
  | { kind: "finished_rejected"; eventId: string; stepKey: string }
  | { kind: "primary_limit"; eventId: string; stepKey: string; effectiveMaxOutputTokens: number; reason: "output_limit" | "repetition_runaway" }
  | { kind: "exhausted"; eventId: string; stepKey: string }
  | { kind: "uncertain"; eventId: string; stepKey: string; recoveryLevel: 0 | 1 }
  | { kind: "unsafe"; reason: string };

const viewerEvents = new Set(["VIEWER_RESPONSE", "VIEWER_SPECIAL_TASK_RESPONSE", "VIEWER_MONITOR_RESPONSE"]);
const limitReasons = new Set(["length", "max_tokens", "max_output_tokens", "max_completion_tokens"]);
const resumableIncompleteReasons = new Set(["output_limit", "repetition_runaway"]);

function normalizedReason(event: SessionEventRecord): string {
  return String(event.metadata?.finishReason ?? "").trim().toLowerCase().replace(/[ -]/g, "_");
}

/** Old events without an exact call identity must never be guessed into a resumed step. */
export function viewerEventStepKey(event: SessionEventRecord): string | undefined {
  const m = event.metadata;
  if (!m) return undefined;
  if (typeof m.stepId === "string" && m.stepId.trim()) return m.stepId;
  // Legacy coordinates are diagnostics only: phase does not distinguish repeated Monitor calls.
  return undefined;
}

function legacyStepKey(event: SessionEventRecord): string | undefined {
  const metadata = event.metadata ?? {};
  const locator = ["phase", "promptNumber", "step"].find((key) => typeof metadata[key] === "number");
  if (!locator) return undefined;
  const source = typeof metadata.source === "string"
    ? metadata.source
    : event.eventType === "VIEWER_SPECIAL_TASK_RESPONSE" ? "special_task"
      : event.eventType === "VIEWER_MONITOR_RESPONSE" ? "monitor_intervention" : "viewer";
  const exchange = typeof metadata.exchangeNumber === "number" ? `:${metadata.exchangeNumber}` : "";
  return `${locator}:${String(metadata[locator])}:${source}${exchange}`;
}

function legacyKeyForExactStep(stepKey: string): string | undefined {
  const match = stepKey.match(/^(?:rcp:phase|lite:prompt|custom:step|telepathic:step):(\d+):([^:]+)(?::exchange:(\d+))?/);
  if (!match) return undefined;
  const locator = stepKey.startsWith("rcp:phase") ? "phase" : stepKey.startsWith("lite:prompt") ? "promptNumber" : "step";
  return `${locator}:${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}`;
}

export function viewerRequestFingerprintInput(messages: ProviderMessage[]): string {
  return JSON.stringify(messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.images ? { images: message.images.map((image) => ({ ...image })) } : {}),
  })));
}

export function buildViewerStepId(scope: "rcp" | "lite" | "custom" | "telepathic", metadata: Record<string, unknown>): string {
  const pass = typeof metadata.passIndex === "number" ? `:pass:${metadata.passIndex}` : "";
  const source = typeof metadata.source === "string" ? metadata.source : "viewer";
  const exchange = typeof metadata.exchangeNumber === "number" ? `:exchange:${metadata.exchangeNumber}` : "";
  const question = typeof metadata.questionNumber === "number" ? `:question:${metadata.questionNumber}` : "";
  if (typeof metadata.phase === "number") return `${scope}:phase:${metadata.phase}:${source}${exchange}${question}${pass}`;
  if (typeof metadata.promptNumber === "number") return `${scope}:prompt:${metadata.promptNumber}:${source}${exchange}${question}${pass}`;
  if (typeof metadata.step === "number") return `${scope}:step:${metadata.step}:${source}${exchange}${question}${pass}`;
  throw new Error("Viewer output recovery requires an exact persisted step identity.");
}

export function inspectViewerResumeLedger(events: SessionEventRecord[], stepKey?: string, requestSha256?: string): ViewerResumeLedgerDecision {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const incomplete = sorted.filter((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || (viewerEvents.has(event.eventType) && limitReasons.has(normalizedReason(event))));
  const legacyStart = sorted.find(event => event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED" && !viewerEventStepKey(event)
    && !sorted.some(later => later.sequenceNumber > event.sequenceNumber && later.metadata?.attemptId === event.metadata?.attemptId
      && (viewerEvents.has(later.eventType) || later.eventType === "VIEWER_OUTPUT_ATTEMPT_NOT_DISPATCHED")));
  if (legacyStart) return { kind: "unsafe", reason: "A legacy unresolved Viewer dispatch lacks the exact step identity required for Resume." };
  if (!stepKey) return incomplete.length === 0 ? { kind: "fresh" } : { kind: "unsafe", reason: "Viewer Resume requires the exact current step identity." };
  const currentLegacyKey = legacyKeyForExactStep(stepKey);
  const legacyUnresolved = incomplete.find((event) => {
    if (viewerEventStepKey(event)) return false;
    const key = legacyStepKey(event);
    if (key && currentLegacyKey && key !== currentLegacyKey) return false;
    if (key && sorted.some((candidate) => candidate.sequenceNumber > event.sequenceNumber && viewerEvents.has(candidate.eventType) && candidate.content?.trim() && candidate.metadata?.accepted !== false && !limitReasons.has(normalizedReason(candidate)) && legacyStepKey(candidate) === key)) return false;
    return !key || key === currentLegacyKey;
  });
  if (legacyUnresolved) return { kind: "unsafe", reason: "A legacy unresolved Viewer attempt for this step has no exact step identity; automatic paid Resume is disabled for safety." };
  const relatedAll = sorted.filter((event) => viewerEventStepKey(event) === stepKey);
  if (requestSha256) {
    const mismatched = relatedAll.find((event) => typeof event.metadata?.requestSha256 === "string" && event.metadata.requestSha256 !== requestSha256);
    if (mismatched) return { kind: "unsafe", reason: "The reconstructed Viewer request does not match the persisted request fingerprint for this step." };
    const resumableEvidence = relatedAll.some((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED");
    if (resumableEvidence && relatedAll.some((event) => (event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED") && typeof event.metadata?.requestSha256 !== "string")) {
      return { kind: "unsafe", reason: "The persisted Viewer attempt lacks the request fingerprint required for safe automatic Resume." };
    }
  }
  const accepted = relatedAll.some((event) => viewerEvents.has(event.eventType) && event.metadata?.accepted === true && !limitReasons.has(normalizedReason(event)));
  const started = relatedAll.filter((event) => event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED");
  let finishedRejected: SessionEventRecord | undefined;
  for (const startedEvent of [...started].reverse()) {
    const level = Number(startedEvent.metadata?.recoveryLevel);
    if (![0, 1].includes(level)) return { kind: "unsafe", reason: "A persisted Viewer dispatch lacks a trustworthy recovery level." };
    const attemptId = typeof startedEvent.metadata?.attemptId === "string" ? startedEvent.metadata.attemptId : undefined;
    if (!attemptId) return { kind: "unsafe", reason: "A persisted Viewer dispatch start lacks the attempt identity required for safe automatic Resume." };
    const laterForSameAttempt = sorted.filter(event => event.sequenceNumber > startedEvent.sequenceNumber && event.metadata?.attemptId === attemptId);
    const resolution = [...relatedAll].reverse().find(event => event.eventType === "VIEWER_OUTPUT_RETRY_AUTHORIZED" && event.metadata?.resolution === "operator_failed"
      && event.metadata?.maximumPhysicalAttempts === 1 && event.metadata?.recoveryLevel === 1
      && Number(event.metadata?.resolvedThroughSequence) >= Math.max(startedEvent.sequenceNumber, ...laterForSameAttempt.map(e => e.sequenceNumber)));
    if (resolution) continue;
    const terminal = [...laterForSameAttempt].reverse().find(event => event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || viewerEvents.has(event.eventType));
    const failures = laterForSameAttempt.filter(event => event.eventType === "PROVIDER_ATTEMPT_FAILED");
    const hasUnknown = [...failures, ...(terminal ? [terminal] : [])].some(event => {
      const m = event.metadata ?? {};
      const outcomes = providerAttemptOutcomes(m);
      // Legacy adapter acceptance closes its own semantic output, but never an
      // earlier failed physical call in the same executor report.
      if (outcomes.length) return outcomes.some(a => a.outcome === "dispatch_unknown" && a.validation !== "accepted");
      return event.eventType === "PROVIDER_ATTEMPT_FAILED" && m.dispatchOutcome !== "not_dispatched";
    });
    if (hasUnknown) return { kind: "uncertain", eventId: startedEvent.id, stepKey, recoveryLevel: level as 0 | 1 };
    if (terminal) continue;
    const errors = laterForSameAttempt.filter(event => event.eventType === "PROVIDER_ERROR");
    if (errors.some(event => classifyProviderFailure(event.metadata) === "dispatch_unknown" && event.metadata?.dispatchOutcome !== "not_dispatched")) {
      return { kind: "uncertain", eventId: startedEvent.id, stepKey, recoveryLevel: level as 0 | 1 };
    }
    if (errors.some(event => classifyProviderFailure(event.metadata) === "response_finished") || failures.some(event => classifyProviderFailure(event.metadata) === "response_finished")) {
      finishedRejected ??= errors.at(-1) ?? failures.at(-1);
      continue;
    }
    const notDispatched = laterForSameAttempt.some(event => event.eventType === "VIEWER_OUTPUT_ATTEMPT_NOT_DISPATCHED" || (event.eventType === "PROVIDER_ERROR" && event.metadata?.dispatchOutcome === "not_dispatched"));
    if (!notDispatched) return { kind: "uncertain", eventId: startedEvent.id, stepKey, recoveryLevel: level as 0 | 1 };
  }
  // Accepted responses are replayed by createSessionReplay, never regenerated.
  if (accepted) return { kind: "fresh" };
  const authorization = [...relatedAll].reverse().find(event => event.eventType === "VIEWER_OUTPUT_RETRY_AUTHORIZED"
    && event.metadata?.requestSha256
    && event.metadata?.recoveryLevel === 1 && event.metadata?.maximumPhysicalAttempts === 1
    && !started.some(start => start.metadata?.resumeAuthorizationId === event.id)
    && !relatedAll.some(later => later.sequenceNumber > event.sequenceNumber && ["VIEWER_OUTPUT_ATTEMPT_STARTED", "VIEWER_OUTPUT_INCOMPLETE", "PROVIDER_ERROR"].includes(later.eventType)));
  if (authorization) return { kind: "authorized", eventId: authorization.id, stepKey };
  if (finishedRejected) return { kind: "finished_rejected", eventId: finishedRejected.id, stepKey };
  const blocked = [...relatedAll].reverse().find(event => event.eventType === "VIEWER_OUTPUT_RECOVERY_BLOCKED");
  if (blocked?.metadata?.reason === "no_larger_recovery_budget") return { kind: "exhausted", eventId: blocked.id, stepKey };
  if (blocked?.metadata?.reason === "context_limit") return { kind: "unsafe", reason: "The frozen Viewer request exceeds this route's context capacity; Resume requires a compatible route." };
  const incompleteForStep = incomplete.filter((event) => viewerEventStepKey(event) === stepKey);
  if (incompleteForStep.length === 0) return { kind: "fresh" };
  const last = incompleteForStep[incompleteForStep.length - 1];
  const persistedStepKey = viewerEventStepKey(last);
  if (!persistedStepKey) return { kind: "unsafe", reason: "The saved incomplete attempt lacks an exact step identity." };
  const related = incompleteForStep;
  if (related.some((event) => !Number.isSafeInteger(event.metadata?.recoveryLevel) || ![0, 1].includes(Number(event.metadata?.recoveryLevel)))) {
    return { kind: "unsafe", reason: "The saved output-limit attempt lacks a trustworthy recovery level." };
  }
  const lastReason = String(last.metadata?.reason ?? "");
  if (related.some((event) => event.metadata?.recoveryLevel === 1)) return { kind: "exhausted", eventId: last.id, stepKey: persistedStepKey! };
  if (last.eventType === "VIEWER_OUTPUT_INCOMPLETE" && lastReason && !resumableIncompleteReasons.has(lastReason)) return { kind: "finished_rejected", eventId: last.id, stepKey };
  const acceptedLater = sorted.some((event) => viewerEvents.has(event.eventType) && event.sequenceNumber > last.sequenceNumber && viewerEventStepKey(event) === persistedStepKey && event.metadata?.accepted === true && !limitReasons.has(normalizedReason(event)));
  if (acceptedLater) return { kind: "fresh" };
  const budget = last.metadata?.effectiveMaxOutputTokens;
  if (!Number.isSafeInteger(budget) || Number(budget) < 1) return { kind: "unsafe", reason: "The saved primary attempt has no valid effective output budget." };
  return { kind: "primary_limit", eventId: last.id, stepKey: persistedStepKey!, effectiveMaxOutputTokens: Number(budget), reason: lastReason === "repetition_runaway" ? "repetition_runaway" : "output_limit" };
}

export async function resolveViewerResumeStart(input: { repository: { listSessionEvents(sessionId: string): Promise<SessionEventRecord[]> }; sessionId: string; stepKey: string; requestSha256: string }): Promise<{ startRecoveryLevel: 0 | 1; priorEffectiveMaxOutputTokens?: number; priorIncompleteReason?: "output_limit" | "repetition_runaway"; resumeAuthorizationId?: string }> {
  const decision = inspectViewerResumeLedger(await input.repository.listSessionEvents(input.sessionId), input.stepKey, input.requestSha256);
  if (decision.kind === "authorized") return { startRecoveryLevel: 1, resumeAuthorizationId: decision.eventId };
  if (decision.kind === "finished_rejected") throw new Error("AUTO-STOP: A completed Viewer response was rejected; confirm a manual retry before another paid request.");
  if (decision.kind === "fresh") return { startRecoveryLevel: 0 };
  if (decision.kind === "primary_limit") return { startRecoveryLevel: 1, priorEffectiveMaxOutputTokens: decision.effectiveMaxOutputTokens, priorIncompleteReason: decision.reason };
  if (decision.kind === "exhausted") throw new Error("AUTO-STOP: Viewer output recovery was already exhausted for this exact step; no additional automatic paid attempt is allowed.");
  if (decision.kind === "uncertain") throw new Error("AUTO-STOP: A Viewer request for this exact step may already have been dispatched before interruption; automatic resend is blocked to avoid a duplicate paid request.");
  throw new Error(`AUTO-STOP: ${decision.reason}`);
}
