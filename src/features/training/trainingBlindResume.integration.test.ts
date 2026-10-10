import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { getRvLite } from "../../resources/protocolRegistry";
import type { AppRepository } from "../../storage/repository";
import { createSessionReplay } from "../../sessions/resumeReplay";
import { runAutomaticRvLiteSession } from "../../sessions/rvLiteController";
import type { RvSession, SessionEventInput, SessionEventRecord, SessionSnapshot } from "../../sessions/types";
import type { TargetRecord } from "../../targets/types";
import type { TrainingRunRecord } from "../../training/types";
import type { Profile } from "../../types";
import { executeTrainingRun } from "./trainingExecution";

const config: ProviderConfig = { id: "p", provider: "openrouter", label: "P", credentialId: "c", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: "p", provider: "openrouter", modelId: "m", displayName: "M", route: "openrouter:m", pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], maxOutputTokens: 65536, contextTokens: 131072, source: "provider", capturedAt: "now" },
};

function durableRepository() {
  let session: RvSession | undefined;
  let snapshot: SessionSnapshot | undefined;
  let reveal: Parameters<AppRepository["acceptReveal"]>[1] | undefined;
  const usage: Array<{ id: string; targetId: string; profileId?: string; sessionId?: string; usedAt: string }> = [];
  const events: SessionEventRecord[] = [];
  let sequence = 0;
  let crashAfterFirstIncomplete = true;
  const append = async (sessionId: string, event: SessionEventInput): Promise<SessionEventRecord> => {
    sequence = Math.max(sequence, 0, ...events.map((item) => item.sequenceNumber));
    const record = { ...structuredClone(event), id: `e${++sequence}`, sessionId, sequenceNumber: sequence, createdAt: `t${sequence}` } as SessionEventRecord;
    events.push(record);
    if (event.eventType === "VIEWER_OUTPUT_INCOMPLETE" && crashAfterFirstIncomplete) {
      crashAfterFirstIncomplete = false;
      throw new Error("SIMULATED_PROCESS_CRASH_AFTER_DURABLE_INCOMPLETE");
    }
    return record;
  };
  const repository = {
    createRvSession: vi.fn(async (input: Record<string, unknown>) => {
      if (session) throw new Error("UNIQUE constraint failed: rv_sessions.id");
      session = { ...input, state: "Created", preRevealTranscript: "", postRevealTranscript: "", createdAt: "now", updatedAt: "now" } as unknown as RvSession;
    }),
    getRvSession: vi.fn(async () => session),
    updateRvSessionState: vi.fn(async (_id: string, state: RvSession["state"]) => { if (session) session = { ...session, state, updatedAt: "later" }; }),
    appendSessionEvent: vi.fn(append),
    appendSessionEventWithProviderState: vi.fn(async (sessionId: string, event: SessionEventInput) => append(sessionId, event)),
    listSessionEvents: vi.fn(async () => events.map((event) => structuredClone(event))),
    updatePreRevealTranscript: vi.fn(async (_id: string, transcript: string) => { if (session) session = { ...session, preRevealTranscript: transcript }; }),
    saveSessionSnapshot: vi.fn(async (_id: string, value: SessionSnapshot) => { snapshot = structuredClone(value); }),
    getSessionSnapshot: vi.fn(async () => snapshot ? structuredClone(snapshot) : undefined),
    getSessionEventProviderState: vi.fn(async () => undefined),
    sealPreReveal: vi.fn(async (_id: string, transcript: string, hash: string) => {
      if (session) session = { ...session, preRevealTranscript: transcript, preRevealHash: hash, preRevealSealedAt: "sealed-at", state: "AwaitingReveal", updatedAt: "later" };
    }),
    acceptReveal: vi.fn(async (_id: string, value: Parameters<AppRepository["acceptReveal"]>[1]) => {
      if (session?.state !== "AwaitingReveal") throw new Error("Reveal requires a sealed pre-reveal session");
      reveal = structuredClone(value);
      session = { ...session, state: "Revealed", updatedAt: "later" };
    }),
    getReveal: vi.fn(async () => reveal ? structuredClone(reveal) : null),
    recordTargetUsage: vi.fn(async (value: { targetId: string; profileId?: string; sessionId?: string }) => {
      if (!usage.some((item) => item.targetId === value.targetId && item.sessionId === value.sessionId)) usage.push({ ...value, id: `u${usage.length + 1}`, usedAt: "now" });
    }),
    listTargetUsage: vi.fn(async () => structuredClone(usage) as never),
  } as unknown as AppRepository;
  return {
    repository,
    session: () => session!,
    snapshot: () => snapshot!,
    reveal: () => reveal,
    usage,
    events,
    setSession: (value: RvSession) => { session = structuredClone(value); },
    setSnapshot: (value: SessionSnapshot) => { snapshot = structuredClone(value); },
  };
}

describe("Training blind real RV Lite replay", () => {
  it("replays accepted P1 and resumes only P2 at 32K after a crash following durable length", async () => {
    const durable = durableRepository();
    let calls = 0;
    const first = await runAutomaticRvLiteSession({
      repository: durable.repository,
      workspaceId: "w",
      profileId: "profile",
      providerConfig: config,
      model,
      protocol: getRvLite("en", "extended"),
      sessionLanguage: "en",
      requestedSettings: { maxOutputTokens: 16384 },
      operationKind: "training_blind_viewer",
      chat: async () => {
        calls += 1;
        if (calls === 1) return { content: "P1 accepted", finishReason: "stop", usage: {} };
        return { content: "P2 partial", finishReason: "length", usage: {} };
      },
    });
    expect(first.state).toBe("Interrupted");
    expect(calls).toBe(2);
    expect(durable.events.some((event) => event.eventType === "VIEWER_OUTPUT_INCOMPLETE")).toBe(true);

    const liveBudgets: number[] = [];
    const livePrompts: string[] = [];
    const replay = await createSessionReplay({
      repository: durable.repository,
      session: durable.session(),
      events: await durable.repository.listSessionEvents(durable.session().id),
      liveChat: async ({ settings, messages }) => {
        liveBudgets.push(settings.effective.maxOutputTokens ?? 0);
        livePrompts.push(messages.at(-1)?.content ?? "");
        return { content: `live ${liveBudgets.length}`, finishReason: "stop", usage: {} };
      },
    });
    const resumed = await runAutomaticRvLiteSession({
      repository: replay.repository,
      workspaceId: "w",
      profileId: "profile",
      providerConfig: config,
      model,
      protocol: getRvLite("en", "extended"),
      sessionLanguage: "en",
      requestedSettings: durable.snapshot().generationSettings.requested,
      operationKind: "training_blind_viewer",
      resumeSession: durable.session(),
      ...(durable.snapshot().continuationRoute ? { resumeContinuationRoute: durable.snapshot().continuationRoute } : {}),
      chat: replay.chat,
    });

    expect(resumed.state).toBe("AwaitingReveal");
    expect(liveBudgets[0]).toBe(32768);
    expect(livePrompts[0]).toContain("Step 2");
    const starts = durable.events.filter((event) => event.eventType === "VIEWER_OUTPUT_ATTEMPT_STARTED");
    const p2Starts = starts.filter((event) => event.metadata?.stepId === "lite:prompt:2:viewer");
    expect(p2Starts.at(-1)?.metadata?.recoveryLevel).toBe(1);
    expect(durable.events.filter((event) => event.eventType === "VIEWER_RESPONSE" && event.metadata?.stepId === "lite:prompt:1:viewer")).toHaveLength(1);
  });

  it("fires the session-created callback only after the immutable snapshot is durable", async () => {
    const log: string[] = [];
    const repository = {
      listSessionEvents: vi.fn(async () => []),
      createRvSession: vi.fn(async () => { log.push("session"); }),
      updateRvSessionState: vi.fn(async () => undefined),
      appendSessionEvent: vi.fn(async (_id: string, event: SessionEventInput) => ({ ...event, id: "e", sessionId: "s", sequenceNumber: 1, createdAt: "now" } as SessionEventRecord)),
      updatePreRevealTranscript: vi.fn(async () => undefined),
      saveSessionSnapshot: vi.fn(async () => { log.push("snapshot"); }),
      sealPreReveal: vi.fn(async () => undefined),
      acceptReveal: vi.fn(async () => undefined),
      recordTargetUsage: vi.fn(async () => undefined),
    } as unknown as AppRepository;
    await runAutomaticRvLiteSession({
      repository,
      workspaceId: "w",
      profileId: "profile",
      providerConfig: config,
      model,
      protocol: getRvLite("en", "extended"),
      sessionLanguage: "en",
      requestedSettings: { maxOutputTokens: 16384 },
      onSessionCreated: async () => { log.push("linked"); },
      chat: async () => ({ content: "ok", finishReason: "stop", usage: {} }),
    });
    expect(log.indexOf("snapshot")).toBeGreaterThan(log.indexOf("session"));
    expect(log.indexOf("linked")).toBeGreaterThan(log.indexOf("snapshot"));
  });
});

  it("executes Training resume from a sealed blind session through durable Reveal without returning to BlindRunning", async () => {
    const durable = durableRepository();
    const protocol = getRvLite("en", "extended");
    const target: TargetRecord = {
      id: "target-1", collection: "training", title: "Target", revealText: "Durable reveal", tags: [],
      sourceMetadata: { category: "mixed_targets" }, createdAt: "now", updatedAt: "now",
    };
    const profile: Profile = { id: "profile", name: "Viewer", humanName: "Human", credentialId: "c", createdAt: "now", updatedAt: "now" };
    const sealedSession: RvSession = {
      id: "session-sealed", workspaceId: "w", profileId: profile.id, sessionCode: "RV-SEALED", state: "AwaitingReveal", runType: "automatic",
      preRevealTranscript: "sealed transcript", preRevealHash: "sealed-hash", preRevealSealedAt: "sealed-at", postRevealTranscript: "",
      targetId: target.id, createdAt: "now", updatedAt: "now",
    };
    const snapshot: SessionSnapshot = {
      schemaVersion: 4, sessionId: sealedSession.id, sessionCode: sealedSession.sessionCode, profileId: profile.id, workspaceId: "w",
      providerConfigId: config.id, credentialId: config.credentialId, provider: config.provider, modelId: model.modelId, modelRoute: model.route,
      capabilitySnapshot: {}, capabilityCapturedAt: "now",
      generationSettings: { requested: { maxOutputTokens: 16384 }, effective: { maxOutputTokens: 16384 }, omitted: [] },
      viewerOutputPolicy: { version: 1, initialTokens: 16384, recoveryTokens: 32768, preserveConfiguredBudget: false },
      sessionLanguage: "en",
      protocol: { id: protocol.id, version: protocol.version, language: protocol.language, contentSha256: protocol.contentSha256, fullContent: protocol.content, variant: protocol.variant },
      controllerPrompt: { id: "rv-lite-four-call-controller", version: "1.0.0", language: "en" },
      viewerNotes: { enabled: false, aiIdentityId: "identity", noteType: "viewer_self_notes", content: "", contentSha256: "empty", estimatedTokens: 0, estimatorVersion: "conservative-char-v1", capacityTokens: 2048, modelRoute: model.route, capturedAt: "now" },
      revealSource: "automatic", targetId: target.id, applicationVersion: "0.7.14", createdAt: "now",
    };
    durable.setSession(sealedSession);
    durable.setSnapshot(snapshot);
    for (let promptNumber = 1; promptNumber <= 4; promptNumber += 1) {
      durable.events.push({
        id: `saved-${promptNumber}`, sessionId: sealedSession.id, sequenceNumber: promptNumber, eventType: "VIEWER_RESPONSE",
        role: "assistant", content: `saved ${promptNumber}`,
        metadata: { promptNumber, source: "viewer", stepId: `lite:prompt:${promptNumber}:viewer`, accepted: true, finishReason: "stop" }, createdAt: "now",
      });
    }

    let current: TrainingRunRecord = {
      id: "training", runNumber: 1, name: "Training", status: "Interrupted", mode: "partial", profileId: profile.id, workspaceId: "w",
      modelRoute: `${config.id}::${model.modelId}`, protocolVariant: "extended", targetIds: [target.id], completedTargetIds: [], sessionIds: [], currentIndex: 0,
      categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: false,
      executionSnapshot: { language: "en", generationSettings: snapshot.generationSettings.requested, transport: { maxRetries: 2, requestTimeoutMs: 30000, sessionCodePrefix: "RV" } },
      activeTargetCheckpoint: { targetId: target.id, sessionId: sealedSession.id, stage: "blind_running" }, errors: [], createdAt: "now", updatedAt: "now",
    };
    const repository = durable.repository as AppRepository & { updateTrainingRun: AppRepository["updateTrainingRun"]; listTrainingRuns: AppRepository["listTrainingRuns"]; listRvSessions: AppRepository["listRvSessions"] };
    repository.updateTrainingRun = vi.fn(async (_id, update) => { current = { ...current, ...update } as TrainingRunRecord; });
    repository.listTrainingRuns = vi.fn(async () => [current]);
    repository.listRvSessions = vi.fn(async () => [{ ...durable.session(), postRevealTranscript: "" }] as never);

    const outcome = await executeTrainingRun({
      repository,
      initial: current,
      profile,
      providerConfig: config,
      model,
      judges: [],
      targets: [target],
      language: "en",
      settings: { maxRetries: 2, requestTimeoutMs: 30000, sessionCodePrefix: "RV" },
      dependencies: {
        runAutomaticRvLiteSession,
        runAutomaticPostRevealReview: vi.fn(async () => { throw new Error("STOP_AFTER_DURABLE_REVEAL"); }),
      },
      now: () => "later",
    });

    expect(outcome.run.activeTargetCheckpoint?.stage).toBe("session_revealed");
    expect(durable.session().state).toBe("Revealed");
    expect(durable.reveal()).toBeTruthy();
    expect(durable.events.some((event) => event.eventType === "REVEAL_ACCEPTED")).toBe(true);
    expect(durable.usage.some((item) => item.sessionId === sealedSession.id && item.targetId === target.id)).toBe(true);
    expect(durable.repository.updateRvSessionState).toHaveBeenCalledWith(sealedSession.id, "AwaitingReveal");
    expect(durable.repository.updateRvSessionState).not.toHaveBeenCalledWith(sealedSession.id, "BlindRunning");
  });
