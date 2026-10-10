import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { getRvLite } from "../../resources/protocolRegistry";
import type { AppRepository } from "../../storage/repository";
import type { TargetRecord } from "../../targets/types";
import { buildAutomaticTargetReveal } from "../../targets/service";
import type { TrainingRunRecord } from "../../training/types";
import type { Profile } from "../../types";
import { executeTrainingRun, type ExecuteTrainingRunInput } from "./trainingExecution";

const profile: Profile = { id: "profile", name: "Viewer", humanName: "Human", credentialId: "credential", createdAt: "now", updatedAt: "now" };
const provider: ProviderConfig = { id: "provider", provider: "openrouter", label: "Provider", credentialId: "credential", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: provider.id,
  provider: "openrouter",
  modelId: "viewer-model",
  displayName: "Viewer model",
  route: "openrouter:viewer-model",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100_000, maxOutputTokens: 32_768, source: "provider", capturedAt: "now" },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
};
const target: TargetRecord = { id: "t1", collection: "training", title: "Target", revealText: "Reveal t1", tags: [], sourceMetadata: { category: "mixed_targets" }, createdAt: "now", updatedAt: "now" };

function training(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    id: "training", runNumber: 1, name: "Training 1", status: "Interrupted", mode: "partial",
    profileId: profile.id, workspaceId: "workspace", modelRoute: `${provider.id}::${model.modelId}`,
    protocolVariant: "extended", targetIds: [target.id], completedTargetIds: [], sessionIds: [], currentIndex: 0,
    categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: true,
    executionSnapshot: { language: "en", generationSettings: { maxOutputTokens: 16_384 }, transport: { maxRetries: 2, requestTimeoutMs: 30_000, sessionCodePrefix: "RV" } },
    errors: [], createdAt: "now", updatedAt: "now", ...overrides,
  };
}

function baseInput(repository: AppRepository, initial: TrainingRunRecord, dependencies: NonNullable<ExecuteTrainingRunInput["dependencies"]>): ExecuteTrainingRunInput {
  return { repository, initial, profile, providerConfig: provider, model, judges: [], targets: [target], language: "en", settings: { maxRetries: 2, requestTimeoutMs: 30_000, sessionCodePrefix: "RV" }, dependencies, now: () => "later" };
}

function frozenSnapshot() {
  const protocol = getRvLite("en", "extended");
  return {
    schemaVersion: 4 as const,
    sessionId: "session_t1", sessionCode: "RV-1", profileId: profile.id, workspaceId: "workspace",
    identities: { aiIsBeDisplayName: "Frozen Viewer", humanIsBeDisplayName: "Frozen Human" },
    providerConfigId: provider.id, credentialId: provider.credentialId, provider: provider.provider,
    modelId: model.modelId, modelRoute: model.route, capabilitySnapshot: {}, capabilityCapturedAt: "now",
    generationSettings: { requested: { maxOutputTokens: 16_384 }, effective: { maxOutputTokens: 16_384 }, omitted: [] },
    viewerOutputPolicy: { version: 1 as const, initialTokens: 16_384, recoveryTokens: 32_768, preserveConfiguredBudget: false },
    sessionLanguage: "en" as const,
    protocol: { id: protocol.id, version: protocol.version, language: protocol.language, contentSha256: protocol.contentSha256, fullContent: protocol.content, variant: protocol.variant },
    controllerPrompt: { id: "rv-lite-four-call-controller", version: "1.0.0", language: "en" as const },
    rvSystemPrompt: { id: "viewer-system", version: "1", language: "en" as const, contentSha256: "prompt-hash", fullContent: "FROZEN PROMPT", fieldGuide: { aiIdentityId: "identity", language: "en" as const, versionId: "guide-1", versionNumber: 1, content: "FROZEN GUIDE", contentSha256: "guide-hash", estimatedTokens: 10, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 2048 as const, modelRoute: model.route, capturedAt: "now", sourceKind: "factory-baseline" as const } },
    viewerNotes: { enabled: true, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, versionId: "notes-1", versionNumber: 1, content: "FROZEN NOTES", contentSha256: "notes-hash", estimatedTokens: 10, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 2048 as const, modelRoute: model.route, capturedAt: "now" },
    revealSource: "automatic" as const, targetId: target.id, applicationVersion: "0.7.14", createdAt: "now",
  };
}

describe("Training blind durable Resume", () => {
  it("persists blind_running from onSessionCreated before an interrupted blind session returns", async () => {
    let current = training({ status: "Running", executionSnapshot: undefined });
    const updates: Array<Record<string, unknown>> = [];
    const repository = {
      updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { updates.push(update); current = { ...current, ...update } as TrainingRunRecord; }),
      listTrainingRuns: vi.fn(async () => [current]),
      getRvSession: vi.fn(async () => null),
      getSessionSnapshot: vi.fn(async () => null),
    } as unknown as AppRepository;
    const runAutomaticRvLiteSession = vi.fn(async (request: { sessionIdentity?: { id: string; sessionCode: string }; onSessionCreated?: (sessionId: string, sessionCode: string) => Promise<void> | void }) => {
      const identity = request.sessionIdentity!;
      await request.onSessionCreated?.(identity.id, identity.sessionCode);
      return { sessionId: identity.id, sessionCode: identity.sessionCode, state: "Interrupted" as const, transcript: "partial", stopReason: "AUTO-STOP" };
    });
    const dependencies = {
      prepareFieldGuideForSession: vi.fn(async () => ({ aiIdentityId: "identity", language: "en", content: "guide", contentSha256: "guide", estimatedTokens: 1, estimatorVersion: "conservative-char-v1", capacityTokens: 2048, modelRoute: model.route, capturedAt: "now", sourceKind: "factory-baseline" })),
      viewerSystemPromptSnapshotFromFieldGuide: vi.fn(async () => ({ id: "prompt", version: "1", language: "en", content: "prompt", contentSha256: "prompt" })),
      prepareViewerNotesForSession: vi.fn(async () => ({ enabled: false, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, content: "", contentSha256: "empty-notes-hash", estimatedTokens: 0, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 2048 as const, modelRoute: model.route, capturedAt: "now" })),
      runAutomaticRvLiteSession,
    } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;

    const outcome = await executeTrainingRun(baseInput(repository, current, dependencies));
    expect(outcome.run.status).toBe("Interrupted");
    expect(outcome.run.activeTargetCheckpoint?.targetId).toBe("t1");
    expect(outcome.run.activeTargetCheckpoint?.stage).toBe("blind_running");
    expect(outcome.run.activeTargetCheckpoint?.sessionId).toMatch(/^session_/);
    expect(updates.some((update) => (update.activeTargetCheckpoint as { stage?: string } | undefined)?.stage === "blind_initializing")).toBe(true);
    expect(updates.some((update) => (update.activeTargetCheckpoint as { stage?: string } | undefined)?.stage === "blind_running")).toBe(true);
  });

  it("resumes the same blind session from frozen Session Snapshot without refreshing Field Guide or Viewer Notes", async () => {
    const initial = training({ activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "blind_running" } });
    let current = initial;
    const snapshot = frozenSnapshot();
    let durableState: "Interrupted" | "Revealed" = "Interrupted";
    const durableEvents: Array<{ eventType: string; metadata?: Record<string, unknown> }> = [];
    const durableUsage: Array<{ sessionId: string; targetId: string }> = [];
    const repository = {
      updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { current = { ...current, ...update } as TrainingRunRecord; }),
      listTrainingRuns: vi.fn(async () => [current]),
      getRvSession: vi.fn(async () => ({ id: "session_t1", workspaceId: "workspace", profileId: profile.id, sessionCode: "RV-1", state: durableState, runType: "automatic", preRevealTranscript: "P1 accepted", preRevealSealedAt: durableState === "Revealed" ? "now" : undefined, postRevealTranscript: "", targetId: "t1", createdAt: "now", updatedAt: "now" })),
      getSessionSnapshot: vi.fn(async () => snapshot),
      listSessionEvents: vi.fn(async () => durableEvents.map((event, index) => ({ ...event, id: `e${index + 1}`, sessionId: "session_t1", sequenceNumber: index + 1, createdAt: "now" })) as never),
      appendSessionEvent: vi.fn(async (_sessionId: string, event: { eventType: string; metadata?: Record<string, unknown> }) => { durableEvents.push(event); return undefined as never; }),
      getReveal: vi.fn(async () => durableState === "Revealed" ? ({ source: "automatic", text: "Reveal t1", hash: "reveal-hash", artifactManifest: [] } as never) : null),
      listTargetUsage: vi.fn(async () => durableUsage as never),
      recordTargetUsage: vi.fn(async (value: { sessionId?: string; targetId: string }) => { if (value.sessionId) durableUsage.push({ sessionId: value.sessionId, targetId: value.targetId }); }),
      listRvSessions: vi.fn(async () => [{ id: "session_t1", postRevealTranscript: "" }] as never),
    } as unknown as AppRepository;
    const runAutomaticRvLiteSession = vi.fn(async (request: Record<string, unknown>) => {
      expect((request.resumeSession as { id: string }).id).toBe("session_t1");
      expect(request.requestedSettings).toEqual(snapshot.generationSettings.requested);
      expect((request.viewerNotes as { content: string }).content).toBe("FROZEN NOTES");
      expect((request.rvSystemPrompt as { content: string }).content).toBe("FROZEN PROMPT");
      durableState = "Revealed";
      durableEvents.push({ eventType: "REVEAL_ACCEPTED", metadata: { source: "automatic_target", targetId: "t1" } });
      durableUsage.push({ sessionId: "session_t1", targetId: "t1" });
      return { sessionId: "session_t1", sessionCode: "RV-1", state: "Revealed" as const, transcript: "done" };
    });
    const dependencies = {
      prepareFieldGuideForSession: vi.fn(async () => { throw new Error("must not refresh Field Guide"); }),
      viewerSystemPromptSnapshotFromFieldGuide: vi.fn(async () => { throw new Error("must not rebuild prompt"); }),
      prepareViewerNotesForSession: vi.fn(async () => { throw new Error("must not refresh Viewer Notes"); }),
      runAutomaticRvLiteSession,
      runAutomaticPostRevealReview: vi.fn(async () => { throw new Error("stop after blind resume"); }),
    } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;

    const outcome = await executeTrainingRun(baseInput(repository, initial, dependencies));
    expect(outcome.run.activeTargetCheckpoint?.stage).toBe("session_revealed");
    expect(runAutomaticRvLiteSession).toHaveBeenCalledOnce();
    expect(dependencies.prepareFieldGuideForSession).not.toHaveBeenCalled();
    expect(dependencies.prepareViewerNotesForSession).not.toHaveBeenCalled();
  });


  it("recovers blind_initializing with an existing session but missing snapshot without inserting a second session", async () => {
    const reveal = await buildAutomaticTargetReveal(target, "en");
    const initial = training({ activeTargetCheckpoint: {
      targetId: "t1", sessionId: "session_init", stage: "blind_initializing",
      blindInitialization: { sessionCode: "RV-INIT", automaticRevealHash: reveal.hash, rvSystemPrompt: { id: "prompt", version: "1", content: "FROZEN", contentSha256: "hash" }, viewerNotes: { enabled: false, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, content: "", contentSha256: "empty-notes-hash", estimatedTokens: 0, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 2048 as const, modelRoute: model.route, capturedAt: "now" } },
    } });
    let current = initial;
    const existingSession = { id: "session_init", workspaceId: "workspace", profileId: profile.id, sessionCode: "RV-INIT", state: "Preflight", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", targetId: "t1", createdAt: "now", updatedAt: "now" };
    const repository = {
      updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { current = { ...current, ...update } as TrainingRunRecord; }),
      listTrainingRuns: vi.fn(async () => [current]),
      getRvSession: vi.fn(async () => existingSession),
      getSessionSnapshot: vi.fn(async () => undefined),
    } as unknown as AppRepository;
    const runAutomaticRvLiteSession = vi.fn(async (request: { resumeSession?: { id: string }; sessionIdentity?: unknown; onSessionCreated?: (sessionId: string, sessionCode: string) => Promise<void> | void }) => {
      expect(request.resumeSession?.id).toBe("session_init");
      expect(request.sessionIdentity).toBeUndefined();
      await request.onSessionCreated?.("session_init", "RV-INIT");
      return { sessionId: "session_init", sessionCode: "RV-INIT", state: "Interrupted" as const, transcript: "", stopReason: "AUTO-STOP" };
    });
    const dependencies = { runAutomaticRvLiteSession } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;
    const outcome = await executeTrainingRun(baseInput(repository, initial, dependencies));
    expect(outcome.run.activeTargetCheckpoint?.stage).toBe("blind_running");
    expect(runAutomaticRvLiteSession).toHaveBeenCalledOnce();
  });

  it("recovers blind_initializing after snapshot durability by promoting to replayable blind_running", async () => {
    const reveal = await buildAutomaticTargetReveal(target, "en");
    const snapshot = { ...frozenSnapshot(), automaticRevealHash: reveal.hash };
    const initial = training({ activeTargetCheckpoint: {
      targetId: "t1", sessionId: "session_t1", stage: "blind_initializing",
      blindInitialization: { sessionCode: "RV-1", automaticRevealHash: reveal.hash, rvSystemPrompt: { id: "prompt", version: "1", content: "FROZEN", contentSha256: "hash" }, viewerNotes: { enabled: false, aiIdentityId: "identity", noteType: "viewer_self_notes" as const, content: "", contentSha256: "empty-notes-hash", estimatedTokens: 0, estimatorVersion: "conservative-char-v1" as const, capacityTokens: 2048 as const, modelRoute: model.route, capturedAt: "now" } },
    } });
    let current = initial;
    const repository = {
      updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { current = { ...current, ...update } as TrainingRunRecord; }),
      listTrainingRuns: vi.fn(async () => [current]),
      getRvSession: vi.fn(async () => ({ id: "session_t1", workspaceId: "workspace", profileId: profile.id, sessionCode: "RV-1", state: "Interrupted", runType: "automatic", preRevealTranscript: "", postRevealTranscript: "", targetId: "t1", createdAt: "now", updatedAt: "now" })),
      getSessionSnapshot: vi.fn(async () => snapshot),
      listSessionEvents: vi.fn(async () => []),
    } as unknown as AppRepository;
    const runAutomaticRvLiteSession = vi.fn(async () => ({ sessionId: "session_t1", sessionCode: "RV-1", state: "Interrupted" as const, transcript: "", stopReason: "AUTO-STOP" }));
    const dependencies = { runAutomaticRvLiteSession } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;
    const outcome = await executeTrainingRun(baseInput(repository, initial, dependencies));
    expect(outcome.run.activeTargetCheckpoint?.stage).toBe("blind_running");
    expect(runAutomaticRvLiteSession).toHaveBeenCalledOnce();
  });
  it("does not rerun blind when the session was already Revealed before the Training checkpoint advanced", async () => {
    const initial = training({ activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "blind_running" } });
    let current = initial;
    const repository = {
      updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { current = { ...current, ...update } as TrainingRunRecord; }),
      listTrainingRuns: vi.fn(async () => [current]),
      getRvSession: vi.fn(async () => ({ id: "session_t1", workspaceId: "workspace", profileId: profile.id, sessionCode: "RV-1", state: "Revealed", runType: "automatic", preRevealTranscript: "complete", preRevealSealedAt: "now", postRevealTranscript: "", targetId: "t1", createdAt: "now", updatedAt: "now" })),
      getSessionSnapshot: vi.fn(async () => frozenSnapshot()),
      getReveal: vi.fn(async () => ({ source: "automatic", text: "Reveal t1", hash: "reveal-hash", artifactManifest: [] }) as never),
      listSessionEvents: vi.fn(async () => [{ id: "e1", sessionId: "session_t1", sequenceNumber: 1, eventType: "REVEAL_ACCEPTED", metadata: { source: "automatic_target", targetId: "t1" }, createdAt: "now" }] as never),
      listTargetUsage: vi.fn(async () => [{ id: "u1", sessionId: "session_t1", targetId: "t1", usedAt: "now" }] as never),
      listRvSessions: vi.fn(async () => [{ id: "session_t1", postRevealTranscript: "" }] as never),
    } as unknown as AppRepository;
    const runAutomaticRvLiteSession = vi.fn();
    const dependencies = {
      runAutomaticRvLiteSession,
      runAutomaticPostRevealReview: vi.fn(async () => { throw new Error("stop after checkpoint promotion"); }),
    } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;

    const outcome = await executeTrainingRun(baseInput(repository, initial, dependencies));
    expect(outcome.run.activeTargetCheckpoint?.stage).toBe("session_revealed");
    expect(runAutomaticRvLiteSession).not.toHaveBeenCalled();
  });
});
