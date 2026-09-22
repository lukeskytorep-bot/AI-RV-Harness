import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "./types";
import { captureOpenRouterContinuationState, validateOpenRouterReplayForRequest } from "./openRouterContinuation";

const config: ProviderConfig = {
  id: "provider-config",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const details = [
  { type: "reasoning.summary", summary: "summary", id: "s1", format: "openai-responses-v1", index: 0 },
  { type: "reasoning.encrypted", data: "RklYVFVSRQ==", id: "e1", format: "openai-responses-v1", index: 1 },
  { type: "reasoning.text", text: "reasoning", signature: "sig", id: "t1", format: "openai-responses-v1", index: 2 },
];

describe("OPENROUTER-CONTINUITY-IN-MEMORY-1 contract bridge", () => {
  it("captures the complete reasoning_details sequence without actual-model gating", () => {
    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: details,
    });
    expect(captured.state?.reasoningDetails).toEqual(details);
    expect(captured.state?.replayFingerprint).toMatchObject({
      providerConfigId: "provider-config",
      credentialId: "credential",
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
    });
    expect(captured.state?.replayFingerprint.actualModelId).toBeUndefined();
  });

  it("requires the same provider config, credential, requested model and normalized endpoint", () => {
    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: details,
    });
    expect(captured.state).toBeDefined();
    if (!captured.state) return;
    expect(validateOpenRouterReplayForRequest({ state: captured.state, config, requestedModelId: "model-a", normalizedEndpoint: "https://openrouter.ai/api/v1" }).ok).toBe(true);
    expect(validateOpenRouterReplayForRequest({ state: captured.state, config, requestedModelId: "model-b", normalizedEndpoint: "https://openrouter.ai/api/v1" }).ok).toBe(false);
    expect(validateOpenRouterReplayForRequest({ state: captured.state, config: { ...config, credentialId: "other" }, requestedModelId: "model-a", normalizedEndpoint: "https://openrouter.ai/api/v1" }).ok).toBe(false);
    expect(validateOpenRouterReplayForRequest({ state: captured.state, config, requestedModelId: "model-a", normalizedEndpoint: "https://openrouter.ai/api/v2" }).ok).toBe(false);
  });

  it("does not create OpenRouter continuation state for other transports", () => {
    const captured = captureOpenRouterContinuationState({
      config: { ...config, provider: "openai" },
      requestedModelId: "model-a",
      normalizedEndpoint: "https://api.openai.com/v1",
      reasoningDetails: details,
    });
    expect(captured.state).toBeUndefined();
    expect(captured.issue).toBeUndefined();
  });

  it("records malformed provider state as an issue instead of replaying it", () => {
    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [{ type: "reasoning.future", payload: "nope" }],
    });
    expect(captured.state).toBeUndefined();
    expect(captured.issue).toMatchObject({ code: "invalid_payload" });
  });
});
