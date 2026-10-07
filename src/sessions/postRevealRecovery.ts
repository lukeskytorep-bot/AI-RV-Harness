import type { AppRepository } from "../storage/repository";
import { parsePostRevealTranscript } from "./postRevealTranscript";

export type PostRevealReviewStage = "viewer" | "monitor";
export type PostRevealReviewStatus = "pending" | "dispatched" | "completed" | "failed" | "uncertain";

export interface PostRevealReviewCheckpoint {
  stage: PostRevealReviewStage;
  status: PostRevealReviewStatus;
  attempt: number;
  updatedAt: string;
  message?: string;
}

export interface PostRevealReviewRecoveryState {
  viewer: PostRevealReviewCheckpoint | null;
  monitor: PostRevealReviewCheckpoint | null;
  nextStage: PostRevealReviewStage | null;
  requiresDecision: boolean;
  resumable: boolean;
  completed: boolean;
}

const EVENT_TYPE = "POST_REVEAL_REVIEW_CHECKPOINT";

function isStage(value: unknown): value is PostRevealReviewStage {
  return value === "viewer" || value === "monitor";
}

function isStatus(value: unknown): value is PostRevealReviewStatus {
  return value === "pending" || value === "dispatched" || value === "completed" || value === "failed" || value === "uncertain";
}

export function latestPostRevealReviewCheckpoints(events: Awaited<ReturnType<AppRepository["listSessionEvents"]>>): {
  viewer: PostRevealReviewCheckpoint | null;
  monitor: PostRevealReviewCheckpoint | null;
} {
  const result: { viewer: PostRevealReviewCheckpoint | null; monitor: PostRevealReviewCheckpoint | null } = { viewer: null, monitor: null };
  for (const event of events) {
    if (event.eventType !== EVENT_TYPE) continue;
    const stage = event.metadata?.stage;
    const status = event.metadata?.status;
    if (!isStage(stage) || !isStatus(status)) continue;
    const checkpoint: PostRevealReviewCheckpoint = {
      stage,
      status,
      attempt: typeof event.metadata?.attempt === "number" ? event.metadata.attempt : 1,
      updatedAt: event.createdAt,
      ...(typeof event.metadata?.message === "string" ? { message: event.metadata.message } : {}),
    };
    result[stage] = checkpoint;
  }
  return result;
}

export async function appendPostRevealReviewCheckpoint(input: {
  repository: Pick<AppRepository, "appendSessionEvent">;
  sessionId: string;
  stage: PostRevealReviewStage;
  status: PostRevealReviewStatus;
  attempt: number;
  message?: string;
}): Promise<void> {
  await input.repository.appendSessionEvent(input.sessionId, {
    eventType: EVENT_TYPE,
    role: "controller",
    metadata: {
      stage: input.stage,
      status: input.status,
      attempt: input.attempt,
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

export function hasPendingAutomaticViewerInstruction(transcript: string, request: string): boolean {
  const turns = parsePostRevealTranscript(transcript);
  const last = turns.at(-1);
  return Boolean(last?.role === "user" && last.content === request);
}

export async function getPostRevealReviewRecoveryState(
  repository: Pick<AppRepository, "listSessionEvents" | "getSessionSnapshot">,
  sessionId: string,
  completion?: { viewer?: boolean; monitor?: boolean },
): Promise<PostRevealReviewRecoveryState> {
  const [events, snapshot] = await Promise.all([
    repository.listSessionEvents(sessionId),
    repository.getSessionSnapshot(sessionId),
  ]);
  const checkpoints = latestPostRevealReviewCheckpoints(events);
  const viewer = completion?.viewer && checkpoints.viewer?.status !== "completed"
    ? { stage: "viewer" as const, status: "completed" as const, attempt: checkpoints.viewer?.attempt ?? 1, updatedAt: "" }
    : checkpoints.viewer;
  const monitorExpected = Boolean(snapshot?.monitor);
  const monitor = completion?.monitor && checkpoints.monitor?.status !== "completed"
    ? { stage: "monitor" as const, status: "completed" as const, attempt: checkpoints.monitor?.attempt ?? 1, updatedAt: "" }
    : checkpoints.monitor;

  const uncertainStage = viewer?.status === "uncertain" || viewer?.status === "dispatched"
    ? "viewer"
    : monitor?.status === "uncertain" || monitor?.status === "dispatched"
      ? "monitor"
      : null;
  const viewerDone = viewer?.status === "completed";
  const monitorDone = !monitorExpected || monitor?.status === "completed";
  const allCompleted = viewerDone && monitorDone;
  const nextStage = allCompleted ? null : uncertainStage ?? (!viewerDone ? "viewer" : monitorExpected ? "monitor" : null);

  return {
    viewer,
    monitor,
    nextStage,
    requiresDecision: Boolean(uncertainStage),
    resumable: Boolean(nextStage && !uncertainStage),
    completed: allCompleted,
  };
}

export async function resolveUncertainPostRevealReviewStage(input: {
  repository: Pick<AppRepository, "listSessionEvents" | "appendSessionEvent">;
  sessionId: string;
  stage: PostRevealReviewStage;
}): Promise<void> {
  const checkpoints = latestPostRevealReviewCheckpoints(await input.repository.listSessionEvents(input.sessionId));
  const current = checkpoints[input.stage];
  if (!current || (current.status !== "uncertain" && current.status !== "dispatched")) {
    throw new Error("The selected post-Reveal review stage is not awaiting an operator decision.");
  }
  await appendPostRevealReviewCheckpoint({
    repository: input.repository,
    sessionId: input.sessionId,
    stage: input.stage,
    status: "failed",
    attempt: current.attempt,
    message: "Operator resolved the uncertain attempt as failed; retry is now allowed.",
  });
}
