import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { automaticPostRevealReviewRequest, runAutomaticPostRevealReview } from "./postReveal";
import {
  getPostRevealReviewRecoveryState,
  resolveUncertainPostRevealReviewStage,
} from "./postRevealRecovery";
import { serializePostRevealTurn } from "./postRevealTranscript";
import type { SessionEventRecord } from "./types";

const viewerConfig: ProviderConfig = { id: "viewer-pc", provider: "openrouter", label: "Viewer", credentialId: "cred-v", enabled: true, createdAt: "now", updatedAt: "now" };
const monitorConfig: ProviderConfig = { id: "monitor-pc", provider: "openrouter", label: "Monitor", credentialId: "cred-m", enabled: true, createdAt: "now", updatedAt: "now" };
const capabilities = { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" as const }, temperature: { supported: false, confidence: "unknown" as const }, supportedParameters: [] as string[], contextTokens: 100_000, maxOutputTokens: 4096, source: "provider" as const, capturedAt: "now" };
const viewerModel: ProviderModel = { providerConfigId: "viewer-pc", provider: "openrouter", modelId: "viewer", displayName: "Viewer", route: "openrouter:viewer", capabilities, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now" };
const monitorModel: ProviderModel = { ...viewerModel, providerConfigId: "monitor-pc", modelId: "monitor", displayName: "Monitor", route: "openrouter:monitor" };

function makeRepository(input?: { transcript?: string; monitor?: boolean; checkpoints?: Array<{ stage: "viewer" | "monitor"; status: string; attempt?: number }> }) {
  let transcript = input?.transcript ?? "";
  const events: SessionEventRecord[] = (input?.checkpoints ?? []).map((checkpoint, index) => ({
    id: `event-${index + 1}`,
    sessionId: "s",
    sequenceNumber: index + 1,
    eventType: "POST_REVEAL_REVIEW_CHECKPOINT",
    role: "controller" as const,
    metadata: { stage: checkpoint.stage, status: checkpoint.status, attempt: checkpoint.attempt ?? 1 },
    createdAt: `t-${index + 1}`,
  }));
  let leaseHeld = false;
  const repository = {
    withPostRevealReviewLease: vi.fn(async <T>(_sessionId: string, task: () => Promise<T>): Promise<T> => {
      if (leaseHeld) throw new Error("Automatic post-Reveal review is already running for this session.");
      leaseHeld = true;
      try { return await task(); } finally { leaseHeld = false; }
    }),
    assertPostRevealReviewLease: vi.fn(async () => {
      if (!leaseHeld) throw new Error("Post-Reveal review lease was lost or is not active.");
    }),
    postRevealReviewLeaseSignal: vi.fn(() => undefined),
    getSessionSnapshot: vi.fn().mockResolvedValue({
      providerConfigId: "viewer-pc",
      modelId: "viewer",
      provider: "openrouter",
      modelRoute: "openrouter:viewer",
      sessionLanguage: "en",
      workspaceId: "w",
      generationSettings: { requested: {}, effective: {}, omitted: [] },
      capabilitySnapshot: {},
      ...(input?.monitor ? { monitor: { providerConfigId: "monitor-pc", modelId: "monitor", effectivePrompt: "Monitor prompt" } } : {}),
    }),
    getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h", artifactManifest: [] }),
    getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
    listTargetClarifications: vi.fn().mockResolvedValue([]),
    listMonitorRuns: vi.fn().mockResolvedValue([{ id: "run", sessionId: "s" }]),
    listMonitorInterventions: vi.fn().mockResolvedValue([]),
    getRvSession: vi.fn(async () => ({ id: "s", postRevealTranscript: transcript, updatedAt: "now" })),
    listSessionEvents: vi.fn(async () => events.map((event) => structuredClone(event))),
    appendSessionEvent: vi.fn(async (_sessionId: string, event: { eventType: string; role?: string; metadata?: Record<string, unknown> }) => {
      events.push({
        id: `event-${events.length + 1}`,
        sessionId: "s",
        sequenceNumber: events.length + 1,
        eventType: event.eventType,
        role: (event.role ?? "controller") as "controller",
        metadata: event.metadata ?? {},
        createdAt: `t-${events.length + 1}`,
      });
    }),
    appendPostRevealTurn: vi.fn(async (_sessionId: string, role: "user" | "assistant" | "monitor", content: string) => {
      transcript += serializePostRevealTurn(role, content);
      return transcript;
    }),
  };
  return { repository, getTranscript: () => transcript, events };
}

describe("STEP 5B post-Reveal review recovery", () => {
  it("resumes at Monitor without repeating a completed Viewer review", async () => {
    const request = automaticPostRevealReviewRequest("en");
    const initial = `${serializePostRevealTurn("user", request)}${serializePostRevealTurn("assistant", "Stored Viewer review")}`;
    const fixture = makeRepository({
      transcript: initial,
      monitor: true,
      checkpoints: [
        { stage: "viewer", status: "completed" },
        { stage: "monitor", status: "failed" },
      ],
    });
    const chat = vi.fn(async ({ config }: { config: ProviderConfig }) => {
      if (config.id === "viewer-pc") throw new Error("Viewer must not be called again");
      return { content: "Recovered Monitor review", usage: {} };
    });

    const transcript = await runAutomaticPostRevealReview({
      repository: fixture.repository as never,
      sessionId: "s",
      viewer: { providerConfig: viewerConfig, model: viewerModel },
      monitor: { providerConfig: monitorConfig, model: monitorModel },
      chat: chat as never,
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].config.id).toBe("monitor-pc");
    expect(transcript.match(/Stored Viewer review/g)).toHaveLength(1);
    expect(transcript).toContain("Recovered Monitor review");
  });

  it("requires operator resolution for an uncertain stage before retry", async () => {
    const fixture = makeRepository({
      checkpoints: [{ stage: "viewer", status: "uncertain", attempt: 1 }],
    });
    const before = await getPostRevealReviewRecoveryState(fixture.repository as never, "s");
    expect(before.requiresDecision).toBe(true);
    expect(before.nextStage).toBe("viewer");

    await resolveUncertainPostRevealReviewStage({
      repository: fixture.repository as never,
      sessionId: "s",
      stage: "viewer",
    });

    const after = await getPostRevealReviewRecoveryState(fixture.repository as never, "s");
    expect(after.requiresDecision).toBe(false);
    expect(after.resumable).toBe(true);
    expect(after.viewer?.status).toBe("failed");
  });

  it("rejects two concurrent Resume review runs for the same session", async () => {
    const fixture = makeRepository();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const chat = vi.fn(async () => {
      started();
      await wait;
      return { content: "Viewer review", usage: {} };
    });

    const first = runAutomaticPostRevealReview({
      repository: fixture.repository as never,
      sessionId: "s",
      viewer: { providerConfig: viewerConfig, model: viewerModel },
      chat: chat as never,
    });
    await startedPromise;

    await expect(runAutomaticPostRevealReview({
      repository: fixture.repository as never,
      sessionId: "s",
      viewer: { providerConfig: viewerConfig, model: viewerModel },
      chat: chat as never,
    })).rejects.toThrow("already running");

    release();
    await first;
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("keeps an exhausted length recovery safely resumable instead of uncertain", async () => {
    const limitedModel: ProviderModel = {
      ...viewerModel,
      capabilities: { ...viewerModel.capabilities, maxOutputTokens: 4096 },
    };
    const fixture = makeRepository();
    const chat = vi.fn(async () => ({ content: "cut off", finishReason: "length", usage: {} }));

    await expect(runAutomaticPostRevealReview({
      repository: fixture.repository as never,
      sessionId: "s",
      viewer: { providerConfig: viewerConfig, model: limitedModel },
      chat: chat as never,
    })).rejects.toThrow("exhausted the available analytical output budget");

    const recovery = await getPostRevealReviewRecoveryState(fixture.repository as never, "s");
    expect(recovery.viewer?.status).toBe("failed");
    expect(recovery.requiresDecision).toBe(false);
    expect(recovery.resumable).toBe(true);
  });

});
