import type { TrainingCategory } from "../targets/bundled";
import type { GenerationSettings } from "../providers/types";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";

export type TrainingRunStatus = "Planned" | "Running" | "Paused" | "Interrupted" | "Completed";

export type TrainingTargetStage = "session_revealed" | "review_completed" | "judging_completed";

export interface TrainingTargetCheckpoint {
  targetId: string;
  sessionId: string;
  stage: TrainingTargetStage;
}

export interface TrainingExecutionSnapshot {
  language: InterfaceLanguage;
  generationSettings: GenerationSettings;
  transport: {
    maxRetries: number;
    requestTimeoutMs: number;
    sessionCodePrefix: string;
    maxSessionCostUsd: number;
  };
  rvSystemPrompt?: ViewerSystemPromptSnapshot;
}

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
  /** Frozen at creation (or the first resume of a legacy run). */
  executionSnapshot?: TrainingExecutionSnapshot;
  /** Durable sub-target checkpoint used to resume without repeating completed AI work. */
  activeTargetCheckpoint?: TrainingTargetCheckpoint | null;
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
  executionSnapshot?: TrainingExecutionSnapshot;
  activeTargetCheckpoint?: TrainingTargetCheckpoint | null;
  directoryPath?: string;
  actualCostUsd?: number;
  error?: string;
  completedAt?: string;
}
