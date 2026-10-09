import type { ProviderMessage } from "../providers/types";
import type { SessionEventRecord } from "./types";

/** A conservative, read-only interpretation of durable Viewer output attempts.
 * This module never authorizes a provider dispatch by itself.
 */
export type ViewerResumeLedgerDecision =
  | { kind: "fresh" }
  | { kind: "primary_limit"; eventId: string; stepKey: string; effectiveMaxOutputTokens: number }
  | { kind: "exhausted"; eventId: string; stepKey: string }
  | { kind: "uncertain"; eventId: string; stepKey: string; recoveryLevel: 0 | 1 }
  | { kind: "unsafe"; reason: string };

const viewerEvents = new Set(["VIEWER_RESPONSE", "VIEWER_SPECIAL_TASK_RESPONSE", "VIEWER_MONITOR_RESPONSE"]);
const limitReasons = new Set(["length", "max_tokens", "max_output_tokens", "max_completion_tokens"]);

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
  const source = typeof metadata.source === "string" ? metadata.source : "viewer";
  const exchange = typeof metadata.exchangeNumber === "number" ? `:exchange:${metadata.exchangeNumber}` : "";
  const question = typeof metadata.questionNumber === "number" ? `:question:${metadata.questionNumber}` : "";
  if (typeof metadata.phase === "number") return `${scope}:phase:${metadata.phase}:${source}${exchange}${question}`;
  if (typeof metadata.promptNumber === "number") return `${scope}:prompt:${metadata.promptNumber}:${source}${exchange}${question}`;
  if (typeof metadata.step === "number") return `${scope}:step:${metadata.step}:${source}${exchange}${question}`;
  throw new Error("Viewer output recovery requires an exact persisted step identity.");
}

export function inspectViewerResumeLedger(events: SessionEventRecord[], stepKey?: string, requestSha256?: string): ViewerResumeLedgerDecision {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const incomplete = sorted.filter((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || (viewerEvents.has(event.eventType) && limitReasons.has(normalizedReason(event))));
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
  if (accepted) return { kind: "fresh" };
  const started = relatedAll.filter((event) => event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED");
  for (const startedEvent of [...started].reverse()) {
    const level = Number(startedEvent.metadata?.recoveryLevel);
    if (![0, 1].includes(level)) continue;
    const attemptId = typeof startedEvent.metadata?.attemptId === "string" ? startedEvent.metadata.attemptId : undefined;
    if (!attemptId) {
      return { kind: "unsafe", reason: "A persisted Viewer dispatch start lacks the attempt identity required for safe automatic Resume." };
    }
    const laterForSameAttempt = sorted.filter((event) =>
      event.sequenceNumber > startedEvent.sequenceNumber
      && typeof event.metadata?.attemptId === "string"
      && event.metadata.attemptId === attemptId,
    );
    const semanticTerminal = laterForSameAttempt.some((event) =>
      event.eventType === "VIEWER_OUTPUT_INCOMPLETE" || viewerEvents.has(event.eventType),
    );
    if (semanticTerminal) continue;

    // Physical transport retries belong to the same logical Viewer attempt.
    // A later confirmed-before-dispatch failure cannot erase an earlier
    // physical attempt whose dispatch outcome is unknown.
    const physicalFailures = laterForSameAttempt.filter((event) => event.eventType === "PROVIDER_ATTEMPT_FAILED");
    const hasUnknownPhysicalDispatch = physicalFailures.some((event) => event.metadata?.dispatchOutcome !== "not_dispatched");
    if (hasUnknownPhysicalDispatch) {
      return { kind: "uncertain", eventId: startedEvent.id, stepKey, recoveryLevel: level as 0 | 1 };
    }
    const confirmedNotDispatched = laterForSameAttempt.some((event) => event.eventType === "VIEWER_OUTPUT_ATTEMPT_NOT_DISPATCHED")
      || laterForSameAttempt.some((event) => event.eventType === "PROVIDER_ERROR" && event.metadata?.dispatchOutcome === "not_dispatched");
    if (confirmedNotDispatched) continue;

    return { kind: "uncertain", eventId: startedEvent.id, stepKey, recoveryLevel: level as 0 | 1 };
  }
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
  if (last.eventType === "VIEWER_OUTPUT_INCOMPLETE" && lastReason && lastReason !== "output_limit") return { kind: "fresh" };
  const acceptedLater = sorted.some((event) => viewerEvents.has(event.eventType) && event.sequenceNumber > last.sequenceNumber && viewerEventStepKey(event) === persistedStepKey && event.metadata?.accepted === true && !limitReasons.has(normalizedReason(event)));
  if (acceptedLater) return { kind: "fresh" };
  const budget = last.metadata?.effectiveMaxOutputTokens;
  if (!Number.isSafeInteger(budget) || Number(budget) < 1) return { kind: "unsafe", reason: "The saved primary attempt has no valid effective output budget." };
  return { kind: "primary_limit", eventId: last.id, stepKey: persistedStepKey!, effectiveMaxOutputTokens: Number(budget) };
}

export async function resolveViewerResumeStart(input: { repository: { listSessionEvents(sessionId: string): Promise<SessionEventRecord[]> }; sessionId: string; stepKey: string; requestSha256: string }): Promise<{ startRecoveryLevel: 0 | 1; priorEffectiveMaxOutputTokens?: number }> {
  const decision = inspectViewerResumeLedger(await input.repository.listSessionEvents(input.sessionId), input.stepKey, input.requestSha256);
  if (decision.kind === "fresh") return { startRecoveryLevel: 0 };
  if (decision.kind === "primary_limit") return { startRecoveryLevel: 1, priorEffectiveMaxOutputTokens: decision.effectiveMaxOutputTokens };
  if (decision.kind === "exhausted") throw new Error("AUTO-STOP: Viewer output recovery was already exhausted for this exact step; no additional automatic paid attempt is allowed.");
  if (decision.kind === "uncertain") throw new Error("AUTO-STOP: A Viewer request for this exact step may already have been dispatched before interruption; automatic resend is blocked to avoid a duplicate paid request.");
  throw new Error(`AUTO-STOP: ${decision.reason}`);
}
