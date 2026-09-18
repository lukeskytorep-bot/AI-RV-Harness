import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { AppRepository } from "../../storage/repository";
import type { TargetRecord } from "../../targets/types";
import type { TrainingRunRecord } from "../../training/types";
import type { Profile } from "../../types";
import { executeTrainingRun, firstPendingTrainingTargetIndex, type ExecuteTrainingRunInput } from "./trainingExecution";
import { supportedAutomaticPostRevealReviewRequests } from "../../sessions/postReveal";
import { serializePostRevealTurn } from "../../sessions/postRevealTranscript";

const profile: Profile = { id: "profile", name: "Viewer", humanName: "Human", credentialId: "credential", createdAt: "now", updatedAt: "now" };
const provider: ProviderConfig = { id: "provider", provider: "openrouter", label: "Provider", credentialId: "credential", enabled: true, lastStatus: "ok", createdAt: "now", updatedAt: "now" };
const model: ProviderModel = {
  providerConfigId: provider.id,
  provider: "openrouter",
  modelId: "viewer-model",
  displayName: "Viewer model",
  route: "openrouter:viewer-model",
  capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100_000, maxOutputTokens: 8_192, source: "provider", capturedAt: "now" },
  pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now",
};

const targets: TargetRecord[] = ["t1", "t2", "t3"].map((id) => ({
  id,
  collection: "training",
  title: id,
  revealText: `Reveal ${id}`,
  tags: [],
  sourceMetadata: { category: "mixed_targets" },
  createdAt: "now",
  updatedAt: "now",
}));

function run(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    id: "training",
    runNumber: 1,
    name: "Training 1",
    status: "Running",
    mode: "partial",
    profileId: profile.id,
    workspaceId: "workspace",
    modelRoute: `${provider.id}::${model.modelId}`,
    protocolVariant: "extended",
    targetIds: targets.map((target) => target.id),
    completedTargetIds: [],
    sessionIds: [],
    currentIndex: 0,
    categories: ["mixed_targets"],
    judgeModelRoutes: [],
    pauseAfterBlock: false,
    viewerNotesEnabled: true,
    errors: [],
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  };
}

function harness(sessionFailureAt?: string) {
  const updates: Array<Record<string, unknown>> = [];
  const transcripts = new Map<string, string>();
  const repository = {
    updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { updates.push(update); }),
    updateRvSessionState: vi.fn(async () => undefined),
    listRvSessions: vi.fn(async () => [...transcripts].map(([id, postRevealTranscript]) => ({ id, postRevealTranscript })) as never),
    listTrainingRuns: vi.fn(async () => []),
    listArchivedTrainingRuns: vi.fn(async () => []),
    getSessionSnapshot: vi.fn(async (sessionId: string) => ({
      sessionId,
      providerConfigId: provider.id,
      provider: provider.provider,
      modelId: model.modelId,
      modelRoute: model.route,
      viewerNotes: { enabled: false },
    }) as never),
    getReveal: vi.fn(async () => ({ hash: "reveal-hash", text: "Reveal", artifactManifest: [] }) as never),
    getViewerEvidence: vi.fn(async () => "sealed blind evidence"),
    listViewerNoteReflectionRuns: vi.fn(async () => []),
    listJudgeScores: vi.fn(async () => []),
  } as unknown as AppRepository;
  const reflect = vi.fn(async () => null);
  const fieldGuideUpdate = vi.fn(async () => null);
  let fieldGuideVersion = 0;
  const prepareFieldGuide = vi.fn(async () => ({
    versionId: `field-guide-${++fieldGuideVersion}`,
    version: fieldGuideVersion,
    language: "en" as const,
    content: `guide-${fieldGuideVersion}`,
    contentSha256: `hash-${fieldGuideVersion}`,
    estimatedTokens: 10,
    capacityTokens: 2048 as const,
    sourceKind: "factory-baseline" as const,
    activationId: `activation-${fieldGuideVersion}`,
    activatedAt: "now",
    aiIdentityId: "identity",
    modelRoute: model.route,
  }));
  const promptFromFieldGuide = vi.fn(async (fieldGuide: Awaited<ReturnType<typeof prepareFieldGuide>>) => ({
    id: "viewer-prompt",
    version: "1.5.0",
    language: "en" as const,
    content: `prompt-${fieldGuide.versionId}`,
    contentSha256: `prompt-hash-${fieldGuide.versionId}`,
    fieldGuide,
  }));
  const runSession = vi.fn(async (input: { automaticTarget?: TargetRecord; signal?: AbortSignal; rvSystemPrompt?: { fieldGuide?: { versionId: string } } }) => {
    const id = input.automaticTarget!.id;
    if (id === sessionFailureAt) throw new Error("provider unavailable");
    return { sessionId: `session_${id}`, sessionCode: id, state: "Revealed" as const, transcript: id };
  });
  const postReview = vi.fn(async (request: { sessionId: string }) => {
    const transcript = `${serializePostRevealTurn("user", supportedAutomaticPostRevealReviewRequests("en")[0])}${serializePostRevealTurn("assistant", "review")}`;
    transcripts.set(request.sessionId, transcript);
    return transcript;
  });
  const dependencies = {
    prepareFieldGuideForSession: prepareFieldGuide,
    viewerSystemPromptSnapshotFromFieldGuide: promptFromFieldGuide,
    prepareViewerNotesForSession: vi.fn(async () => ({ enabled: true })),
    runAutomaticRvLiteSession: runSession,
    runAutomaticPostRevealReview: postReview,
    runFieldGuideUpdate: fieldGuideUpdate,
    runViewerNoteReflection: reflect,
    runBlindJudging: vi.fn(async () => ({ scores: [], aggregate: null })),
  } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;
  return { repository, updates, transcripts, reflect, fieldGuideUpdate, prepareFieldGuide, promptFromFieldGuide, runSession, dependencies };
}

function input(initial: TrainingRunRecord, testHarness: ReturnType<typeof harness>, extra: Partial<ExecuteTrainingRunInput> = {}): ExecuteTrainingRunInput {
  return {
    repository: testHarness.repository,
    initial,
    profile,
    providerConfig: provider,
    model,
    judges: [],
    targets,
    language: "en",
    settings: { maxRetries: 2, requestTimeoutMs: 30_000, sessionCodePrefix: "RV", maxSessionCostUsd: 0 },
    dependencies: testHarness.dependencies,
    now: () => "later",
    ...extra,
  };
}

describe("Training execution", () => {
  it("checkpoints every completed target and creates at most one Viewer Notes reflection per target", async () => {
    const testHarness = harness();
    const outcome = await executeTrainingRun(input(run(), testHarness));
    expect(outcome.run.status).toBe("Completed");
    expect(outcome.run.completedTargetIds).toEqual(["t1", "t2", "t3"]);
    expect(outcome.run.sessionIds).toEqual(["session_t1", "session_t2", "session_t3"]);
    expect(testHarness.fieldGuideUpdate).toHaveBeenCalledTimes(3);
    expect(testHarness.prepareFieldGuide).toHaveBeenCalledTimes(3);
    expect(testHarness.runSession.mock.calls.map((call) => call[0].rvSystemPrompt?.fieldGuide?.versionId)).toEqual([
      "field-guide-1",
      "field-guide-2",
      "field-guide-3",
    ]);
    expect(testHarness.reflect).toHaveBeenCalledTimes(3);
    expect(testHarness.updates.filter((update) => Array.isArray(update.completedTargetIds)).map((update) => (update.completedTargetIds as string[]).length)).toEqual([1, 2, 3]);
  });

  it("resumes at the first target without a durable checkpoint even when currentIndex is stale", async () => {
    const initial = run({ completedTargetIds: ["t1"], sessionIds: ["session_t1"], currentIndex: 0, status: "Interrupted" });
    expect(firstPendingTrainingTargetIndex(initial)).toBe(1);
    const testHarness = harness();
    const outcome = await executeTrainingRun(input(initial, testHarness));
    expect(testHarness.runSession.mock.calls.map((call) => call[0].automaticTarget?.id)).toEqual(["t2", "t3"]);
    expect(outcome.run.completedTargetIds).toEqual(["t1", "t2", "t3"]);
    expect(outcome.run.sessionIds).toEqual(["session_t1", "session_t2", "session_t3"]);
  });

  it("pauses only after the current target has been durably checkpointed", async () => {
    const testHarness = harness();
    const outcome = await executeTrainingRun(input(run(), testHarness, { shouldPause: () => true }));
    expect(outcome.run.status).toBe("Paused");
    expect(outcome.run.completedTargetIds).toEqual(["t1"]);
    expect(testHarness.runSession).toHaveBeenCalledTimes(1);
    expect(testHarness.updates.at(-1)).toMatchObject({ status: "Paused" });
  });

  it("preserves the last checkpoint when a later provider operation fails", async () => {
    const testHarness = harness("t2");
    const outcome = await executeTrainingRun(input(run(), testHarness));
    expect(outcome.run.status).toBe("Interrupted");
    expect(outcome.run.completedTargetIds).toEqual(["t1"]);
    expect(outcome.run.sessionIds).toEqual(["session_t1"]);
    expect(outcome.error).toBe("provider unavailable");
    expect(testHarness.updates.at(-1)).toMatchObject({ status: "Interrupted", error: "provider unavailable" });
  });

  it("forwards cancellation to the active session and never starts the next target", async () => {
    const testHarness = harness();
    const controller = new AbortController();
    testHarness.runSession.mockImplementationOnce(async (request) => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException("Training cancelled", "AbortError");
    });
    const outcome = await executeTrainingRun(input(run(), testHarness, { signal: controller.signal }));
    expect(outcome.run.status).toBe("Interrupted");
    expect(testHarness.runSession).toHaveBeenCalledTimes(1);
    expect(testHarness.reflect).not.toHaveBeenCalled();
  });

  it("does not complete or checkpoint a target cancelled during post-Reveal work", async () => {
    const testHarness = harness();
    const controller = new AbortController();
    const postReview = testHarness.dependencies!.runAutomaticPostRevealReview as ReturnType<typeof vi.fn>;
    postReview.mockImplementationOnce(async (request: { sessionId: string }) => {
      const transcript = `${serializePostRevealTurn("user", supportedAutomaticPostRevealReviewRequests("en")[0])}${serializePostRevealTurn("assistant", "review")}`;
      testHarness.transcripts.set(request.sessionId, transcript);
      controller.abort();
      return transcript;
    });
    const outcome = await executeTrainingRun(input(run(), testHarness, { signal: controller.signal }));
    expect(outcome.run.status).toBe("Interrupted");
    expect(outcome.run.completedTargetIds).toEqual([]);
    expect(testHarness.repository.updateRvSessionState).not.toHaveBeenCalledWith("session_t1", "Completed");
  });

  it("resumes after a Judge failure without repeating the Viewer session, review, or reflection", async () => {
    const testHarness = harness();
    const judge = testHarness.dependencies!.runBlindJudging as ReturnType<typeof vi.fn>;
    judge.mockRejectedValueOnce(new Error("Judge unavailable"));
    const judges = [{ providerConfig: provider, model }];

    const interrupted = await executeTrainingRun(input(run({ targetIds: ["t1"], judgeModelRoutes: [model.route] }), testHarness, { judges }));
    expect(interrupted.run.status).toBe("Interrupted");
    expect(interrupted.run.activeTargetCheckpoint).toMatchObject({ targetId: "t1", sessionId: "session_t1", stage: "viewer_notes_reflection_completed" });
    expect(interrupted.run.activeTargetCheckpoint?.postRevealReviewPacketSha256).toMatch(/^[a-f0-9]{64}$/);

    judge.mockResolvedValueOnce({ scores: [], aggregate: null });
    const resumed = await executeTrainingRun(input(interrupted.run, testHarness, { judges }));

    expect(resumed.run.status).toBe("Completed");
    expect(resumed.run.sessionIds).toEqual(["session_t1"]);
    expect(testHarness.runSession).toHaveBeenCalledTimes(1);
    expect(testHarness.dependencies!.runAutomaticPostRevealReview).toHaveBeenCalledTimes(1);
    expect(testHarness.fieldGuideUpdate).toHaveBeenCalledTimes(1);
    expect(testHarness.reflect).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("does not call a Judge again when frozen scores exist before the Training checkpoint", async () => {
    const testHarness = harness();
    testHarness.repository.listJudgeScores = vi.fn(async () => [{ modelRoute: model.route }] as never);
    const judge = testHarness.dependencies!.runBlindJudging as ReturnType<typeof vi.fn>;
    const initial = run({
      targetIds: ["t1"],
      judgeModelRoutes: [model.route],
      status: "Interrupted",
      activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "viewer_notes_reflection_completed" },
    });

    const outcome = await executeTrainingRun(input(initial, testHarness, { judges: [{ providerConfig: provider, model }] }));

    expect(outcome.run.status).toBe("Completed");
    expect(judge).not.toHaveBeenCalled();
    expect(outcome.run.sessionIds).toEqual(["session_t1"]);
  });

  it("runs Review, Field Guide Update, then Viewer Notes Reflection in that order", async () => {
    const testHarness = harness();
    const order: string[] = [];
    (testHarness.dependencies!.runAutomaticPostRevealReview as ReturnType<typeof vi.fn>).mockImplementationOnce(async (request: { sessionId: string }) => {
      order.push("review");
      const transcript = `${serializePostRevealTurn("user", supportedAutomaticPostRevealReviewRequests("en")[0])}${serializePostRevealTurn("assistant", "review")}`;
      testHarness.transcripts.set(request.sessionId, transcript);
      return transcript;
    });
    testHarness.fieldGuideUpdate.mockImplementationOnce(async () => { order.push("field-guide"); return null; });
    testHarness.reflect.mockImplementationOnce(async () => { order.push("viewer-notes"); return null; });

    const outcome = await executeTrainingRun(input(run({ targetIds: ["t1"] }), testHarness));
    expect(outcome.run.status).toBe("Completed");
    expect(order).toEqual(["review", "field-guide", "viewer-notes"]);
  });

  it("resumes at Field Guide Update without repeating a completed Review", async () => {
    const testHarness = harness();
    const transcript = `${serializePostRevealTurn("user", supportedAutomaticPostRevealReviewRequests("en")[0])}${serializePostRevealTurn("assistant", "Stored review")}`;
    testHarness.transcripts.set("session_t1", transcript);
    testHarness.fieldGuideUpdate.mockRejectedValueOnce(new Error("Field Guide provider unavailable"));
    const initial = run({ targetIds: ["t1"], status: "Interrupted", activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "review_completed" } });

    const interrupted = await executeTrainingRun(input(initial, testHarness));
    expect(interrupted.run.status).toBe("Interrupted");
    expect(testHarness.dependencies!.runAutomaticPostRevealReview).not.toHaveBeenCalled();
    expect(testHarness.reflect).not.toHaveBeenCalled();

    testHarness.fieldGuideUpdate.mockResolvedValueOnce(null);
    const resumed = await executeTrainingRun(input(interrupted.run, testHarness));
    expect(resumed.run.status).toBe("Completed");
    expect(testHarness.dependencies!.runAutomaticPostRevealReview).not.toHaveBeenCalled();
    expect(testHarness.fieldGuideUpdate).toHaveBeenCalledTimes(2);
    expect(testHarness.reflect).toHaveBeenCalledOnce();
  });

  it("keeps Field Guide Update unfinished after a provider failure and resumes from that stage", async () => {
    const testHarness = harness();
    const transcript = `${serializePostRevealTurn("user", supportedAutomaticPostRevealReviewRequests("en")[0])}${serializePostRevealTurn("assistant", "Stored review")}`;
    testHarness.transcripts.set("session_t1", transcript);
    testHarness.fieldGuideUpdate.mockResolvedValueOnce({
      status: "FAILED_PROVIDER",
      audit: { status: "FAILED_PROVIDER", failureMessage: "temporary provider outage" },
    } as never);
    const initial = run({ targetIds: ["t1"], status: "Interrupted", activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "review_completed" } });

    const interrupted = await executeTrainingRun(input(initial, testHarness));
    expect(interrupted.run.status).toBe("Interrupted");
    expect(interrupted.run.activeTargetCheckpoint?.stage).toBe("review_completed");
    expect(testHarness.reflect).not.toHaveBeenCalled();

    testHarness.fieldGuideUpdate.mockResolvedValueOnce(null);
    const resumed = await executeTrainingRun(input(interrupted.run, testHarness));
    expect(resumed.run.status).toBe("Completed");
    expect(testHarness.fieldGuideUpdate).toHaveBeenCalledTimes(2);
    expect(testHarness.reflect).toHaveBeenCalledOnce();
  });

  it("treats FAILED_CAPACITY as a completed Field Guide decision and still continues Viewer Notes", async () => {
    const testHarness = harness();
    testHarness.fieldGuideUpdate.mockResolvedValueOnce({
      status: "FAILED_CAPACITY",
      audit: { status: "FAILED_CAPACITY", packetSha256: "a".repeat(64) },
    } as never);
    const outcome = await executeTrainingRun(input(run({ targetIds: ["t1"] }), testHarness));
    expect(outcome.run.status).toBe("Completed");
    expect(testHarness.reflect).toHaveBeenCalledOnce();
  });

  it("does not repeat completed Review or Field Guide Update when Viewer Notes Reflection resumes", async () => {
    const testHarness = harness();
    const transcript = `${serializePostRevealTurn("user", supportedAutomaticPostRevealReviewRequests("en")[0])}${serializePostRevealTurn("assistant", "Stored review")}`;
    testHarness.transcripts.set("session_t1", transcript);
    testHarness.reflect.mockRejectedValueOnce(new Error("Viewer Notes provider unavailable"));
    const initial = run({ targetIds: ["t1"], status: "Interrupted", activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "field_guide_update_completed" } });

    const interrupted = await executeTrainingRun(input(initial, testHarness));
    expect(interrupted.run.status).toBe("Interrupted");
    expect(testHarness.dependencies!.runAutomaticPostRevealReview).not.toHaveBeenCalled();
    expect(testHarness.fieldGuideUpdate).not.toHaveBeenCalled();

    testHarness.reflect.mockResolvedValueOnce(null);
    const resumed = await executeTrainingRun(input(interrupted.run, testHarness));
    expect(resumed.run.status).toBe("Completed");
    expect(testHarness.dependencies!.runAutomaticPostRevealReview).not.toHaveBeenCalled();
    expect(testHarness.fieldGuideUpdate).not.toHaveBeenCalled();
    expect(testHarness.reflect).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["pl", "current", 0],
    ["pl", "historical-context", 1],
    ["pl", "historical-original", 2],
    ["en", "current", 0],
    ["en", "historical-context", 1],
    ["en", "historical-original", 2],
  ] as const)("reuses a stored %s %s automatic Viewer Review without a paid rerun", async (language, _version, requestIndex) => {
    const testHarness = harness();
    const request = supportedAutomaticPostRevealReviewRequests(language)[requestIndex];
    const transcript = `${serializePostRevealTurn("user", request)}${serializePostRevealTurn("assistant", "Stored review")}`;
    testHarness.repository.listRvSessions = vi.fn(async () => [{ id: "session_t1", postRevealTranscript: transcript }] as never);
    const initial = run({
      targetIds: ["t1"],
      status: "Interrupted",
      activeTargetCheckpoint: { targetId: "t1", sessionId: "session_t1", stage: "session_revealed" },
    });

    const outcome = await executeTrainingRun(input(initial, testHarness, { language }));
    const repeated = await executeTrainingRun(input(outcome.run, testHarness, { language }));

    expect(outcome.run.status).toBe("Completed");
    expect(repeated.run.status).toBe("Completed");
    expect(testHarness.dependencies!.runAutomaticPostRevealReview).not.toHaveBeenCalled();
    expect(testHarness.fieldGuideUpdate).toHaveBeenCalledOnce();
    expect(testHarness.reflect).toHaveBeenCalledOnce();
    expect(testHarness.reflect).toHaveBeenCalledWith(expect.objectContaining({ viewerReview: "Stored review" }));
  });
});
