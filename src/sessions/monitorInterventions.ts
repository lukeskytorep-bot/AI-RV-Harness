import type { InterfaceLanguage } from "../types";
import type { SessionEventRecord } from "./types";

export interface MonitorInstructionPair {
  monitor: SessionEventRecord;
  controller: SessionEventRecord;
  identical: boolean;
}

/** Deterministic logical identity: retries/replay keep the same intervention. */
export function monitorInterventionId(sessionId: string, viewerStepId: string): string {
  return `${sessionId}:monitor:${viewerStepId}`;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameCallCoordinates(monitor: SessionEventRecord, controller: SessionEventRecord): boolean {
  const m = monitor.metadata ?? {}, c = controller.metadata ?? {};
  if (monitor.sessionId !== controller.sessionId || monitor.sequenceNumber >= controller.sequenceNumber
    || typeof c.step !== "number" || m.step !== c.step || m.passIndex !== c.passIndex) return false;
  if (c.source === "monitor_intervention") {
    return typeof c.exchangeNumber === "number" && m.exchangeNumber === c.exchangeNumber;
  }
  // Pre-entered T9 questions retain their old Viewer step identity (questionNumber, not exchangeNumber).
  return c.source === "monitor" && c.step === 8 && c.telepathicPhase === "T9"
    && m.source === "operator_predefined_t9" && typeof c.questionNumber === "number"
    && m.exchangeNumber === c.questionNumber;
}

/** Presentation only. Never filters the durable events or reconstructed provider messages. */
export function monitorInstructionPairs(events: SessionEventRecord[]): MonitorInstructionPair[] {
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const pairs: MonitorInstructionPair[] = [];
  const claimed = new Set<string>();
  for (let index = 0; index < ordered.length; index += 1) {
    const controller = ordered[index];
    if (controller.eventType !== "CONTROLLER_STEP" || !controller.content?.trim()) continue;
    const identity = controller.metadata?.interventionId;
    let monitor: SessionEventRecord | undefined;
    if (nonemptyString(identity)) {
      const candidates = ordered.filter(event => event.eventType === "MONITOR_INTERVENTION"
        && event.metadata?.interventionId === identity && sameCallCoordinates(event, controller));
      const controllers = ordered.filter(event => event.eventType === "CONTROLLER_STEP"
        && event.sessionId === controller.sessionId && event.metadata?.interventionId === identity);
      if (candidates.length !== 1 || controllers.length !== 1) continue; // Ambiguous data stays visible.
      monitor = candidates[0];
      if (!nonemptyString(controller.metadata?.stepId) || monitor.metadata?.viewerStepId !== controller.metadata?.stepId) continue;
    } else {
      // Legacy fallback is confined to adjacent records of the same session, never a text-wide search.
      const previous = ordered.slice(0, index).reverse().find(event => event.sessionId === controller.sessionId);
      if (previous?.eventType !== "MONITOR_INTERVENTION" || nonemptyString(previous.metadata?.interventionId)
        || !sameCallCoordinates(previous, controller)) continue;
      monitor = previous;
    }
    if (!monitor?.content?.trim() || claimed.has(monitor.id)) continue;
    claimed.add(monitor.id);
    pairs.push({ monitor, controller, identical: monitor.content === controller.content });
  }
  return pairs;
}

export function sentMonitorInstructionNote(language: InterfaceLanguage): string {
  return language === "pl"
    ? "Kontroler uzupełnił polecenie Monitora przed wysłaniem do Viewera."
    : "The controller supplemented the Monitor instruction before sending it to the Viewer.";
}

/** One instruction if identical; preserve the Monitor's command and actual wrapper otherwise. */
export function monitorInstructionMarkdown(command: string, sentPrompt: string, language: InterfaceLanguage): string {
  const pl = language === "pl";
  const monitor = `#### ${pl ? "Dokładne polecenie Monitora" : "Exact Monitor instruction"}\n\n${command.trim()}`;
  return command === sentPrompt ? monitor
    : `${monitor}\n\n${sentMonitorInstructionNote(language)}\n\n#### ${pl ? "Faktycznie wysłana instrukcja" : "Actually sent instruction"}\n\n${sentPrompt.trim()}`;
}
