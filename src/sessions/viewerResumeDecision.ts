import { withRvWorkflow } from "../application/workflowOwnership";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";
import type { SessionEventRecord } from "./types";
import { inspectViewerResumeLedger, viewerEventStepKey, type ViewerResumeLedgerDecision } from "./viewerResumeLedger";

export interface ViewerResumeDecisionCopy {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** Shared read-only decision for the button, preparation and execution ledger. */
export function inspectViewerSessionResume(events: SessionEventRecord[]): ViewerResumeLedgerDecision {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const keys = [...new Set(sorted.map(viewerEventStepKey).filter((key): key is string => Boolean(key)))];
  let pending: ViewerResumeLedgerDecision = { kind: "fresh" };
  for (const key of keys) {
    const decision = inspectViewerResumeLedger(sorted, key);
    if (decision.kind !== "fresh" && decision.kind !== "unsafe" && typeof sorted.find(event => event.id === decision.eventId)?.metadata?.requestSha256 !== "string") {
      return { kind: "unsafe", reason: "The persisted Viewer attempt lacks the request fingerprint required for safe Resume." };
    }
    if (decision.kind === "unsafe" || decision.kind === "uncertain") return decision;
    if (decision.kind !== "fresh") pending = decision;
  }
  return keys.length ? pending : inspectViewerResumeLedger(sorted);
}

export async function prepareViewerSessionResume(input: {
  repository: AppRepository;
  sessionId: string;
  language: InterfaceLanguage;
  signal?: AbortSignal;
  confirm: (copy: ViewerResumeDecisionCopy) => Promise<boolean>;
}): Promise<boolean> {
  return withRvWorkflow(input.repository, input.sessionId, input.signal, async (repository, signal) => {
    const events = await repository.listSessionEvents(input.sessionId);
    const decision = inspectViewerSessionResume(events);
    if (decision.kind === "unsafe") throw new Error(`AUTO-STOP: ${decision.reason}`);
    if (["fresh", "primary_limit", "authorized"].includes(decision.kind)) return true;
    if (decision.kind !== "uncertain" && decision.kind !== "exhausted" && decision.kind !== "finished_rejected") return true;
    const pl = input.language === "pl";
    const uncertain = decision.kind === "uncertain";
    const confirmed = await input.confirm({
      title: uncertain ? (pl ? "Rozstrzygnąć niepewne wywołanie Viewera?" : "Resolve uncertain Viewer call?") : (pl ? "Ponowić odrzucony wynik Viewera?" : "Retry rejected Viewer output?"),
      description: uncertain
        ? (pl ? "Poprzednie żądanie mogło zostać wykonane. Potwierdzenie rozstrzyga wskazaną próbę jako nieudaną. Zapisane wyniki zostaną zachowane; tylko brakujący krok może otrzymać jedną dodatkową próbę, która może naliczyć koszt." : "The previous request may have executed. Confirmation resolves the recorded attempt as failed. Saved results are retained; only the missing step may receive one additional attempt, which may incur a charge.")
        : (pl ? "Odpowiedź została odebrana, ale krok jej nie zaakceptował. Limit automatycznego odzyskiwania jest polityką Harness. Potwierdzenie zezwala na jedną dodatkową płatną próbę brakującego kroku. Historia prób pozostaje zachowana; aktualizacje pamięci nie są ponownie otwierane." : "The response was received but the step did not accept it. Automatic recovery limits are Harness policy. Confirmation allows one additional paid attempt of the missing step. Attempt history is retained; memory updates are not reopened."),
      confirmLabel: pl ? "Potwierdź i kontynuuj" : "Confirm and continue", cancelLabel: pl ? "Anuluj" : "Cancel",
    });
    if (!confirmed) return false;
    signal?.throwIfAborted();
    const fresh = await repository.listSessionEvents(input.sessionId);
    if (JSON.stringify(fresh) !== JSON.stringify(events)) throw new Error(pl ? "Stan sesji zmienił się podczas potwierdzenia. Użyj Wznów ponownie." : "The session state changed during confirmation. Use Resume again.");
    const source = events.find(event => event.id === decision.eventId);
    const requestSha256 = source?.metadata?.requestSha256;
    if (typeof requestSha256 !== "string" || !requestSha256) throw new Error("Manual Viewer Resume requires the persisted request fingerprint.");
    await repository.appendSessionEvent(input.sessionId, {
      eventType: "VIEWER_OUTPUT_RETRY_AUTHORIZED", role: "controller",
      metadata: { stepId: decision.stepKey, requestSha256, sourceEventId: decision.eventId, reason: decision.kind, recoveryLevel: 1, maximumPhysicalAttempts: 1,
        ...(uncertain ? { resolution: "operator_failed", resolvedThroughSequence: Math.max(0, ...events.map(e => e.sequenceNumber)) } : {}) },
    });
    return true;
  });
}
