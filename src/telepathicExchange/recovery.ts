import { lengthRecoveryUnavailable } from "./outputBudgets";
import { parseProviderResponseEvidence } from "../providers/responseEvidence";
import { viewerResponseCompletion } from "../sessions/viewerOutputRecovery";
import { sanitizeRepetitiveOutput } from "../sessions/repetitionGuard";
import type { TelepathicProviderCallRecord, TelepathicSeriesConfig, TelepathicSeriesState } from "./types";

export interface TelepathicRecoveryPolicy {
  version: 1;
  mode: "automatic" | "manual";
  maxTransportRetriesPerScope: 1;
}
export const AUTOMATIC_TELEPATHIC_RECOVERY: Readonly<TelepathicRecoveryPolicy> = Object.freeze({ version: 1, mode: "automatic", maxTransportRetriesPerScope: 1 });
export function validateTelepathicRecoveryPolicy(policy: TelepathicRecoveryPolicy | undefined): void {
  if (policy !== undefined && (!policy || policy.version !== 1 || !["automatic", "manual"].includes(policy.mode) || policy.maxTransportRetriesPerScope !== 1)) throw new Error("Invalid Telepathic recovery policy.");
}
export function automaticTelepathicRecovery(config: Pick<TelepathicSeriesConfig, "recoveryPolicy">): boolean {
  validateTelepathicRecoveryPolicy(config.recoveryPolicy);
  return config.recoveryPolicy?.mode === "automatic";
}
export function hasRecoverableTelepathicResponse(call: TelepathicProviderCallRecord, language: "pl" | "en"): boolean {
  if (!call.responseText?.trim() || call.transportFailure?.earlierAmbiguousAttempt) return false;
  const evidence = parseProviderResponseEvidence(call.responseEvidence);
  if (call.outputDiagnostics?.completion !== "complete" && !evidence) return false;
  const reason = call.finishReason ?? evidence?.finishReason;
  // A finish label alone never proves receipt. A domain validator still runs in the engine.
  if (!reason || !["stop", "end_turn", "eos", "completed"].includes(reason.trim().toLowerCase())) return false;
  return viewerResponseCompletion({ content: call.responseText, finishReason: reason, usage: call.usage ?? {} }) === "complete"
    && !sanitizeRepetitiveOutput(call.responseText, language).truncated;
}
export function validateTelepathicRecoveryLedger(calls: TelepathicProviderCallRecord[]): void {
  if (calls.filter(call => call.recovery?.action === "transport_retry").length > 1) throw new Error("Invalid Telepathic transport recovery ledger: retry budget exceeded.");
  for (const call of calls) {
    const recovery = call.recovery;
    if (recovery && (!["transport_retry", "recovered_response", "rejected_response", "manual_resolution"].includes(recovery.action)
      || !["prepared", "dispatched", "uncertain", "failed", "succeeded"].includes(recovery.originalStatus) || typeof recovery.at !== "string" || !recovery.at.trim()
      || recovery.action === "transport_retry" && call.status !== "failed")) throw new Error("Invalid Telepathic recovery record.");
    if (call.retryOfCallId) {
      const parent = calls.find(item => item.id === call.retryOfCallId);
      if (!parent || parent.id === call.id || parent.recovery?.action !== "transport_retry" || parent.scopeKey !== call.scopeKey
        || parent.requestSha256 !== call.requestSha256 || parent.technicalAttempt !== call.technicalAttempt
        || calls.filter(item => item.retryOfCallId === parent.id).length > 1) throw new Error("Invalid Telepathic transport retry parent.");
    }
  }
}
export function pendingTelepathicTransportRetry(calls: TelepathicProviderCallRecord[]): TelepathicProviderCallRecord | undefined {
  return calls.find(call => call.recovery?.action === "transport_retry" && !calls.some(child => child.retryOfCallId === call.id));
}
export function canRetryTelepathicTransport(config: TelepathicSeriesConfig, calls: TelepathicProviderCallRecord[], call: TelepathicProviderCallRecord, resuming: boolean): boolean {
  if (!automaticTelepathicRecovery(config) || calls.filter(item => item.recovery?.action === "transport_retry").length >= 1) return false;
  if (call.status === "dispatched" && !call.transportFailure && call.responseText === undefined && !call.finishReason) return true; // settled task/restart only
  // Older ledgers did not persist typed transport details. Opting into the
  // saved policy permits one replay of a wholly missing outcome, not an
  // incomplete/rejected body or a known non-retryable current error.
  if (call.status === "uncertain" && !call.transportFailure && call.responseText === undefined && !call.finishReason
    && !call.responseEvidence && (!call.outputDiagnostics || call.outputDiagnostics.completion === "unknown")) return true;
  return call.transportFailure?.retryable === true || resuming && call.transportFailure?.code === "cancelled";
}
export interface TelepathicRecoveryDecision {
  canResume: boolean;
  needsManualResolution: boolean;
  automatic: boolean;
  reason?: "manual" | "transport_exhausted" | "output_exhausted" | "provider_failure" | "storage_failure" | "ended";
}
export function telepathicRecoveryDecision(state: TelepathicSeriesState): TelepathicRecoveryDecision {
  let automatic = false;
  try { automatic = automaticTelepathicRecovery(state.config); } catch { return { automatic, canResume: false, needsManualResolution: false, reason: "provider_failure" }; }
  const result: TelepathicRecoveryDecision = { canResume: true, needsManualResolution: false, automatic };
  if (state.archivedAt || state.termination || state.status === "cancelled") return { ...result, canResume: false, reason: "ended" };
  if (state.recoveryBlock) return { ...result, canResume: false, reason: "provider_failure" };
  const activeRoundId = state.rounds[state.currentRoundIndex]?.assignment.roundId;
  if (state.providerCalls.some(call => ["uncertain", "dispatched"].includes(call.status) && (call.callStage === "series_reflection" ? state.currentRoundIndex < state.rounds.length : call.roundId !== activeRoundId))) return { ...result, canResume: false, needsManualResolution: true, reason: "manual" };
  const relevant = state.providerCalls.filter(call => ["uncertain", "dispatched"].includes(call.status) || call.roundId === state.rounds[state.currentRoundIndex]?.assignment.roundId || call.callStage === "series_reflection");
  const groups = new Map<string, TelepathicProviderCallRecord[]>();
  for (const call of relevant) groups.set(call.scopeKey, [...(groups.get(call.scopeKey) ?? []), call]);
  for (const calls of groups.values()) {
    try { validateTelepathicRecoveryLedger(calls); } catch { return { ...result, canResume: false, reason: "provider_failure" }; }
    // Never hide an unresolved earlier physical request behind a later success.
    const unresolved = calls.filter(call => call.status === "uncertain" || call.status === "dispatched");
    if (unresolved.length > 1 || unresolved.length && calls.some(call => call.status === "succeeded")) return { ...result, canResume: false, needsManualResolution: true, reason: "manual" };
    for (const call of unresolved) {
      if (hasRecoverableTelepathicResponse(call, state.config.language) || canRetryTelepathicTransport(state.config, calls, call, true)) continue;
      return { ...result, canResume: false, needsManualResolution: !automatic, reason: automatic ? "transport_exhausted" : "manual" };
    }
    if (!unresolved.length && calls.some(call => call.status === "succeeded")) continue;
    const last = calls.filter(call => call.recovery?.action !== "transport_retry").reduce<TelepathicProviderCallRecord | undefined>((latest, call) => !latest || call.technicalAttempt >= latest.technicalAttempt ? call : latest, undefined);
    if (last?.status === "failed" && last.recovery?.action !== "transport_retry") {
      if (last.outputBudgetSnapshot && lengthRecoveryUnavailable(last.outputBudgetSnapshot, calls)) return { ...result, canResume: false, reason: "output_exhausted" };
      if (last.transportFailure && last.recovery?.action !== "manual_resolution" && !canRetryTelepathicTransport(state.config, calls, last, true)) return { ...result, canResume: false, reason: last.transportFailure.retryable ? "transport_exhausted" : "provider_failure" };
      if (last.technicalAttempt >= 2 && (!last.transportFailure || last.recovery?.action === "manual_resolution")) return { ...result, canResume: false, reason: "output_exhausted" };
    }
  }
  return result;
}
export function blockTelepathicRecoveryForCheckpoint(decision: TelepathicRecoveryDecision, blocked: boolean): TelepathicRecoveryDecision {
  return blocked ? { ...decision, canResume: false, reason: "storage_failure" } : decision;
}
export function telepathicRecoveryMessage(decision: TelepathicRecoveryDecision, pl: boolean): string {
  const messages = {
    storage_failure: ["Zapis nie powiódł się. Sprawdź bazę i otwórz serię ponownie z historii.", "The checkpoint could not be saved. Check the database and reopen the series from history."],
    manual: ["Niepewne wywołanie wymaga rozstrzygnięcia lub włączenia automatycznego odzyskiwania.", "An uncertain provider call requires an explicit operator decision or enabling automatic recovery."],
    transport_exhausted: ["Nie można automatycznie ponowić tego kroku: limit odzyskiwania został wyczerpany lub brak dowodu błędu połączenia.", "This step cannot be retried automatically: recovery is exhausted or no transport failure was established."],
    output_exhausted: ["Wyczerpano próby uzyskania poprawnej odpowiedzi w tym kroku.", "Telepathic response attempts exhausted for this step."],
    provider_failure: ["Błąd providera lub konfiguracji wymaga sprawdzenia ustawień.", "Check the provider or configuration error before continuing."],
    ended: ["Ta seria nie jest dostępna do wznowienia.", "This series is unavailable for resume."],
  };
  return decision.reason ? messages[decision.reason][pl ? 0 : 1] : "";
}
