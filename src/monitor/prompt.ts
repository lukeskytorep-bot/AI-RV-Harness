import type { InterfaceLanguage } from "../types";
import { buildEffectiveMonitorPrompt, FACTORY_PROMPT_VERSION } from "../resources/systemPrompts";

export const MONITOR_PROMPT_VERSION = FACTORY_PROMPT_VERSION;

export function buildMonitorSystemPrompt(language: InterfaceLanguage, editablePrompt?: string): string {
  return buildEffectiveMonitorPrompt(language, editablePrompt);
}

export interface MonitorPacketOptions {
  stageKind?: "phase" | "step";
  protocolName?: string;
  wholeSessionScope?: boolean;
}

export function buildMonitorUserPacket(language: InterfaceLanguage, phase: number, blindTranscript: string, exchangeNumber = 1, specialTask?: string, options: MonitorPacketOptions = {}): string {
  const stageKind = options.stageKind ?? "phase";
  const heading = stageKind === "step"
    ? (language === "pl" ? "BIEŻĄCY KROK" : "CURRENT STEP")
    : (language === "pl" ? "BIEŻĄCA FAZA" : "CURRENT PHASE");
  const transcriptHeading = language === "pl" ? "ŚLEPY TRANSCRIPT VIEWERA" : "BLIND VIEWER TRANSCRIPT";
  const exchangeHeading = language === "pl" ? "NUMER WYMIANY W TYM CYKLU" : "EXCHANGE NUMBER IN THIS CYCLE";
  const task = specialTask?.trim()
    ? `\n\nSPECIAL MONITOR TASK (available after Phase 4):\n${specialTask.trim()}`
    : "";
  const protocol = options.protocolName?.trim() ? `\nPROTOCOL: ${options.protocolName.trim()}` : "";
  const scope = options.wholeSessionScope
    ? (language === "pl"
        ? "\nZAKRES: Możesz sformułować pytanie T9 odnoszące się do całej dotychczasowej sesji."
        : "\nSCOPE: You may formulate a T9 question referring to the entire session so far.")
    : "";
  return `${heading}: ${phase}${protocol}${scope}\n${exchangeHeading}: ${exchangeNumber}\n\n${transcriptHeading}:\n${blindTranscript}${task}`;
}
