import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import { shouldRetryProviderError, waitBeforeProviderRetry } from "../providers/retry";
import type { ProtocolResource } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import type { TargetRecord } from "../targets/types";
import { evaluateMonitor, isIncompleteMonitorResponse, type MonitorDecision } from "../monitor/engine";
import { MONITOR_PROMPT_VERSION } from "../monitor/prompt";
import { RCP_CONTROLLER_PROMPT_ID, RCP_CONTROLLER_PROMPT_VERSION, rcpPhasePrompt } from "./controllerPrompts";
import { emptySessionRequestMetrics, recordProviderRequest, snapshotSessionMetrics, type SessionRequestMetrics, type SessionRunMetrics } from "./metrics";
import type { RevealArtifactRecord, RvSession, RvSessionState, SessionSnapshot } from "./types";
import { buildAutomaticTargetReveal, targetHasSupportedReveal } from "../targets/service";
import { APP_VERSION } from "../version";
import { createSessionCode } from "./sessionCode";
import { CostGuardStop, SessionCostGuard } from "./costGuard";
import { sanitizeRepetitiveOutput } from "./repetitionGuard";
import type { SpecialTaskInput } from "./specialTask";
import { renderSpecialTask } from "./specialTask";
import { politeRevealTransition, politeSessionGreeting } from "./courtesy";
import {
  buildEffectiveMonitorPrompt,
  lockedActivityDefinition,
  lockedMonitorExecution,
  lockedViewerIdentity,
  LOCKED_ACTIVITY_VERSION,
  LOCKED_IDENTITY_VERSION,
  LOCKED_MONITOR_EXECUTION_VERSION,
} from "../resources/systemPrompts";

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
  aiIsBeDisplayName?: string;
  humanIsBeDisplayName?: string;
  specialTask?: SpecialTaskInput;
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
  researchConditionInstruction?: ViewerSystemPromptSnapshot;
  resumeSession?: RvSession;
  monitor?: {
    providerConfig: ProviderConfig;
    model: ProviderModel;
    maxInterventions?: number;
    editablePrompt?: string;
    effectivePrompt?: string;
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
  awaitingStep8Questions?: boolean;
  telepathicQuestionCount?: number;
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

  const sessionId = input.resumeSession?.id ?? `session_${crypto.randomUUID()}`;
  const sessionCode = input.resumeSession?.sessionCode ?? createSessionCode(input.sessionCodePrefix);
  const createdAt = new Date().toISOString();
  const startedAtMs = Date.now();
  let transcript = "";
  let metrics = emptySessionRequestMetrics();
  let currentState: RvSessionState = "Draft";
  const chat = input.chat ?? nativeProviderChat;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 5));
  const maxMonitorInterventionsPerPhase = input.monitor ? 5 : 0;
  const effectiveMonitorPrompt = input.monitor ? input.monitor.effectivePrompt?.trim() || buildEffectiveMonitorPrompt(input.sessionLanguage, input.monitor.editablePrompt) : undefined;
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
  if (!input.resumeSession) await input.onSessionCreated?.(sessionId, sessionCode);

  const snapshot: SessionSnapshot = {
    schemaVersion: 2,
    sessionId,
    sessionCode,
    profileId: input.profileId,
    workspaceId: input.workspaceId,
    identities: {
      aiIsBeDisplayName: input.aiIsBeDisplayName?.trim() || "AI IS-BE",
      humanIsBeDisplayName: input.humanIsBeDisplayName?.trim() || "Human IS-BE",
    },
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
        libraryVersion: "natural-language-open-v1",
        maxInterventions: maxMonitorInterventionsPerPhase,
        effectivePrompt: effectiveMonitorPrompt,
        effectivePromptSha256: await sha256Text(effectiveMonitorPrompt!),
        lockedBlocks: [
          { id: "locked-activity-definition", version: LOCKED_ACTIVITY_VERSION, contentSha256: await sha256Text(lockedActivityDefinition(input.sessionLanguage)), fullContent: lockedActivityDefinition(input.sessionLanguage) },
          { id: "locked-monitor-execution", version: LOCKED_MONITOR_EXECUTION_VERSION, contentSha256: await sha256Text(lockedMonitorExecution(input.sessionLanguage)), fullContent: lockedMonitorExecution(input.sessionLanguage) },
        ],
      },
    } : {}),
    ...(renderSpecialTask(input.specialTask, input.sessionLanguage) ? {
      specialTask: {
        selectedOptions: input.specialTask?.selectedOptions ?? [],
        ...(input.specialTask?.customText?.trim() ? { customText: input.specialTask.customText.trim() } : {}),
        recipient: input.monitor ? "monitor" as const : "viewer" as const,
        injectAfter: "phase_4" as const,
      },
    } : {}),
    ...(input.rvSystemPrompt ? {
      rvSystemPrompt: {
        id: input.rvSystemPrompt.id,
        version: input.rvSystemPrompt.version,
        language: input.sessionLanguage,
        contentSha256: input.rvSystemPrompt.contentSha256,
        fullContent: input.rvSystemPrompt.content,
        lockedBlocks: [
          { id: "locked-viewer-identity", version: LOCKED_IDENTITY_VERSION, contentSha256: await sha256Text(lockedViewerIdentity(input.sessionLanguage)), fullContent: lockedViewerIdentity(input.sessionLanguage) },
          { id: "locked-activity-definition", version: LOCKED_ACTIVITY_VERSION, contentSha256: await sha256Text(lockedActivityDefinition(input.sessionLanguage)), fullContent: lockedActivityDefinition(input.sessionLanguage) },
        ],
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
        libraryVersion: "natural-language-open-v1",
        maxInterventions: maxMonitorInterventionsPerPhase,
      })
    : null;
  notify(input, sessionId, sessionCode, currentState, transcript, undefined, undefined, metrics, startedAtMs);

  currentState = "BlindRunning";
  await input.repository.updateRvSessionState(sessionId, currentState);
  notify(input, sessionId, sessionCode, currentState, transcript, undefined, undefined, metrics, startedAtMs);

  for (let phase = 1; phase <= 6; phase += 1) {
    if (input.signal?.aborted) return stop("USER STOP");
    const phasePrompt = rcpPhasePrompt(input.sessionLanguage, phase, sessionCode);
    const controllerPrompt = phase === 1 ? `${politeSessionGreeting(input.sessionLanguage, input.aiIsBeDisplayName)}\n\n${phasePrompt}` : phasePrompt;
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
        if (input.signal?.aborted) return stop("USER STOP");
        if (!response) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
        lastError = cause instanceof Error ? cause.message : String(cause);
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "PROVIDER_ERROR",
          role: "controller",
          content: lastError,
          metadata: { phase, attempt: attempt + 1, requestDurationMs: Date.now() - requestStartedAt },
        });
        response = null;
        if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
        else break;
      }
    }
    if (!response) {
      return stop(`AUTO-STOP: repeated provider/API failures${lastError ? ` — ${lastError}` : ""}`);
    }

    const rawResponseContent = response.content;
    const sanitized = sanitizeRepetitiveOutput(rawResponseContent, input.sessionLanguage);
    response = { ...response, content: sanitized.content };
    if (sanitized.truncated) {
      await input.repository.appendSessionEvent(sessionId, {
        eventType: "OUTPUT_TRUNCATED_LOOP",
        role: "controller",
        content: sanitized.finding?.fragment,
        metadata: { phase, rule: sanitized.finding?.rule, originalLength: sanitized.originalLength, retainedLength: sanitized.retainedLength, rawOutputSha256: await sha256Text(rawResponseContent) },
      });
    }
    messages.push({ role: "assistant", content: response.content });
    transcript = appendPhaseTranscript(transcript, phase, controllerPrompt, response.content, input.sessionLanguage);
    await input.repository.appendSessionEvent(sessionId, {
      eventType: "VIEWER_RESPONSE",
      role: "assistant",
      content: response.content,
      metadata: { phase, finishReason: response.finishReason, actualModel: response.actualModel ?? "unavailable", providerRequestId: response.providerRequestId ?? "unavailable", usage: response.usage, usageAccuracy: response.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: responseDurationMs },
    });
    // Persistence is awaited before any next provider call. This is the autosave boundary.
    await input.repository.updatePreRevealTranscript(sessionId, transcript);
    notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
    if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");

    if (input.signal?.aborted) return stop("USER STOP");

    if (!input.monitor && phase === 4) {
      const specialTask = renderSpecialTask(input.specialTask, input.sessionLanguage);
      if (specialTask) {
        const taskPrompt = input.sessionLanguage === "pl"
          ? `SPECJALNE ZADANIE VIEWERA — wykonaj je teraz, używając wyłącznie neutralnych etykiet ślepej sesji:\n${specialTask}`
          : `SPECIAL VIEWER TASK — apply it now using neutral blind-session labels only:\n${specialTask}`;
        messages.push({ role: "user", content: taskPrompt });
        await input.repository.appendSessionEvent(sessionId, { eventType: "SPECIAL_TASK_INJECTED", role: "controller", content: taskPrompt, metadata: { phase, recipient: "viewer" } });

        let taskResponse: ProviderChatResponse | null = null;
        let taskError = "";
        let taskDurationMs = 0;
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
            taskResponse = await chat({
              config: input.providerConfig,
              modelId: input.model.modelId,
              messages: [...messages],
              settings: effectiveSettings,
              timeoutMs: input.requestTimeoutMs,
              signal: input.signal,
            });
            taskResponse = { ...taskResponse, usage: costAuthorization.success(taskResponse.usage) };
            taskDurationMs = Date.now() - requestStartedAt;
            metrics = recordProviderRequest(metrics, taskResponse.usage, taskDurationMs);
            if (!taskResponse.content.trim()) throw new Error("empty provider response");
            break;
          } catch (cause) {
            costAuthorization.failure();
            if (input.signal?.aborted) return stop("USER STOP");
            if (!taskResponse) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
            taskError = cause instanceof Error ? cause.message : String(cause);
            await input.repository.appendSessionEvent(sessionId, {
              eventType: "PROVIDER_ERROR",
              role: "controller",
              content: taskError,
              metadata: { phase, attempt: attempt + 1, source: "special_task", requestDurationMs: Date.now() - requestStartedAt },
            });
            taskResponse = null;
            if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
            else break;
          }
        }
        if (!taskResponse) return stop(`AUTO-STOP: Viewer failed during Special Task${taskError ? ` — ${taskError}` : ""}`);

        const rawTaskContent = taskResponse.content;
        const sanitizedTask = sanitizeRepetitiveOutput(rawTaskContent, input.sessionLanguage);
        taskResponse = { ...taskResponse, content: sanitizedTask.content };
        if (sanitizedTask.truncated) {
          await input.repository.appendSessionEvent(sessionId, {
            eventType: "OUTPUT_TRUNCATED_LOOP",
            role: "controller",
            content: sanitizedTask.finding?.fragment,
            metadata: { phase, source: "special_task", rule: sanitizedTask.finding?.rule, originalLength: sanitizedTask.originalLength, retainedLength: sanitizedTask.retainedLength, rawOutputSha256: await sha256Text(rawTaskContent) },
          });
        }
        messages.push({ role: "assistant", content: taskResponse.content });
        transcript = appendSpecialTaskTranscript(transcript, phase, taskPrompt, taskResponse.content, input.sessionLanguage);
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "VIEWER_SPECIAL_TASK_RESPONSE",
          role: "assistant",
          content: taskResponse.content,
          metadata: { phase, finishReason: taskResponse.finishReason, actualModel: taskResponse.actualModel ?? "unavailable", providerRequestId: taskResponse.providerRequestId ?? "unavailable", usage: taskResponse.usage, usageAccuracy: taskResponse.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: taskDurationMs },
        });
        await input.repository.updatePreRevealTranscript(sessionId, transcript);
        notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
        if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");
      }
    }

    if (input.monitor && monitorRunId && phase >= 2) {
      for (let exchangeNumber = 1; exchangeNumber <= maxMonitorInterventionsPerPhase; exchangeNumber += 1) {
        let decision: MonitorDecision | null = null;
        let monitorError = "";
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
            decision = await evaluateMonitor({
            providerConfig: input.monitor.providerConfig,
            model: input.monitor.model,
            language: input.sessionLanguage,
            phase,
            blindTranscript: transcript,
            exchangeNumber,
            attempt,
            effectiveSystemPrompt: effectiveMonitorPrompt,
            ...(phase >= 4 ? { specialTask: renderSpecialTask(input.specialTask, input.sessionLanguage) } : {}),
            requestTimeoutMs: input.requestTimeoutMs,
            chat: async (request) => {
              const costAuthorization = costGuard.authorize(input.monitor!.model, request.messages, request.settings);
              const requestStartedAt = Date.now();
              try {
                const rawMonitorResponse = await chat({ ...request, signal: input.signal });
                const monitorResponse = { ...rawMonitorResponse, usage: costAuthorization.success(rawMonitorResponse.usage) };
                const requestDurationMs = Date.now() - requestStartedAt;
                metrics = recordProviderRequest(metrics, monitorResponse.usage, requestDurationMs);
                await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_TELEMETRY", role: "controller", content: rawMonitorResponse.content, metadata: { phase, exchangeNumber, usage: monitorResponse.usage, requestDurationMs, reasoningSource: rawMonitorResponse.reasoningSource, reasoningCharacterCount: rawMonitorResponse.reasoningContent?.length ?? 0, failed: isIncompleteMonitorResponse(rawMonitorResponse) } });
                return monitorResponse;
              } catch (cause) {
                costAuthorization.failure();
                const requestDurationMs = Date.now() - requestStartedAt;
                metrics = recordProviderRequest(metrics, undefined, requestDurationMs);
                await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_TELEMETRY", role: "controller", metadata: { phase, exchangeNumber, requestDurationMs, failed: true } });
                throw cause;
              }
            },
            });
            break;
          } catch (cause) {
            if (cause instanceof CostGuardStop) return stop(cause.message);
            if (input.signal?.aborted) return stop("USER STOP");
            monitorError = cause instanceof Error ? cause.message : String(cause);
            await input.repository.appendSessionEvent(sessionId, {
              eventType: "MONITOR_PROVIDER_ERROR",
              role: "controller",
              content: monitorError,
              metadata: { phase, exchangeNumber, attempt: attempt + 1 },
            });
            if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
            else break;
          }
        }
        if (!decision) return stop(`AUTO-STOP: Monitor provider failure — ${monitorError}`);
        if (input.signal?.aborted) return stop("USER STOP");
        if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");
        await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_DECISION", role: "monitor", content: decision.decision === "INTERVENE" ? decision.commandText : "CONTINUE_PROTOCOL", metadata: { phase, exchangeNumber, decision: decision.decision } });
        if (decision.decision === "CONTINUE_PROTOCOL") {
          await input.repository.appendMonitorIntervention(monitorRunId, { decision: "CONTINUE_PROTOCOL", rationale: JSON.stringify({ phase, exchangeNumber }) });
          break;
        }
        monitorInterventionCount += 1;
        await input.repository.appendMonitorIntervention(monitorRunId, {
          decision: "INTERVENE",
          commandText: decision.commandText,
          rationale: JSON.stringify({ phase, exchangeNumber, rawResponse: decision.rawResponse }),
        });
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "MONITOR_INTERVENTION",
          role: "controller",
          content: decision.commandText,
          metadata: { phase, exchangeNumber, rawResponse: decision.rawResponse },
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
            if (input.signal?.aborted) return stop("USER STOP");
            if (!deepening) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
            deepeningError = cause instanceof Error ? cause.message : String(cause);
            await input.repository.appendSessionEvent(sessionId, {
              eventType: "PROVIDER_ERROR",
              role: "controller",
              content: deepeningError,
              metadata: { phase, attempt: attempt + 1, source: "monitor_intervention", requestDurationMs: Date.now() - requestStartedAt },
            });
            deepening = null;
            if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
            else break;
          }
        }
        if (!deepening) {
          return stop(`AUTO-STOP: Viewer failed after Monitor intervention${deepeningError ? ` — ${deepeningError}` : ""}`);
        }
        const rawDeepeningContent = deepening.content;
        const sanitizedDeepening = sanitizeRepetitiveOutput(rawDeepeningContent, input.sessionLanguage);
        deepening = { ...deepening, content: sanitizedDeepening.content };
        if (sanitizedDeepening.truncated) {
          await input.repository.appendSessionEvent(sessionId, {
            eventType: "OUTPUT_TRUNCATED_LOOP",
            role: "controller",
            content: sanitizedDeepening.finding?.fragment,
            metadata: { phase, source: "monitor_intervention", rule: sanitizedDeepening.finding?.rule, originalLength: sanitizedDeepening.originalLength, retainedLength: sanitizedDeepening.retainedLength, rawOutputSha256: await sha256Text(rawDeepeningContent) },
          });
        }
        messages.push({ role: "assistant", content: deepening.content });
        transcript = appendMonitorTranscript(transcript, phase, decision.commandText, deepening.content, input.sessionLanguage);
        await input.repository.appendSessionEvent(sessionId, {
          eventType: "VIEWER_MONITOR_RESPONSE",
          role: "assistant",
          content: deepening.content,
          metadata: { phase, exchangeNumber, finishReason: deepening.finishReason, actualModel: deepening.actualModel ?? "unavailable", providerRequestId: deepening.providerRequestId ?? "unavailable", usage: deepening.usage, usageAccuracy: deepening.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: deepeningDurationMs },
        });
        await input.repository.updatePreRevealTranscript(sessionId, transcript);
        notify(input, sessionId, sessionCode, currentState, transcript, phase, undefined, metrics, startedAtMs);
        if (costLimitExceeded(input.maxSessionCostUsd, metrics.costUsd)) return stop("AUTO-STOP: configured session cost limit exceeded");
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
    await input.repository.appendSessionEvent(sessionId, { eventType: "REVEAL_TRANSITION", role: "controller", content: politeRevealTransition(input.sessionLanguage) });
    const reveal = await buildAutomaticTargetReveal(input.automaticTarget, input.sessionLanguage);
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

export function appendPhaseTranscript(current: string, phase: number, prompt: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `## Faza ${phase}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${content.trim()}`
    : `## Phase ${phase}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendMonitorTranscript(current: string, phase: number, command: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `### Pogłębienie AI Monitora po Fazie ${phase}\n\n#### Dokładne polecenie Monitora\n\n${command.trim()}\n\n#### Odpowiedź Viewera\n\n${content.trim()}`
    : `### AI Monitor deepening after Phase ${phase}\n\n#### Exact Monitor instruction\n\n${command.trim()}\n\n#### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendSpecialTaskTranscript(current: string, phase: number, command: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `## Zadanie specjalne — po Fazie ${phase}\n\n### Dokładne polecenie kontrolera\n\n${command.trim()}\n\n### Odpowiedź Viewera\n\n${content.trim()}`
    : `## Special Task — after Phase ${phase}\n\n### Exact controller instruction\n\n${command.trim()}\n\n### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export async function submitExternalReveal(repository: SessionRepository, sessionId: string, text: string, artifactManifest: RevealArtifactRecord[] = [], language: InterfaceLanguage = "en"): Promise<void> {
  const clean = text.trim();
  if (!clean && !artifactManifest.length) throw new Error("Reveal cannot be empty.");
  const source = clean && artifactManifest.length ? "external_mixed" : artifactManifest.length ? "external_artifact" : "external_text";
  const hashMaterial = artifactManifest.length
    ? JSON.stringify({ text: clean || null, artifacts: artifactManifest.map((artifact) => ({ artifactId: artifact.artifactId, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.sha256 })) })
    : clean;
  await repository.appendSessionEvent(sessionId, { eventType: "REVEAL_TRANSITION", role: "controller", content: politeRevealTransition(language) });
  await repository.acceptReveal(sessionId, { source, ...(clean ? { text: clean } : {}), ...(artifactManifest.length ? { artifactManifest } : {}), hash: await sha256Text(hashMaterial) });
  await repository.appendSessionEvent(sessionId, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source, artifactCount: artifactManifest.length } });
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
