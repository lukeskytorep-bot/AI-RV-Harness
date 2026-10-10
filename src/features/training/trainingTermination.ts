import type { AppRepository } from "../../storage/repository";
import { canResumeOrEndTrainingRun, isTrainingRunUserFinished } from "../../training/runLifecycle";
import type { TrainingRunRecord } from "../../training/types";

export async function endTrainingRun(
  repository: AppRepository,
  runId: string,
  endedAt = new Date().toISOString(),
): Promise<TrainingRunRecord> {
  const current = (await repository.listTrainingRuns()).find((run) => run.id === runId);
  if (!current) throw new Error("Training run is no longer available.");
  if (isTrainingRunUserFinished(current)) return current;
  if (!canResumeOrEndTrainingRun(current)) throw new Error("This Training run cannot be ended in its current state.");

  await repository.updateTrainingRun(runId, {
    status: "Interrupted",
    termination: { reason: "user_finished", endedAt },
  });

  const persisted = (await repository.listTrainingRuns()).find((run) => run.id === runId);
  if (!persisted) throw new Error("Training run is no longer available after ending it.");
  if (!isTrainingRunUserFinished(persisted)) throw new Error("Training end marker was not persisted.");
  return persisted;
}
