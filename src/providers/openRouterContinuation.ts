import {
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "./continuationContract";
import type { ProviderConfig } from "./types";

export interface OpenRouterContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type OpenRouterContinuationCapture =
  | { state: Extract<ProviderContinuationState, { transport: "openrouter" }>; issue?: never }
  | { state?: never; issue: OpenRouterContinuationIssue }
  | { state?: never; issue?: never };

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
}): OpenRouterContinuationCapture {
  if (input.config.provider !== "openrouter" || !input.reasoningDetails?.length) return {};
  const replayFingerprint = buildOpenRouterReplayFingerprint(input);
  if (!replayFingerprint) return {};
  const checked = validateProviderContinuationState({
    schemaVersion: 1,
    transport: "openrouter",
    format: "openrouter-reasoning-details",
    replayFingerprint,
    reasoningDetails: input.reasoningDetails,
  });
  if (checked.ok === false) {
    return { issue: { code: checked.code, message: checked.message } };
  }
  if (checked.value.transport !== "openrouter") {
    return { issue: { code: "invalid_payload", message: "validated continuation state changed transport unexpectedly" } };
  }
  return { state: checked.value };
}

export function validateOpenRouterReplayForRequest(input: {
  state: ProviderContinuationState;
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): { ok: true; state: Extract<ProviderContinuationState, { transport: "openrouter" }> } | { ok: false; issue: OpenRouterContinuationIssue } {
  const checked = validateProviderContinuationState(input.state);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
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
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  return { ok: true };
}
