import {
  CONTINUATION_LIMITS_V1,
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "./continuationContract";
import { detailedProviderDiagnosticsEnabled, recordProviderDebug } from "./debug";
import type { ProviderConfig, ProviderContinuationDiagnostics } from "./types";

export interface OpenRouterContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type OpenRouterContinuationCapture =
  | { state: Extract<ProviderContinuationState, { transport: "openrouter" }>; issue?: never; diagnostics: ProviderContinuationDiagnostics }
  | { state?: never; issue: OpenRouterContinuationIssue; diagnostics: ProviderContinuationDiagnostics }
  | { state?: never; issue?: never; diagnostics?: never };

function continuationValidationMessageForStage(message: string, stage: "capture_validation" | "replay_validation"): string {
  return message.startsWith("continuation_validation / ")
    ? `${stage} / ${message.slice("continuation_validation / ".length)}`
    : `${stage} / ${message}`;
}

export function buildOpenRouterReplayFingerprint(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): ProviderReplayFingerprint | null {
  if (input.config.provider !== "openrouter") return null;
  return {
    transport: "openrouter",
    normalizedEndpoint: input.normalizedEndpoint,
    providerConfigId: input.config.id,
    credentialId: input.config.credentialId,
    requestedModelId: input.requestedModelId,
    stateFormat: "openrouter-reasoning-details",
    stateFormatVersion: 1,
  };
}

export function captureOpenRouterContinuationState(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
  reasoningDetails?: unknown[];
  continuationDiagnostics?: ProviderContinuationDiagnostics;
}): OpenRouterContinuationCapture {
  if (input.config.provider !== "openrouter" || input.reasoningDetails === undefined) return {};
  const replayFingerprint = buildOpenRouterReplayFingerprint(input);
  if (!replayFingerprint) return {};
  const candidate = {
    schemaVersion: 1,
    transport: "openrouter",
    format: "openrouter-reasoning-details",
    replayFingerprint,
    reasoningDetails: input.reasoningDetails,
  } as const;
  const checked = validateProviderContinuationState(candidate);
  const rawStateBytes = (() => {
    try {
      return new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
    } catch {
      return undefined;
    }
  })();
  const baseDiagnostics: ProviderContinuationDiagnostics = input.continuationDiagnostics ?? {
    transport: "openrouter",
    rawSseEvents: 0,
    receivedReasoningDetailItems: input.reasoningDetails.length,
    logicalReasoningBlocks: input.reasoningDetails.length,
    reasoningDetailsPresent: true,
  };
  const diagnostics: ProviderContinuationDiagnostics = {
    ...baseDiagnostics,
    transport: "openrouter",
    logicalReasoningBlocks: input.reasoningDetails.length,
    reasoningDetailsPresent: true,
    continuationStateBytes: checked.ok ? checked.sizeBytes : rawStateBytes,
    blockLimit: CONTINUATION_LIMITS_V1.maxBlocksPerMessage,
    stateByteLimit: CONTINUATION_LIMITS_V1.maxStateBytes,
    ...(checked.ok ? {} : {
      rejectionStage: "capture_validation" as const,
      rejectionReason: continuationValidationMessageForStage(checked.message, "capture_validation"),
    }),
  };
  const recordDiagnostics = (status: "ok" | "error", error?: string) => {
    if (!detailedProviderDiagnosticsEnabled()) return;
    recordProviderDebug({
      provider: "openrouter",
      modelId: input.requestedModelId,
      status,
      continuation: diagnostics,
      ...(error ? { error } : {}),
    });
  };
  if (checked.ok === false) {
    const message = continuationValidationMessageForStage(checked.message, "capture_validation");
    recordDiagnostics("error", message);
    return { issue: { code: checked.code, message }, diagnostics: { ...diagnostics, rejectionReason: message } };
  }
  if (checked.value.transport !== "openrouter") {
    const issue = { code: "invalid_payload" as const, message: "validated continuation state changed transport unexpectedly" };
    recordDiagnostics("error", issue.message);
    return { issue, diagnostics: { ...diagnostics, rejectionStage: "capture_validation", rejectionReason: issue.message } };
  }
  recordDiagnostics("ok");
  return { state: checked.value, diagnostics };
}

export function validateOpenRouterReplayForRequest(input: {
  state: ProviderContinuationState;
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): { ok: true; state: Extract<ProviderContinuationState, { transport: "openrouter" }> } | { ok: false; issue: OpenRouterContinuationIssue } {
  const checked = validateProviderContinuationState(input.state);
  if (checked.ok === false) return {
    ok: false,
    issue: { code: checked.code, message: continuationValidationMessageForStage(checked.message, "replay_validation") },
  };
  if (checked.value.transport !== "openrouter" || input.config.provider !== "openrouter") {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state belongs to a different provider transport" } };
  }
  const targetFingerprint = buildOpenRouterReplayFingerprint({
    config: input.config,
    requestedModelId: input.requestedModelId,
    normalizedEndpoint: input.normalizedEndpoint,
  });
  if (!targetFingerprint || !replayFingerprintsCompatible(checked.value.replayFingerprint, targetFingerprint)) {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state is not compatible with the current OpenRouter route" } };
  }
  return { ok: true, state: checked.value };
}

export function validateOpenRouterReplayBudget(states: readonly ProviderContinuationState[]): { ok: true } | { ok: false; issue: OpenRouterContinuationIssue } {
  const checked = validateContinuationRequestBudget(states);
  if (checked.ok === false) return {
    ok: false,
    issue: { code: checked.code, message: continuationValidationMessageForStage(checked.message, "replay_validation") },
  };
  return { ok: true };
}
