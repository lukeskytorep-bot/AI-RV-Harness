import type { InterfaceLanguage } from "../types";
import { buildEffectiveMonitorPrompt, FACTORY_PROMPT_VERSION } from "../resources/systemPrompts";

export const MONITOR_PROMPT_VERSION = FACTORY_PROMPT_VERSION;

export function buildMonitorSystemPrompt(language: InterfaceLanguage, editablePrompt?: string): string {
  return buildEffectiveMonitorPrompt(language, editablePrompt);
}

export function buildMonitorUserPacket(language: InterfaceLanguage, phase: number, blindTranscript: string, exchangeNumber = 1, specialTask?: string): string {
  const heading = language === "pl" ? "BIEŻĄCA FAZA" : "CURRENT PHASE";
  const transcriptHeading = language === "pl" ? "ŚLEPY TRANSCRIPT VIEWERA" : "BLIND VIEWER TRANSCRIPT";
  const exchangeHeading = language === "pl" ? "NUMER WYMIANY W TEJ FAZIE" : "EXCHANGE NUMBER IN THIS PHASE";
  const task = specialTask?.trim()
    ? `\n\nSPECIAL MONITOR TASK (available after Phase 4):\n${specialTask.trim()}`
    : "";
  return `${heading}: ${phase}\n${exchangeHeading}: ${exchangeNumber}\n\n${transcriptHeading}:\n${blindTranscript}${task}`;
}
