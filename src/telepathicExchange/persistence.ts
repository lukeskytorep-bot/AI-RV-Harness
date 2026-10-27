import type { TelepathicSeriesPlan, TelepathicSeriesState } from "./types";

/** Versioned JSON extension inside the existing atomically fenced plan_json.
 * Relational tables remain authoritative for their existing fields. No historical
 * migration changes are needed. The extension is decoded only by this repository.
 */
interface RuntimeExtension {
  recoveryBlock?: TelepathicSeriesState["recoveryBlock"];
  termination?: TelepathicSeriesState["termination"];
  version: 1;
  rounds: Record<string, { guidance?: TelepathicSeriesState["rounds"][number]["guidance"]; blind: Record<string, NonNullable<TelepathicSeriesState["rounds"][number]["blindByParticipant"][string]["guidanceResponses"]>> }>;
  calls: Record<string, Pick<TelepathicSeriesState["providerCalls"][number], "usage" | "elapsedMs" | "physicalAttempts" | "costSource" | "finishReason" | "requestMessages" | "requestSettings" | "outputBudgetSnapshot" | "outputDiagnostics" | "responseEvidence" | "transportFailure" | "recovery" | "retryOfCallId" | "manualRetryAuthorization" | "manualRetryOfCallId">>;
  transcript?: TelepathicSeriesState["transcript"];
  finalization?: TelepathicSeriesState["finalization"];
  activeElapsedMs?: number;
  archivedAt?: string;
  archiveRevision?: number;
}
export function serializeTelepathicPlan(state: TelepathicSeriesState): string {
  const runtime: RuntimeExtension = {
    version: 1, termination: state.termination, recoveryBlock: state.recoveryBlock,
    rounds: Object.fromEntries(state.rounds.map(round => [round.assignment.roundId, { guidance: round.guidance,
      blind: Object.fromEntries(Object.values(round.blindByParticipant).filter(blind => blind.guidanceResponses).map(blind => [blind.participantId, blind.guidanceResponses!])) }])),
    calls: Object.fromEntries(state.providerCalls.map(({ id,usage,elapsedMs,physicalAttempts,costSource,finishReason,requestMessages,requestSettings,outputBudgetSnapshot,outputDiagnostics,responseEvidence,transportFailure,recovery,retryOfCallId,manualRetryAuthorization,manualRetryOfCallId }) => [id,{usage,elapsedMs,physicalAttempts,costSource,finishReason,requestMessages,requestSettings,outputBudgetSnapshot,outputDiagnostics,responseEvidence,transportFailure,recovery,retryOfCallId,manualRetryAuthorization,manualRetryOfCallId}])),
    transcript: state.transcript, finalization: state.finalization, activeElapsedMs: state.activeElapsedMs,
    archivedAt: state.archivedAt, archiveRevision: state.archiveRevision,
  };
  return JSON.stringify({ ...state.plan, _runtime: runtime });
}
export function restoreTelepathicRuntime(state: TelepathicSeriesState, storedPlan: TelepathicSeriesPlan & { _runtime?: RuntimeExtension }): TelepathicSeriesState {
  const runtime = storedPlan._runtime;
  delete (state.plan as typeof storedPlan)._runtime;
  if (!runtime) return state;
  if (runtime.version !== 1) throw new Error("Unsupported telepathic runtime version.");
  for (const round of state.rounds) {
    const extension = runtime.rounds[round.assignment.roundId];
    if (!extension) continue;
    round.guidance = extension.guidance;
    for (const [id,responses] of Object.entries(extension.blind)) {
      if (!round.blindByParticipant[id]) throw new Error("Guidance without a persisted blind submission.");
      round.blindByParticipant[id].guidanceResponses = responses;
    }
  }
  for (const call of state.providerCalls) Object.assign(call, runtime.calls[call.id]);
  return Object.assign(state, { recoveryBlock: runtime.recoveryBlock, termination: runtime.termination, transcript: runtime.transcript, finalization: runtime.finalization,
    activeElapsedMs: runtime.activeElapsedMs, archivedAt: runtime.archivedAt, archiveRevision: runtime.archiveRevision });
}
export function assertArchiveRevision(state: TelepathicSeriesState, previous: TelepathicSeriesState | null): void {
  if (previous?.termination && (state.status !== "cancelled" || JSON.stringify(state.termination) !== JSON.stringify(previous.termination))) throw new Error("Ended telepathic series cannot be resumed or rewritten.");
  if (previous && (state.archiveRevision ?? 0) < (previous.archiveRevision ?? 0)) throw new Error("Stale telepathic archive revision.");
}
