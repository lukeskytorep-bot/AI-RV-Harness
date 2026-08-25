import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { InterfaceLanguage } from "../types";
import { buildMonitorSystemPrompt, buildMonitorUserPacket, type MonitorPacketOptions } from "./prompt";

export type MonitorDecision =
  | { decision: "CONTINUE_PROTOCOL" }
  | { decision: "INTERVENE"; commandText: string; rawResponse: string };

export async function evaluateMonitor(input: {
  providerConfig: ProviderConfig;
  model: ProviderModel;
  language: InterfaceLanguage;
  phase: number;
  blindTranscript: string;
  exchangeNumber?: number;
  editablePrompt?: string;
  effectiveSystemPrompt?: string;
  specialTask?: string;
  packetOptions?: MonitorPacketOptions;
  requestTimeoutMs?: number;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number }) => Promise<ProviderChatResponse>;
}): Promise<MonitorDecision> {
  if (input.model.providerConfigId !== input.providerConfig.id) throw new Error("Monitor model/provider route mismatch.");
  const messages: ProviderMessage[] = [
    { role: "system", content: input.effectiveSystemPrompt?.trim() || buildMonitorSystemPrompt(input.language, input.editablePrompt) },
    { role: "user", content: buildMonitorUserPacket(input.language, input.phase, input.blindTranscript, input.exchangeNumber, input.specialTask, input.packetOptions) },
  ];
  const maxOutputTokens = Math.min(input.model.capabilities.maxOutputTokens ?? 800, 800);
  const settings = resolveGenerationSettings(input.model.capabilities, { maxOutputTokens });
  const response = await (input.chat ?? nativeProviderChat)({ config: input.providerConfig, modelId: input.model.modelId, messages, settings, timeoutMs: input.requestTimeoutMs });
  return parseMonitorDecision(response.content);
}

export function parseMonitorDecision(raw: string): MonitorDecision {
  const clean = raw.trim().replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!clean || /^CONTINUE(?:_PROTOCOL)?[.!]?$/i.test(clean)) return { decision: "CONTINUE_PROTOCOL" };
  return { decision: "INTERVENE", commandText: clean, rawResponse: raw };
}
