import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../../training/types";

/** Internal persistence contract for Training run state, checkpoints and execution snapshots. */
export interface TrainingRepository {
  createTrainingRun(input: CreateTrainingRunInput): Promise<TrainingRunRecord>;
  updateTrainingRun(id: string, input: UpdateTrainingRunInput): Promise<void>;
  listTrainingRuns(): Promise<TrainingRunRecord[]>;
}
