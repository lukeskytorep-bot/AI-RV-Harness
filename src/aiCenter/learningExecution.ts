import { parseProviderFinalCandidate } from "../providers/finalCandidate";
import { assertAbortOwnership } from "../application/abortOwnership";
import { sha256Text } from "../application/sha256";
import { callWithAnalyticalOutputRecovery, isOutputLimitFailure } from "../providers/outputRecovery";
import { executeProviderChat, ProviderExecutionError, type ProviderChatAttempt } from "../providers/requestExecutor";
import { ProviderCallError } from "../providers/providerError";
import { classifyProviderAttempt, parseProviderResponseEvidence } from "../providers/responseEvidence";
import type { ProviderConfig, ProviderChatResponse, ProviderMessage } from "../providers/types";
import type { AppRepository } from "../storage/repository";

export interface LearningSettlement {
  kind: "field_guide" | "viewer_notes";
  sessionId: string;
  packetHash: string;
  auditId: string;
  settlement: "updated" | "model_no_change" | "failed_preserved" | "disabled";
  version: { id: string; contentSha256: string; versionNumber?: number } | null;
  attempts: number;
  status: string;
  failureMessage?: string;
}
export class LearningProposalFailure extends Error {
  constructor(public readonly status: "FAILED_PROVIDER" | "FAILED_PARSE" | "FAILED_SCHEMA" | "FAILED_CAPACITY" | "FAILED_OUTPUT_PREFLIGHT", message: string, public readonly attempts: number, public readonly response?: ProviderChatResponse, public readonly outputRecoveryRequired = false) { super(message); }
}
/** Shared by execution recovery and the Resume decision; provider/PENDING alone prove nothing. */
export function learningAuditHasKnownResult(audit: { status: string; rawFinalResponseSha256?: string }): boolean {
  return ["UPDATE", "NO_CHANGE", "STALE_BASE", "FAILED_CAPACITY", "FAILED_OUTPUT_PREFLIGHT"].includes(audit.status)
    || (["FAILED_PARSE", "FAILED_SCHEMA"].includes(audit.status) && Boolean(audit.rawFinalResponseSha256));
}
function requiresFinalOutputRecovery(cause: unknown): boolean {
  return isOutputLimitFailure(cause) || /provider returned an empty assistant response/i.test(cause instanceof Error ? cause.message : String(cause));
}
export class LearningUncertainError extends Error {
  constructor() { super("Learning dispatch is unconfirmed. Resolve the existing attempt before continuing; automatic resend is blocked."); }
}
export const LEARNING_ATTEMPT_EVENT = "LEARNING_PHYSICAL_ATTEMPT";
export const LEARNING_SETTLEMENT_EVENT = "LEARNING_SETTLEMENT";

export async function readLearningSettlement(repository: AppRepository, sessionId: string, kind: LearningSettlement["kind"], packetHash: string): Promise<LearningSettlement | undefined> {
  const events = await repository.listSessionEvents(sessionId);
  return events.filter(e => e.eventType === LEARNING_SETTLEMENT_EVENT).map(e => e.metadata?.settlement as LearningSettlement | undefined).find(s => s?.sessionId === sessionId && s.kind === kind && s.packetHash === packetHash);
}
export async function saveLearningSettlement(repository: AppRepository, value: LearningSettlement, signal?: AbortSignal): Promise<LearningSettlement> {
  await assertAbortOwnership(signal);
  const existing = await readLearningSettlement(repository, value.sessionId, value.kind, value.packetHash);
  const settled = existing ?? value;
  if (!existing) await repository.appendSessionEvent(value.sessionId, { eventType: LEARNING_SETTLEMENT_EVENT, metadata: { settlement: value } });
  const runs = await repository.listTrainingRuns();
  const run = runs.find(r => r.activeTargetCheckpoint?.sessionId === value.sessionId || r.sessionIds.includes(value.sessionId));
  if (run && !(run.learningSettlements ?? []).some(s => s.auditId === settled.auditId)) {
    await repository.updateTrainingRun(run.id, { learningSettlements: [...(run.learningSettlements ?? []), settled] });
  }
  return settled;
}

async function checkedFinalCandidate(value: unknown) {
  const candidate = parseProviderFinalCandidate(value);
  if (value !== undefined && !candidate) throw new Error("Invalid final candidate metadata.");
  if (candidate?.content !== null && candidate?.content !== undefined && await sha256Text(candidate.content) !== candidate.contentSha256) throw new Error("Final candidate content hash mismatch.");
  return candidate;
}

/** One persistent allowance covers generation, formatting, capacity and transport retries. */
export async function executeLearningProposal<T>(input: {
  repository: AppRepository; sessionId: string; packetHash: string; kind: LearningSettlement["kind"];
  config: ProviderConfig; modelId: string; timeoutMs?: number; chat?: ProviderChatAttempt;
  analytical: Omit<Extract<Parameters<typeof callWithAnalyticalOutputRecovery>[0], { learningObjectCapacityTokens: number }>, "call" | "messages">;
  messages: ProviderMessage[];
  parse: (response: ProviderChatResponse) => T;
  repairMessages: (response: ProviderChatResponse, cause: LearningProposalFailure) => ProviderMessage[];
}): Promise<{ parsed: T; response: ProviderChatResponse; settings: Awaited<ReturnType<typeof callWithAnalyticalOutputRecovery>>["settings"]; attempts: number }> {
  const { repository, sessionId, packetHash, kind } = input;
  const signal = input.analytical.signal;
  const events = await repository.listSessionEvents(sessionId);
  const entries = events.filter(e => e.eventType === LEARNING_ATTEMPT_EVENT && e.metadata?.kind === kind && e.metadata?.packetHash === packetHash);
  let messages = input.messages;
  let lastFailure: LearningProposalFailure | undefined;
  for (const slot of [0, 1] as const) {
    await assertAbortOwnership(signal);
    const start = entries.find(e => e.metadata?.slot === slot && e.metadata?.state === "reserved");
    const end = entries.find(e => e.metadata?.slot === slot && e.metadata?.state === "finished");
    const resolved = entries.find(e => e.metadata?.slot === slot && e.metadata?.state === "resolved");
    if (start && !end && !resolved) throw new LearningUncertainError();
    let attemptId = start?.metadata?.attemptId;
    let response: ProviderChatResponse | undefined;
    let settings: Awaited<ReturnType<typeof callWithAnalyticalOutputRecovery>>["settings"] | undefined;
    let providerFailure: LearningProposalFailure | undefined;
    let responseOutcome = end?.metadata?.outcome;
    if (resolved) {
      providerFailure = new LearningProposalFailure("FAILED_PROVIDER", "Unconfirmed attempt explicitly resolved as failed by the user.", slot + 1);
    } else if (end) {
      if (end.metadata?.outcome === "dispatch_unknown" && !end.metadata?.response) throw new LearningUncertainError();
      if (end.metadata?.failureStatus === "FAILED_OUTPUT_PREFLIGHT") throw new LearningProposalFailure("FAILED_OUTPUT_PREFLIGHT", String(end.metadata.message), slot + 1);
      if (end.metadata?.response) {
        response = end.metadata.response as ProviderChatResponse;
        await checkedFinalCandidate(response.finalCandidate);
        if (await sha256Text(response.content) !== end.metadata.responseHash) throw new Error("Stored learning response hash mismatch.");
        settings = end.metadata.settings as NonNullable<typeof settings>;
      } else providerFailure = new LearningProposalFailure("FAILED_PROVIDER", String(end.metadata?.message), slot + 1, undefined, end.metadata?.outputRecoveryRequired === true);
    } else {
      // Catch only provider execution. Repository and ownership errors escape unchanged.
      let persistenceFailure: unknown;
      let capturedResponse: ProviderChatResponse | undefined;
      let capturedSettings: typeof settings;
      try {
        const outputRecovery = slot === 1 && lastFailure?.outputRecoveryRequired === true;
        const result = await callWithAnalyticalOutputRecovery({ ...input.analytical,
          recoveryInstruction: outputRecovery ? input.analytical.recoveryInstruction : undefined,
          recoveryReasoningMaxTokens: outputRecovery ? input.analytical.recoveryReasoningMaxTokens : undefined,
          messages, initialAttempt: slot, maximumAttempts: 1,
          call: async (attemptSettings, _attempt, attemptMessages) => {
            capturedSettings = attemptSettings;
            const value = await executeProviderChat({ config: input.config, modelId: input.modelId, messages: attemptMessages, settings: attemptSettings, timeoutMs: input.timeoutMs, signal,
              configuredRetries: 0, operationId: `${kind}.learning`, operationKind: input.analytical.operationKind,
              attempt: input.chat,
              onAttemptStart: async context => {
                attemptId = `${context.logicalRequestId}:${context.physicalAttempt}`;
                try { await assertAbortOwnership(signal); await repository.appendSessionEvent(sessionId, { eventType: LEARNING_ATTEMPT_EVENT, metadata: { kind, packetHash, slot, state: "reserved", attemptId, logicalRequestId: context.logicalRequestId, physicalAttempt: context.physicalAttempt } }); }
                catch (cause) { persistenceFailure = cause; throw cause; }
              },
            });
            capturedResponse = value;
            return value;
          },
        });
        response = result.response; settings = result.settings;
      } catch (cause) {
        if (persistenceFailure) throw persistenceFailure;
        await assertAbortOwnership(signal);
        if (capturedResponse) { response = capturedResponse; settings = capturedSettings; }
        else if (cause instanceof ProviderCallError && cause.details.phase === "before_dispatch" && cause.details.code === "configuration") {
          throw new LearningProposalFailure("FAILED_OUTPUT_PREFLIGHT", cause.message, slot);
        } else if (cause instanceof ProviderExecutionError) {
          const outcome = classifyProviderAttempt(cause.causeError.details);
          const outputRecoveryRequired = cause.causeError.details.httpStatus === undefined && requiresFinalOutputRecovery(cause);
          const responseEvidence = parseProviderResponseEvidence(cause.causeError.details.responseEvidence);
          const finalCandidate = await checkedFinalCandidate(cause.causeError.details.finalCandidate);
          await repository.appendSessionEvent(sessionId, { eventType: LEARNING_ATTEMPT_EVENT, metadata: { kind, packetHash, slot, state: "finished", outcome, attemptId, providerRequestId: cause.causeError.details.providerRequestId, transportRequestId: cause.causeError.details.transportRequestId, validation: "native_rejected", ...(finalCandidate ? { finalCandidate } : {}), message: cause.message, outputRecoveryRequired, ...(responseEvidence ? { responseEvidence } : {}) } });
          if (outcome === "dispatch_unknown") throw new LearningUncertainError();
          providerFailure = new LearningProposalFailure("FAILED_PROVIDER", cause.message, slot + 1, undefined, outputRecoveryRequired);
        } else {
          // Only local capacity/settings preflight can fail before the executor is entered.
          if (!/available context or output capacity|rejected.*budget|cannot increase beyond/.test(cause instanceof Error ? cause.message : "")) throw cause;
          throw new LearningProposalFailure("FAILED_OUTPUT_PREFLIGHT", cause instanceof Error ? cause.message : String(cause), slot);
        }
      }
      if (response) {
        await assertAbortOwnership(signal);
        const finalCandidate = await checkedFinalCandidate(response.finalCandidate);
        await assertAbortOwnership(signal);
        // Store only final output, never private reasoning. Bounded by the native response limit.
        if (new TextEncoder().encode(response.content).length > 2_000_000) {
          const outcome = classifyProviderAttempt({ responseEvidence: response.responseEvidence });
          const message = "Learning final response exceeds the bounded local replay capacity; previous memory retained.";
          await repository.appendSessionEvent(sessionId, { eventType: LEARNING_ATTEMPT_EVENT, metadata: { kind, packetHash, slot, state: "finished", outcome, attemptId, ...(finalCandidate ? { finalCandidate } : {}), failureStatus: "FAILED_OUTPUT_PREFLIGHT", message, responseHash: await sha256Text(response.content) } });
          if (outcome === "dispatch_unknown") throw new LearningUncertainError();
          throw new LearningProposalFailure("FAILED_OUTPUT_PREFLIGHT", message, slot + 1);
        }
        responseOutcome = classifyProviderAttempt({ responseEvidence: response.responseEvidence });
        const safeResponse = { ...(finalCandidate ? { finalCandidate } : {}), content: response.content, finishReason: response.finishReason, providerRequestId: response.providerRequestId };
        await repository.appendSessionEvent(sessionId, { eventType: LEARNING_ATTEMPT_EVENT, metadata: { kind, packetHash, slot, state: "finished", outcome: responseOutcome, attemptId, providerRequestId: response.providerRequestId, transportRequestId: response.transportRequestId, response: safeResponse, responseHash: await sha256Text(response.content), settings } });
      }
    }
    if (providerFailure) { lastFailure = providerFailure; continue; }
    if (!response || !settings) throw new Error("Learning response/settings unavailable.");
    let parsed: T;
    try { parsed = input.parse(response); }
    catch (cause) {
      if (!(cause instanceof LearningProposalFailure)) throw cause;
      if (responseOutcome === "dispatch_unknown") throw new LearningUncertainError();
      lastFailure = new LearningProposalFailure(cause.status, cause.message, slot + 1, response, cause.status === "FAILED_PROVIDER" && requiresFinalOutputRecovery(cause));
      await assertAbortOwnership(signal);
      await repository.appendSessionEvent(sessionId, { eventType: "LEARNING_CANDIDATE_VALIDATION", metadata: { kind, packetHash, slot, attemptId, validation: "learning_rejected", status: cause.status, message: cause.message, responseHash: await sha256Text(response.content) } });
      messages = input.repairMessages(response, lastFailure);
      continue;
    }
    await assertAbortOwnership(signal);
    await repository.appendSessionEvent(sessionId, { eventType: "LEARNING_CANDIDATE_VALIDATION", metadata: { kind, packetHash, slot, attemptId, validation: "learning_accepted", responseHash: await sha256Text(response.content) } });
    return { parsed, response, settings, attempts: slot + 1 };
  }
  throw lastFailure ?? new Error("Learning allowance exhausted without a recorded result.");
}

export function learningWarningText(value: LearningSettlement, pl: boolean): string {
  const name = value.kind === "field_guide" ? "Field Guide" : "Viewer Notes";
  return `${name}: ${pl ? "Aktualizacja nieudana — zachowano poprzednią wersję" : "Update failed — previous version retained"} (${value.attempts}/2). ${value.failureMessage ?? value.status}`;
}
