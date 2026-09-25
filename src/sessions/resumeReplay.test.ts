import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { RvSession, SessionEventRecord, SessionSnapshot } from "./types";
import anthropicFixture from "../providers/continuation-fixtures/anthropic-thinking-blocks.json";
import googleFixture from "../providers/continuation-fixtures/google-thought-signature.json";
import { captureAnthropicContinuationState } from "../providers/anthropicContinuation";
import { captureGoogleContinuationState } from "../providers/googleContinuation";
import { captureOpenRouterContinuationState } from "../providers/openRouterContinuation";
import type { ProviderContinuationState } from "../providers/continuationContract";
import type { ProviderConfig } from "../providers/types";
import { ANTHROPIC_SANITIZED_TURN_AUTO_STOP_REASON, SessionContinuationError } from "./providerContinuation";
import { createSessionReplay, isRecoverableProviderInterruption } from "./resumeReplay";

const session: RvSession = {
  id: "session_1", workspaceId: "w", profileId: "p", sessionCode: "RV-1", state: "Interrupted", runType: "automatic_monitor",
  preRevealTranscript: "saved", postRevealTranscript: "", createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

function event(sequenceNumber: number, eventType: string, content?: string, metadata: Record<string, unknown> = {}): SessionEventRecord {
  return { id: `e${sequenceNumber}`, sessionId: session.id, sequenceNumber, eventType, ...(content ? { content } : {}), metadata, createdAt: "2026-01-01" };
}

function bindingFor(ownerId: string, state: ProviderContinuationState) {
  return {
    ownerId,
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

describe("durable session replay", () => {
  it("recognizes provider interruptions but rejects user and cost stops", () => {
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", "AUTO-STOP: Monitor provider failure — empty assistant response")])).toBe(true);
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", "USER STOP")])).toBe(false);
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", "AUTO-STOP: configured session cost limit exceeded")])).toBe(false);
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", ANTHROPIC_SANITIZED_TURN_AUTO_STOP_REASON)])).toBe(false);
  });

  it("replays saved responses and starts the provider only at the missing call", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const append = vi.fn().mockResolvedValue(undefined);
    const liveChat = vi.fn().mockResolvedValue({ content: "recovered", usage: {} });
    const repository = { updateRvSessionState: update, appendSessionEvent: append, getSessionSnapshot: vi.fn().mockResolvedValue({ schemaVersion: 3 } as unknown as SessionSnapshot) } as unknown as AppRepository;
    const replay = await createSessionReplay({
      repository,
      session,
      events: [
        event(1, "VIEWER_RESPONSE", "saved viewer", { usage: { totalTokens: 10 } }),
        event(2, "MONITOR_TELEMETRY", "CONTINUE_PROTOCOL", { usage: { totalTokens: 2 } }),
        event(3, "MONITOR_TELEMETRY", "truncated monitor output that must not be replayed", { failed: true, finishReason: "length" }),
      ],
      liveChat,
    });
    const request = { config: {} as never, modelId: "m", messages: [], settings: { requested: {}, effective: {}, omitted: [] } };
    expect((await replay.chat(request)).content).toBe("saved viewer");
    expect((await replay.chat(request)).content).toBe("CONTINUE_PROTOCOL");
    expect(liveChat).not.toHaveBeenCalled();
    expect((await replay.chat(request)).content).toBe("recovered");
    expect(update).toHaveBeenCalledWith(session.id, "BlindRunning");
    expect(append).toHaveBeenCalledWith(session.id, expect.objectContaining({ eventType: "SESSION_RESUMED" }));
  });



  it("keeps historical Resume text-only when the saved snapshot has no continuation route", async () => {
    const config: ProviderConfig = { id: "pc", provider: "openrouter", label: "OpenRouter", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const liveChat = vi.fn().mockResolvedValue({ content: "historical live", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ schemaVersion: 3, providerConfigId: "pc", credentialId: "cred", provider: "openrouter", modelId: "m", modelRoute: "openrouter:m" } as unknown as SessionSnapshot),
      getSessionEventProviderState: vi.fn(),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [], liveChat });
    const response = await replay.chat({
      config,
      modelId: "m",
      messages: [{ role: "user", content: "old step" }, { role: "assistant", content: "historical answer" }, { role: "user", content: "continue" }],
      settings: { requested: {}, effective: {}, omitted: [] },
    });
    expect(response.content).toBe("historical live");
    expect(repository.getSessionEventProviderState).not.toHaveBeenCalled();
    expect(liveChat.mock.calls[0][0].messages[1].continuationState).toBeUndefined();
  });

  it("does not apply the frozen Viewer continuation route to a live Monitor request", async () => {
    const viewerConfig: ProviderConfig = { id: "viewer-pc", provider: "openrouter", label: "Viewer", credentialId: "viewer-cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const monitorConfig: ProviderConfig = { id: "monitor-pc", provider: "openrouter", label: "Monitor", credentialId: "monitor-cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const snapshot = {
      schemaVersion: 4, providerConfigId: "viewer-pc", credentialId: "viewer-cred", provider: "openrouter", modelId: "viewer-model", modelRoute: "openrouter:viewer-model",
      continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "viewer-pc", credentialId: "viewer-cred", requestedModelId: "viewer-model", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
    } as unknown as SessionSnapshot;
    const liveChat = vi.fn().mockResolvedValue({ content: "monitor decision", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      getSessionEventProviderState: vi.fn(),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [], liveChat });
    const response = await replay.chat({ config: monitorConfig, modelId: "monitor-model", messages: [{ role: "user", content: "telemetry" }], settings: { requested: {}, effective: {}, omitted: [] } });
    expect(response.content).toBe("monitor decision");
    expect(repository.getSessionEventProviderState).not.toHaveBeenCalled();
    expect(liveChat).toHaveBeenCalledTimes(1);
    expect(viewerConfig.id).not.toBe(monitorConfig.id);
  });

  it("rehydrates exact OpenRouter continuation state before the first live resumed call", async () => {
    const config: ProviderConfig = { id: "pc", provider: "openrouter", label: "OpenRouter", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const captured = captureOpenRouterContinuationState({
      config, requestedModelId: "m", normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [{ type: "reasoning.summary", summary: "saved", id: "s1", format: "openai-responses-v1", index: 0 }],
    });
    expect(captured.state).toBeDefined();
    if (!captured.state) return;
    const viewerEvent = event(1, "VIEWER_RESPONSE", "saved viewer", { continuationState: { status: "stored", format: captured.state.format, version: 1 } });
    const liveChat = vi.fn().mockResolvedValue({ content: "live", usage: {} });
    const snapshot = {
      schemaVersion: 4, providerConfigId: "pc", credentialId: "cred", provider: "openrouter", modelId: "m", modelRoute: "openrouter:m",
      continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "pc", credentialId: "cred", requestedModelId: "m", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
    } as unknown as SessionSnapshot;
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      listSessionEvents: vi.fn().mockResolvedValue([viewerEvent]),
      getSessionEventProviderState: vi.fn().mockResolvedValue({ ownerId: viewerEvent.id, format: captured.state.format, formatVersion: 1, transport: "openrouter", replayFingerprint: captured.state.replayFingerprint, state: captured.state, payloadSha256: "a".repeat(64), payloadSizeBytes: 1, createdAt: "now" }),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined), appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [viewerEvent], liveChat });
    const request = { config, modelId: "m", messages: [{ role: "user" as const, content: "step 1" }, { role: "assistant" as const, content: "saved viewer" }, { role: "user" as const, content: "step 2" }], settings: { requested: {}, effective: {}, omitted: [] } };
    expect((await replay.chat(request)).content).toBe("saved viewer");
    expect((await replay.chat(request)).content).toBe("live");
    expect(liveChat).toHaveBeenCalledTimes(1);
    const sent = liveChat.mock.calls[0][0];
    expect(sent.messages[1].continuationState).toEqual(captured.state);
  });
  it("rejects an unsupported frozen continuation transport before any live provider call", async () => {
    const config: ProviderConfig = { id: "google-pc", provider: "google", label: "Google", credentialId: "google-cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const snapshot = {
      schemaVersion: 4, providerConfigId: "google-pc", credentialId: "google-cred", provider: "google", modelId: "gemini-3.8-flash", modelRoute: "google:gemini-3.8-flash",
      continuationRoute: { transport: "future-native", normalizedEndpoint: "https://generativelanguage.googleapis.com/v1beta", providerConfigId: "google-pc", credentialId: "google-cred", requestedModelId: "gemini-3.8-flash", stateFormat: "google-thought-parts", stateFormatVersion: 1 },
    } as unknown as SessionSnapshot;
    const liveChat = vi.fn().mockResolvedValue({ content: "must not run", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [], liveChat });
    await expect(replay.chat({
      config,
      modelId: "gemini-3.8-flash",
      messages: [{ role: "user", content: "continue" }],
      settings: { requested: {}, effective: {}, omitted: [] },
    })).rejects.toThrow("Unsupported frozen provider continuation transport.");
    expect(liveChat).not.toHaveBeenCalled();
  });

  it("rehydrates exact Google native thoughtSignature state before a live resumed call", async () => {
    const config: ProviderConfig = { id: "google-pc", provider: "google", label: "Google", credentialId: "google-cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const parts = structuredClone(googleFixture.providerResponse.candidates[0].content.parts);
    const captured = captureGoogleContinuationState({
      config, requestedModelId: "gemini-3.8-flash", normalizedEndpoint: "https://generativelanguage.googleapis.com/v1beta", parts,
    });
    if (!captured.state) throw new Error("Expected Google continuation state.");
    const viewerEvent = event(1, "VIEWER_RESPONSE", "Visible fixture answer.", { continuationState: { status: "stored", format: captured.state.format, version: 1 } });
    const snapshot = {
      schemaVersion: 4, providerConfigId: "google-pc", credentialId: "google-cred", provider: "google", modelId: "gemini-3.8-flash", modelRoute: "google:gemini-3.8-flash",
      continuationRoute: { transport: "google-native", normalizedEndpoint: "https://generativelanguage.googleapis.com/v1beta", providerConfigId: "google-pc", credentialId: "google-cred", requestedModelId: "gemini-3.8-flash", stateFormat: "google-thought-parts", stateFormatVersion: 1 },
    } as unknown as SessionSnapshot;
    const liveChat = vi.fn().mockResolvedValue({ content: "live", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      listSessionEvents: vi.fn().mockResolvedValue([viewerEvent]),
      getSessionEventProviderState: vi.fn().mockResolvedValue(bindingFor(viewerEvent.id, captured.state)),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [viewerEvent], liveChat });
    const request = { config, modelId: "gemini-3.8-flash", messages: [{ role: "user" as const, content: "step 1" }, { role: "assistant" as const, content: "Visible fixture answer." }, { role: "user" as const, content: "step 2" }], settings: { requested: {}, effective: {}, omitted: [] } };
    expect((await replay.chat(request)).content).toBe("Visible fixture answer.");
    expect((await replay.chat(request)).content).toBe("live");
    const sent = liveChat.mock.calls[0][0];
    expect(sent.messages[1].continuationState).toEqual(captured.state);
  });

  it("stops Resume before a provider call when the frozen Anthropic prefix policy is malformed", async () => {
    const config: ProviderConfig = { id: "anthropic-pc", provider: "anthropic", label: "Anthropic", credentialId: "anthropic-cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const snapshot = {
      schemaVersion: 4, providerConfigId: "anthropic-pc", credentialId: "anthropic-cred", provider: "anthropic", modelId: "claude-fixture", modelRoute: "anthropic:claude-fixture",
      continuationRoute: { transport: "anthropic-native", normalizedEndpoint: "https://api.anthropic.com/v1", providerConfigId: "anthropic-pc", credentialId: "anthropic-cred", requestedModelId: "claude-fixture", stateFormat: "anthropic-thinking-blocks", stateFormatVersion: 1, prefixPolicy: "mutable" },
    } as unknown as SessionSnapshot;
    const liveChat = vi.fn().mockResolvedValue({ content: "must not run", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [], liveChat });
    const request = { config, modelId: "claude-fixture", messages: [{ role: "user" as const, content: "step" }], settings: { requested: {}, effective: {}, omitted: [] } };

    await expect(replay.chat(request)).rejects.toBeInstanceOf(SessionContinuationError);
    expect(liveChat).not.toHaveBeenCalled();
  });

  it("rehydrates exact Anthropic thinking blocks before a live resumed call", async () => {
    const config: ProviderConfig = { id: "anthropic-pc", provider: "anthropic", label: "Anthropic", credentialId: "anthropic-cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const blocks = structuredClone(anthropicFixture.continuationState.blocks);
    const captured = captureAnthropicContinuationState({
      config, requestedModelId: "claude-fixture", normalizedEndpoint: "https://api.anthropic.com/v1", blocks,
    });
    if (!captured.state) throw new Error("Expected Anthropic continuation state.");
    const viewerEvent = event(1, "VIEWER_RESPONSE", "Visible fixture answer.", { continuationState: { status: "stored", format: captured.state.format, version: 1 } });
    const snapshot = {
      schemaVersion: 4, providerConfigId: "anthropic-pc", credentialId: "anthropic-cred", provider: "anthropic", modelId: "claude-fixture", modelRoute: "anthropic:claude-fixture",
      continuationRoute: { transport: "anthropic-native", normalizedEndpoint: "https://api.anthropic.com/v1", providerConfigId: "anthropic-pc", credentialId: "anthropic-cred", requestedModelId: "claude-fixture", stateFormat: "anthropic-thinking-blocks", stateFormatVersion: 1, prefixPolicy: "append-only" },
    } as unknown as SessionSnapshot;
    const liveChat = vi.fn().mockResolvedValue({ content: "live", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      listSessionEvents: vi.fn().mockResolvedValue([viewerEvent]),
      getSessionEventProviderState: vi.fn().mockResolvedValue(bindingFor(viewerEvent.id, captured.state)),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [viewerEvent], liveChat });
    const request = { config, modelId: "claude-fixture", messages: [{ role: "user" as const, content: "step 1" }, { role: "assistant" as const, content: "Visible fixture answer." }, { role: "user" as const, content: "step 2" }], settings: { requested: {}, effective: {}, omitted: [] } };
    expect((await replay.chat(request)).content).toBe("Visible fixture answer.");
    expect((await replay.chat(request)).content).toBe("live");
    const sent = liveChat.mock.calls[0][0];
    expect(sent.messages[1].continuationState).toEqual(captured.state);
  });

  it("refreshes durable Viewer events before every live resumed call", async () => {
    const config: ProviderConfig = { id: "pc", provider: "openrouter", label: "OpenRouter", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
    const saved = captureOpenRouterContinuationState({
      config, requestedModelId: "m", normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [{ type: "reasoning.summary", summary: "saved-A", id: "a", format: "openai-responses-v1", index: 0 }],
    });
    const resumed = captureOpenRouterContinuationState({
      config, requestedModelId: "m", normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [{ type: "reasoning.summary", summary: "live-B", id: "b", format: "openai-responses-v1", index: 0 }],
    });
    if (!saved.state || !resumed.state) throw new Error("Expected OpenRouter continuation fixtures.");
    const savedState = saved.state;
    const resumedState = resumed.state;

    const persistedEvents: SessionEventRecord[] = [
      event(1, "VIEWER_RESPONSE", "saved viewer", { continuationState: { status: "stored", format: savedState.format, version: 1 } }),
    ];
    const bindings = new Map<string, ReturnType<typeof bindingFor>>([
      [persistedEvents[0].id, bindingFor(persistedEvents[0].id, savedState)],
    ]);
    const snapshot = {
      schemaVersion: 4, providerConfigId: "pc", credentialId: "cred", provider: "openrouter", modelId: "m", modelRoute: "openrouter:m",
      continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "pc", credentialId: "cred", requestedModelId: "m", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
    } as unknown as SessionSnapshot;
    const liveChat = vi.fn()
      .mockResolvedValueOnce({ content: "new viewer", usage: {} })
      .mockResolvedValueOnce({ content: "next viewer", usage: {} });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue(snapshot),
      listSessionEvents: vi.fn(async () => [...persistedEvents]),
      getSessionEventProviderState: vi.fn(async (eventId: string) => bindings.get(eventId) ?? null),
      updateRvSessionState: vi.fn().mockResolvedValue(undefined),
      appendSessionEvent: vi.fn().mockResolvedValue(undefined),
      appendSessionEventWithProviderState: vi.fn(async (_sessionId: string, input: { eventType: string; role?: "assistant"; content?: string; metadata?: Record<string, unknown> }, state: ProviderContinuationState) => {
        const next = event(persistedEvents.length + 1, input.eventType, input.content, input.metadata);
        persistedEvents.push(next);
        bindings.set(next.id, bindingFor(next.id, state));
        return next;
      }),
    } as unknown as AppRepository;
    const replay = await createSessionReplay({ repository, session, events: [...persistedEvents], liveChat });

    const firstRequest = {
      config, modelId: "m",
      messages: [{ role: "user" as const, content: "step 1" }, { role: "assistant" as const, content: "saved viewer" }, { role: "user" as const, content: "step 2" }],
      settings: { requested: {}, effective: {}, omitted: [] },
    };
    expect((await replay.chat(firstRequest)).content).toBe("saved viewer");
    expect((await replay.chat(firstRequest)).content).toBe("new viewer");
    await replay.repository.appendSessionEventWithProviderState(session.id, {
      eventType: "VIEWER_RESPONSE", role: "assistant", content: "new viewer",
      metadata: { continuationState: { status: "stored", format: resumedState.format, version: 1 } },
    }, resumedState);

    const secondRequest = {
      config, modelId: "m",
      messages: [
        { role: "user" as const, content: "step 1" },
        { role: "assistant" as const, content: "saved viewer" },
        { role: "user" as const, content: "step 2" },
        { role: "assistant" as const, content: "new viewer" },
        { role: "user" as const, content: "step 3" },
      ],
      settings: { requested: {}, effective: {}, omitted: [] },
    };
    expect((await replay.chat(secondRequest)).content).toBe("next viewer");
    expect(liveChat).toHaveBeenCalledTimes(2);
    const secondLiveMessages = liveChat.mock.calls[1][0].messages;
    expect(secondLiveMessages[1].continuationState).toEqual(savedState);
    expect(secondLiveMessages[3].continuationState).toEqual(resumedState);
    expect(repository.listSessionEvents).toHaveBeenCalledTimes(2);
  });

});
