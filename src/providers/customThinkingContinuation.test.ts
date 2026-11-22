import { describe, expect, it } from "vitest";
import { captureCustomThinkingState, validateCustomThinkingReplay } from "./customThinkingContinuation";
import { validateProviderContinuationState } from "./continuationContract";
import type { ProviderConfig } from "./types";

const config: ProviderConfig = {id: "p", provider: "custom_openai", credentialId: "cred", label: "RunPod", baseUrl: "https://example.test/v1", customCompatibilityProfile: "llama_cpp", enabled: true, createdAt: "x", updatedAt: "x"};
const endpoint = "https://example.test/v1";
const capture = () => captureCustomThinkingState({config, requestedModelId: "gemma", normalizedEndpoint: endpoint, reasoningContent: "Private thinking", reasoningSource: "openai_reasoning_content", visibleContent: "Public final"});
describe("Custom OpenAI-compatible thinking continuation", () => {
  it("captures a distinct hidden state with matching visible text and serializes across restart", () => {
    const state = capture().state!;
    expect(state.reasoningContent).toBe("Private thinking");
    expect(state.visibleContent).toBe("Public final");
    const roundtrip = JSON.parse(JSON.stringify(state));
    expect(validateProviderContinuationState(roundtrip).ok).toBe(true);
    expect(validateCustomThinkingReplay({state: roundtrip, config, requestedModelId: "gemma", normalizedEndpoint: endpoint}).ok).toBe(true);
  });
  it("does not capture default generic routes or absent thinking", () => {
    expect(captureCustomThinkingState({config: {...config, customCompatibilityProfile: "generic"}, requestedModelId: "gemma", normalizedEndpoint: endpoint, reasoningContent: "Private", visibleContent: "Public"})).toEqual({});
    expect(captureCustomThinkingState({config, requestedModelId: "gemma", normalizedEndpoint: endpoint, visibleContent: "Public"})).toEqual({});
  });
  it("never persists tagged thinking or unconfirmed reasoning sources", () => {
    expect(captureCustomThinkingState({config, requestedModelId: "gemma", normalizedEndpoint: endpoint, reasoningContent: "tagged", reasoningSource: "tagged_content", visibleContent: "Public"})).toEqual({});
    expect(captureCustomThinkingState({config, requestedModelId: "gemma", normalizedEndpoint: endpoint, reasoningContent: "unknown", visibleContent: "Public"})).toEqual({});
  });
  it("rejects changed connection, model and endpoint", () => {
    const state = capture().state!;
    for (const options of [
      {config: {...config, credentialId: "other"}, requestedModelId: "gemma", normalizedEndpoint: endpoint},
      {config, requestedModelId: "different-model", normalizedEndpoint: endpoint},
      {config, requestedModelId: "gemma", normalizedEndpoint: "https://other.test/v1"},
      {config: {...config, customCompatibilityProfile: "generic" as const}, requestedModelId: "gemma", normalizedEndpoint: endpoint},
    ]) expect(validateCustomThinkingReplay({state, ...options}).ok).toBe(false);
  });
  it("rejects malformed, empty and oversized thinking and injected fields", () => {
    const state = capture().state!;
    expect(validateProviderContinuationState({...state, reasoningContent: " "}).ok).toBe(false);
    expect(validateProviderContinuationState({...state, reasoningContent: "a".repeat(524289)}).ok).toBe(false);
    expect(validateProviderContinuationState({...state, rogue: true}).ok).toBe(false);
  });
});
