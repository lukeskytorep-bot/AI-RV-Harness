import { evaluateMonitor, type MonitorDecision } from "../monitor/engine";
import { MONITOR_PROMPT_VERSION } from "../monitor/prompt";
import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel, ProviderUsage } from "../providers/types";
import { shouldRetryProviderError, waitBeforeProviderRetry } from "../providers/retry";
import type { TelepathicProtocolResource } from "../resources/protocolRegistry";
import {
  buildEffectiveTelepathicMonitorPrompt,
  lockedActivityDefinition,
  lockedTelepathicMonitorExecution,
  lockedViewerIdentity,
  LOCKED_ACTIVITY_VERSION,
  LOCKED_IDENTITY_VERSION,
  LOCKED_TELEPATHIC_MONITOR_EXECUTION_VERSION,
} from "../resources/systemPrompts";
import type { AppRepository } from "../storage/repository";
import { buildAutomaticTargetReveal, targetHasSupportedReveal, targetIsEligibleForProtocol } from "../targets/service";
import type { TargetRecord } from "../targets/types";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import { APP_VERSION } from "../version";
import { sha256Text, type SessionProgress } from "./controller";
import { CostGuardStop, SessionCostGuard } from "./costGuard";
import { emptySessionRequestMetrics, recordProviderRequest, snapshotSessionMetrics, type SessionRequestMetrics } from "./metrics";
import { sanitizeRepetitiveOutput } from "./repetitionGuard";
import { createSessionCode } from "./sessionCode";
import {
  TELEPATHIC_CONTROLLER_PROMPT_ID,
  TELEPATHIC_CONTROLLER_PROMPT_VERSION,
  TELEPATHIC_STEP_MAPPING,
  telepathicFixedDeepeningPrompt,
  telepathicQuestionPrompt,
  telepathicStepPrompt,
} from "./telepathicControllerPrompts";
import type { RvSession, RvSessionState, SessionEventRecord, SessionSnapshot } from "./types";
import { politeRevealTransition, politeSessionGreeting } from "./courtesy";

type TelepathicSessionRepository = Pick<
  AppRepository,
  | "createRvSession"
  | "updateRvSessionState"
  | "appendSessionEvent"
  | "updatePreRevealTranscript"
  | "saveSessionSnapshot"
  | "sealPreReveal"
  | "acceptReveal"
  | "recordTargetUsage"
  | "createMonitorRun"
  | "appendMonitorIntervention"
>;

type TelepathicResumeRepository = TelepathicSessionRepository & Pick<AppRepository, "getSessionSnapshot" | "listSessionEvents">;

export type TelepathicQuestionMode = "predefined" | "manual" | "monitor";

export interface TelepathicManualQuestionHandle {
  sessionId: string;
  ask(question: string): Promise<void>;
  finish(): void;
}

export interface AutomaticTelepathicRunInput {
  repository: TelepathicSessionRepository;
  workspaceId: string;
  profileId: string;
  aiIsBeDisplayName?: string;
  humanIsBeDisplayName?: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  protocol: TelepathicProtocolResource;
  sessionLanguage: InterfaceLanguage;
  requestedSettings: GenerationSettings;
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
  resumeSession?: RvSession;
  automaticTarget?: TargetRecord;
  step8Questions: {
    mode: TelepathicQuestionMode;
    questions?: string[];
  };
  monitor?: {
    providerConfig: ProviderConfig;
    model: ProviderModel;
    editablePrompt?: string;
    effectivePrompt?: string;
  };
  signal?: AbortSignal;
  maxRetries?: number;
  requestTimeoutMs?: number;
  maxSessionCostUsd?: number;
  sessionCodePrefix?: string;
  chat?: (input: {
    config: ProviderConfig;
    modelId: string;
    messages: ProviderMessage[];
    settings: ReturnType<typeof resolveGenerationSettings>;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) => Promise<ProviderChatResponse>;
  onManualQuestionStage?: (handle: TelepathicManualQuestionHandle | null) => void;
  onProgress?: (progress: SessionProgress) => void;
}

export interface AutomaticTelepathicRunResult {
  sessionId: string;
  sessionCode: string;
  state: "AwaitingReveal" | "Revealed" | "Interrupted";
  transcript: string;
  stopReason?: string;
}

export type TelepathicManualRecoveryState = "questions" | "step9" | "seal";

export interface ResumeTelepathicManualStageInput {
  repository: TelepathicResumeRepository;
  session: RvSession;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  automaticTarget?: TargetRecord;
  signal?: AbortSignal;
  maxRetries?: number;
  requestTimeoutMs?: number;
  maxSessionCostUsd?: number;
  chat?: AutomaticTelepathicRunInput["chat"];
  onManualQuestionStage: (handle: TelepathicManualQuestionHandle | null) => void;
  onProgress?: (progress: SessionProgress) => void;
}

class TelepathicRunStop extends Error {}

export async function runAutomaticTelepathicSession(input: AutomaticTelepathicRunInput): Promise<AutomaticTelepathicRunResult> {
  validate(input);
  const effectiveSettings = resolveGenerationSettings(input.model.capabilities, input.requestedSettings);
  if (effectiveSettings.omitted.length) throw new Error(`Unsupported generation settings: ${effectiveSettings.omitted.join(", ")}`);
  const costGuard = new SessionCostGuard(input.maxSessionCostUsd);
  costGuard.validateModel(input.model);
  if (input.monitor) costGuard.validateModel(input.monitor.model);

  const sessionId = input.resumeSession?.id ?? `session_${crypto.randomUUID()}`;
  const sessionCode = input.resumeSession?.sessionCode ?? createSessionCode(input.sessionCodePrefix);
  const chat = input.chat ?? nativeProviderChat;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 5));
  const messages: ProviderMessage[] = [
    { role: "system", content: input.protocol.content },
    ...(input.rvSystemPrompt?.content.trim() ? [{ role: "system" as const, content: input.rvSystemPrompt.content.trim() }] : []),
  ];
  const startedAtMs = Date.now();
  let metrics = emptySessionRequestMetrics();
  let transcript = "";
  const cleanQuestions = normalizeQuestions(input.step8Questions.questions);
  const effectiveMonitorPrompt = input.monitor
    ? input.monitor.effectivePrompt?.trim() || buildEffectiveTelepathicMonitorPrompt(input.sessionLanguage, input.monitor.editablePrompt)
    : undefined;

  await input.repository.createRvSession({
    id: sessionId,
    workspaceId: input.workspaceId,
    profileId: input.profileId,
    sessionCode,
    runType: input.monitor ? "automatic_monitor" : "automatic",
    targetId: input.automaticTarget?.id,
  });
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_CREATED", role: "controller", metadata: { sessionCode, protocolFamily: "telepathic" } });
  await input.repository.updateRvSessionState(sessionId, "Preflight");

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
    controllerPrompt: { id: TELEPATHIC_CONTROLLER_PROMPT_ID, version: TELEPATHIC_CONTROLLER_PROMPT_VERSION, language: input.sessionLanguage },
    telepathic: {
      controllerStepCount: 9,
      step8QuestionMode: input.step8Questions.mode,
      predefinedQuestions: cleanQuestions,
      fixedDeepeningAfterSteps: [3, 4, 5],
      stepMapping: TELEPATHIC_STEP_MAPPING.map((entry) => ({ controllerStep: entry.controllerStep, protocolSections: [...entry.protocolSections] })),
      targetKind: input.automaticTarget ? "telepathic" : "external",
    },
    ...(input.monitor ? {
      monitor: {
        providerConfigId: input.monitor.providerConfig.id,
        provider: input.monitor.providerConfig.provider,
        modelId: input.monitor.model.modelId,
        modelRoute: input.monitor.model.route,
        promptVersion: MONITOR_PROMPT_VERSION,
        libraryVersion: "telepathic-natural-language-v1",
        maxInterventions: 5,
        effectivePrompt: effectiveMonitorPrompt,
        effectivePromptSha256: await sha256Text(effectiveMonitorPrompt!),
        lockedBlocks: [
          { id: "locked-activity-definition", version: LOCKED_ACTIVITY_VERSION, contentSha256: await sha256Text(lockedActivityDefinition(input.sessionLanguage)), fullContent: lockedActivityDefinition(input.sessionLanguage) },
          { id: "locked-telepathic-monitor-execution", version: LOCKED_TELEPATHIC_MONITOR_EXECUTION_VERSION, contentSha256: await sha256Text(lockedTelepathicMonitorExecution(input.sessionLanguage)), fullContent: lockedTelepathicMonitorExecution(input.sessionLanguage) },
        ],
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
    revealSource: input.automaticTarget ? "automatic" : "external",
    ...(input.automaticTarget ? { targetId: input.automaticTarget.id } : {}),
    applicationVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
  };
  await input.repository.saveSessionSnapshot(sessionId, snapshot, await sha256Text(JSON.stringify(snapshot)));
  await input.repository.appendSessionEvent(sessionId, { eventType: "PREFLIGHT_COMPLETE", role: "controller", metadata: { controllerSteps: 9, fixedDeepeningAfterSteps: [3, 4, 5], monitorAfterSteps: input.monitor ? [2, 3, 4, 5, 6, 7, 8] : [] } });
  notify(input, sessionId, sessionCode, "Preflight", transcript, undefined, metrics, startedAtMs);
  await input.repository.updateRvSessionState(sessionId, "BlindRunning");
  notify(input, sessionId, sessionCode, "BlindRunning", transcript, undefined, metrics, startedAtMs);

  const monitorRunId = input.monitor
    ? await input.repository.createMonitorRun({ sessionId, modelRoute: input.monitor.model.route, promptVersionId: `ai-monitor-telepathic:${MONITOR_PROMPT_VERSION}`, libraryVersion: "telepathic-natural-language-v1", maxInterventions: 5 })
    : null;

  const stopRun = async (reason: string): Promise<AutomaticTelepathicRunResult> => {
    input.onManualQuestionStage?.(null);
    await input.repository.updateRvSessionState(sessionId, "Interrupted");
    await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_STOPPED", role: "controller", content: reason, metadata: { metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
    notify(input, sessionId, sessionCode, "Interrupted", transcript, undefined, metrics, startedAtMs, reason);
    return { sessionId, sessionCode, state: "Interrupted", transcript, stopReason: reason };
  };

  const viewerCall = async (prompt: string, metadata: Record<string, unknown>): Promise<ProviderChatResponse> => {
    if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
    messages.push({ role: "user", content: prompt });
    await input.repository.appendSessionEvent(sessionId, { eventType: "CONTROLLER_STEP", role: "controller", content: prompt, metadata: { protocolFamily: "telepathic", ...metadata } });
    let response: ProviderChatResponse | null = null;
    let lastError = "";
    let responseDurationMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
      let authorization;
      try {
        authorization = costGuard.authorize(input.model, messages, effectiveSettings);
      } catch (cause) {
        if (cause instanceof CostGuardStop) throw new TelepathicRunStop(cause.message);
        throw cause;
      }
      const requestStartedAt = Date.now();
      try {
        response = await chat({ config: input.providerConfig, modelId: input.model.modelId, messages: [...messages], settings: effectiveSettings, timeoutMs: input.requestTimeoutMs, signal: input.signal });
        response = { ...response, usage: authorization.success(response.usage) };
        responseDurationMs = Date.now() - requestStartedAt;
        metrics = recordProviderRequest(metrics, response.usage, responseDurationMs);
        if (!response.content.trim()) throw new Error("empty provider response");
        break;
      } catch (cause) {
        authorization.failure();
        if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
        if (!response) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
        lastError = cause instanceof Error ? cause.message : String(cause);
        await input.repository.appendSessionEvent(sessionId, { eventType: "PROVIDER_ERROR", role: "controller", content: lastError, metadata: { ...metadata, attempt: attempt + 1, requestDurationMs: Date.now() - requestStartedAt } });
        response = null;
        if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
        else break;
      }
    }
    if (!response) throw new TelepathicRunStop(`AUTO-STOP: repeated Viewer provider failures${lastError ? ` — ${lastError}` : ""}`);
    const raw = response.content;
    const sanitized = sanitizeRepetitiveOutput(raw, input.sessionLanguage);
    response = { ...response, content: sanitized.content };
    if (sanitized.truncated) {
      await input.repository.appendSessionEvent(sessionId, { eventType: "OUTPUT_TRUNCATED_LOOP", role: "controller", content: sanitized.finding?.fragment, metadata: { ...metadata, rule: sanitized.finding?.rule, originalLength: sanitized.originalLength, retainedLength: sanitized.retainedLength, rawOutputSha256: await sha256Text(raw) } });
    }
    messages.push({ role: "assistant", content: response.content });
    await input.repository.appendSessionEvent(sessionId, { eventType: "VIEWER_RESPONSE", role: "assistant", content: response.content, metadata: { ...metadata, finishReason: response.finishReason, actualModel: response.actualModel ?? "unavailable", providerRequestId: response.providerRequestId ?? "unavailable", usage: response.usage, usageAccuracy: response.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: responseDurationMs } });
    return response;
  };

  const persist = async (nextTranscript: string, step: number, awaitingStep8Questions = false, questionCount?: number): Promise<void> => {
    transcript = nextTranscript;
    await input.repository.updatePreRevealTranscript(sessionId, transcript);
    notify(input, sessionId, sessionCode, "BlindRunning", transcript, step, metrics, startedAtMs, undefined, awaitingStep8Questions, questionCount);
    if (input.maxSessionCostUsd && input.maxSessionCostUsd > 0 && metrics.costUsd !== undefined && metrics.costUsd >= input.maxSessionCostUsd) {
      throw new TelepathicRunStop("AUTO-STOP: configured session cost limit exceeded");
    }
  };

  const runQuestion = async (question: string, questionNumber: number, source: "operator" | "monitor"): Promise<void> => {
    const prompt = telepathicQuestionPrompt(input.sessionLanguage, question, questionNumber);
    const response = await viewerCall(prompt, { step: 8, telepathicPhase: "T9", questionNumber, source });
    await persist(appendTelepathicQuestionTranscript(transcript, questionNumber, prompt, response.content, input.sessionLanguage, source), 8, input.step8Questions.mode === "manual", questionNumber);
  };

  const runMonitorCycle = async (step: number, forcedQuestions?: string[]): Promise<void> => {
    if (!input.monitor || !monitorRunId || step < 2 || step > 8) return;
    if (forcedQuestions) {
      for (let index = 0; index < Math.min(5, forcedQuestions.length); index += 1) {
        const command = forcedQuestions[index];
        await input.repository.appendMonitorIntervention(monitorRunId, { decision: "INTERVENE", commandText: command, rationale: JSON.stringify({ step, exchangeNumber: index + 1, source: "operator_predefined_t9" }) });
        await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_INTERVENTION", role: "controller", content: command, metadata: { step, exchangeNumber: index + 1, source: "operator_predefined_t9" } });
        await runQuestion(command, index + 1, "monitor");
      }
      return;
    }
    for (let exchangeNumber = 1; exchangeNumber <= 5; exchangeNumber += 1) {
      let decision: MonitorDecision | null = null;
      let monitorError = "";
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          decision = await evaluateMonitor({
          providerConfig: input.monitor.providerConfig,
          model: input.monitor.model,
          language: input.sessionLanguage,
          phase: step,
          blindTranscript: transcript,
          exchangeNumber,
          effectiveSystemPrompt: effectiveMonitorPrompt,
          packetOptions: { stageKind: "step", protocolName: "Telepathic Protocol v1.1", wholeSessionScope: step === 8 },
          requestTimeoutMs: input.requestTimeoutMs,
          chat: async (request) => {
            let authorization;
            try {
              authorization = costGuard.authorize(input.monitor!.model, request.messages, request.settings);
            } catch (cause) {
              if (cause instanceof CostGuardStop) throw new TelepathicRunStop(cause.message);
              throw cause;
            }
            const requestStartedAt = Date.now();
            try {
              const raw = await chat({ ...request, signal: input.signal });
              const response = { ...raw, usage: authorization.success(raw.usage) };
              const requestDurationMs = Date.now() - requestStartedAt;
              metrics = recordProviderRequest(metrics, response.usage, requestDurationMs);
              await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_TELEMETRY", role: "controller", content: raw.content, metadata: { step, exchangeNumber, actualModel: response.actualModel ?? "unavailable", providerRequestId: response.providerRequestId ?? "unavailable", usage: response.usage, usageAccuracy: response.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs } });
              return response;
            } catch (cause) {
              authorization.failure();
              metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
              throw cause;
            }
          },
          });
          break;
        } catch (cause) {
          if (cause instanceof TelepathicRunStop) throw cause;
          if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
          monitorError = cause instanceof Error ? cause.message : String(cause);
          await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_PROVIDER_ERROR", role: "controller", content: monitorError, metadata: { step, exchangeNumber, attempt: attempt + 1 } });
          if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
          else break;
        }
      }
      if (!decision) throw new TelepathicRunStop(`AUTO-STOP: Monitor provider failure — ${monitorError}`);
      await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_DECISION", role: "monitor", content: decision.decision === "INTERVENE" ? decision.commandText : "CONTINUE_PROTOCOL", metadata: { step, exchangeNumber, decision: decision.decision } });
      if (decision.decision === "CONTINUE_PROTOCOL") {
        await input.repository.appendMonitorIntervention(monitorRunId, { decision: "CONTINUE_PROTOCOL", rationale: JSON.stringify({ step, exchangeNumber }) });
        break;
      }
      await input.repository.appendMonitorIntervention(monitorRunId, { decision: "INTERVENE", commandText: decision.commandText, rationale: JSON.stringify({ step, exchangeNumber, rawResponse: decision.rawResponse }) });
      await input.repository.appendSessionEvent(sessionId, { eventType: "MONITOR_INTERVENTION", role: "controller", content: decision.commandText, metadata: { step, exchangeNumber, rawResponse: decision.rawResponse } });
      const viewerPrompt = step === 8 ? telepathicQuestionPrompt(input.sessionLanguage, decision.commandText, exchangeNumber) : decision.commandText;
      const response = await viewerCall(viewerPrompt, { step, exchangeNumber, source: "monitor_intervention", ...(step === 8 ? { telepathicPhase: "T9" } : {}) });
      await persist(appendTelepathicMonitorTranscript(transcript, step, decision.commandText, response.content, input.sessionLanguage), step);
    }
  };

  try {
    for (let step = 1; step <= 9; step += 1) {
      const stepPrompt = telepathicStepPrompt(input.sessionLanguage, step, sessionCode);
      const prompt = step === 1 ? `${politeSessionGreeting(input.sessionLanguage, input.aiIsBeDisplayName)}\n\n${stepPrompt}` : stepPrompt;
      notify(input, sessionId, sessionCode, "BlindRunning", transcript, step, metrics, startedAtMs);
      const response = await viewerCall(prompt, { step, telepathicPhase: step === 1 ? "T0-T1" : step === 2 ? "T2" : step === 9 ? "T10" : `T${step}` });
      await persist(appendTelepathicStepTranscript(transcript, step, prompt, response.content, input.sessionLanguage), step);

      if (step === 3 || step === 4 || step === 5) {
        const deepeningPrompt = telepathicFixedDeepeningPrompt(input.sessionLanguage, step);
        const deepening = await viewerCall(deepeningPrompt, { step, source: "mandatory_fixed_deepening" });
        await persist(appendTelepathicFixedDeepeningTranscript(transcript, step, deepeningPrompt, deepening.content, input.sessionLanguage), step);
      }

      if (input.monitor && step >= 2 && step <= 8) {
        await runMonitorCycle(step, step === 8 && input.step8Questions.mode === "predefined" ? cleanQuestions : undefined);
      } else if (!input.monitor && step === 8) {
        if (input.step8Questions.mode === "predefined") {
          for (let index = 0; index < cleanQuestions.length; index += 1) await runQuestion(cleanQuestions[index], index + 1, "operator");
        } else if (input.step8Questions.mode === "manual") {
          let finished = false;
          let resolveFinished!: () => void;
          const waiting = new Promise<void>((resolve) => { resolveFinished = resolve; });
          let inFlight = false;
          let finishRequested = false;
          let questionCount = 0;
          const finish = () => {
            if (finished) return;
            if (inFlight) { finishRequested = true; return; }
            finished = true;
            resolveFinished();
          };
          const handle: TelepathicManualQuestionHandle = {
            sessionId,
            ask: async (question) => {
              if (finished) throw new Error("The Step 8 question stage is already closed.");
              if (inFlight) throw new Error("Wait for the current answer before asking another question.");
              inFlight = true;
              try {
                questionCount += 1;
                await runQuestion(question, questionCount, "operator");
              } finally {
                inFlight = false;
                if (finishRequested) finish();
              }
            },
            finish,
          };
          notify(input, sessionId, sessionCode, "BlindRunning", transcript, 8, metrics, startedAtMs, undefined, true, 0);
          await input.repository.appendSessionEvent(sessionId, { eventType: "TELEPATHIC_QUESTIONS_AWAITING_OPERATOR", role: "controller", metadata: { step: 8 } });
          input.onManualQuestionStage?.(handle);
          const abort = () => finish();
          input.signal?.addEventListener("abort", abort, { once: true });
          await waiting;
          input.signal?.removeEventListener("abort", abort);
          input.onManualQuestionStage?.(null);
          if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
          await input.repository.appendSessionEvent(sessionId, { eventType: "TELEPATHIC_QUESTIONS_COMPLETED", role: "controller", metadata: { step: 8, questionCount } });
          notify(input, sessionId, sessionCode, "BlindRunning", transcript, 8, metrics, startedAtMs, undefined, false, questionCount);
        }
      }
    }
  } catch (cause) {
    if (cause instanceof TelepathicRunStop) return stopRun(cause.message);
    throw cause;
  }

  if (input.signal?.aborted) return stopRun("USER STOP");
  const transcriptHash = await sha256Text(transcript);
  await input.repository.sealPreReveal(sessionId, transcript, transcriptHash);
  await input.repository.appendSessionEvent(sessionId, { eventType: "PRE_REVEAL_SEALED", role: "controller", metadata: { sha256: transcriptHash, metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
  notify(input, sessionId, sessionCode, "AwaitingReveal", transcript, undefined, metrics, startedAtMs);
  if (input.signal?.aborted) return stopRun("USER STOP");
  if (!input.automaticTarget) return { sessionId, sessionCode, state: "AwaitingReveal", transcript };

  await input.repository.appendSessionEvent(sessionId, { eventType: "REVEAL_TRANSITION", role: "controller", content: politeRevealTransition(input.sessionLanguage) });
  const reveal = await buildAutomaticTargetReveal(input.automaticTarget, input.sessionLanguage);
  await input.repository.acceptReveal(sessionId, reveal);
  await input.repository.recordTargetUsage({ targetId: input.automaticTarget.id, profileId: input.profileId, sessionId });
  await input.repository.appendSessionEvent(sessionId, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source: "automatic_target", targetId: input.automaticTarget.id } });
  notify(input, sessionId, sessionCode, "Revealed", transcript, undefined, metrics, startedAtMs);
  return { sessionId, sessionCode, state: "Revealed", transcript };
}

export function telepathicManualRecoveryState(events: SessionEventRecord[]): TelepathicManualRecoveryState | null {
  const waitingSequence = Math.max(0, ...events.filter((event) => event.eventType === "TELEPATHIC_QUESTIONS_AWAITING_OPERATOR").map((event) => event.sequenceNumber));
  if (!waitingSequence || events.some((event) => event.sequenceNumber > waitingSequence && event.eventType === "PRE_REVEAL_SEALED")) return null;
  const step9Response = events.some((event) => event.sequenceNumber > waitingSequence
    && event.eventType === "VIEWER_RESPONSE"
    && event.metadata?.step === 9);
  if (step9Response) return "seal";
  const questionsCompleted = events.some((event) => event.sequenceNumber > waitingSequence && event.eventType === "TELEPATHIC_QUESTIONS_COMPLETED");
  return questionsCompleted ? "step9" : "questions";
}

export async function resumeTelepathicManualQuestionStage(input: ResumeTelepathicManualStageInput): Promise<AutomaticTelepathicRunResult> {
  const snapshot = await input.repository.getSessionSnapshot(input.session.id);
  if (!snapshot?.telepathic || snapshot.protocol.id !== "telepathic-protocol" || snapshot.telepathic.step8QuestionMode !== "manual" || snapshot.monitor) {
    throw new Error("This session is not a resumable manual Step 8 Telepathic Protocol session.");
  }
  if (input.session.state !== "BlindRunning" && input.session.state !== "Preflight") throw new Error("Only an incomplete blind telepathic session can be resumed.");
  if (snapshot.providerConfigId !== input.providerConfig.id || snapshot.provider !== input.providerConfig.provider) throw new Error("The captured Viewer provider is unavailable or has changed.");
  if (snapshot.modelId !== input.model.modelId || snapshot.modelRoute !== input.model.route) throw new Error("The captured Viewer model route is unavailable or has changed.");
  if (snapshot.revealSource === "automatic" && (!input.automaticTarget || input.automaticTarget.id !== snapshot.targetId)) throw new Error("The captured telepathic target is unavailable.");
  if (input.automaticTarget && !targetIsEligibleForProtocol(input.automaticTarget, "telepathic")) throw new Error("The captured target is not classified as telepathic.");

  const events = await input.repository.listSessionEvents(input.session.id);
  const recoveryState = telepathicManualRecoveryState(events);
  if (!recoveryState) throw new Error("No durable Step 8 telepathic recovery checkpoint was found.");

  const chat = input.chat ?? nativeProviderChat;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 5));
  const messages = rebuildViewerMessages(snapshot, events);
  const startedAtMs = Date.now();
  let metrics = rebuildViewerMetrics(events);
  const costGuard = new SessionCostGuard(input.maxSessionCostUsd, metrics.costUsd ?? 0);
  costGuard.validateModel(input.model);
  let transcript = recoverTelepathicTranscript(input.session.preRevealTranscript, events, snapshot.sessionLanguage);
  let questionCount = Math.max(0, ...events
    .filter((event) => event.eventType === "VIEWER_RESPONSE" && event.metadata?.telepathicPhase === "T9")
    .map((event) => Number(event.metadata?.questionNumber ?? 0))
    .filter(Number.isFinite));

  const notifyResume = (state: RvSessionState, phase?: number, stopReason?: string, awaitingQuestions = false): void => {
    input.onProgress?.({
      sessionId: input.session.id,
      sessionCode: input.session.sessionCode,
      state,
      transcript,
      phase,
      ...(stopReason ? { stopReason } : {}),
      metrics: snapshotSessionMetrics(metrics, startedAtMs),
      ...(awaitingQuestions ? { awaitingStep8Questions: true } : {}),
      telepathicQuestionCount: questionCount,
    });
  };
  const stop = async (reason: string): Promise<AutomaticTelepathicRunResult> => {
    input.onManualQuestionStage(null);
    await input.repository.updateRvSessionState(input.session.id, "Interrupted");
    await input.repository.appendSessionEvent(input.session.id, { eventType: "SESSION_STOPPED", role: "controller", content: reason, metadata: { resumed: true, metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
    notifyResume("Interrupted", undefined, reason);
    return { sessionId: input.session.id, sessionCode: input.session.sessionCode, state: "Interrupted", transcript, stopReason: reason };
  };
  const persist = async (nextTranscript: string, phase: number, awaitingQuestions = false): Promise<void> => {
    transcript = nextTranscript;
    await input.repository.updatePreRevealTranscript(input.session.id, transcript);
    notifyResume("BlindRunning", phase, undefined, awaitingQuestions);
    if (input.maxSessionCostUsd && input.maxSessionCostUsd > 0 && metrics.costUsd !== undefined && metrics.costUsd >= input.maxSessionCostUsd) {
      throw new TelepathicRunStop("AUTO-STOP: configured session cost limit exceeded");
    }
  };
  const viewerCall = async (prompt: string, metadata: Record<string, unknown>): Promise<ProviderChatResponse> => {
    if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
    messages.push({ role: "user", content: prompt });
    await input.repository.appendSessionEvent(input.session.id, { eventType: "CONTROLLER_STEP", role: "controller", content: prompt, metadata: { protocolFamily: "telepathic", resumed: true, ...metadata } });
    let response: ProviderChatResponse | null = null;
    let lastError = "";
    let responseDurationMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
      let authorization;
      try {
        authorization = costGuard.authorize(input.model, messages, snapshot.generationSettings);
      } catch (cause) {
        if (cause instanceof CostGuardStop) throw new TelepathicRunStop(cause.message);
        throw cause;
      }
      const requestStartedAt = Date.now();
      try {
        response = await chat({ config: input.providerConfig, modelId: input.model.modelId, messages: [...messages], settings: snapshot.generationSettings, timeoutMs: input.requestTimeoutMs, signal: input.signal });
        response = { ...response, usage: authorization.success(response.usage) };
        responseDurationMs = Date.now() - requestStartedAt;
        metrics = recordProviderRequest(metrics, response.usage, responseDurationMs);
        if (!response.content.trim()) throw new Error("empty provider response");
        break;
      } catch (cause) {
        authorization.failure();
        if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
        if (!response) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
        lastError = cause instanceof Error ? cause.message : String(cause);
        await input.repository.appendSessionEvent(input.session.id, { eventType: "PROVIDER_ERROR", role: "controller", content: lastError, metadata: { ...metadata, resumed: true, attempt: attempt + 1, requestDurationMs: Date.now() - requestStartedAt } });
        response = null;
        if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
        else break;
      }
    }
    if (!response) throw new TelepathicRunStop(`AUTO-STOP: repeated Viewer provider failures${lastError ? ` — ${lastError}` : ""}`);
    const raw = response.content;
    const sanitized = sanitizeRepetitiveOutput(raw, snapshot.sessionLanguage);
    response = { ...response, content: sanitized.content };
    if (sanitized.truncated) {
      await input.repository.appendSessionEvent(input.session.id, { eventType: "OUTPUT_TRUNCATED_LOOP", role: "controller", content: sanitized.finding?.fragment, metadata: { ...metadata, resumed: true, rule: sanitized.finding?.rule, originalLength: sanitized.originalLength, retainedLength: sanitized.retainedLength, rawOutputSha256: await sha256Text(raw) } });
    }
    messages.push({ role: "assistant", content: response.content });
    await input.repository.appendSessionEvent(input.session.id, { eventType: "VIEWER_RESPONSE", role: "assistant", content: response.content, metadata: { ...metadata, resumed: true, finishReason: response.finishReason, actualModel: response.actualModel ?? "unavailable", providerRequestId: response.providerRequestId ?? "unavailable", usage: response.usage, usageAccuracy: response.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: responseDurationMs } });
    return response;
  };
  const runQuestion = async (question: string): Promise<void> => {
    questionCount += 1;
    const prompt = telepathicQuestionPrompt(snapshot.sessionLanguage, question, questionCount);
    const response = await viewerCall(prompt, { step: 8, telepathicPhase: "T9", questionNumber: questionCount, source: "operator" });
    await persist(appendTelepathicQuestionTranscript(transcript, questionCount, prompt, response.content, snapshot.sessionLanguage, "operator"), 8, true);
  };

  try {
    await input.repository.updateRvSessionState(input.session.id, "BlindRunning");
    await input.repository.appendSessionEvent(input.session.id, { eventType: "TELEPATHIC_SESSION_RESUMED", role: "controller", metadata: { recoveryState, questionCount } });
    await input.repository.updatePreRevealTranscript(input.session.id, transcript);

    if (recoveryState === "questions") {
      let finished = false;
      let inFlight = false;
      let finishRequested = false;
      let resolveFinished!: () => void;
      const waiting = new Promise<void>((resolve) => { resolveFinished = resolve; });
      const finish = () => {
        if (finished) return;
        if (inFlight) { finishRequested = true; return; }
        finished = true;
        resolveFinished();
      };
      const handle: TelepathicManualQuestionHandle = {
        sessionId: input.session.id,
        ask: async (question) => {
          if (finished) throw new Error("The Step 8 question stage is already closed.");
          if (inFlight) throw new Error("Wait for the current answer before asking another question.");
          inFlight = true;
          try { await runQuestion(question); }
          finally {
            inFlight = false;
            if (finishRequested) finish();
          }
        },
        finish,
      };
      notifyResume("BlindRunning", 8, undefined, true);
      input.onManualQuestionStage(handle);
      const abort = () => finish();
      input.signal?.addEventListener("abort", abort, { once: true });
      await waiting;
      input.signal?.removeEventListener("abort", abort);
      input.onManualQuestionStage(null);
      if (input.signal?.aborted) throw new TelepathicRunStop("USER STOP");
      await input.repository.appendSessionEvent(input.session.id, { eventType: "TELEPATHIC_QUESTIONS_COMPLETED", role: "controller", metadata: { step: 8, questionCount, resumed: true } });
    }

    if (recoveryState !== "seal") {
      const step9Prompt = telepathicStepPrompt(snapshot.sessionLanguage, 9, input.session.sessionCode);
      notifyResume("BlindRunning", 9);
      const step9Response = await viewerCall(step9Prompt, { step: 9, telepathicPhase: "T10" });
      await persist(appendTelepathicStepTranscript(transcript, 9, step9Prompt, step9Response.content, snapshot.sessionLanguage), 9);
    }
  } catch (cause) {
    if (cause instanceof TelepathicRunStop) return stop(cause.message);
    throw cause;
  }

  const transcriptHash = await sha256Text(transcript);
  await input.repository.sealPreReveal(input.session.id, transcript, transcriptHash);
  await input.repository.appendSessionEvent(input.session.id, { eventType: "PRE_REVEAL_SEALED", role: "controller", metadata: { sha256: transcriptHash, resumed: true, metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
  notifyResume("AwaitingReveal");
  if (!input.automaticTarget) return { sessionId: input.session.id, sessionCode: input.session.sessionCode, state: "AwaitingReveal", transcript };
  await input.repository.appendSessionEvent(input.session.id, { eventType: "REVEAL_TRANSITION", role: "controller", content: politeRevealTransition(snapshot.sessionLanguage), metadata: { resumed: true } });
  const reveal = await buildAutomaticTargetReveal(input.automaticTarget, snapshot.sessionLanguage);
  await input.repository.acceptReveal(input.session.id, reveal);
  await input.repository.recordTargetUsage({ targetId: input.automaticTarget.id, profileId: input.session.profileId, sessionId: input.session.id });
  await input.repository.appendSessionEvent(input.session.id, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source: "automatic_target", targetId: input.automaticTarget.id, resumed: true } });
  notifyResume("Revealed");
  return { sessionId: input.session.id, sessionCode: input.session.sessionCode, state: "Revealed", transcript };
}

export function appendTelepathicStepTranscript(current: string, step: number, prompt: string, content: string, language: InterfaceLanguage): string {
  const phase = step === 1 ? "T0–T1" : step === 2 ? "T2" : step === 9 ? "T10" : `T${step}`;
  const block = language === "pl"
    ? `## Protokół Telepatyczny — Krok ${step} (${phase})\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${content.trim()}`
    : `## Telepathic Protocol — Step ${step} (${phase})\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendTelepathicFixedDeepeningTranscript(current: string, step: number, prompt: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `### Obowiązkowe pogłębienie Kroku ${step}\n\n#### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n#### Odpowiedź Viewera\n\n${content.trim()}`
    : `### Mandatory deepening of Step ${step}\n\n#### Exact controller instruction\n\n${prompt.trim()}\n\n#### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendTelepathicQuestionTranscript(current: string, questionNumber: number, prompt: string, content: string, language: InterfaceLanguage, source: "operator" | "monitor"): string {
  const block = language === "pl"
    ? `### T9 — pytanie ${questionNumber} (${source === "monitor" ? "AI Monitor" : "operator"})\n\n#### Pytanie\n\n${prompt.trim()}\n\n#### Odpowiedź Viewera\n\n${content.trim()}`
    : `### T9 — Question ${questionNumber} (${source === "monitor" ? "AI Monitor" : "operator"})\n\n#### Question\n\n${prompt.trim()}\n\n#### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendTelepathicMonitorTranscript(current: string, step: number, command: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `### AI Monitor — pogłębienie po Kroku ${step}\n\n#### Dokładne polecenie Monitora\n\n${command.trim()}\n\n#### Odpowiedź Viewera\n\n${content.trim()}`
    : `### AI Monitor — deepening after Step ${step}\n\n#### Exact Monitor instruction\n\n${command.trim()}\n\n#### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

function rebuildViewerMessages(snapshot: SessionSnapshot, events: SessionEventRecord[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [
    { role: "system", content: snapshot.protocol.fullContent },
    ...(snapshot.rvSystemPrompt?.fullContent.trim() ? [{ role: "system" as const, content: snapshot.rvSystemPrompt.fullContent.trim() }] : []),
  ];
  for (const event of [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber)) {
    if (event.eventType === "CONTROLLER_STEP" && event.content?.trim()) messages.push({ role: "user", content: event.content });
    if (event.eventType === "VIEWER_RESPONSE" && event.content?.trim()) messages.push({ role: "assistant", content: event.content });
  }
  return messages;
}

function rebuildViewerMetrics(events: SessionEventRecord[]): SessionRequestMetrics {
  let metrics = emptySessionRequestMetrics();
  for (const event of events) {
    if (event.eventType !== "VIEWER_RESPONSE") continue;
    const usage = event.metadata?.usage;
    const duration = Number(event.metadata?.requestDurationMs ?? 0);
    metrics = recordProviderRequest(
      metrics,
      usage && typeof usage === "object" && !Array.isArray(usage) ? usage as ProviderUsage : undefined,
      Number.isFinite(duration) ? duration : 0,
    );
  }
  return metrics;
}

function recoverTelepathicTranscript(current: string, events: SessionEventRecord[], language: InterfaceLanguage): string {
  let transcript = current;
  const ordered = [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  for (const response of ordered) {
    if (response.eventType !== "VIEWER_RESPONSE" || !response.content?.trim()) continue;
    if (response.metadata?.telepathicPhase === "T9") {
      const questionNumber = Number(response.metadata.questionNumber ?? 0);
      if (!Number.isInteger(questionNumber) || questionNumber < 1) continue;
      const marker = language === "pl" ? `T9 — pytanie ${questionNumber}` : `T9 — Question ${questionNumber}`;
      if (transcript.includes(marker)) continue;
      const prompt = [...ordered]
        .reverse()
        .find((event) => event.sequenceNumber < response.sequenceNumber
          && event.eventType === "CONTROLLER_STEP"
          && event.metadata?.telepathicPhase === "T9"
          && Number(event.metadata?.questionNumber ?? 0) === questionNumber
          && event.content?.trim());
      if (prompt?.content) transcript = appendTelepathicQuestionTranscript(transcript, questionNumber, prompt.content, response.content, language, "operator");
    }
    if (response.metadata?.step === 9) {
      const marker = language === "pl" ? "Protokół Telepatyczny — Krok 9" : "Telepathic Protocol — Step 9";
      if (transcript.includes(marker)) continue;
      const prompt = [...ordered].reverse().find((event) => event.sequenceNumber < response.sequenceNumber && event.eventType === "CONTROLLER_STEP" && event.metadata?.step === 9 && event.content?.trim());
      if (prompt?.content) transcript = appendTelepathicStepTranscript(transcript, 9, prompt.content, response.content, language);
    }
  }
  return transcript;
}

function normalizeQuestions(questions: string[] | undefined): string[] {
  return [...new Set((questions ?? []).map((question) => question.trim()).filter(Boolean))].slice(0, 20);
}

function validate(input: AutomaticTelepathicRunInput): void {
  if (input.protocol.id !== "telepathic-protocol" || input.protocol.controllerStepCount !== 9) throw new Error("Telepathic sessions require the approved nine-step bundled protocol.");
  if (input.protocol.language !== input.sessionLanguage) throw new Error("Telepathic Protocol language must match Session Language.");
  if (input.model.providerConfigId !== input.providerConfig.id || input.model.provider !== input.providerConfig.provider) throw new Error("Model/provider route mismatch.");
  if (input.monitor && (input.monitor.model.providerConfigId !== input.monitor.providerConfig.id || input.monitor.model.provider !== input.monitor.providerConfig.provider)) throw new Error("Monitor model/provider route mismatch.");
  if (input.monitor && input.step8Questions.mode === "manual") throw new Error("Manual Step 8 questions are available without AI Monitor; monitored sessions use predefined questions or Monitor-selected questions.");
  if (!input.monitor && input.step8Questions.mode === "monitor") throw new Error("Monitor-selected Step 8 questions require AI Monitor mode.");
  if (input.step8Questions.mode === "manual" && !input.onManualQuestionStage) throw new Error("Manual Step 8 questions require an operator question handler.");
  if (input.step8Questions.mode === "predefined" && normalizeQuestions(input.step8Questions.questions).length === 0) throw new Error("Enter at least one Step 8 tasking question.");
  if (input.monitor && normalizeQuestions(input.step8Questions.questions).length > 5) throw new Error("AI Monitor may ask no more than five predefined Step 8 questions.");
  if (input.automaticTarget && !targetHasSupportedReveal(input.automaticTarget)) throw new Error("Automatic target requires a supported reveal description or image.");
  if (input.automaticTarget && !targetIsEligibleForProtocol(input.automaticTarget, "telepathic")) throw new Error("Telepathic sessions require a telepathic user target or an external blind target.");
}

function notify(
  input: AutomaticTelepathicRunInput,
  sessionId: string,
  sessionCode: string,
  state: RvSessionState,
  transcript: string,
  phase: number | undefined,
  metrics: SessionRequestMetrics,
  startedAtMs: number,
  stopReason?: string,
  awaitingStep8Questions?: boolean,
  telepathicQuestionCount?: number,
): void {
  input.onProgress?.({
    sessionId,
    sessionCode,
    state,
    transcript,
    phase,
    stopReason,
    metrics: snapshotSessionMetrics(metrics, startedAtMs),
    ...(awaitingStep8Questions ? { awaitingStep8Questions: true } : {}),
    ...(telepathicQuestionCount !== undefined ? { telepathicQuestionCount } : {}),
  });
}
