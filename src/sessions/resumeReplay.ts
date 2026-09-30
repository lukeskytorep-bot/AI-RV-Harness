import { providerChatOnce } from "../providers/requestExecutor";
import type { EffectiveGenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderUsage } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { MonitorRunRecord } from "../monitor/types";
import type { RvSession, SessionEventRecord } from "./types";
import { hydrateSessionMessageContinuationForRequest, validateFrozenSessionContinuationRequest, validateSessionContinuationBudget } from "./providerContinuation";

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

export async function createSessionReplay(input: {
  repository: AppRepository;
  session: RvSession;
  events: SessionEventRecord[];
  monitorRun?: MonitorRunRecord;
  liveChat?: (request: ReplayChatRequest) => Promise<ProviderChatResponse>;
}): Promise<SessionReplay> {
  const snapshot = await input.repository.getSessionSnapshot(input.session.id);
  if (!snapshot) throw new Error("The saved Session Snapshot required for Resume is unavailable.");
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
    let messages = request.messages;
    const isViewerRequest = request.config.id === snapshot.providerConfigId && request.modelId === snapshot.modelId;
    const frozenRoute = isViewerRequest
      ? validateFrozenSessionContinuationRequest(snapshot, request.config, request.modelId)
      : undefined;
    if (frozenRoute) {
      const viewerEvents = (await base.listSessionEvents(input.session.id))
        .filter((event) => ["VIEWER_RESPONSE", "VIEWER_SPECIAL_TASK_RESPONSE", "VIEWER_MONITOR_RESPONSE"].includes(event.eventType) && event.content?.trim() && event.metadata?.failed !== true)
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
      let viewerIndex = 0;
      messages = [];
      for (const message of request.messages) {
        if (message.role !== "assistant") { messages.push(message); continue; }
        const event = viewerEvents[viewerIndex++];
        if (!event) throw new Error("Resume reconstructed an assistant message without a matching persisted Session event.");
        messages.push(await hydrateSessionMessageContinuationForRequest({ repository: base, snapshot, config: request.config, requestedModelId: request.modelId, event, message }));
      }
      validateSessionContinuationBudget(messages);
    }
    // The resumed controller owns retry. Replay supplies exactly one physical
    // live attempt after all durable responses have been replayed.
    return providerChatOnce({ ...request, messages }, input.liveChat);
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
  "appendSessionEventWithProviderState",
  "updatePreRevealTranscript",
  "saveSessionSnapshot",
  "sealPreReveal",
  "acceptReveal",
  "appendMonitorIntervention",
  "recordTargetUsage",
]);
