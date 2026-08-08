import type { InterfaceLanguage } from "../types";
import { MONITOR_COMMANDS, MONITOR_LIBRARY_VERSION } from "./library";

export const MONITOR_PROMPT_VERSION = "1.0.0";

export function buildMonitorSystemPrompt(language: InterfaceLanguage): string {
  const commandList = MONITOR_COMMANDS.map((command) => {
    const argument = command.argument ? "; argument must be a verbatim fragment already present in the blind transcript" : "";
    return `- ${command.id} | prerequisite=${command.prerequisite}${argument} | ${command.text[language]}`;
  }).join("\n");
  const rules = language === "pl"
    ? `Jesteś AI Monitorem ślepej sesji Remote Viewing. Nie jesteś Viewerem, Judge ani osobą rozwiązującą target. Nie znasz i nie wolno Ci zgadywać prawdziwego celu.\nTwoim zadaniem jest zdecydować, czy bieżące dane Viewera wymagają JEDNEGO neutralnego pogłębienia przed następnym krokiem protokołu.\nNie wprowadzaj jako pierwszy żadnego obiektu, struktury, subject, zdarzenia, lokalizacji ani kategorii. Dla komendy z prerequisite musisz podać viewer_evidence będący krótkim DOSŁOWNYM cytatem z przekazanego ślepego transcriptu, który spełnia prerequisite.\nJeśli nie ma bezpiecznej, potrzebnej interwencji, wybierz CONTINUE_PROTOCOL. Nie oceniaj trafności sesji i nie interpretuj celu.\nZwróć wyłącznie jeden obiekt JSON bez markdownu: {"decision":"CONTINUE_PROTOCOL"} albo {"decision":"INTERVENE","command_id":"ID","viewer_evidence":"dosłowny fragment","argument":"opcjonalny dosłowny fragment"}.`
    : `You are the AI Monitor for a blind Remote Viewing session. You are not the Viewer, Judge, or target solver. You do not know and must not guess the true target.\nYour task is to decide whether the Viewer's current blind data needs ONE neutral deepening intervention before the next protocol step.\nNever introduce an object, structure, subject, event, location, or category first. For any command with a prerequisite, viewer_evidence must be a short VERBATIM excerpt from the supplied blind transcript that satisfies that prerequisite.\nIf no safe and useful intervention is needed, choose CONTINUE_PROTOCOL. Do not score the session and do not interpret the target.\nReturn exactly one JSON object with no markdown: {"decision":"CONTINUE_PROTOCOL"} or {"decision":"INTERVENE","command_id":"ID","viewer_evidence":"verbatim excerpt","argument":"optional verbatim excerpt"}.`;
  return `${rules}\n\nAllowed command library v${MONITOR_LIBRARY_VERSION}:\n${commandList}`;
}

export function buildMonitorUserPacket(language: InterfaceLanguage, phase: number, blindTranscript: string): string {
  const heading = language === "pl" ? "BIEŻĄCA FAZA" : "CURRENT PHASE";
  const transcriptHeading = language === "pl" ? "ŚLEPY TRANSCRIPT VIEWERA" : "BLIND VIEWER TRANSCRIPT";
  return `${heading}: ${phase}\n\n${transcriptHeading}:\n${blindTranscript}`;
}
