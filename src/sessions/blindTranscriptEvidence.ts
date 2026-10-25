import { focusTranscriptContent, sessionFocusLabel, type SessionFocus } from "./sessionFocus";
import type { InterfaceLanguage } from "../types";
import type { SessionEventRecord } from "./types";
import { monitorInstructionPairs, monitorInstructionMarkdown } from "./monitorInterventions";

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

function telepathicQuestionBlock(questionNumber: number, source: "operator" | "monitor", prompt: string, response: string, language: InterfaceLanguage, monitorCommand?: string): string {
  const question = monitorCommand !== undefined ? monitorInstructionMarkdown(monitorCommand, prompt, language) : `#### ${language === "pl" ? "Pytanie" : "Question"}\n\n${prompt.trim()}`;
  return language === "pl"
    ? `### T9 — pytanie ${questionNumber} (${source === "monitor" ? "AI Monitor" : "operator"})\n\n${question}\n\n#### Odpowiedź Viewera\n\n${response.trim()}`
    : `### T9 — Question ${questionNumber} (${source === "monitor" ? "AI Monitor" : "operator"})\n\n${question}\n\n#### Viewer response\n\n${response.trim()}`;
}

function telepathicMonitorBlock(step: number, prompt: string, response: string, language: InterfaceLanguage, sentPrompt = prompt): string {
  const instruction = monitorInstructionMarkdown(prompt, sentPrompt, language);
  return language === "pl"
    ? `### AI Monitor — pogłębienie po Kroku ${step}\n\n${instruction}\n\n#### Odpowiedź Viewera\n\n${response.trim()}`
    : `### AI Monitor — deepening after Step ${step}\n\n${instruction}\n\n#### Viewer response\n\n${response.trim()}`;
}

function precedingPrompt(events: SessionEventRecord[], responseIndex: number, predicate: (event: SessionEventRecord) => boolean): SessionEventRecord | undefined {
  for (let index = responseIndex - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (candidate.sessionId === events[responseIndex].sessionId && candidate.metadata?.passIndex === events[responseIndex].metadata?.passIndex && predicate(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Rebuilds only the accepted blind transcript using the same markdown shapes as
 * the four session controllers. Incomplete/rejected attempts are intentionally
 * excluded: they are presentation/diagnostic records, never accepted transcript.
 */
export function reconstructAcceptedBlindTranscript(events: SessionEventRecord[], language: InterfaceLanguage, includeSentInstructions = true): string | null {
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber).map(event=>({...event,content:typeof event.metadata?.passIndex==="number" && event.content ? focusTranscriptContent(event.content,{version:1,first:event.metadata.sessionFocus as SessionFocus}) : event.content}));
  const pairs = new Map(monitorInstructionPairs(ordered).map(pair => [pair.controller.id, pair]));
  let lastPass:unknown;
  let transcript = "";

  for (let index = 0; index < ordered.length; index += 1) {
    const response = ordered[index];
    if (!isAcceptedViewerEvent(response)) continue;
    const metadata = response.metadata ?? {};
    if(typeof metadata.passIndex==="number" && metadata.passIndex!==lastPass) {
      transcript=appendBlock(transcript,`## ${language==="pl"?"Sesja":"Session"} ${metadata.passIndex} — ${sessionFocusLabel(metadata.sessionFocus as SessionFocus,language)}`);
      lastPass=metadata.passIndex;
    }
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
        transcript = appendBlock(transcript, telepathicQuestionBlock(questionNumber, source === "monitor" ? "monitor" : "operator", prompt.content, response.content!, language, includeSentInstructions ? pairs.get(prompt.id)?.monitor.content : undefined));
        continue;
      }
      if (source === "monitor_intervention") {
        const exchangeNumber = metadata.exchangeNumber;
        const prompt = precedingPrompt(ordered, index, (event) => event.eventType === "MONITOR_INTERVENTION"
          && event.metadata?.step === step
          && (exchangeNumber === undefined || event.metadata?.exchangeNumber === exchangeNumber));
        if (!prompt?.content?.trim()) return null;
        const sent = precedingPrompt(ordered, index, event => event.eventType === "CONTROLLER_STEP"
          && event.metadata?.step === step && event.metadata?.source === "monitor_intervention"
          && event.metadata?.exchangeNumber === exchangeNumber);
        const pair = sent ? pairs.get(sent.id) : undefined;
        if (includeSentInstructions && pair?.monitor.id !== prompt.id) return null;
        transcript = appendBlock(transcript, telepathicMonitorBlock(step, prompt.content, response.content!, language, includeSentInstructions ? sent?.content : undefined));
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

export function hasCompleteEventCoverage(events: SessionEventRecord[], fallbackTranscript: string, sessionLanguage?: InterfaceLanguage): boolean {
  if (!fallbackTranscript.trim()) return true;
  if (!sessionLanguage) return false;
  const reconstructed = reconstructAcceptedBlindTranscript(events, sessionLanguage);
  if (reconstructed !== null && normalizedTranscript(reconstructed) === normalizedTranscript(fallbackTranscript)) return true;
  // Old sealed transcripts did not include a T9 wrapper; verify their full accepted coverage before projecting it.
  const legacy = reconstructAcceptedBlindTranscript(events, sessionLanguage, false);
  return legacy !== null && normalizedTranscript(legacy) === normalizedTranscript(fallbackTranscript);
}


/** Read-only export projection. Unknown/partial event coverage never replaces sealed evidence. */
export function readableBlindTranscript(events: SessionEventRecord[], storedTranscript: string, language: InterfaceLanguage): string {
  if (!hasCompleteEventCoverage(events, storedTranscript, language)) return storedTranscript;
  return reconstructAcceptedBlindTranscript(events, language) ?? storedTranscript;
}
