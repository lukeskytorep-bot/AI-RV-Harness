import { describe, expect, it, vi } from "vitest";
import { serializePostRevealTurn } from "../../sessions/postRevealTranscript";
import { supportedAutomaticPostRevealReviewRequests } from "../../sessions/postReveal";
import type { TrainingRunRecord } from "../../training/types";
import type { AppRepository } from "../../storage/repository";
import { prepareTrainingRunResume } from "./trainingResumeRecovery";

function run(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    id: "run-1", runNumber: 1, name: "Training", status: "Interrupted", mode: "partial",
    profileId: "p", workspaceId: "w", modelRoute: "route", protocolVariant: "extended",
    targetIds: ["t"], completedTargetIds: [], sessionIds: ["s"], currentIndex: 0,
    categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: true,
    activeTargetCheckpoint: { targetId: "t", sessionId: "s", stage: "session_revealed" },
    executionSnapshot: { language: "en", generationSettings: {}, transport: { maxRetries: 1, requestTimeoutMs: 1000, sessionCodePrefix: "T" } },
    errors: [], createdAt: "now", updatedAt: "now",
    ...overrides,
  } as TrainingRunRecord;
}

function repository(transcript = "") {
  const events: Array<Record<string, unknown>> = [{ id: "e1", sessionId: "s", sequenceNumber: 1, eventType: "POST_REVEAL_REVIEW_CHECKPOINT", role: "controller", content: null, metadata: { stage: "viewer", status: "uncertain", attempt: 1 }, createdAt: "now" }];
  const repo = {
    _events: events,
    listTrainingRuns: vi.fn(async () => [run()]),
    getRvSession: vi.fn(async () => ({ id: "s", postRevealTranscript: transcript })),
    listSessionEvents: vi.fn(async () => events),
    getSessionSnapshot: vi.fn(async () => ({ monitor: null })),
    appendSessionEvent: vi.fn(async (_sessionId: string, event: Record<string, unknown>) => { events.push({ ...event, createdAt: "later" }); }),
    withPostRevealReviewLease: vi.fn(async <T>(_sessionId: string, task: () => Promise<T>) => task()),
  };
  return repo;
}

describe("Training uncertain Viewer Review Resume", () => {
  it("does not mutate the checkpoint when the operator cancels", async () => {
    const repo = repository();
    const confirm = vi.fn(async () => false);
    const result = await prepareTrainingRunResume({ repository: repo as never, runId: "run-1", fallbackLanguage: "en", confirmUncertainViewerReview: confirm });
    expect(result).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(repo.appendSessionEvent).not.toHaveBeenCalled();
    expect(repo.withPostRevealReviewLease).not.toHaveBeenCalled();
  });

  it("persists the decision under the existing post-Reveal lease before retry is allowed", async () => {
    const repo = repository();
    const result = await prepareTrainingRunResume({ repository: repo as never, runId: "run-1", fallbackLanguage: "en", confirmUncertainViewerReview: async () => true });
    expect(result?.id).toBe("run-1");
    expect(repo.withPostRevealReviewLease).toHaveBeenCalledWith("s", expect.any(Function));
    expect(repo.appendSessionEvent).toHaveBeenCalledWith("s", expect.objectContaining({ metadata: expect.objectContaining({ stage: "viewer", status: "failed", attempt: 1 }) }));
  });


  it("does not apply an old confirmation to a newer uncertain Viewer Review attempt", async () => {
    const repo = repository();
    const confirm = vi.fn(async () => {
      repo._events.push({ id: "e2", sessionId: "s", sequenceNumber: 2, eventType: "POST_REVEAL_REVIEW_CHECKPOINT", role: "controller", content: null, metadata: { stage: "viewer", status: "uncertain", attempt: 2 }, createdAt: "later" });
      return true;
    });
    await expect(prepareTrainingRunResume({ repository: repo as never, runId: "run-1", fallbackLanguage: "en", confirmUncertainViewerReview: confirm })).rejects.toThrow("newer attempt was not resolved");
    expect(repo.appendSessionEvent).not.toHaveBeenCalled();
  });

  it("recovers a Viewer Review that completed while the confirmation dialog was open", async () => {
    const repo = repository();
    const request = supportedAutomaticPostRevealReviewRequests("en")[0];
    const transcript = `${serializePostRevealTurn("user", request)}${serializePostRevealTurn("assistant", "complete review")}`;
    const confirm = vi.fn(async () => {
      repo.getRvSession.mockResolvedValue({ id: "s", postRevealTranscript: transcript });
      return true;
    });
    const result = await prepareTrainingRunResume({ repository: repo as never, runId: "run-1", fallbackLanguage: "en", confirmUncertainViewerReview: confirm });
    expect(result?.id).toBe("run-1");
    expect(repo.appendSessionEvent).not.toHaveBeenCalled();
  });

  it("recovers a completed Viewer Review without asking or retrying", async () => {
    const request = supportedAutomaticPostRevealReviewRequests("en")[0];
    const transcript = `${serializePostRevealTurn("user", request)}${serializePostRevealTurn("assistant", "complete review")}`;
    const repo = repository(transcript);
    const confirm = vi.fn(async () => true);
    const result = await prepareTrainingRunResume({ repository: repo as never, runId: "run-1", fallbackLanguage: "en", confirmUncertainViewerReview: confirm });
    expect(result?.id).toBe("run-1");
    expect(confirm).not.toHaveBeenCalled();
    expect(repo.appendSessionEvent).not.toHaveBeenCalled();
  });
  it("refuses a user-finished run before checkpoint analysis or confirmation", async () => {
    const terminal = run({
      status: "Interrupted",
      termination: { reason: "user_finished", endedAt: "2026-10-10T12:00:00.000Z" },
    });
    const repository = {
      listTrainingRuns: vi.fn(async () => [terminal]),
      getRvSession: vi.fn(),
      withPostRevealReviewLease: vi.fn(),
    } as unknown as AppRepository;
    const confirm = vi.fn(async () => true);
    await expect(prepareTrainingRunResume({ repository, runId: terminal.id, fallbackLanguage: "en", confirmUncertainViewerReview: confirm })).rejects.toThrow("ended by the user");
    expect(repository.getRvSession).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

});
