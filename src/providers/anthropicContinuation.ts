import {
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "./continuationContract";
import type { ProviderConfig } from "./types";

export interface AnthropicContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type AnthropicContinuationCapture =
  | { state: Extract<ProviderContinuationState, { transport: "anthropic-native" }>; issue?: never }
  | { state?: never; issue: AnthropicContinuationIssue }
  | { state?: never; issue?: never };

export function buildAnthropicReplayFingerprint(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): ProviderReplayFingerprint | null {
  if (input.config.provider !== "anthropic") return null;
  return {
    transport: "anthropic-native",
    normalizedEndpoint: input.normalizedEndpoint,
    providerConfigId: input.config.id,
    credentialId: input.config.credentialId,
    requestedModelId: input.requestedModelId,
    stateFormat: "anthropic-thinking-blocks",
    stateFormatVersion: 1,
  };
}

export function captureAnthropicContinuationState(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
  blocks?: unknown[];
}): AnthropicContinuationCapture {
  if (input.config.provider !== "anthropic" || !input.blocks?.length) return {};
  const replayFingerprint = buildAnthropicReplayFingerprint(input);
  if (!replayFingerprint) return {};
  const checked = validateProviderContinuationState({
    schemaVersion: 1,
    transport: "anthropic-native",
    format: "anthropic-thinking-blocks",
    replayFingerprint,
    blocks: input.blocks,
  });
  if (checked.ok === false) return { issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "anthropic-native") {
    return { issue: { code: "invalid_payload", message: "validated continuation state changed transport unexpectedly" } };
  }
  return { state: checked.value };
}

export function validateAnthropicReplayForRequest(input: {
  state: ProviderContinuationState;
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): { ok: true; state: Extract<ProviderContinuationState, { transport: "anthropic-native" }> } | { ok: false; issue: AnthropicContinuationIssue } {
  const checked = validateProviderContinuationState(input.state);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "anthropic-native" || input.config.provider !== "anthropic") {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state belongs to a different provider transport" } };
  }
  const targetFingerprint = buildAnthropicReplayFingerprint({
    config: input.config,
    requestedModelId: input.requestedModelId,
    normalizedEndpoint: input.normalizedEndpoint,
  });
  if (!targetFingerprint || !replayFingerprintsCompatible(checked.value.replayFingerprint, targetFingerprint)) {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state is not compatible with the current Anthropic native route" } };
  }
  return { ok: true, state: checked.value };
}

export function validateAnthropicReplayBudget(states: readonly ProviderContinuationState[]): { ok: true } | { ok: false; issue: AnthropicContinuationIssue } {
  const checked = validateContinuationRequestBudget(states);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  return { ok: true };
}
