import type { TrainingCategory } from "../targets/bundled";

export type TrainingRunStatus = "Planned" | "Running" | "Paused" | "Interrupted" | "Completed";

export interface TrainingRunRecord {
  id: string;
  runNumber: number;
  name: string;
  status: TrainingRunStatus;
  mode: "full" | "partial";
  profileId: string;
  workspaceId: string;
  modelRoute: string;
  protocolVariant: "core" | "extended";
  curriculumId?: string;
  curriculumVersion?: string;
  targetIds: string[];
  completedTargetIds: string[];
  /** Session ids follow the same order as completedTargetIds. */
  sessionIds: string[];
  currentIndex: number;
  categories: TrainingCategory[];
  judgeModelRoutes: string[];
  pauseAfterBlock: boolean;
  viewerNotesEnabled?: boolean;
  directoryPath?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  errors: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type CreateTrainingRunInput = Omit<TrainingRunRecord, "id" | "runNumber" | "createdAt" | "updatedAt" | "completedTargetIds" | "sessionIds" | "currentIndex" | "errors">;

export interface UpdateTrainingRunInput {
  status?: TrainingRunStatus;
  completedTargetIds?: string[];
  sessionIds?: string[];
  currentIndex?: number;
  directoryPath?: string;
  actualCostUsd?: number;
  error?: string;
  completedAt?: string;
}
