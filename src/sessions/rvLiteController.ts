import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import { isRetryableProviderError, waitBeforeProviderRetry } from "../providers/retry";
import { renderRvLiteSteps, type RvLiteProtocolResource } from "../resources/protocolRegistry";
import {
  lockedActivityDefinition,
  lockedViewerIdentity,
  LOCKED_ACTIVITY_VERSION,
  LOCKED_IDENTITY_VERSION,
} from "../resources/systemPrompts";
import type { AppRepository } from "../storage/repository";
import { buildAutomaticTargetReveal, targetHasSupportedReveal } from "../targets/service";
import type { TargetRecord } from "../targets/types";
import type { InterfaceLanguage } from "../types";
import type { ViewerSystemPromptSnapshot } from "../types";
import { APP_VERSION } from "../version";
import { sha256Text, type SessionProgress } from "./controller";
import { emptySessionRequestMetrics, recordProviderRequest, snapshotSessionMetrics, type SessionRequestMetrics } from "./metrics";
import { createSessionCode } from "./sessionCode";
import type { RvSessionState, SessionSnapshot } from "./types";
import { CostGuardStop, SessionCostGuard } from "./costGuard";
import { sanitizeRepetitiveOutput } from "./repetitionGuard";
import type { SpecialTaskInput } from "./specialTask";
import { renderSpecialTask } from "./specialTask";

type RvLiteSessionRepository = Pick<
  AppRepository,
  | "createRvSession"
  | "updateRvSessionState"
  | "appendSessionEvent"
  | "updatePreRevealTranscript"
  | "saveSessionSnapshot"
  | "sealPreReveal"
  | "acceptReveal"
  | "recordTargetUsage"
>;

export interface AutomaticRvLiteRunInput {
  repository: RvLiteSessionRepository;
  workspaceId: string;
  profileId: string;
  profileName?: string;
  humanIsBeDisplayName?: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  protocol: RvLiteProtocolResource;
  sessionLanguage: InterfaceLanguage;
  requestedSettings: GenerationSettings;
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
  automaticTarget?: TargetRecord;
  specialTask?: SpecialTaskInput;
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
  onProgress?: (progress: SessionProgress) => void;
}

export async function runAutomaticRvLiteSession(input: AutomaticRvLiteRunInput): Promise<{ sessionId: string; sessionCode: string; state: "AwaitingReveal" | "Revealed" | "Interrupted"; transcript: string; stopReason?: string }> {
  validate(input);
  const effectiveSettings = resolveGenerationSettings(input.model.capabilities, input.requestedSettings);
  if (effectiveSettings.omitted.length) throw new Error(`Unsupported generation settings: ${effectiveSettings.omitted.join(", ")}`);
  const costGuard = new SessionCostGuard(input.maxSessionCostUsd);
  costGuard.validateModel(input.model);

  const sessionId = `session_${crypto.randomUUID()}`;
  const sessionCode = createSessionCode(input.sessionCodePrefix);
  const steps = renderRvLiteSteps(input.protocol, input.profileName, sessionCode);
  const chat = input.chat ?? nativeProviderChat;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 5));
  const messages: ProviderMessage[] = input.rvSystemPrompt?.content.trim()
    ? [{ role: "system", content: input.rvSystemPrompt.content.trim() }]
    : [];
  const startedAtMs = Date.now();
  let metrics = emptySessionRequestMetrics();
  let transcript = "";
  const stopRun = (reason: string) => stop(input, sessionId, sessionCode, transcript, reason, metrics, startedAtMs);

  await input.repository.createRvSession({
    id: sessionId,
    workspaceId: input.workspaceId,
    profileId: input.profileId,
    sessionCode,
    runType: "automatic",
    targetId: input.automaticTarget?.id,
  });
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_CREATED", role: "controller", metadata: { sessionCode, protocolFamily: "rv-lite" } });
  await input.repository.updateRvSessionState(sessionId, "Preflight");

  const snapshot: SessionSnapshot = {
    schemaVersion: 2,
    sessionId,
    sessionCode,
    profileId: input.profileId,
    workspaceId: input.workspaceId,
    identities: {
      aiIsBeDisplayName: input.profileName?.trim() || "AI IS-BE",
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
      variant: input.protocol.variant,
    },
    controllerPrompt: { id: "rv-lite-four-call-controller", version: "1.0.0", language: input.sessionLanguage },
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
    ...(renderSpecialTask(input.specialTask, input.sessionLanguage) ? {
      specialTask: {
        selectedOptions: input.specialTask?.selectedOptions ?? [],
        ...(input.specialTask?.customText?.trim() ? { customText: input.specialTask.customText.trim() } : {}),
        recipient: "viewer" as const,
        injectAfter: "rv_lite_step_3" as const,
      },
    } : {}),
    revealSource: input.automaticTarget ? "automatic" : "external",
    ...(input.automaticTarget ? { targetId: input.automaticTarget.id } : {}),
    applicationVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
  };
  await input.repository.saveSessionSnapshot(sessionId, snapshot, await sha256Text(JSON.stringify(snapshot)));
  await input.repository.appendSessionEvent(sessionId, { eventType: "PREFLIGHT_COMPLETE", role: "controller", metadata: { viewerCalls: 4, mandatoryDeepeningInPrompt: 3 } });
  notify(input, sessionId, sessionCode, "Preflight", transcript, undefined, undefined, metrics, startedAtMs);
  await input.repository.updateRvSessionState(sessionId, "BlindRunning");
  notify(input, sessionId, sessionCode, "BlindRunning", transcript, undefined, undefined, metrics, startedAtMs);

  for (let index = 0; index < steps.length; index += 1) {
    const promptNumber = index + 1;
    if (input.signal?.aborted) return stopRun("USER STOP");
    const prompt = steps[index];
    messages.push({ role: "user", content: prompt });
    await input.repository.appendSessionEvent(sessionId, { eventType: "CONTROLLER_STEP", role: "controller", content: prompt, metadata: { promptNumber, protocolFamily: "rv-lite" } });
    notify(input, sessionId, sessionCode, "BlindRunning", transcript, promptNumber, undefined, metrics, startedAtMs);

    let response: ProviderChatResponse | null = null;
    let lastError = "";
    let responseDurationMs = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (input.signal?.aborted) return stopRun("USER STOP");
      let costAuthorization;
      try {
        costAuthorization = costGuard.authorize(input.model, messages, effectiveSettings);
      } catch (cause) {
        if (cause instanceof CostGuardStop) return stopRun(cause.message);
        throw cause;
      }
      const requestStartedAt = Date.now();
      try {
        response = await chat({ config: input.providerConfig, modelId: input.model.modelId, messages: [...messages], settings: effectiveSettings, timeoutMs: input.requestTimeoutMs, signal: input.signal });
        response = { ...response, usage: costAuthorization.success(response.usage) };
        responseDurationMs = Date.now() - requestStartedAt;
        metrics = recordProviderRequest(metrics, response.usage, responseDurationMs);
        if (!response.content.trim()) throw new Error("empty provider response");
        break;
      } catch (cause) {
        costAuthorization.failure();
        if (input.signal?.aborted) return stopRun("USER STOP");
        if (!response) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
        lastError = cause instanceof Error ? cause.message : String(cause);
        await input.repository.appendSessionEvent(sessionId, { eventType: "PROVIDER_ERROR", role: "controller", content: lastError, metadata: { promptNumber, attempt: attempt + 1, requestDurationMs: Date.now() - requestStartedAt } });
        response = null;
        if (attempt < maxRetries && isRetryableProviderError(cause)) await waitBeforeProviderRetry(attempt, input.signal, cause);
        else break;
      }
    }
    if (!response) return stopRun(`AUTO-STOP: repeated provider/API failures${lastError ? ` — ${lastError}` : ""}`);

    const rawResponseContent = response.content;
    const sanitized = sanitizeRepetitiveOutput(rawResponseContent, input.sessionLanguage);
    response = { ...response, content: sanitized.content };
    if (sanitized.truncated) {
      await input.repository.appendSessionEvent(sessionId, {
        eventType: "OUTPUT_TRUNCATED_LOOP",
        role: "controller",
        content: sanitized.finding?.fragment,
        metadata: { promptNumber, rule: sanitized.finding?.rule, originalLength: sanitized.originalLength, retainedLength: sanitized.retainedLength, rawOutputSha256: await sha256Text(rawResponseContent) },
      });
    }
    messages.push({ role: "assistant", content: response.content });
    transcript = appendRvLiteTranscript(transcript, promptNumber, prompt, response.content, input.sessionLanguage);
    await input.repository.appendSessionEvent(sessionId, { eventType: "VIEWER_RESPONSE", role: "assistant", content: response.content, metadata: { promptNumber, finishReason: response.finishReason, actualModel: response.actualModel ?? "unavailable", providerRequestId: response.providerRequestId ?? "unavailable", usage: response.usage, usageAccuracy: response.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: responseDurationMs } });
    // The Viewer response is durably saved before any next model call.
    await input.repository.updatePreRevealTranscript(sessionId, transcript);
    notify(input, sessionId, sessionCode, "BlindRunning", transcript, promptNumber, undefined, metrics, startedAtMs);
    if (input.maxSessionCostUsd && input.maxSessionCostUsd > 0 && metrics.costUsd !== undefined && metrics.costUsd >= input.maxSessionCostUsd) return stopRun("AUTO-STOP: configured session cost limit exceeded");

    if (promptNumber === 3) {
      const specialTask = renderSpecialTask(input.specialTask, input.sessionLanguage);
      if (specialTask) {
        const taskPrompt = input.sessionLanguage === "pl"
          ? `SPECJALNE ZADANIE VIEWERA — wykonaj je teraz, po zakończeniu Kroku 3, używając wyłącznie neutralnych etykiet ślepej sesji:\n${specialTask}`
          : `SPECIAL VIEWER TASK — perform it now, after completing Step 3, using only neutral blind-session labels:\n${specialTask}`;
        messages.push({ role: "user", content: taskPrompt });
        await input.repository.appendSessionEvent(sessionId, { eventType: "SPECIAL_TASK_INJECTED", role: "controller", content: taskPrompt, metadata: { promptNumber, recipient: "viewer", injectAfter: "rv_lite_step_3" } });

        let taskResponse: ProviderChatResponse | null = null;
        let taskError = "";
        let taskDurationMs = 0;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          if (input.signal?.aborted) return stopRun("USER STOP");
          let costAuthorization;
          try {
            costAuthorization = costGuard.authorize(input.model, messages, effectiveSettings);
          } catch (cause) {
            if (cause instanceof CostGuardStop) return stopRun(cause.message);
            throw cause;
          }
          const requestStartedAt = Date.now();
          try {
            taskResponse = await chat({ config: input.providerConfig, modelId: input.model.modelId, messages: [...messages], settings: effectiveSettings, timeoutMs: input.requestTimeoutMs, signal: input.signal });
            taskResponse = { ...taskResponse, usage: costAuthorization.success(taskResponse.usage) };
            taskDurationMs = Date.now() - requestStartedAt;
            metrics = recordProviderRequest(metrics, taskResponse.usage, taskDurationMs);
            if (!taskResponse.content.trim()) throw new Error("empty provider response");
            break;
          } catch (cause) {
            costAuthorization.failure();
            if (input.signal?.aborted) return stopRun("USER STOP");
            if (!taskResponse) metrics = recordProviderRequest(metrics, undefined, Date.now() - requestStartedAt);
            taskError = cause instanceof Error ? cause.message : String(cause);
            await input.repository.appendSessionEvent(sessionId, { eventType: "PROVIDER_ERROR", role: "controller", content: taskError, metadata: { promptNumber, attempt: attempt + 1, source: "special_task", requestDurationMs: Date.now() - requestStartedAt } });
            taskResponse = null;
            if (attempt < maxRetries && isRetryableProviderError(cause)) await waitBeforeProviderRetry(attempt, input.signal, cause);
            else break;
          }
        }
        if (!taskResponse) return stopRun(`AUTO-STOP: Viewer failed during Special Task${taskError ? ` — ${taskError}` : ""}`);

        const rawTaskContent = taskResponse.content;
        const sanitizedTask = sanitizeRepetitiveOutput(rawTaskContent, input.sessionLanguage);
        taskResponse = { ...taskResponse, content: sanitizedTask.content };
        if (sanitizedTask.truncated) {
          await input.repository.appendSessionEvent(sessionId, {
            eventType: "OUTPUT_TRUNCATED_LOOP",
            role: "controller",
            content: sanitizedTask.finding?.fragment,
            metadata: { promptNumber, source: "special_task", rule: sanitizedTask.finding?.rule, originalLength: sanitizedTask.originalLength, retainedLength: sanitizedTask.retainedLength, rawOutputSha256: await sha256Text(rawTaskContent) },
          });
        }
        messages.push({ role: "assistant", content: taskResponse.content });
        transcript = appendRvLiteSpecialTaskTranscript(transcript, taskPrompt, taskResponse.content, input.sessionLanguage);
        await input.repository.appendSessionEvent(sessionId, { eventType: "VIEWER_SPECIAL_TASK_RESPONSE", role: "assistant", content: taskResponse.content, metadata: { promptNumber, finishReason: taskResponse.finishReason, actualModel: taskResponse.actualModel ?? "unavailable", providerRequestId: taskResponse.providerRequestId ?? "unavailable", usage: taskResponse.usage, usageAccuracy: taskResponse.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: taskDurationMs } });
        await input.repository.updatePreRevealTranscript(sessionId, transcript);
        notify(input, sessionId, sessionCode, "BlindRunning", transcript, promptNumber, undefined, metrics, startedAtMs);
        if (input.maxSessionCostUsd && input.maxSessionCostUsd > 0 && metrics.costUsd !== undefined && metrics.costUsd >= input.maxSessionCostUsd) return stopRun("AUTO-STOP: configured session cost limit exceeded");
      }
    }
  }

  // STOP always wins, including the narrow boundary after Prompt 4 and before sealing/reveal.
  if (input.signal?.aborted) return stopRun("USER STOP");
  const transcriptHash = await sha256Text(transcript);
  await input.repository.sealPreReveal(sessionId, transcript, transcriptHash);
  await input.repository.appendSessionEvent(sessionId, { eventType: "PRE_REVEAL_SEALED", role: "controller", metadata: { sha256: transcriptHash, metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
  notify(input, sessionId, sessionCode, "AwaitingReveal", transcript, undefined, undefined, metrics, startedAtMs);
  if (input.signal?.aborted) return stopRun("USER STOP");
  if (!input.automaticTarget) return { sessionId, sessionCode, state: "AwaitingReveal", transcript };

  const reveal = await buildAutomaticTargetReveal(input.automaticTarget, input.sessionLanguage);
  await input.repository.acceptReveal(sessionId, reveal);
  await input.repository.recordTargetUsage({ targetId: input.automaticTarget.id, profileId: input.profileId, sessionId });
  await input.repository.appendSessionEvent(sessionId, { eventType: "REVEAL_ACCEPTED", role: "controller", metadata: { source: "automatic_target", targetId: input.automaticTarget.id } });
  notify(input, sessionId, sessionCode, "Revealed", transcript, undefined, undefined, metrics, startedAtMs);
  return { sessionId, sessionCode, state: "Revealed", transcript };
}

export function appendRvLiteTranscript(current: string, promptNumber: number, prompt: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `## RV Lite — krok ${promptNumber}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${content.trim()}`
    : `## RV Lite — Step ${promptNumber}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

export function appendRvLiteSpecialTaskTranscript(current: string, command: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `## RV Lite — zadanie specjalne po Kroku 3\n\n### Dokładne polecenie kontrolera\n\n${command.trim()}\n\n### Odpowiedź Viewera\n\n${content.trim()}`
    : `## RV Lite — Special Task after Step 3\n\n### Exact controller instruction\n\n${command.trim()}\n\n### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

function validate(input: AutomaticRvLiteRunInput): void {
  if (input.protocol.id !== "rv-lite" || input.protocol.steps.length !== 4) throw new Error("RV Lite requires the approved four-call bundled resource.");
  if (input.protocol.language !== input.sessionLanguage) throw new Error("RV Lite language must match Session Language.");
  if (input.model.providerConfigId !== input.providerConfig.id || input.model.provider !== input.providerConfig.provider) throw new Error("Model/provider route mismatch.");
  if (input.automaticTarget && !targetHasSupportedReveal(input.automaticTarget)) throw new Error("Automatic target requires a supported reveal description or image.");
}

async function stop(input: AutomaticRvLiteRunInput, sessionId: string, sessionCode: string, transcript: string, reason: string, metrics: SessionRequestMetrics, startedAtMs: number) {
  await input.repository.updateRvSessionState(sessionId, "Interrupted");
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_STOPPED", role: "controller", content: reason, metadata: { metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
  notify(input, sessionId, sessionCode, "Interrupted", transcript, undefined, reason, metrics, startedAtMs);
  return { sessionId, sessionCode, state: "Interrupted" as const, transcript, stopReason: reason };
}

function notify(input: AutomaticRvLiteRunInput, sessionId: string, sessionCode: string, state: RvSessionState, transcript: string, phase?: number, stopReason?: string, metrics?: SessionRequestMetrics, startedAtMs?: number): void {
  input.onProgress?.({ sessionId, sessionCode, state, transcript, phase, stopReason, ...(metrics && startedAtMs !== undefined ? { metrics: snapshotSessionMetrics(metrics, startedAtMs) } : {}) });
}
