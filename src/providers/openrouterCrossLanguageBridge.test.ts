import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { captureOpenRouterContinuationState } from "./openRouterContinuation";
import type { ProviderChatResponse, ProviderConfig, ProviderModel } from "./types";
import {
  prepareProviderContinuationState,
  restoreProviderContinuationState,
  type PersistedProviderContinuationStateRow,
} from "../storage/providerContinuationState";
import { captureSessionContinuationRoute, persistSessionAssistantResponse, SessionContinuationError } from "../sessions/providerContinuation";

const rustOut = process.env.AI_RV_BRIDGE_RUST_OUT;
const tsOut = process.env.AI_RV_BRIDGE_TS_OUT;
const bridgeIt = rustOut && tsOut ? it : it.skip;

const config: ProviderConfig = {
  id: "provider-config",
  provider: "openrouter",
  label: "OpenRouter",
  credentialId: "credential",
  enabled: true,
  createdAt: "now",
  updatedAt: "now",
};

const model: ProviderModel = {
  providerConfigId: config.id,
  provider: "openrouter",
  modelId: "z-ai/glm-5.3-flash-20260826",
  displayName: "Bridge model",
  route: "openrouter:z-ai/glm-5.3-flash-20260826",
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: true, efforts: ["high"], confidence: "verified" },
    temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now",
  },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
};

describe("OPENROUTER-CONTINUATION-COMPATIBILITY-2 cross-language bridge", () => {
  bridgeIt("takes the actual Rust stream result through TS capture and persisted restore", async () => {
    const rustResult = JSON.parse(fs.readFileSync(rustOut!, "utf8")) as {
      content: string;
      reasoningDetails: unknown[];
      modelId: string;
      normalizedEndpoint: string;
      providerConfigId: string;
      credentialId: string;
      invalidResponse: ProviderChatResponse;
    };
    expect(rustResult.providerConfigId).toBe(config.id);
    expect(rustResult.credentialId).toBe(config.credentialId);

    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: rustResult.modelId,
      normalizedEndpoint: rustResult.normalizedEndpoint,
      reasoningDetails: rustResult.reasoningDetails,
    });
    expect(captured.issue).toBeUndefined();
    expect(captured.state).toBeDefined();
    if (!captured.state) throw new Error("Rust bridge result was not captured");

    const prepared = await prepareProviderContinuationState(captured.state);
    const row: PersistedProviderContinuationStateRow = {
      ownerId: "bridge-assistant-message",
      format: prepared.format,
      formatVersion: prepared.formatVersion,
      transport: prepared.transport,
      replayFingerprintJson: prepared.replayFingerprintJson,
      payloadJson: prepared.payloadJson,
      payloadSha256: prepared.payloadSha256,
      payloadSizeBytes: prepared.payloadSizeBytes,
      createdAt: "2026-09-27T00:00:00.000Z",
    };
    const restored = await restoreProviderContinuationState(row);
    expect(restored.state.transport).toBe("openrouter");
    if (restored.state.transport !== "openrouter") throw new Error("Unexpected bridge transport");
    expect(restored.state.reasoningDetails).toEqual(rustResult.reasoningDetails);

    const route = captureSessionContinuationRoute(config, model);
    expect(route).toBeDefined();
    const appended: Array<{ sessionId: string; event: any }> = [];
    const invalidPersistence = persistSessionAssistantResponse({
      repository: {
        appendSessionEvent: async (sessionId, event) => { appended.push({ sessionId, event }); return { id: "event-invalid", ...event } as any; },
        appendSessionEventWithProviderState: async () => { throw new Error("invalid continuation must never be stored for replay"); },
      },
      sessionId: "bridge-session",
      event: {
        eventType: "VIEWER_RESPONSE", role: "assistant", content: rustResult.invalidResponse.content,
        metadata: { usage: rustResult.invalidResponse.usage },
      },
      response: rustResult.invalidResponse,
      providerConfig: config,
      model,
      route,
    });
    await expect(invalidPersistence).rejects.toBeInstanceOf(SessionContinuationError);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.event.content).toBe("Visible answer survives");
    expect(appended[0]?.event.metadata?.usage).toEqual({
      inputTokens: 11, outputTokens: 7, reasoningTokens: 3, totalTokens: 18, costUsd: 0.001,
    });
    expect(appended[0]?.event.metadata?.continuationState?.status).toBe("invalid");

    fs.writeFileSync(tsOut!, JSON.stringify({
      state: restored.state,
      modelId: rustResult.modelId,
      normalizedEndpoint: rustResult.normalizedEndpoint,
    }, null, 2));
  });
});
