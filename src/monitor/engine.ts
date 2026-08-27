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
  attempt?: number;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number }) => Promise<ProviderChatResponse>;
}): Promise<MonitorDecision> {
  if (input.model.providerConfigId !== input.providerConfig.id) throw new Error("Monitor model/provider route mismatch.");
  const messages: ProviderMessage[] = [
    { role: "system", content: input.effectiveSystemPrompt?.trim() || buildMonitorSystemPrompt(input.language, input.editablePrompt) },
    { role: "user", content: buildMonitorUserPacket(input.language, input.phase, input.blindTranscript, input.exchangeNumber, input.specialTask, input.packetOptions) },
  ];
  const maxOutputTokens = monitorOutputTokenBudget(input.model, input.attempt ?? 0);
  const settings = resolveGenerationSettings(input.model.capabilities, { maxOutputTokens });
  const response = await (input.chat ?? nativeProviderChat)({ config: input.providerConfig, modelId: input.model.modelId, messages, settings, timeoutMs: input.requestTimeoutMs });
  if (isIncompleteMonitorResponse(response)) {
    throw new Error(`provider returned an incomplete assistant response [finish-reason=${response.finishReason}]`);
  }
  return parseMonitorDecision(response.content);
}

export function parseMonitorDecision(raw: string): MonitorDecision {
  const clean = raw.trim();
  if (!clean) throw new Error("provider returned an empty assistant response");
  if (clean === "CONTINUE_PROTOCOL") return { decision: "CONTINUE_PROTOCOL" };
  return { decision: "INTERVENE", commandText: raw, rawResponse: raw };
}

export function monitorOutputTokenBudget(model: ProviderModel, attempt: number): number {
  const requested = attempt > 0 ? 8192 : 4096;
  const routeLimit = model.capabilities.maxOutputTokens;
  return Math.max(1, Math.floor(routeLimit ? Math.min(routeLimit, requested) : requested));
}

export function isIncompleteMonitorResponse(response: Pick<ProviderChatResponse, "content" | "finishReason">): boolean {
  return !response.content.trim() || Boolean(response.finishReason && ["length", "max_tokens", "max_output_tokens"].includes(response.finishReason.toLowerCase()));
}
