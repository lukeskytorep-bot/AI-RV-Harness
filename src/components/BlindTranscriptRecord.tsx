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
}

const ACCEPTED_VIEWER_EVENTS = new Set(["VIEWER_RESPONSE", "VIEWER_SPECIAL_TASK_RESPONSE", "VIEWER_MONITOR_RESPONSE"]);
const BAD_FINISH_REASONS = new Set(["length", "max_tokens", "max_output_tokens", "max_completion_tokens", "error", "failed", "failure", "content_filter", "safety", "blocked", "refusal", "refused"]);

function normalizedFinishReason(event: SessionEventRecord): string {
  return typeof event.metadata?.finishReason === "string"
    ? event.metadata.finishReason.trim().toLowerCase().replace(/[ -]/g, "_")
    : "";
}

function isAcceptedViewerEvent(event: SessionEventRecord): boolean {
  if (!ACCEPTED_VIEWER_EVENTS.has(event.eventType) || !event.content?.trim()) return false;
  if (event.metadata?.accepted === false) return false;
  if (BAD_FINISH_REASONS.has(normalizedFinishReason(event))) return false;
  return true;
}

function metadataHeading(event: SessionEventRecord, language: InterfaceLanguage): string | undefined {
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

function appendBlock(current: string, block: string): string {
  const clean = block.trim();
  return current ? `${current}\n\n${clean}` : clean;
}

function rcpPhaseBlock(phase: number | string, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `## Faza ${phase}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${response.trim()}`
    : `## Phase ${phase}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${response.trim()}`;
}

function rcpSpecialTaskBlock(phase: number | string, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `## Zadanie specjalne — po Fazie ${phase}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${response.trim()}`
    : `## Special Task — after Phase ${phase}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${response.trim()}`;
}

function rcpMonitorBlock(phase: number | string, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `### Pogłębienie AI Monitora po Fazie ${phase}\n\n#### Dokładne polecenie Monitora\n\n${prompt.trim()}\n\n#### Odpowiedź Viewera\n\n${response.trim()}`
    : `### AI Monitor deepening after Phase ${phase}\n\n#### Exact Monitor instruction\n\n${prompt.trim()}\n\n#### Viewer response\n\n${response.trim()}`;
}

function liteBlock(promptNumber: number, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `## RV Lite — krok ${promptNumber}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${response.trim()}`
    : `## RV Lite — Step ${promptNumber}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${response.trim()}`;
}

function liteSpecialTaskBlock(prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `## RV Lite — zadanie specjalne po Kroku 3\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${response.trim()}`
    : `## RV Lite — Special Task after Step 3\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${response.trim()}`;
}

function customBlock(step: number | string, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `## Protokół własny — krok ${step}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${response.trim()}`
    : `## Custom protocol — Step ${step}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${response.trim()}`;
}

function telepathicStepBlock(step: number, prompt: string, response: string, language: InterfaceLanguage): string {
  const phase = step === 1 ? "T0–T1" : step === 2 ? "T2" : step === 9 ? "T10" : `T${step}`;
  return language === "pl"
    ? `## Protokół Telepatyczny — Krok ${step} (${phase})\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${response.trim()}`
    : `## Telepathic Protocol — Step ${step} (${phase})\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${response.trim()}`;
}

function telepathicDeepeningBlock(step: number, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `### Obowiązkowe pogłębienie Kroku ${step}\n\n#### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n#### Odpowiedź Viewera\n\n${response.trim()}`
    : `### Mandatory deepening of Step ${step}\n\n#### Exact controller instruction\n\n${prompt.trim()}\n\n#### Viewer response\n\n${response.trim()}`;
}

function telepathicQuestionBlock(questionNumber: number, source: "operator" | "monitor", prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `### T9 — pytanie ${questionNumber} (${source === "monitor" ? "AI Monitor" : "operator"})\n\n#### Pytanie\n\n${prompt.trim()}\n\n#### Odpowiedź Viewera\n\n${response.trim()}`
    : `### T9 — Question ${questionNumber} (${source === "monitor" ? "AI Monitor" : "operator"})\n\n#### Question\n\n${prompt.trim()}\n\n#### Viewer response\n\n${response.trim()}`;
}

function telepathicMonitorBlock(step: number, prompt: string, response: string, language: InterfaceLanguage): string {
  return language === "pl"
    ? `### AI Monitor — pogłębienie po Kroku ${step}\n\n#### Dokładne polecenie Monitora\n\n${prompt.trim()}\n\n#### Odpowiedź Viewera\n\n${response.trim()}`
    : `### AI Monitor — deepening after Step ${step}\n\n#### Exact Monitor instruction\n\n${prompt.trim()}\n\n#### Viewer response\n\n${response.trim()}`;
}

function precedingPrompt(events: SessionEventRecord[], responseIndex: number, predicate: (event: SessionEventRecord) => boolean): SessionEventRecord | undefined {
  for (let index = responseIndex - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (predicate(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Rebuilds only the accepted blind transcript using the same markdown shapes as
 * the four session controllers. Incomplete/rejected attempts are intentionally
 * excluded: they are presentation/diagnostic records, never accepted transcript.
 */
export function reconstructAcceptedBlindTranscript(events: SessionEventRecord[], language: InterfaceLanguage): string | null {
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  let transcript = "";

  for (let index = 0; index < ordered.length; index += 1) {
    const response = ordered[index];
    if (!isAcceptedViewerEvent(response)) continue;
    const metadata = response.metadata ?? {};
    const phase = typeof metadata.phase === "number" || typeof metadata.phase === "string" ? metadata.phase : undefined;
    const promptNumber = typeof metadata.promptNumber === "number" ? metadata.promptNumber : undefined;
    const step = typeof metadata.step === "number" ? metadata.step : undefined;
    const questionNumber = typeof metadata.questionNumber === "number" ? metadata.questionNumber : undefined;
    const source = typeof metadata.source === "string" ? metadata.source : undefined;
    const customProtocol = typeof metadata.customProtocol === "string" && metadata.customProtocol.trim() ? metadata.customProtocol : undefined;
    const matchingCustomPrompt = step !== undefined ? precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP"
      && event.metadata?.step === step
      && typeof event.metadata?.customProtocol === "string"
      && Boolean(event.metadata.customProtocol.trim())) : undefined;

    if (response.eventType === "VIEWER_SPECIAL_TASK_RESPONSE") {
      const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "SPECIAL_TASK_INJECTED" && (
        promptNumber !== undefined ? event.metadata?.promptNumber === promptNumber : phase !== undefined ? event.metadata?.phase === phase : true
      ));
      if (!prompt?.content?.trim()) return null;
      transcript = appendBlock(transcript, promptNumber !== undefined
        ? liteSpecialTaskBlock(prompt.content, response.content!, language)
        : phase !== undefined
          ? rcpSpecialTaskBlock(phase, prompt.content, response.content!, language)
          : "");
      if (!transcript) return null;
      continue;
    }

    if (response.eventType === "VIEWER_MONITOR_RESPONSE") {
      const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "MONITOR_INTERVENTION" && (phase === undefined || event.metadata?.phase === phase));
      if (!prompt?.content?.trim() || phase === undefined) return null;
      transcript = appendBlock(transcript, rcpMonitorBlock(phase, prompt.content, response.content!, language));
      continue;
    }

    if (step !== undefined && (customProtocol || matchingCustomPrompt)) {
      const prompt = matchingCustomPrompt ?? precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP" && event.metadata?.step === step && event.metadata?.customProtocol === customProtocol);
      if (!prompt?.content?.trim()) return null;
      transcript = appendBlock(transcript, customBlock(step, prompt.content, response.content!, language));
      continue;
    }

    if (promptNumber !== undefined) {
      const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP" && event.metadata?.promptNumber === promptNumber);
      if (!prompt?.content?.trim()) return null;
      transcript = appendBlock(transcript, liteBlock(promptNumber, prompt.content, response.content!, language));
      continue;
    }

    if (step !== undefined) {
      if (metadata.telepathicPhase === "T9" && questionNumber !== undefined) {
        const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP"
          && event.metadata?.step === step
          && event.metadata?.questionNumber === questionNumber
          && event.metadata?.telepathicPhase === "T9");
        if (!prompt?.content?.trim()) return null;
        transcript = appendBlock(transcript, telepathicQuestionBlock(questionNumber, source === "monitor" ? "monitor" : "operator", prompt.content, response.content!, language));
        continue;
      }
      if (source === "monitor_intervention") {
        const exchangeNumber = metadata.exchangeNumber;
        const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "MONITOR_INTERVENTION"
          && event.metadata?.step === step
          && (exchangeNumber === undefined || event.metadata?.exchangeNumber === exchangeNumber));
        if (!prompt?.content?.trim()) return null;
        transcript = appendBlock(transcript, telepathicMonitorBlock(step, prompt.content, response.content!, language));
        continue;
      }
      if (source === "mandatory_fixed_deepening") {
        const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP" && event.metadata?.step === step && event.metadata?.source === "mandatory_fixed_deepening");
        if (!prompt?.content?.trim()) return null;
        transcript = appendBlock(transcript, telepathicDeepeningBlock(step, prompt.content, response.content!, language));
        continue;
      }
      const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP" && event.metadata?.step === step && event.metadata?.source !== "mandatory_fixed_deepening");
      if (!prompt?.content?.trim()) return null;
      transcript = appendBlock(transcript, telepathicStepBlock(step, prompt.content, response.content!, language));
      continue;
    }

    if (phase !== undefined) {
      const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "CONTROLLER_STEP" && event.metadata?.phase === phase);
      if (!prompt?.content?.trim()) return null;
      transcript = appendBlock(transcript, rcpPhaseBlock(phase, prompt.content, response.content!, language));
      continue;
    }

    // Unknown legacy event shape: retain the stored transcript rather than
    // claiming complete event coverage from ambiguous data.
    return null;
  }

  return transcript;
}

function normalizedTranscript(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function hasCompleteEventCoverage(events: SessionEventRecord[], fallbackTranscript: string, sessionLanguage?: InterfaceLanguage): boolean {
  if (!fallbackTranscript.trim()) return true;
  if (!sessionLanguage) return false;
  const reconstructed = reconstructAcceptedBlindTranscript(events, sessionLanguage);
  return reconstructed !== null && normalizedTranscript(reconstructed) === normalizedTranscript(fallbackTranscript);
}

export function buildBlindTranscriptBlocks(events: SessionEventRecord[], language: InterfaceLanguage): DisplayBlock[] {
  return [...events]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .filter(displayable)
    .map((event) => ({
      key: event.id,
      kind: blockKind(event),
      heading: carriesStepHeading(event) ? metadataHeading(event, language) : undefined,
      label: blockLabel(event, language),
      content: event.content!.trim(),
    }));
}

export function BlindTranscriptRecord({ events, fallbackTranscript, interfaceLanguage, sessionLanguage, className = "" }: {
  events: SessionEventRecord[];
  fallbackTranscript: string;
  interfaceLanguage: InterfaceLanguage;
  sessionLanguage?: InterfaceLanguage;
  className?: string;
}) {
  const blocks = buildBlindTranscriptBlocks(events, interfaceLanguage);
  const showLegacyFallback = Boolean(fallbackTranscript.trim()) && !hasCompleteEventCoverage(events, fallbackTranscript, sessionLanguage);

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
      <SafeMarkdown content={block.content} />
    </section>)}
  </div>;
}
