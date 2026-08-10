import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { ProtocolResource } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import type { TargetRecord } from "../targets/types";
import { evaluateMonitor, MonitorDecisionError, type MonitorDecision } from "../monitor/engine";
import { MONITOR_LIBRARY_VERSION } from "../monitor/library";
import { MONITOR_PROMPT_VERSION } from "../monitor/prompt";
import { RCP_CONTROLLER_PROMPT_ID, RCP_CONTROLLER_PROMPT_VERSION, rcpPhasePrompt } from "./controllerPrompts";
import { emptySessionRequestMetrics, recordProviderRequest, snapshotSessionMetrics, type SessionRequestMetrics, type SessionRunMetrics } from "./metrics";
import type { RevealArtifactRecord, RvSessionState, SessionSnapshot } from "./types";
import { buildAutomaticTargetReveal, targetHasSupportedReveal } from "../targets/service";
import { APP_VERSION } from "../version";
import { createSessionCode } from "./sessionCode";
import { CostGuardStop, SessionCostGuard } from "./costGuard";
import { RepetitionGuard, formatRepetitionStopReason } from "./repetitionGuard";

export { detectRepetitiveOutput } from "./repetitionGuard";

type SessionRepository = Pick<
  AppRepository,
  | "createRvSession"
  | "updateRvSessionState"
  | "appendSessionEvent"
  | "updatePreRevealTranscript"
  | "saveSessionSnapshot"
  | "sealPreReveal"
  | "acceptReveal"
  | "createMonitorRun"
  | "appendMonitorIntervention"
  | "recordTargetUsage"
>;

export interface AutomaticRcpRunInput {
  repository: SessionRepository;
  workspaceId: string;
  profileId: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  protocol: ProtocolResource;
  sessionLanguage: InterfaceLanguage;
  requestedSettings: GenerationSettings;
  signal?: AbortSignal;
  maxRetries?: number;
  requestTimeoutMs?: number;
  maxSessionCostUsd?: number;
  sessionCodePrefix?: string;
  automaticTarget?: TargetRecord;
  researchProjectId?: string;
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
  researchConditionInstruction?: ViewerSystemPromptSnapshot;
  monitor?: {
    providerConfig: ProviderConfig;
    model: ProviderModel;
    maxInterventions?: number;
  };
  chat?: (input: {
    config: ProviderConfig;
    modelId: string;
    messages: ProviderMessage[];
    settings: ReturnType<typeof resolveGenerationSettings>;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) => Promise<ProviderChatResponse>;
  onSessionCreated?: (sessionId: string, sessionCode: string) => Promise<void>;
  onProgress?: (progress: SessionProgress) => void;
}

export interface SessionProgress {
  sessionId: string;
  sessionCode: string;
  state: RvSessionState;
  phase?: number;
  transcript: string;
  stopReason?: string;
  metrics?: SessionRunMetrics;
}

export interface AutomaticRcpRunResult {
  sessionId: string;
  sessionCode: string;
  state: "AwaitingReveal" | "Revealed" | "Interrupted";
  transcript: string;
  stopReason?: string;
}

export async function runAutomaticRcpSession(input: AutomaticRcpRunInput): Promise<AutomaticRcpRunResult> {
  validateRunInput(input);
  const effectiveSettings = resolveGenerationSettings(input.model.capabilities, input.requestedSettings);
  if (effectiveSettings.omitted.length) {
    throw new Error(`Unsupported generation settings: ${effectiveSettings.omitted.join(", ")}`);
  }
  const costGuard = new SessionCostGuard(input.maxSessionCostUsd);
  costGuard.validateModel(input.model);
  if (input.monitor) costGuard.validateModel(input.monitor.model);

  const sessionId = `session_${crypto.randomUUID()}`;
  const sessionCode = createSessionCode(input.sessionCodePrefix);
  const createdAt = new Date().toISOString();
  const startedAtMs = Date.now();
  let transcript = "";
  let metrics = emptySessionRequestMetrics();
  const repetitionGuard = new RepetitionGuard();
  let currentState: RvSessionState = "Draft";
  const chat = input.chat ?? nativeProviderChat;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 5));
  const maxMonitorInterventions = input.monitor ? Math.max(0, Math.min(input.monitor.maxInterventions ?? 6, 20)) : 0;
  let monitorInterventionCount = 0;
  const messages: ProviderMessage[] = [
    { role: "system", content: input.protocol.content },
    ...(input.rvSystemPrompt?.content.trim() ? [{ role: "system" as const, content: input.rvSystemPrompt.content.trim() }] : []),
    ...(input.researchConditionInstruction?.content.trim() ? [{ role: "system" as const, content: `[LOCKED RESEARCH CONDITION INSTRUCTION]\n${input.researchConditionInstruction.content.trim()}` }] : []),
  ];
  const stop = (reason: string) => stopRun(input, sessionId, sessionCode, transcript, reason, metrics, startedAtMs);

  await input.repository.createRvSession({
    id: sessionId,
    workspaceId: input.workspaceId,
    profileId: input.profileId,
    sessionCode,
    runType: input.monitor ? "automatic_monitor" : "automatic",
    targetId: input.automaticTarget?.id,
    researchProjectId: input.researchProjectId,
  });
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_CREATED", role: "controller", metadata: { sessionCode } });
  await input.onSessionCreated?.(sessionId, sessionCode);

  const snapshot: SessionSnapshot = {
    schemaVersion: 1,
    sessionId,
    sessionCode,
    profileId: input.profileId,
    workspaceId: input.workspaceId,
    providerConfigId: input.providerConfig.id,
    credentialId: input.providerConfig.credentialId,
    ...(input.providerConfig.credentialHint ? { credentialHint: input.providerConfig.credentialHint } : {}),
    provider: input.providerConfig.provider,
    modelId: input.model.modelId,
    modelRoute: input.model.route,
    capabilitySnapshot: JSON.parse(JSON.stringify(input.model.capabilities)) as Record<string, unknown>,
    capabilityCapturedAt: input.model.capabilities.capturedAt,
    generationSettings: effectiveSettings,
    sessionLanguage: input.sessionLanguage,
    protocol: {
      id: input.protocol.id,
      version: input.protocol.version,
      language: input.protocol.language,
      contentSha256: input.protocol.contentSha256,
      fullContent: input.protocol.content,
    },
    controllerPrompt: {
      id: RCP_CONTROLLER_PROMPT_ID,
      version: RCP_CONTROLLER_PROMPT_VERSION,
      language: input.sessionLanguage,
    },
    ...(input.monitor ? {
      monitor: {
        providerConfigId: input.monitor.providerConfig.id,
        provider: input.monitor.providerConfig.provider,
        modelId: input.monitor.model.modelId,
        modelRoute: input.monitor.model.route,
        promptVersion: MONITOR_PROMPT_VERSION,
        libraryVersion: MONITOR_LIBRARY_VERSION,
        maxInterventions: maxMonitorInterventions,
      },
    } : {}),
    ...(input.rvSystemPrompt ? {
      rvSystemPrompt: {
        id: input.rvSystemPrompt.id,
        version: input.rvSystemPrompt.version,
        language: input.sessionLanguage,
        contentSha256: input.rvSystemPrompt.contentSha256,
        fullContent: input.rvSystemPrompt.content,
      },
    } : {}),
    ...(input.researchConditionInstruction ? {
      researchConditionInstruction: {
        id: input.researchConditionInstruction.id,
        version: input.researchConditionInstruction.version,
        language: input.sessionLanguage,
        contentSha256: input.researchConditionInstruction.contentSha256,
        fullContent: input.researchConditionInstruction.content,
      },
    } : {}),
    revealSource: input.automaticTarget ? "automatic" : "external",
    ...(input.automaticTarget ? { targetId: input.automaticTarget.id } : {}),
    ...(input.researchProjectId ? { researchProjectId: input.researchProjectId } : {}),
    applicationVersion: APP_VERSION,
    createdAt,
  };

  currentState = "Preflight";
  await input.repository.updateRvSessionState(sessionId, currentState);
  await input.repository.saveSessionSnapshot(sessionId, snapshot, await sha256Text(JSON.stringify(snapshot)));
  await input.repository.appendSessionEvent(sessionId, {
    eventType: "PREFLIGHT_COMPLETE",
    role: "controller",
    metadata: { provider: input.providerConfig.provider, modelId: input.model.modelId },
  });
  const monitorRunId = input.monitor
    ? await input.repository.createMonitorRun({
        sessionId,
        modelRoute: input.monitor.model.route,
        promptVersionId: `ai-monitor:${MONITOR_PROMPT_VERSION}`,
        libraryVersion: MONITOR_LIBRARY_VERSION,
        maxInterventions: maxMonitorInterventions,
      })
    : null;
  notify(input, sessionId, sessionCode, currentState, transcript, undefined, undefined, metrics, startedAtMs);

  currentState = "BlindRunning";
  await input.repository.updateRvSessionState(sessionId, currentState);
  notify(input, sessionId, sessionCode, currentState, transcript, undefined, undefined, metrics, startedAtMs);

  for (let phase = 1; phase <= 6; phase += 1) {
    if (input.signal?.aborted) return stop("USER STOP");
    const controllerPrompt = rcpPhasePrompt(input.sessionLanguage, phase, sessionCode);
    messages.push({ role: "user", content: controllerPrompt });
    await input.repository.appendSessionEvent(sessionId, {
      eventType: "CONTROLLER_STEP",
      role: "controller",
      content: controllerPrompt,
      metadata: { phase },
    });
    notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);

    let response: ProviderChatResponse | null = null;
    let lastError = "";
    let responseDurationMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (input.signal?.aborted) return stop("USER STOP");
      let costAuthorization;
      try {
        costAuthorization = costGuard.authorize(input.model, messages, effectiveSettings);
      } catch (cause) {
        if (cause instanceof CostGuardStop) return stop(cause.message);
        throw cause;
      }
      const requestStartedAt = Date.now();
      try {
        response = await chat({
          config: input.providerConfig,
          modelId: input.model.modelId,
          messages: [...messages],
          settings: effectiveSettings,
          timeoutMs: input.requestTimeoutMs,
          signal: input.signal,
        });
        response = { ...response, usage: costAuthorization.success(response.usage) };
        responseDurationMs = Date.now() - requestStartedAt;
        metrics = recordProviderRequest(metrics, response.usage, responseDurationMs);
        if (!response.content.trim()) throw new Error("empty provider response");
        break;
      } catch (cause) {
        costAuthorization.failure();
        if (!response) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
        lastError = cause instanceof Error ? cause.message : String(cause);
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "PROVIDER_ERROR",
          role: "controller",
          content: lastError,
          metadata: { phase, attempt: attempt + 1, requestDurationMs: Date.now() - requestStartedAt },
        });
        response = null;
      }
    }
    if (!response) {
      return stop(`AUTO-STOP: repeated provider/API failures${lastError ? ` — ${lastError}` : ""}`);
    }

    messages.push({ role: "assistant", content: response.content });
    transcript = appendPhaseTranscript(transcript, phase, response.content);
    await input.repository.appendSessionEvent(sessionId, {
      eventType: "VIEWER_RESPONSE",
      role: "assistant",
      content: response.content,
      metadata: { phase, finishReason: response.finishReason, usage: response.usage, requestDurationMs: responseDurationMs },
    });
    // Persistence is awaited before any next provider call. This is the autosave boundary.
    await input.repository.updatePreRevealTranscript(sessionId, transcript);
    notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
    if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");

    const repetition = repetitionGuard.inspect(response.content);
    if (repetition.severity !== "clear") {
      await input.repository.appendSessionEvent(sessionId, { eventType: repetition.severity === "stop" ? "REPETITION_STOP" : "REPETITION_WARNING", role: "controller", content: repetition.fragment, metadata: { phase, rule: repetition.rule, severity: repetition.severity } });
      if (repetition.severity === "stop") return stop(formatRepetitionStopReason(repetition));
    }
    if (input.signal?.aborted) return stop("USER STOP");

    if (input.monitor && monitorRunId && monitorInterventionCount < maxMonitorInterventions) {
      let decision: MonitorDecision | null = null;
      const rejectedAttempts: Array<{ attempt: number; reason: string; code?: string; rawResponse?: string }> = [];
      const monitorRetryLimit = Math.min(1, maxRetries);
      for (let attempt = 0; attempt <= monitorRetryLimit; attempt += 1) {
        try {
          decision = await evaluateMonitor({
            providerConfig: input.monitor.providerConfig,
            model: input.monitor.model,
            language: input.sessionLanguage,
            phase,
            blindTranscript: transcript,
            requestTimeoutMs: input.requestTimeoutMs,
            chat: async (request) => {
              const costAuthorization = costGuard.authorize(input.monitor!.model, request.messages, request.settings);
              const requestStartedAt = Date.now();
              try {
                const rawMonitorResponse = await chat({ ...request, signal: input.signal });
                const monitorResponse = { ...rawMonitorResponse, usage: costAuthorization.success(rawMonitorResponse.usage) };
                const requestDurationMs = Date.now() - requestStartedAt;
                metrics = recordProviderRequest(metrics, monitorResponse.usage, requestDurationMs);
                await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_TELEMETRY", role: "controller", metadata: { phase, attempt: attempt + 1, usage: monitorResponse.usage, requestDurationMs } });
                return monitorResponse;
              } catch (cause) {
                costAuthorization.failure();
                const requestDurationMs = Date.now() - requestStartedAt;
                metrics = recordProviderRequest(metrics, undefined, requestDurationMs);
                await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_TELEMETRY", role: "controller", metadata: { phase, attempt: attempt + 1, requestDurationMs, failed: true } });
                throw cause;
              }
            },
          });
          break;
        } catch (cause) {
          if (cause instanceof CostGuardStop) return stop(cause.message);
          if (input.signal?.aborted) return stop("USER STOP");
          const reason = cause instanceof Error ? cause.message : String(cause);
          const rawResponse = cause instanceof MonitorDecisionError ? cause.rawResponse : undefined;
          const code = cause instanceof MonitorDecisionError ? cause.code : undefined;
          rejectedAttempts.push({ attempt: attempt + 1, reason, ...(code ? { code } : {}), ...(rawResponse ? { rawResponse } : {}) });
          await input.repository.appendSessionEvent(sessionId, {
            eventType: "MONITOR_ATTEMPT_REJECTED",
            role: "controller",
            ...(rawResponse ? { content: rawResponse } : {}),
            metadata: { phase, attempt: attempt + 1, reason, ...(code ? { code } : {}) },
          });
        }
      }
      if (input.signal?.aborted) return stop("USER STOP");
      if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");

      if (!decision) {
        const rationale = JSON.stringify({ kind: "monitor_rejected_continue_protocol", phase, attempts: rejectedAttempts });
        await input.repository.appendMonitorIntervention(monitorRunId, { decision: "CONTINUE_PROTOCOL", rationale });
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "MONITOR_SKIPPED_CONTINUE_PROTOCOL",
          role: "controller",
          content: rejectedAttempts.at(-1)?.rawResponse,
          metadata: { phase, reason: rejectedAttempts.at(-1)?.reason ?? "unknown Monitor failure", attempts: rejectedAttempts.length },
        });
        notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
      } else if (decision.decision === "CONTINUE_PROTOCOL") {
        await input.repository.appendMonitorIntervention(monitorRunId, { decision: "CONTINUE_PROTOCOL" });
        notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
      } else {
        monitorInterventionCount += 1;
        await input.repository.appendMonitorIntervention(monitorRunId, {
          decision: "INTERVENE",
          commandId: decision.commandId,
          viewerEvidence: decision.viewerEvidence,
          commandText: decision.commandText,
        });
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "MONITOR_INTERVENTION",
          role: "controller",
          content: decision.commandText,
          metadata: { phase, commandId: decision.commandId, viewerEvidence: decision.viewerEvidence },
        });
        messages.push({ role: "user", content: decision.commandText });

        let deepening: ProviderChatResponse | null = null;
        let deepeningError = "";
        let deepeningDurationMs = 0;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          if (input.signal?.aborted) return stop("USER STOP");
          let costAuthorization;
          try {
            costAuthorization = costGuard.authorize(input.model, messages, effectiveSettings);
          } catch (cause) {
            if (cause instanceof CostGuardStop) return stop(cause.message);
            throw cause;
          }
          const requestStartedAt = Date.now();
          try {
            deepening = await chat({
              config: input.providerConfig,
              modelId: input.model.modelId,
              messages: [...messages],
              settings: effectiveSettings,
              timeoutMs: input.requestTimeoutMs,
              signal: input.signal,
            });
            deepening = { ...deepening, usage: costAuthorization.success(deepening.usage) };
            deepeningDurationMs = Date.now() - requestStartedAt;
            metrics = recordProviderRequest(metrics, deepening.usage, deepeningDurationMs);
            if (!deepening.content.trim()) throw new Error("empty provider response");
            break;
          } catch (cause) {
            costAuthorization.failure();
            if (!deepening) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
            deepeningError = cause instanceof Error ? cause.message : String(cause);
            await input.repository.appendSessionEvent(sessionId, {
              eventType: "PROVIDER_ERROR",
              role: "controller",
              content: deepeningError,
              metadata: { phase, attempt: attempt + 1, source: "monitor_intervention", requestDurationMs: Date.now() - requestStartedAt },
            });
            deepening = null;
          }
        }
        if (!deepening) {
          return stop(`AUTO-STOP: Viewer failed after Monitor intervention${deepeningError ? ` — ${deepeningError}` : ""}`);
        }
        messages.push({ role: "assistant", content: deepening.content });
        transcript = appendMonitorTranscript(transcript, phase, decision.commandText, deepening.content);
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "VIEWER_MONITOR_RESPONSE",
          role: "assistant",
          content: deepening.content,
          metadata: { phase, commandId: decision.commandId, finishReason: deepening.finishReason, usage: deepening.usage, requestDurationMs: deepeningDurationMs },
        });
        await input.repository.updatePreRevealTranscript(sessionId, transcript);
        notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
        if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");
        const deepeningRepetition = repetitionGuard.inspect(deepening.content);
        if (deepeningRepetition.severity !== "clear") {
          await input.repository.appendSessionEvent(sessionId, { eventType: deepeningRepetition.severity === "stop" ? "REPETITION_STOP" : "REPETITION_WARNING", role: "controller", content: deepeningRepetition.fragment, metadata: { phase, source: "monitor_intervention", rule: deepeningRepetition.rule, severity: deepeningRepetition.severity } });
          if (deepeningRepetition.severity === "stop") return stop(formatRepetitionStopReason(deepeningRepetition));
        }
      }
    }
  }

  if (input.signal?.aborted) return stop("USER STOP");
  const transcriptHash = await sha256Text(transcript);
  await input.repository.sealPreReveal(sessionId, transcript, transcriptHash);
  await input.repository.appendSessionEvent(sessionId, {
    eventType: "PRE_REVEAL_SEALED",
    role: "controller",
    metadata: { sha256: transcriptHash, metrics: snapshotSessionMetrics(metrics, startedAtMs) },
  });
  notify(input, sessionId, sessionCode, "AwaitingReveal", transcript, undefined, undefined, metrics, startedAtMs);
  if (input.signal?.aborted) return stop("USER STOP");
  if (input.automaticTarget) {
    const reveal = await buildAutomaticTargetReveal(input.automaticTarget);
    await input.repository.acceptReveal(sessionId, reveal);
    await input.repository.recordTargetUsage({ targetId: input.automaticTarget.id, profileId: input.profileId, researchProjectId: input.researchProjectId, sessionId });
    await input.repository.appendSessionEvent(sessionId, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source: "automatic_target", targetId: input.automaticTarget.id } });
    notify(input, sessionId, sessionCode, "Revealed", transcript, undefined, undefined, metrics, startedAtMs);
    return { sessionId, sessionCode, state: "Revealed", transcript };
  }
  return { sessionId, sessionCode, state: "AwaitingReveal", transcript };
}

async function stopRun(
  input: AutomaticRcpRunInput,
  sessionId: string,
  sessionCode: string,
  transcript: string,
  reason: string,
  metrics: SessionRequestMetrics,
  startedAtMs: number,
): Promise<AutomaticRcpRunResult> {
  await input.repository.updateRvSessionState(sessionId, "Interrupted");
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_STOPPED", role: "controller", content: reason, metadata: { metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
  notify(input, sessionId, sessionCode, "Interrupted", transcript, undefined, reason, metrics, startedAtMs);
  return { sessionId, sessionCode, state: "Interrupted", transcript, stopReason: reason };
}

function notify(
  input: AutomaticRcpRunInput,
  sessionId: string,
  sessionCode: string,
  state: RvSessionState,
  transcript: string,
  phase?: number,
  stopReason?: string,
  metrics?: SessionRequestMetrics,
  startedAtMs?: number,
): void {
  input.onProgress?.({ sessionId, sessionCode, state, transcript, phase, stopReason, ...(metrics && startedAtMs !== undefined ? { metrics: snapshotSessionMetrics(metrics, startedAtMs) } : {}) });
}

function validateRunInput(input: AutomaticRcpRunInput): void {
  if (input.protocol.id !== "full-rcp") throw new Error("This controller currently executes Full RCP only.");
  if (input.protocol.language !== input.sessionLanguage) throw new Error("Protocol language must match Session Language.");
  if (input.model.providerConfigId !== input.providerConfig.id) throw new Error("Selected model does not belong to the selected provider connection.");
  if (input.model.provider !== input.providerConfig.provider) throw new Error("Model/provider route mismatch.");
  if (input.monitor) {
    if (input.monitor.model.providerConfigId !== input.monitor.providerConfig.id) throw new Error("Monitor model/provider route mismatch.");
    if (input.monitor.model.provider !== input.monitor.providerConfig.provider) throw new Error("Monitor provider mismatch.");
  }
  if (input.automaticTarget && !targetHasSupportedReveal(input.automaticTarget)) {
    throw new Error("Automatic target requires a supported reveal description or image.");
  }
}

function costLimitExceeded(limit: number | undefined, reportedCost: number | undefined): boolean {
  return Boolean(limit && limit > 0 && reportedCost !== undefined && reportedCost >= limit);
}

export function appendPhaseTranscript(current: string, phase: number, content: string): string {
  const block = `## Phase ${phase}\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendMonitorTranscript(current: string, phase: number, command: string, content: string): string {
  const block = `### AI Monitor deepening after Phase ${phase}\n\nMonitor: ${command.trim()}\n\nViewer: ${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export async function submitExternalReveal(repository: SessionRepository, sessionId: string, text: string, artifactManifest: RevealArtifactRecord[] = []): Promise<void> {
  const clean = text.trim();
  if (!clean && !artifactManifest.length) throw new Error("Reveal cannot be empty.");
  const source = clean && artifactManifest.length ? "external_mixed" : artifactManifest.length ? "external_artifact" : "external_text";
  const hashMaterial = artifactManifest.length
    ? JSON.stringify({ text: clean || null, artifacts: artifactManifest.map((artifact) => ({ artifactId: artifact.artifactId, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.sha256 })) })
    : clean;
  await repository.acceptReveal(sessionId, { source, ...(clean ? { text: clean } : {}), ...(artifactManifest.length ? { artifactManifest } : {}), hash: await sha256Text(hashMaterial) });
  await repository.appendSessionEvent(sessionId, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source, artifactCount: artifactManifest.length } });
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
