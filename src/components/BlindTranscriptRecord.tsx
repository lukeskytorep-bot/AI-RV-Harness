import { monitorInstructionPairs, sentMonitorInstructionNote } from "../sessions/monitorInterventions";
import { hasCompleteEventCoverage } from "../sessions/blindTranscriptEvidence";
export { reconstructAcceptedBlindTranscript } from "../sessions/blindTranscriptEvidence";
import { sessionFocusLabel, type SessionFocus } from "../sessions/sessionFocus";
import type { InterfaceLanguage } from "../types";
import type { SessionEventRecord } from "../sessions/types";
import { SafeMarkdown } from "./SafeMarkdown";

type DisplayKind = "instruction" | "viewer" | "monitor" | "partial";

interface DisplayBlock {
  key: string;
  kind: DisplayKind;
  heading?: string;
  label: string;
  content: string;
  note?: string;
}

function stepHeading(event: SessionEventRecord, language: InterfaceLanguage): string | undefined {
  const metadata = event.metadata ?? {};
  const pl = language === "pl";
  const phase = typeof metadata.phase === "number" || typeof metadata.phase === "string" ? metadata.phase : undefined;
  const promptNumber = typeof metadata.promptNumber === "number" ? metadata.promptNumber : undefined;
  const step = typeof metadata.step === "number" || typeof metadata.step === "string" ? metadata.step : undefined;
  const questionNumber = typeof metadata.questionNumber === "number" ? metadata.questionNumber : undefined;
  const telepathicPhase = typeof metadata.telepathicPhase === "string" ? metadata.telepathicPhase : undefined;
  const customProtocol = typeof metadata.customProtocol === "string" && metadata.customProtocol.trim() ? metadata.customProtocol : undefined;

  if (phase !== undefined) return `${pl ? "Faza" : "Phase"} ${phase}`;
  if (promptNumber !== undefined) return `RV Lite — ${pl ? "krok" : "Step"} ${promptNumber}`;
  if (customProtocol) {
    return step !== undefined
      ? `${pl ? "Protokół własny" : "Custom protocol"} — ${pl ? "krok" : "Step"} ${step}`
      : (pl ? "Protokół własny" : "Custom protocol");
  }
  if (step !== undefined) {
    const base = `Telepathic — ${pl ? "krok" : "Step"} ${step}`;
    return questionNumber !== undefined ? `${base} · ${pl ? "pytanie" : "Question"} ${questionNumber}` : base;
  }
  if (telepathicPhase) return `Telepathic — ${telepathicPhase}`;
  if (questionNumber !== undefined) return `${pl ? "Pytanie" : "Question"} ${questionNumber}`;
  return undefined;
}

function metadataHeading(event:SessionEventRecord,language:InterfaceLanguage):string|undefined {
 const heading=stepHeading(event,language),m=event.metadata;
 return typeof m?.passIndex==="number" ? `${language==="pl"?"Sesja":"Session"} ${m.passIndex} — ${sessionFocusLabel(m.sessionFocus as SessionFocus,language)} · ${heading??""}` : heading;
}

function carriesStepHeading(event: SessionEventRecord): boolean {
  return event.eventType === "CONTROLLER_STEP"
    || event.eventType === "SPECIAL_TASK_INJECTED"
    || event.eventType === "MONITOR_INTERVENTION"
    || event.eventType === "VIEWER_OUTPUT_INCOMPLETE";
}

function blockLabel(event: SessionEventRecord, language: InterfaceLanguage): string {
  const pl = language === "pl";
  switch (event.eventType) {
    case "CONTROLLER_STEP": return pl ? "Dokładne polecenie kontrolera" : "Exact controller instruction";
    case "SPECIAL_TASK_INJECTED": return pl ? "Specjalne zadanie Viewera" : "Special Viewer task";
    case "MONITOR_INTERVENTION": return pl ? "Interwencja Monitora" : "Monitor intervention";
    case "VIEWER_MONITOR_RESPONSE": return pl ? "Odpowiedź Viewera na Monitor" : "Viewer response to Monitor";
    case "VIEWER_SPECIAL_TASK_RESPONSE": return pl ? "Odpowiedź Viewera na zadanie specjalne" : "Viewer special-task response";
    case "VIEWER_OUTPUT_INCOMPLETE": return pl ? "Niekompletna próba Viewera" : "Incomplete Viewer attempt";
    default: return pl ? "Odpowiedź Viewera" : "Viewer response";
  }
}

function blockKind(event: SessionEventRecord): DisplayKind {
  if (event.eventType === "CONTROLLER_STEP" || event.eventType === "SPECIAL_TASK_INJECTED") return "instruction";
  if (event.eventType === "MONITOR_INTERVENTION") return "monitor";
  if (event.eventType === "VIEWER_OUTPUT_INCOMPLETE") return "partial";
  return "viewer";
}

function displayable(event: SessionEventRecord): boolean {
  if (!event.content?.trim()) return false;
  return event.eventType === "CONTROLLER_STEP"
    || event.eventType === "SPECIAL_TASK_INJECTED"
    || event.eventType === "MONITOR_INTERVENTION"
    || event.eventType === "VIEWER_RESPONSE"
    || event.eventType === "VIEWER_SPECIAL_TASK_RESPONSE"
    || event.eventType === "VIEWER_MONITOR_RESPONSE"
    || event.eventType === "VIEWER_OUTPUT_INCOMPLETE";
}

export function buildBlindTranscriptBlocks(events: SessionEventRecord[], language: InterfaceLanguage): DisplayBlock[] {
  const pairs = new Map(monitorInstructionPairs(events).map(pair => [pair.controller.id, pair]));
  return [...events]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .filter(event => displayable(event) && !pairs.get(event.id)?.identical)
    .map(event => {
      const pairedInstruction = pairs.get(event.id);
      return {
        key: event.id,
        kind: blockKind(event),
        heading: carriesStepHeading(event) ? metadataHeading(event, language) : undefined,
        label: pairedInstruction ? (language === "pl" ? "Faktycznie wysłana instrukcja" : "Actually sent instruction") : blockLabel(event, language),
        content: event.content!.trim(),
        ...(pairedInstruction ? { note: sentMonitorInstructionNote(language) } : {}),
      };
    });
}

export function BlindTranscriptRecord({ events, fallbackTranscript, interfaceLanguage, sessionLanguage, className = "", liveSnapshot = false }: {
  events: SessionEventRecord[];
  fallbackTranscript: string;
  interfaceLanguage: InterfaceLanguage;
  sessionLanguage?: InterfaceLanguage;
  className?: string;
  liveSnapshot?: boolean;
}) {
  const blocks = buildBlindTranscriptBlocks(events, interfaceLanguage);
  const hasStoredTranscript = Boolean(fallbackTranscript.trim());
  const completeEventCoverage = hasCompleteEventCoverage(events, fallbackTranscript, sessionLanguage);
  const showLegacyFallback = hasStoredTranscript && !completeEventCoverage;

  // During a live run, progress.transcript and the asynchronously reloaded event
  // ledger can briefly describe different revisions of the same session. Mixing
  // those revisions duplicates phase headings/instructions. Prefer the newer
  // accepted transcript until the event ledger catches up. History/inspection
  // keeps the legacy mixed view so incomplete historical evidence is never lost.
  if (liveSnapshot && showLegacyFallback) {
    return <pre className={`blind-transcript-legacy ${className}`.trim()}>{fallbackTranscript}</pre>;
  }

  if (!blocks.length) {
    return <pre className={`blind-transcript-legacy ${className}`.trim()}>{fallbackTranscript || (interfaceLanguage === "pl" ? "Brak transkryptu." : "No transcript.")}</pre>;
  }

  return <div className={`blind-transcript-record ${className}`.trim()}>
    {showLegacyFallback && <section className="blind-transcript-fallback">
      <small>{interfaceLanguage === "pl" ? "Zapisany transkrypt (zgodność historyczna)" : "Stored transcript (legacy compatibility)"}</small>
      <pre className="blind-transcript-legacy">{fallbackTranscript}</pre>
    </section>}
    {blocks.map((block) => <section className={`blind-transcript-block ${block.kind}`} key={block.key}>
      {block.heading && <h5>{block.heading}</h5>}
      <small>{block.label}</small>
      {block.note && <p className="blind-transcript-instruction-note">{block.note}</p>}
      <SafeMarkdown content={block.content} />
    </section>)}
  </div>;
}
