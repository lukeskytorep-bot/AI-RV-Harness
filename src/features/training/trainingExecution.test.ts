import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { AppRepository } from "../../storage/repository";
import type { TargetRecord } from "../../targets/types";
import type { TrainingRunRecord } from "../../training/types";
import type { Profile } from "../../types";
import { executeTrainingRun, firstPendingTrainingTargetIndex, type ExecuteTrainingRunInput } from "./trainingExecution";

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
  const repository = {
    updateTrainingRun: vi.fn(async (_id: string, update: Record<string, unknown>) => { updates.push(update); }),
    updateRvSessionState: vi.fn(async () => undefined),
  } as unknown as AppRepository;
  const reflect = vi.fn(async () => null);
  const runSession = vi.fn(async (input: { automaticTarget?: TargetRecord; signal?: AbortSignal }) => {
    const id = input.automaticTarget!.id;
    if (id === sessionFailureAt) throw new Error("provider unavailable");
    return { sessionId: `session_${id}`, sessionCode: id, state: "Revealed" as const, transcript: id };
  });
  const postReview = vi.fn(async (input: { afterViewerReview?: (review: { content: string; transcript: string; response: { content: string; usage: {} } }) => Promise<void> }) => {
    await input.afterViewerReview?.({ content: "review", transcript: "review", response: { content: "review", usage: {} } });
    return "review";
  });
  const dependencies = {
    prepareViewerNotesForSession: vi.fn(async () => ({ enabled: true })),
    runAutomaticRvLiteSession: runSession,
    runAutomaticPostRevealReview: postReview,
    runViewerNoteReflection: reflect,
    runBlindJudging: vi.fn(async () => ({ scores: [], aggregate: null })),
  } as unknown as NonNullable<ExecuteTrainingRunInput["dependencies"]>;
  return { repository, updates, reflect, runSession, dependencies };
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
    postReview.mockImplementationOnce(async (request: { afterViewerReview?: (review: { content: string; transcript: string; response: { content: string; usage: {} } }) => Promise<void> }) => {
      await request.afterViewerReview?.({ content: "review", transcript: "review", response: { content: "review", usage: {} } });
      controller.abort();
      return "review";
    });
    const outcome = await executeTrainingRun(input(run(), testHarness, { signal: controller.signal }));
    expect(outcome.run.status).toBe("Interrupted");
    expect(outcome.run.completedTargetIds).toEqual([]);
    expect(testHarness.repository.updateRvSessionState).not.toHaveBeenCalledWith("session_t1", "Completed");
  });
});
