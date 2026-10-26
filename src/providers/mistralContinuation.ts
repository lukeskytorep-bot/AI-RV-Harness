import {
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "./continuationContract";
import type { ProviderConfig } from "./types";

export interface MistralContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type MistralContinuationCapture =
  | { state: Extract<ProviderContinuationState, { transport: "mistral-native" }>; issue?: never }
  | { state?: never; issue: MistralContinuationIssue }
  | { state?: never; issue?: never };

export function buildMistralReplayFingerprint(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): ProviderReplayFingerprint | null {
  if (input.config.provider !== "mistral") return null;
  return {
    transport: "mistral-native",
    normalizedEndpoint: input.normalizedEndpoint,
    providerConfigId: input.config.id,
    credentialId: input.config.credentialId,
    requestedModelId: input.requestedModelId,
    stateFormat: "mistral-assistant-content",
    stateFormatVersion: 1,
  };
}

export function captureMistralContinuationState(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
  content?: unknown[];
  visibleContent?: string;
}): MistralContinuationCapture {
  if (input.config.provider !== "mistral" || !input.content?.length) return {};
  const replayFingerprint = buildMistralReplayFingerprint(input);
  if (!replayFingerprint) return {};
  const checked = validateProviderContinuationState({
    schemaVersion: 1,
    transport: "mistral-native",
    format: "mistral-assistant-content",
    replayFingerprint,
    content: input.content,
  });
  if (checked.ok === false) return { issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "mistral-native") {
    return { issue: { code: "invalid_payload", message: "validated continuation state changed transport unexpectedly" } };
  }
  if (input.visibleContent !== undefined) {
    const visibleFromChunks = checked.value.content.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");
    if (visibleFromChunks !== input.visibleContent) {
      return { issue: { code: "invalid_payload", message: "Mistral continuation chunks do not match the bound assistant message content" } };
    }
  }
  return { state: checked.value };
}

export function validateMistralReplayForRequest(input: {
  state: ProviderContinuationState;
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): { ok: true; state: Extract<ProviderContinuationState, { transport: "mistral-native" }> } | { ok: false; issue: MistralContinuationIssue } {
  const checked = validateProviderContinuationState(input.state);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "mistral-native" || input.config.provider !== "mistral") {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state belongs to a different provider transport" } };
  }
  const targetFingerprint = buildMistralReplayFingerprint(input);
  if (!targetFingerprint || !replayFingerprintsCompatible(checked.value.replayFingerprint, targetFingerprint)) {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state is not compatible with the current Mistral native route" } };
  }
  return { ok: true, state: checked.value };
}

export function validateMistralReplayBudget(states: readonly ProviderContinuationState[]): { ok: true } | { ok: false; issue: MistralContinuationIssue } {
  const checked = validateContinuationRequestBudget(states);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  return { ok: true };
}
