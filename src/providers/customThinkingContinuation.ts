import { replayFingerprintsCompatible, validateProviderContinuationState, type ProviderContinuationState, type ProviderReplayFingerprint, type ContinuationValidationCode } from "./continuationContract";
import type { ProviderConfig } from "./types";

type State = Extract<ProviderContinuationState, {transport: "custom-openai"}>;
export function customThinkingFingerprint(config: ProviderConfig, requestedModelId: string, normalizedEndpoint: string): ProviderReplayFingerprint | null {
  // Deliberate opt-in: generic OpenAI-compatible endpoints never receive private traces.
  if (config.provider !== "custom_openai" || config.customCompatibilityProfile !== "llama_cpp") return null;
  return {transport: "custom-openai", normalizedEndpoint, providerConfigId: config.id, credentialId: config.credentialId, requestedModelId, stateFormat: "custom-reasoning-content", stateFormatVersion: 1};
}
export function captureCustomThinkingState(input: {config: ProviderConfig; requestedModelId: string; normalizedEndpoint: string; reasoningContent?: string; reasoningSource?: string; visibleContent: string}): {state?: State; issue?: {code: ContinuationValidationCode; message: string}} {
  const replayFingerprint = customThinkingFingerprint(input.config, input.requestedModelId, input.normalizedEndpoint);
  if (!replayFingerprint || input.reasoningSource !== "openai_reasoning_content" || !input.reasoningContent?.trim()) return {};
  const checked = validateProviderContinuationState({schemaVersion: 1, transport: "custom-openai", format: "custom-reasoning-content", replayFingerprint, reasoningContent: input.reasoningContent, visibleContent: input.visibleContent});
  if (!checked.ok) return {issue: {code: checked.code, message: checked.message}};
  return checked.value.transport === "custom-openai" ? {state: checked.value} : {issue: {code: "invalid_payload", message: "Custom thinking transport mismatch"}};
}
export function validateCustomThinkingReplay(input: {state: ProviderContinuationState; config: ProviderConfig; requestedModelId: string; normalizedEndpoint: string}) {
  const checked = validateProviderContinuationState(input.state);
  if (!checked.ok) return {ok: false as const, issue: {code: checked.code, message: checked.message}};
  const fingerprint = customThinkingFingerprint(input.config, input.requestedModelId, input.normalizedEndpoint);
  if (checked.value.transport !== "custom-openai" || !fingerprint || !replayFingerprintsCompatible(checked.value.replayFingerprint, fingerprint)) return {ok: false as const, issue: {code: "incompatible_replay" as const, message: "Custom thinking is bound to a different connection, endpoint, or model"}};
  return {ok: true as const, state: checked.value};
}
