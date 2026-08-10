import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { InterfaceLanguage } from "../types";
import { evidenceSatisfies, getMonitorCommand, renderMonitorCommand } from "./library";
import { buildMonitorSystemPrompt, buildMonitorUserPacket } from "./prompt";

export type MonitorDecision =
  | { decision: "CONTINUE_PROTOCOL" }
  | { decision: "INTERVENE"; commandId: string; viewerEvidence: string; argument?: string; commandText: string };

export type MonitorDecisionErrorCode =
  | "INVALID_JSON"
  | "INVALID_DECISION"
  | "UNKNOWN_COMMAND"
  | "MISSING_EVIDENCE"
  | "NON_VERBATIM_EVIDENCE"
  | "PREREQUISITE_MISMATCH"
  | "UNGROUNDED_ARGUMENT";

export class MonitorDecisionError extends Error {
  constructor(
    public readonly code: MonitorDecisionErrorCode,
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = "MonitorDecisionError";
  }
}

export async function evaluateMonitor(input: {
  providerConfig: ProviderConfig;
  model: ProviderModel;
  language: InterfaceLanguage;
  phase: number;
  blindTranscript: string;
  requestTimeoutMs?: number;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number }) => Promise<ProviderChatResponse>;
}): Promise<MonitorDecision> {
  if (input.model.providerConfigId !== input.providerConfig.id) throw new Error("Monitor model/provider route mismatch.");
  const messages: ProviderMessage[] = [
    { role: "system", content: buildMonitorSystemPrompt(input.language) },
    { role: "user", content: buildMonitorUserPacket(input.language, input.phase, input.blindTranscript) },
  ];
  const maxOutputTokens = Math.min(input.model.capabilities.maxOutputTokens ?? 800, 800);
  const settings = resolveGenerationSettings(input.model.capabilities, { maxOutputTokens });
  const response = await (input.chat ?? nativeProviderChat)({ config: input.providerConfig, modelId: input.model.modelId, messages, settings, timeoutMs: input.requestTimeoutMs });
  return validateMonitorDecision(response.content, input.blindTranscript, input.language);
}

export function validateMonitorDecision(raw: string, blindTranscript: string, language: InterfaceLanguage): MonitorDecision {
  let parsed: Record<string, unknown>;
  try {
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    throw new MonitorDecisionError("INVALID_JSON", "AI Monitor returned invalid JSON; intervention blocked.", raw);
  }
  if (parsed.decision === "CONTINUE_PROTOCOL") return { decision: "CONTINUE_PROTOCOL" };
  if (parsed.decision !== "INTERVENE" || typeof parsed.command_id !== "string") {
    throw new MonitorDecisionError("INVALID_DECISION", "AI Monitor returned an invalid decision; intervention blocked.", raw);
  }
  const command = getMonitorCommand(parsed.command_id);
  if (!command) throw new MonitorDecisionError("UNKNOWN_COMMAND", "AI Monitor requested an unknown command; intervention blocked.", raw);
  const evidence = typeof parsed.viewer_evidence === "string" ? parsed.viewer_evidence.trim() : "";
  if (command.prerequisite !== "none") {
    if (!evidence) throw new MonitorDecisionError("MISSING_EVIDENCE", `AI Monitor supplied no Viewer evidence for ${command.id}; intervention blocked.`, raw);
    if (!containsVerbatim(blindTranscript, evidence)) throw new MonitorDecisionError("NON_VERBATIM_EVIDENCE", `AI Monitor evidence is not a verbatim Viewer excerpt for ${command.id}; intervention blocked.`, raw);
    if (!evidenceSatisfies(command, evidence)) throw new MonitorDecisionError("PREREQUISITE_MISMATCH", `AI Monitor prerequisite failed for ${command.id}; intervention blocked.`, raw);
  }
  const argument = typeof parsed.argument === "string" ? parsed.argument.trim() : undefined;
  if (command.argument) {
    if (!argument || argument.length > 160 || !containsVerbatim(blindTranscript, argument)) {
      throw new MonitorDecisionError("UNGROUNDED_ARGUMENT", `AI Monitor argument is not grounded in Viewer evidence for ${command.id}; intervention blocked.`, raw);
    }
  }
  return {
    decision: "INTERVENE",
    commandId: command.id,
    viewerEvidence: evidence,
    ...(argument ? { argument } : {}),
    commandText: renderMonitorCommand(command, language, argument),
  };
}

function containsVerbatim(transcript: string, fragment: string): boolean {
  return transcript.toLocaleLowerCase().includes(fragment.toLocaleLowerCase());
}
