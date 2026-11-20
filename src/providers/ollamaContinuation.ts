import {
  replayFingerprintsCompatible,
  validateContinuationRequestBudget,
  validateProviderContinuationState,
  type ContinuationValidationCode,
  type ProviderContinuationState,
  type ProviderReplayFingerprint,
} from "./continuationContract";
import type { ProviderConfig } from "./types";

export interface OllamaContinuationIssue {
  code: ContinuationValidationCode | "incompatible_replay";
  message: string;
}

export type OllamaContinuationCapture =
  | { state: Extract<ProviderContinuationState, { transport: "ollama-cloud" }>; issue?: never }
  | { state?: never; issue: OllamaContinuationIssue }
  | { state?: never; issue?: never };

export function buildOllamaReplayFingerprint(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): ProviderReplayFingerprint | null {
  if (input.config.provider !== "ollama_cloud") return null;
  return {
    transport: "ollama-cloud",
    normalizedEndpoint: input.normalizedEndpoint,
    providerConfigId: input.config.id,
    credentialId: input.config.credentialId,
    requestedModelId: input.requestedModelId,
    stateFormat: "ollama-thinking-content",
    stateFormatVersion: 1,
  };
}

export function captureOllamaContinuationState(input: {
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
  content?: unknown[];
  visibleContent?: string;
}): OllamaContinuationCapture {
  if (input.config.provider !== "ollama_cloud" || !input.content?.length) return {};
  const replayFingerprint = buildOllamaReplayFingerprint(input);
  if (!replayFingerprint) return {};
  const checked = validateProviderContinuationState({
    schemaVersion: 1,
    transport: "ollama-cloud",
    format: "ollama-thinking-content",
    replayFingerprint,
    content: input.content,
  });
  if (checked.ok === false) return { issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "ollama-cloud") {
    return { issue: { code: "invalid_payload", message: "validated continuation state changed transport unexpectedly" } };
  }
  if (input.visibleContent !== undefined) {
    const visibleFromChunks = checked.value.content.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");
    if (visibleFromChunks !== input.visibleContent) {
      return { issue: { code: "invalid_payload", message: "Ollama continuation chunks do not match the bound assistant message content" } };
    }
  }
  return { state: checked.value };
}

export function validateOllamaReplayForRequest(input: {
  state: ProviderContinuationState;
  config: ProviderConfig;
  requestedModelId: string;
  normalizedEndpoint: string;
}): { ok: true; state: Extract<ProviderContinuationState, { transport: "ollama-cloud" }> } | { ok: false; issue: OllamaContinuationIssue } {
  const checked = validateProviderContinuationState(input.state);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  if (checked.value.transport !== "ollama-cloud" || input.config.provider !== "ollama_cloud") {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state belongs to a different provider transport" } };
  }
  const targetFingerprint = buildOllamaReplayFingerprint(input);
  if (!targetFingerprint || !replayFingerprintsCompatible(checked.value.replayFingerprint, targetFingerprint)) {
    return { ok: false, issue: { code: "incompatible_replay", message: "continuation state is not compatible with the current Ollama native route" } };
  }
  return { ok: true, state: checked.value };
}

export function validateOllamaReplayBudget(states: readonly ProviderContinuationState[]): { ok: true } | { ok: false; issue: OllamaContinuationIssue } {
  const checked = validateContinuationRequestBudget(states);
  if (checked.ok === false) return { ok: false, issue: { code: checked.code, message: checked.message } };
  return { ok: true };
}
