import { providerChat as nativeProviderChat } from "../providers/native";
import type { EffectiveGenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderUsage } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { MonitorRunRecord } from "../monitor/types";
import type { RvSession, SessionEventRecord } from "./types";

const SUCCESSFUL_PROVIDER_EVENTS = new Set([
  "VIEWER_RESPONSE",
  "VIEWER_SPECIAL_TASK_RESPONSE",
  "VIEWER_MONITOR_RESPONSE",
  "MONITOR_TELEMETRY",
]);

export interface ReplayChatRequest {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SessionReplay {
  repository: AppRepository;
  chat: (request: ReplayChatRequest) => Promise<ProviderChatResponse>;
  replayedResponseCount: number;
}

export function isRecoverableProviderInterruption(session: RvSession, events: SessionEventRecord[]): boolean {
  if (session.state !== "Interrupted" || session.preRevealSealedAt) return false;
  const stop = [...events].reverse().find((event) => event.eventType === "SESSION_STOPPED");
  const reason = stop?.content?.toLowerCase() ?? "";
  if (!reason || /user stop|cost limit|content[_ -]?filter|safety|blocked|api key|credential|unauthorized|forbidden|context length|invalid model|route mismatch/.test(reason)) return false;
  return /provider|api fail|response body|empty assistant|invalid json|timed? out|timeout|connection/.test(reason);
}

export function createSessionReplay(input: {
  repository: AppRepository;
  session: RvSession;
  events: SessionEventRecord[];
  monitorRun?: MonitorRunRecord;
  liveChat?: (request: ReplayChatRequest) => Promise<ProviderChatResponse>;
}): SessionReplay {
  const replayResponses = input.events
    .filter((event) => SUCCESSFUL_PROVIDER_EVENTS.has(event.eventType) && event.content?.trim() && event.metadata?.failed !== true)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    .map(eventResponse);
  let replayIndex = 0;
  let live = false;
  const base = input.repository;

  const beginLiveContinuation = async (): Promise<void> => {
    if (live) return;
    live = true;
    await base.updateRvSessionState(input.session.id, "BlindRunning");
    await base.appendSessionEvent(input.session.id, {
      eventType: "SESSION_RESUMED",
      role: "controller",
      metadata: { replayedResponseCount: replayResponses.length, resumedAt: new Date().toISOString() },
    });
  };

  const chat = async (request: ReplayChatRequest): Promise<ProviderChatResponse> => {
    const replay = replayResponses[replayIndex];
    if (replay) {
      replayIndex += 1;
      return replay;
    }
    await beginLiveContinuation();
    return (input.liveChat ?? nativeProviderChat)(request);
  };

  const repository = new Proxy(base, {
    get(target, property, receiver) {
      if (property === "createRvSession") return async () => input.session;
      if (property === "createMonitorRun" && !live) return async () => {
        if (!input.monitorRun) throw new Error("The saved AI Monitor run required for continuation is unavailable.");
        return input.monitorRun.id;
      };
      if (!live && typeof property === "string" && SUPPRESSED_REPLAY_WRITES.has(property)) return async () => undefined;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as AppRepository;

  return { repository, chat, replayedResponseCount: replayResponses.length };
}

function eventResponse(event: SessionEventRecord): ProviderChatResponse {
  const metadata = event.metadata ?? {};
  return {
    content: event.content ?? "",
    ...(typeof metadata.finishReason === "string" ? { finishReason: metadata.finishReason } : {}),
    ...(typeof metadata.actualModel === "string" ? { actualModel: metadata.actualModel } : {}),
    ...(typeof metadata.providerRequestId === "string" ? { providerRequestId: metadata.providerRequestId } : {}),
    usage: isUsage(metadata.usage) ? metadata.usage : {},
  };
}

function isUsage(value: unknown): value is ProviderUsage {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const SUPPRESSED_REPLAY_WRITES = new Set([
  "updateRvSessionState",
  "appendSessionEvent",
  "updatePreRevealTranscript",
  "saveSessionSnapshot",
  "sealPreReveal",
  "acceptReveal",
  "appendMonitorIntervention",
  "recordTargetUsage",
]);
