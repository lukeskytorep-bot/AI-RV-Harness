import { afterEach, describe, expect, it } from "vitest";
import streamFixture from "./continuation-fixtures/openrouter-stream-canonicalization.json";
import { CONTINUATION_LIMITS_V1, validateProviderContinuationState } from "./continuationContract";
import { clearProviderDebug, listProviderDebug, setDetailedProviderDiagnostics } from "./debug";
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



afterEach(() => {
  setDetailedProviderDiagnostics(false);
  clearProviderDebug();
});

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


  it("accepts the shared canonical fixture on the TypeScript side", () => {
    for (const reasoningDetails of [streamFixture.summaryExpected, streamFixture.textExpected]) {
      const captured = captureOpenRouterContinuationState({
        config,
        requestedModelId: "model-a",
        normalizedEndpoint: "https://openrouter.ai/api/v1",
        reasoningDetails,
      });
      expect(captured.issue).toBeUndefined();
      expect(captured.state?.reasoningDetails).toEqual(reasoningDetails);
      if (!captured.state) throw new Error("Expected canonical fixture state.");
      expect(validateProviderContinuationState(captured.state).ok).toBe(true);
    }
  });

  it("preserves explicit empty reasoning_details but does not invent state for an absent field", () => {
    const explicitEmpty = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [],
    });
    expect(explicitEmpty.issue).toBeUndefined();
    expect(explicitEmpty.state?.reasoningDetails).toEqual([]);
    expect(explicitEmpty.diagnostics).toMatchObject({
      reasoningDetailsPresent: true,
      receivedReasoningDetailItems: 0,
      logicalReasoningBlocks: 0,
      blockLimit: 64,
    });
    expect(explicitEmpty.diagnostics?.continuationStateBytes).toBeGreaterThan(0);
    expect(explicitEmpty.diagnostics?.continuationStateBytes).toBeLessThanOrEqual(CONTINUATION_LIMITS_V1.maxStateBytes);

    const absent = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
    });
    expect(absent).toEqual({});
  });

  it("still rejects 65 truly independent logical blocks after canonicalization", () => {
    const independent = Array.from({ length: CONTINUATION_LIMITS_V1.maxBlocksPerMessage + 1 }, (_, index) => ({
      type: "reasoning.encrypted",
      data: "RklYVFVSRQ==",
      id: `opaque-${index}`,
      format: "openai-responses-v1",
      index,
    }));
    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: independent,
      continuationDiagnostics: {
        transport: "openrouter",
        rawSseEvents: 66,
        receivedReasoningDetailItems: 65,
        logicalReasoningBlocks: 65,
        reasoningDetailsPresent: true,
      },
    });
    expect(captured.state).toBeUndefined();
    expect(captured.issue).toMatchObject({ code: "too_many_blocks" });
    expect(captured.diagnostics).toMatchObject({
      logicalReasoningBlocks: 65,
      blockLimit: 64,
      stateByteLimit: CONTINUATION_LIMITS_V1.maxStateBytes,
      rejectionStage: "capture_validation",
    });
  });

  it("records only structural continuation diagnostics when detailed diagnostics are enabled", () => {
    setDetailedProviderDiagnostics(true);
    const secretReasoning = [{ type: "reasoning.text", text: "DO-NOT-LOG", signature: "DO-NOT-LOG-SIG", id: "r1", format: "openai-responses-v1" }];
    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: "model-a",
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: secretReasoning,
      continuationDiagnostics: {
        transport: "openrouter",
        rawSseEvents: 3,
        receivedReasoningDetailItems: 9,
        logicalReasoningBlocks: 1,
        reasoningDetailsPresent: true,
      },
    });
    expect(captured.state).toBeDefined();
    const entries = listProviderDebug();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.continuation).toMatchObject({
      rawSseEvents: 3,
      receivedReasoningDetailItems: 9,
      logicalReasoningBlocks: 1,
      reasoningDetailsPresent: true,
      blockLimit: 64,
    });
    expect(JSON.stringify(entries[0])).not.toContain("DO-NOT-LOG");
  });
});
