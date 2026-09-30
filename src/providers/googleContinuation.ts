import {
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "./continuationContract";
import type { ProviderConfig } from "./types";

export interface GoogleContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type GoogleContinuationCapture =
  | { state: Extract<ProviderContinuationState, { transport: "google-native" }>; issue?: never }
  | { state?: never; issue: GoogleContinuationIssue }
  | { state?: never; issue?: never };

export function buildGoogleReplayFingerprint(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): ProviderReplayFingerprint | null {
  if (input.config.provider !== "google") return null;
  return {
    transport: "google-native",
    normalizedEndpoint: input.normalizedEndpoint,
    providerConfigId: input.config.id,
    credentialId: input.config.credentialId,
    requestedModelId: input.requestedModelId,
    stateFormat: "google-thought-parts",
    stateFormatVersion: 1,
  };
}

export function captureGoogleContinuationState(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
  parts?: unknown[];
  visibleContent?: string;
}): GoogleContinuationCapture {
  if (input.config.provider !== "google" || !input.parts?.length) return {};
  const replayFingerprint = buildGoogleReplayFingerprint(input);
  if (!replayFingerprint) return {};
  const checked = validateProviderContinuationState({
    schemaVersion: 1,
    transport: "google-native",
    format: "google-thought-parts",
    replayFingerprint,
    parts: input.parts,
  });
  if (checked.ok === false) return { issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "google-native") {
    return { issue: { code: "invalid_payload", message: "validated continuation state changed transport unexpectedly" } };
  }
  if (input.visibleContent !== undefined) {
    const visibleFromParts = checked.value.parts.filter((part) => part.thought !== true).map((part) => part.text).join("");
    if (visibleFromParts !== input.visibleContent) {
      return { issue: { code: "invalid_payload", message: "Google continuation parts do not match the bound assistant message content" } };
    }
  }
  return { state: checked.value };
}

export function validateGoogleReplayForRequest(input: {
  state: ProviderContinuationState;
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): { ok: true; state: Extract<ProviderContinuationState, { transport: "google-native" }> } | { ok: false; issue: GoogleContinuationIssue } {
  const checked = validateProviderContinuationState(input.state);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "google-native" || input.config.provider !== "google") {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state belongs to a different provider transport" } };
  }
  const targetFingerprint = buildGoogleReplayFingerprint({
    config: input.config,
    requestedModelId: input.requestedModelId,
    normalizedEndpoint: input.normalizedEndpoint,
  });
  if (!targetFingerprint || !replayFingerprintsCompatible(checked.value.replayFingerprint, targetFingerprint)) {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state is not compatible with the current Google native route" } };
  }
  return { ok: true, state: checked.value };
}

export function validateGoogleReplayBudget(states: readonly ProviderContinuationState[]): { ok: true } | { ok: false; issue: GoogleContinuationIssue } {
  const checked = validateContinuationRequestBudget(states);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  return { ok: true };
}
