import type { TrainingRunRecord } from "./types";

export const USER_FINISHED_TRAINING_REASON = "user_finished" as const;

export function isTrainingRunUserFinished(run: Pick<TrainingRunRecord, "termination">): boolean {
  return run.termination?.reason === USER_FINISHED_TRAINING_REASON;
}

export function isTrainingRunIncomplete(run: Pick<TrainingRunRecord, "status" | "currentIndex" | "targetIds">): boolean {
  return run.status !== "Completed" && run.currentIndex < run.targetIds.length;
}

export function canResumeOrEndTrainingRun(run: Pick<TrainingRunRecord, "termination" | "status" | "currentIndex" | "targetIds">): boolean {
  return !isTrainingRunUserFinished(run)
    && isTrainingRunIncomplete(run)
    && (run.status === "Paused" || run.status === "Interrupted" || run.status === "Running");
}

export function userFinishedTrainingError(): Error {
  return new Error("Training run was ended by the user and cannot be resumed or executed.");
}
