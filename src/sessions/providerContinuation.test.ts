import { describe, expect, it, vi } from "vitest";
import googleFixture from "../providers/continuation-fixtures/google-thought-signature.json";
import type { ProviderContinuationState } from "../providers/continuationContract";
import { captureGoogleContinuationState } from "../providers/googleContinuation";
import { captureOpenRouterContinuationState } from "../providers/openRouterContinuation";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { ProviderContinuationStateBinding } from "../storage/providerContinuationState";
import type { SessionEventInput, SessionEventRecord, SessionSnapshot } from "./types";
import {
  captureSessionContinuationRoute,
  captureSessionContinuationState,
  hydrateSessionMessageContinuation,
  persistSessionAssistantResponse,
  SessionContinuationError,
  validateFrozenSessionContinuationRequest,
  validateFrozenSessionContinuationRoute,
} from "./providerContinuation";

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
  modelId: "model-a",
  displayName: "Model A",
  route: "openrouter:model-a",
  capabilities: {
    inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true,
    reasoning: { supported: true, efforts: ["high"], confidence: "verified" },
    temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], source: "provider", capturedAt: "now",
  },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
};

const reasoningDetails = [
  { type: "reasoning.summary", summary: "summary", id: "s1", format: "openai-responses-v1", index: 0 },
  { type: "reasoning.encrypted", data: "RklYVFVSRQ==", id: "e1", format: "openai-responses-v1", index: 1 },
] as const;

function snapshot(): SessionSnapshot {
  const route = captureSessionContinuationRoute(config, model);
  if (!route) throw new Error("Expected OpenRouter route.");
  return {
    schemaVersion: 4,
    sessionId: "session-1",
    sessionCode: "RV-1",
    profileId: "profile",
    workspaceId: "workspace",
    providerConfigId: config.id,
    credentialId: config.credentialId,
    provider: "openrouter",
    modelId: model.modelId,
    modelRoute: model.route,
    continuationRoute: route,
    capabilitySnapshot: {},
    capabilityCapturedAt: "now",
    generationSettings: { requested: {}, effective: {}, omitted: [] },
    sessionLanguage: "en",
    protocol: { id: "rv-lite", version: "1.1.0", language: "en", contentSha256: "a".repeat(64), fullContent: "protocol" },
    controllerPrompt: { id: "controller", version: "1", language: "en" },
    revealSource: "external",
    applicationVersion: "0.7.13",
    createdAt: "now",
  };
}

function binding(state: NonNullable<ReturnType<typeof captureOpenRouterContinuationState>["state"]>): ProviderContinuationStateBinding {
  return {
    ownerId: "event-1",
    format: state.format,
    formatVersion: state.schemaVersion,
    transport: state.transport,
    replayFingerprint: state.replayFingerprint,
    state,
    payloadSha256: "a".repeat(64),
    payloadSizeBytes: 1,
    createdAt: "now",
  };
}

describe("provider continuation session bridge", () => {
  it("freezes and validates the exact OpenRouter provider, credential, endpoint and model route", () => {
    const frozen = snapshot();
    expect(validateFrozenSessionContinuationRoute(frozen, config, model)).toEqual(frozen.continuationRoute);
    expect(() => validateFrozenSessionContinuationRoute(frozen, { ...config, credentialId: "other" }, model)).toThrow(SessionContinuationError);
    expect(() => validateFrozenSessionContinuationRoute(frozen, config, { ...model, modelId: "model-b" })).toThrow(SessionContinuationError);
  });

  it("atomically persists a valid assistant response state on the exact Session event", async () => {
    const appendSessionEvent = vi.fn(async () => undefined);
    const appendSessionEventWithProviderState = vi.fn(async (_sessionId: string, event: SessionEventInput) => ({
      ...event, id: "event-1", sessionId: "session-1", sequenceNumber: 1, createdAt: "now",
    } as SessionEventRecord));
    const route = snapshot().continuationRoute;
    const persisted = await persistSessionAssistantResponse({
      repository: { appendSessionEvent, appendSessionEventWithProviderState },
      sessionId: "session-1",
      event: { eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer" },
      response: { content: "answer", reasoningDetails: [...reasoningDetails], usage: {} },
      providerConfig: config,
      model,
      route,
    });
    expect(appendSessionEvent).not.toHaveBeenCalled();
    expect(appendSessionEventWithProviderState).toHaveBeenCalledTimes(1);
    expect(appendSessionEventWithProviderState.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      eventType: "VIEWER_RESPONSE",
      metadata: { continuationState: { status: "stored", format: "openrouter-reasoning-details", version: 1 } },
    }));
    expect(persisted.state?.transport).toBe("openrouter");
    if (!persisted.state || persisted.state.transport !== "openrouter") {
      throw new Error("Expected OpenRouter continuation state.");
    }
    expect(persisted.state.reasoningDetails).toEqual(reasoningDetails);
  });

  it("fails closed when a persisted event says state was stored but the exact binding is missing", async () => {
    const event: SessionEventRecord = {
      id: "event-1", sessionId: "session-1", sequenceNumber: 1, createdAt: "now",
      eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer",
      metadata: { continuationState: { status: "stored", format: "openrouter-reasoning-details", version: 1 } },
    };
    const repository = { getSessionEventProviderState: vi.fn(async () => null) } as Pick<AppRepository, "getSessionEventProviderState">;
    await expect(hydrateSessionMessageContinuation({
      repository,
      snapshot: snapshot(),
      config,
      model,
      event,
      message: { role: "assistant", content: "answer" },
    })).rejects.toThrow("Required provider continuation state is missing");
  });

  it("replays only a state compatible with the frozen route", async () => {
    const captured = captureOpenRouterContinuationState({
      config,
      requestedModelId: model.modelId,
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [...reasoningDetails],
    });
    if (!captured.state) throw new Error("Expected captured state.");
    const event: SessionEventRecord = {
      id: "event-1", sessionId: "session-1", sequenceNumber: 1, createdAt: "now",
      eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer",
      metadata: { continuationState: { status: "stored" } },
    };
    const repository = { getSessionEventProviderState: vi.fn(async () => binding(captured.state!)) } as Pick<AppRepository, "getSessionEventProviderState">;
    const hydrated = await hydrateSessionMessageContinuation({ repository, snapshot: snapshot(), config, model, event, message: { role: "assistant", content: "answer" } });
    expect(hydrated.continuationState).toEqual(captured.state);
    await expect(hydrateSessionMessageContinuation({
      repository,
      snapshot: snapshot(),
      config: { ...config, credentialId: "other" },
      model,
      event,
      message: { role: "assistant", content: "answer" },
    })).rejects.toThrow(SessionContinuationError);
  });
  it("fails closed on an unsupported persisted continuation transport before state hydration or capture", async () => {
    const googleConfig: ProviderConfig = { ...config, id: "google-config", provider: "google", label: "Google" };
    const googleModel: ProviderModel = { ...model, providerConfigId: googleConfig.id, provider: "google", modelId: "gemini-3.8-flash", route: "google:gemini-3.8-flash" };
    const validRoute = captureSessionContinuationRoute(googleConfig, googleModel);
    if (!validRoute) throw new Error("Expected Google continuation route.");
    const malformedSnapshot = {
      ...snapshot(),
      providerConfigId: googleConfig.id,
      credentialId: googleConfig.credentialId,
      provider: "google",
      modelId: googleModel.modelId,
      modelRoute: googleModel.route,
      continuationRoute: { ...validRoute, transport: "anthropic-native" },
    } as unknown as SessionSnapshot;

    expect(() => validateFrozenSessionContinuationRequest(malformedSnapshot, googleConfig, googleModel.modelId))
      .toThrow("Unsupported frozen provider continuation transport.");

    const getSessionEventProviderState = vi.fn();
    const event: SessionEventRecord = {
      id: "event-unsupported", sessionId: "session-1", sequenceNumber: 1, createdAt: "now",
      eventType: "VIEWER_RESPONSE", role: "assistant", content: "answer",
      metadata: { continuationState: { status: "stored" } },
    };
    await expect(hydrateSessionMessageContinuation({
      repository: { getSessionEventProviderState },
      snapshot: malformedSnapshot,
      config: googleConfig,
      model: googleModel,
      event,
      message: { role: "assistant", content: "answer" },
    })).rejects.toThrow("Unsupported frozen provider continuation transport.");
    expect(getSessionEventProviderState).not.toHaveBeenCalled();

    expect(() => captureSessionContinuationState({
      response: { content: "answer", reasoningDetails: structuredClone(googleFixture.providerResponse.candidates[0].content.parts), usage: {} },
      providerConfig: googleConfig,
      model: googleModel,
      route: malformedSnapshot.continuationRoute,
    })).toThrow("Unsupported frozen provider continuation transport.");
  });

  it("freezes, persists and rehydrates Google native thoughtSignature state on the exact Session event", async () => {
    const googleConfig: ProviderConfig = { ...config, id: "google-config", provider: "google", label: "Google" };
    const googleModel: ProviderModel = { ...model, providerConfigId: googleConfig.id, provider: "google", modelId: "gemini-3.8-flash", route: "google:gemini-3.8-flash" };
    const route = captureSessionContinuationRoute(googleConfig, googleModel);
    expect(route).toMatchObject({ transport: "google-native", stateFormat: "google-thought-parts" });
    if (!route) throw new Error("Expected Google continuation route.");
    const googleSnapshot: SessionSnapshot = { ...snapshot(), providerConfigId: googleConfig.id, credentialId: googleConfig.credentialId, provider: "google", modelId: googleModel.modelId, modelRoute: googleModel.route, continuationRoute: route };
    expect(validateFrozenSessionContinuationRoute(googleSnapshot, googleConfig, googleModel)).toEqual(route);

    let storedState: ProviderContinuationStateBinding | undefined;
    const appendSessionEventWithProviderState = vi.fn(async (_sessionId: string, event: SessionEventInput, state: ProviderContinuationState) => {
      storedState = { ownerId: "google-event", format: state.format, formatVersion: state.schemaVersion, transport: state.transport, replayFingerprint: state.replayFingerprint, state: structuredClone(state), payloadSha256: "a".repeat(64), payloadSizeBytes: JSON.stringify(state).length, createdAt: "now" };
      return { ...event, id: "google-event", sessionId: "session-1", sequenceNumber: 1, createdAt: "now" } as SessionEventRecord;
    });
    const parts = structuredClone(googleFixture.providerResponse.candidates[0].content.parts);
    const persisted = await persistSessionAssistantResponse({
      repository: { appendSessionEvent: vi.fn(async () => undefined), appendSessionEventWithProviderState },
      sessionId: "session-1",
      event: { eventType: "VIEWER_RESPONSE", role: "assistant", content: "Visible fixture answer." },
      response: { content: "Visible fixture answer.", reasoningDetails: parts, reasoningSource: "google_thought_parts", usage: {} },
      providerConfig: googleConfig,
      model: googleModel,
      route,
    });
    expect(persisted.state?.transport).toBe("google-native");
    expect(appendSessionEventWithProviderState).toHaveBeenCalledTimes(1);
    if (!storedState) throw new Error("Expected persisted Google state.");
    const event: SessionEventRecord = { id: "google-event", sessionId: "session-1", sequenceNumber: 1, createdAt: "now", eventType: "VIEWER_RESPONSE", role: "assistant", content: "Visible fixture answer.", metadata: { continuationState: { status: "stored" } } };
    const hydrated = await hydrateSessionMessageContinuation({
      repository: { getSessionEventProviderState: vi.fn(async () => storedState!) },
      snapshot: googleSnapshot, config: googleConfig, model: googleModel, event,
      message: { role: "assistant", content: "Visible fixture answer." },
    });
    expect(hydrated.continuationState?.transport).toBe("google-native");
    expect(hydrated.continuationState && "parts" in hydrated.continuationState ? hydrated.continuationState.parts : undefined).toEqual(parts);
  });

});
