import type { TrainingCategory } from "../targets/bundled";
import type { GenerationSettings } from "../providers/types";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import type { FieldGuideUpdateAuditRecord } from "../aiCenter/fieldGuideTypes";

export type TrainingRunStatus = "Planned" | "Running" | "Paused" | "Interrupted" | "Completed";

export type TrainingTargetStage = "session_revealed" | "review_completed" | "field_guide_update_completed" | "viewer_notes_reflection_completed" | "judging_completed";

export interface TrainingTargetCheckpoint {
  targetId: string;
  sessionId: string;
  stage: TrainingTargetStage;
  /** Stable input packet hash for the completed shared post-Reveal Review. */
  postRevealReviewPacketSha256?: string;
  /** Stable Field Guide Update packet hash when the stage is applicable. */
  fieldGuideUpdatePacketSha256?: string;
  /** Existing Viewer Notes reflection packet hash when Viewer Notes are enabled. */
  viewerNotesReflectionPacketSha256?: string;
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
  /** Durable audit trail for per-session Field Guide Update decisions. */
  fieldGuideUpdates?: FieldGuideUpdateAuditRecord[];
  directoryPath?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  errors: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  archivedAt?: string;
}

export type CreateTrainingRunInput = Omit<TrainingRunRecord, "id" | "runNumber" | "createdAt" | "updatedAt" | "completedTargetIds" | "sessionIds" | "currentIndex" | "errors">;

export interface UpdateTrainingRunInput {
  status?: TrainingRunStatus;
  completedTargetIds?: string[];
  sessionIds?: string[];
  currentIndex?: number;
  executionSnapshot?: TrainingExecutionSnapshot;
  activeTargetCheckpoint?: TrainingTargetCheckpoint | null;
  fieldGuideUpdates?: FieldGuideUpdateAuditRecord[];
  directoryPath?: string;
  actualCostUsd?: number;
  error?: string;
  completedAt?: string;
}
