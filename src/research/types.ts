import type { JudgeComponentScores } from "../domain/scoring";
import type { EffectiveGenerationSettings, GenerationSettings, ModelCapabilities } from "../providers/types";
import type { InterfaceLanguage } from "../types";

export const RESEARCH_TEMPLATE_TYPES = [
  "reasoning",
  "temperature",
  "profile",
  "model",
  "practice",
  "system_prompt",
  "custom",
] as const;

export type ResearchTemplateType = (typeof RESEARCH_TEMPLATE_TYPES)[number];
export type ResearchState = "Draft" | "Preflight" | "Locked" | "Running" | "SessionsComplete" | "Judging" | "ScoresFrozen" | "Unblinded" | "Complete" | "Interrupted" | "Failed";

export interface ResearchSystemPromptSnapshot {
  id: string;
  version: string;
  content: string;
  contentSha256: string;
}

export interface ResearchConditionDefinition {
  key: string;
  label: string;
  profileId: string;
  providerConfigId: string;
  modelId: string;
  requestedSettings: GenerationSettings;
  effectiveSettings?: EffectiveGenerationSettings;
  capabilitySnapshot?: ModelCapabilities;
  systemPrompt?: ResearchSystemPromptSnapshot;
  practiceOrder?: "FIRST" | "SECOND";
  customValue?: string;
}

export interface ResearchJudgeDefinition {
  providerConfigId: string;
  modelId: string;
}

export interface ResearchConfig {
  schemaVersion: 1;
  name: string;
  workspaceId: string;
  templateType: ResearchTemplateType;
  sessionLanguage: InterfaceLanguage;
  protocol: { id: "full-rcp"; version: "1.5a" };
  targetIds: string[];
  repetitions: number;
  requireUnusedTargets: boolean;
  sessionPolicy?: {
    requestTimeoutMs: number;
    maxRetries: number;
    defaultMaxOutputTokens: number;
    maxSessionCostUsd: number;
    sessionCodePrefix: string;
  };
  conditions: ResearchConditionDefinition[];
  judges: ResearchJudgeDefinition[];
  randomization: { matchedTargets: true; randomizedExecution: true; randomizedJudgeOrder: true };
}

export interface ResearchProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  templateType: ResearchTemplateType;
  state: ResearchState;
  config: ResearchConfig;
  configHash?: string;
  lockedAt?: string;
  scoresFrozenAt?: string;
  unblindedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchConditionRecord {
  id: string;
  researchProjectId: string;
  conditionKey: string;
  config: ResearchConditionDefinition;
}

export interface ResearchAssignmentRecord {
  id: string;
  researchProjectId: string;
  anonymousSessionId: string;
  sessionId?: string;
  targetId: string;
  executionOrder: number;
  judgeOrder: number;
  status: string;
}

export interface BlindingMappingRecord {
  id: string;
  researchProjectId: string;
  anonymousSessionId: string;
  conditionId: string;
  pairKey: string;
  pairOrder?: string;
  mappingHash: string;
  createdAt: string;
}

export interface ResearchLockPlan {
  configHash: string;
  conditions: ResearchConditionRecord[];
  assignments: ResearchAssignmentRecord[];
  mappings: BlindingMappingRecord[];
}

export interface PreflightCheck {
  id: string;
  level: "pass" | "warning" | "fail";
  message: string;
}

export interface ResearchPreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  estimatedCostUsd?: number;
  estimatedViewerCalls: number;
  estimatedJudgeCalls: number;
}

export interface UnblindedSessionResult extends JudgeComponentScores {
  anonymousSessionId: string;
  sessionId: string;
  targetId: string;
  pairKey: string;
  conditionKey: string;
  conditionLabel: string;
  total: number;
  judgeCount: number;
  judgeTotalRange: number;
  judgeTotalStdDev: number;
}

export interface ConditionStatistics {
  conditionKey: string;
  label: string;
  n: number;
  meanTotal: number;
  medianTotal: number;
  stdDevTotal: number;
  minTotal: number;
  maxTotal: number;
  meanComponents: JudgeComponentScores;
}

export interface PairwiseStatistics {
  conditionA: string;
  conditionB: string;
  pairedN: number;
  winsA: number;
  ties: number;
  winsB: number;
  meanPairedDifference: number;
}

export interface ResearchResults {
  schemaVersion: 1;
  projectId: string;
  templateType: ResearchTemplateType;
  sessions: UnblindedSessionResult[];
  conditions: ConditionStatistics[];
  pairwise: PairwiseStatistics[];
  computedAt: string;
}
