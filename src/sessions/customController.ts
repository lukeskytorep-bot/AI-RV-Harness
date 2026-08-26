import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import { shouldRetryProviderError, waitBeforeProviderRetry } from "../providers/retry";
import type { CustomProtocolVersion } from "../protocols/types";
import type { AppRepository } from "../storage/repository";
import { buildAutomaticTargetReveal, targetHasSupportedReveal } from "../targets/service";
import { APP_VERSION } from "../version";
import { createSessionCode } from "./sessionCode";
import type { TargetRecord } from "../targets/types";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import { sha256Text, type SessionProgress } from "./controller";
import { emptySessionRequestMetrics, recordProviderRequest, snapshotSessionMetrics, type SessionRequestMetrics } from "./metrics";
import type { RvSession, RvSessionState, SessionSnapshot } from "./types";
import { CostGuardStop, SessionCostGuard } from "./costGuard";
import { sanitizeRepetitiveOutput } from "./repetitionGuard";
import {
  LOCKED_ACTIVITY_VERSION,
  LOCKED_IDENTITY_VERSION,
  lockedActivityDefinition,
  lockedViewerIdentity,
} from "../resources/systemPrompts";

type CustomSessionRepository = Pick<
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

export interface AutomaticCustomRunInput {
  repository: CustomSessionRepository;
  workspaceId: string;
  profileId: string;
  aiIsBeDisplayName?: string;
  humanIsBeDisplayName?: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  protocol: CustomProtocolVersion;
  sessionLanguage: InterfaceLanguage;
  requestedSettings: GenerationSettings;
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
  resumeSession?: RvSession;
  automaticTarget?: TargetRecord;
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

export async function runAutomaticCustomSession(input: AutomaticCustomRunInput): Promise<{ sessionId: string; sessionCode: string; state: "AwaitingReveal" | "Revealed" | "Interrupted"; transcript: string; stopReason?: string }> {
  validate(input);
  const effectiveSettings = resolveGenerationSettings(input.model.capabilities, input.requestedSettings);
  if (effectiveSettings.omitted.length) throw new Error(`Unsupported generation settings: ${effectiveSettings.omitted.join(", ")}`);
  const costGuard = new SessionCostGuard(input.maxSessionCostUsd);
  costGuard.validateModel(input.model);
  const sessionId = input.resumeSession?.id ?? `session_${crypto.randomUUID()}`;
  const sessionCode = input.resumeSession?.sessionCode ?? createSessionCode(input.sessionCodePrefix);
  const chat = input.chat ?? nativeProviderChat;
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 5));
  const messages: ProviderMessage[] = [
    ...(input.protocol.systemPrompt ? [{ role: "system" as const, content: input.protocol.systemPrompt }] : []),
    ...(input.rvSystemPrompt?.content.trim() ? [{ role: "system" as const, content: input.rvSystemPrompt.content.trim() }] : []),
  ];
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
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_CREATED", role: "controller", metadata: { sessionCode, protocolFamily: "custom" } });
  await input.repository.updateRvSessionState(sessionId, "Preflight");

  const fullProtocol = JSON.stringify({ systemPrompt: input.protocol.systemPrompt ?? "", steps: input.protocol.steps });
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
      id: input.protocol.protocolId,
      version: input.protocol.version,
      language: input.protocol.language,
      contentSha256: input.protocol.contentHash,
      fullContent: fullProtocol,
    },
    controllerPrompt: { id: "custom-protocol-controller", version: "1.0.0", language: input.sessionLanguage },
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
  await input.repository.appendSessionEvent(sessionId, { eventType: "PREFLIGHT_COMPLETE", role: "controller", metadata: { stepCount: input.protocol.steps.length } });
  notify(input, sessionId, sessionCode, "Preflight", transcript, undefined, undefined, metrics, startedAtMs);
  await input.repository.updateRvSessionState(sessionId, "BlindRunning");
  notify(input, sessionId, sessionCode, "BlindRunning", transcript, undefined, undefined, metrics, startedAtMs);

  for (let index = 0; index < input.protocol.steps.length; index += 1) {
    const step = index + 1;
    if (input.signal?.aborted) return stopRun("USER STOP");
    const prompt = input.protocol.steps[index].replaceAll("{{SESSION_CODE}}", sessionCode);
    messages.push({ role: "user", content: prompt });
    await input.repository.appendSessionEvent(sessionId, { eventType: "CONTROLLER_STEP", role: "controller", content: prompt, metadata: { step, customProtocol: input.protocol.versionId } });
    notify(input, sessionId, sessionCode, "BlindRunning", transcript, step, undefined, metrics, startedAtMs);

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
        await input.repository.appendSessionEvent(sessionId, { eventType: "PROVIDER_ERROR", role: "controller", content: lastError, metadata: { step, attempt: attempt + 1, requestDurationMs: Date.now() - requestStartedAt } });
        response = null;
        if (shouldRetryProviderError(cause, attempt, maxRetries)) await waitBeforeProviderRetry(attempt, input.signal, cause);
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
        metadata: { step, rule: sanitized.finding?.rule, originalLength: sanitized.originalLength, retainedLength: sanitized.retainedLength, rawOutputSha256: await sha256Text(rawResponseContent) },
      });
    }
    messages.push({ role: "assistant", content: response.content });
    transcript = appendStepTranscript(transcript, step, prompt, response.content, input.sessionLanguage);
    await input.repository.appendSessionEvent(sessionId, { eventType: "VIEWER_RESPONSE", role: "assistant", content: response.content, metadata: { step, finishReason: response.finishReason, actualModel: response.actualModel ?? "unavailable", providerRequestId: response.providerRequestId ?? "unavailable", usage: response.usage, usageAccuracy: response.usage.totalTokens !== undefined ? "reported" : "unavailable", requestDurationMs: responseDurationMs } });
    await input.repository.updatePreRevealTranscript(sessionId, transcript);
    notify(input, sessionId, sessionCode, "BlindRunning", transcript, step, undefined, metrics, startedAtMs);
    if (input.maxSessionCostUsd && input.maxSessionCostUsd > 0 && metrics.costUsd !== undefined && metrics.costUsd >= input.maxSessionCostUsd) return stopRun("AUTO-STOP: configured session cost limit exceeded");
  }

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

export function appendStepTranscript(current: string, step: number, prompt: string, content: string, language: InterfaceLanguage): string {
  const block = language === "pl"
    ? `## Protokół własny — krok ${step}\n\n### Dokładne polecenie kontrolera\n\n${prompt.trim()}\n\n### Odpowiedź Viewera\n\n${content.trim()}`
    : `## Custom protocol — Step ${step}\n\n### Exact controller instruction\n\n${prompt.trim()}\n\n### Viewer response\n\n${content.trim()}`;
  return current ? `${current}\n\n${block}` : block;
}

function validate(input: AutomaticCustomRunInput): void {
  if (input.protocol.language !== input.sessionLanguage) throw new Error("Custom Protocol language must match Session Language.");
  if (input.protocol.steps.length < 1 || input.protocol.steps.length > 20) throw new RangeError("Custom Protocol requires 1–20 steps.");
  if (input.model.providerConfigId !== input.providerConfig.id || input.model.provider !== input.providerConfig.provider) throw new Error("Model/provider route mismatch.");
  if (input.automaticTarget && !targetHasSupportedReveal(input.automaticTarget)) throw new Error("Automatic target requires a supported reveal description or image.");
}

async function stop(input: AutomaticCustomRunInput, sessionId: string, sessionCode: string, transcript: string, reason: string, metrics: SessionRequestMetrics, startedAtMs: number) {
  await input.repository.updateRvSessionState(sessionId, "Interrupted");
  await input.repository.appendSessionEvent(sessionId, { eventType: "SESSION_STOPPED", role: "controller", content: reason, metadata: { metrics: snapshotSessionMetrics(metrics, startedAtMs) } });
  notify(input, sessionId, sessionCode, "Interrupted", transcript, undefined, reason, metrics, startedAtMs);
  return { sessionId, sessionCode, state: "Interrupted" as const, transcript, stopReason: reason };
}

function notify(input: AutomaticCustomRunInput, sessionId: string, sessionCode: string, state: RvSessionState, transcript: string, phase?: number, stopReason?: string, metrics?: SessionRequestMetrics, startedAtMs?: number): void {
  input.onProgress?.({ sessionId, sessionCode, state, transcript, phase, stopReason, ...(metrics && startedAtMs !== undefined ? { metrics: snapshotSessionMetrics(metrics, startedAtMs) } : {}) });
}
