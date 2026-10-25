import type { JudgeComponentScores } from "../domain/scoring";
import type { EffectiveGenerationSettings, GenerationSettings, ModelCapabilities } from "../providers/types";
import type { InterfaceLanguage, ViewerSystemPromptSnapshot } from "../types";
import type { ViewerNotesSessionSnapshot } from "../aiCenter/types";
import type { FieldGuideSessionSnapshot, FieldGuideSourceSnapshot } from "../aiCenter/fieldGuideTypes";
import type { ProviderKind } from "../providers/types";
import type { ResearchTargetSelectionMode, ResearchTargetSource } from "./targetSelection";

export const RESEARCH_TEMPLATE_TYPES = [
  "reasoning",
  "temperature",
  "profile",
  "model",
  "practice",
  "system_prompt",
  "viewer_notes",
  "custom",
] as const;

export type ResearchTemplateType = (typeof RESEARCH_TEMPLATE_TYPES)[number];
export type ResearchState = "Draft" | "Preflight" | "Locked" | "Running" | "SessionsComplete" | "Judging" | "ScoresFrozen" | "Unblinded" | "Complete" | "Interrupted" | "Failed";

export type ResearchSystemPromptSnapshot = ViewerSystemPromptSnapshot;

export type ResearchFieldGuideMode = "off" | "current" | "history";
export type ResearchFieldGuideSource = "none" | "active" | "history";
export type ResearchPromptResearchSource = "manual" | "field_guide_history";

export interface ResearchFieldGuideIdentitySnapshot {
  aiIdentityId: string;
  profileId: string;
  credentialFingerprint: string;
  providerConfigId: string;
  provider: ProviderKind;
  normalizedBaseUrl?: string;
  modelId: string;
  modelRoute: string;
}

export interface ResearchFieldGuideSnapshot extends FieldGuideSessionSnapshot {
  versionCreatedAt: string;
  capacityTokensAtCreation: 2048 | 4096 | 8192;
  sourceTrainingRunId?: string;
  sourceSessionId?: string;
  sourceSnapshot: FieldGuideSourceSnapshot;
  identity: ResearchFieldGuideIdentitySnapshot;
}

export interface ResearchFieldGuideControl {
  mode: ResearchFieldGuideMode;
  source: ResearchFieldGuideSource;
  language: InterfaceLanguage;
  lockedCoreIdentityVersion: string;
  lockedBaseVocabularyVersion: string;
  identityId?: string;
  selectedVersionIds?: string[];
}

export interface ResearchViewerNotesControl {
  mode: "off" | "current" | "experiment";
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
  conditionInstruction?: ResearchSystemPromptSnapshot;
  practiceOrder?: "FIRST" | "SECOND";
  customValue?: string;
  /** Immutable Viewer Notes snapshot captured for and frozen by Experiment Lock. */
  viewerNotes?: ViewerNotesSessionSnapshot;
  /** Immutable trained Field Guide snapshot. Research never mutates it. */
  fieldGuide?: ResearchFieldGuideSnapshot;
  /** Makes manual prompt vs trained Field Guide provenance explicit in stored conditions. */
  promptSource?: "locked_only" | "active_field_guide" | "historical_field_guide" | "manual_research_prompt" | "legacy";
}

export interface ResearchJudgeDefinition {
  providerConfigId: string;
  modelId: string;
}

export interface ResearchViewerControl {
  model: { mode: "fixed" | "condition_variable"; modelId?: string };
  systemPrompt: {
    mode: "fixed" | "condition_variable";
    source?: "profile" | "custom" | "locked_only" | "field_guide_current" | "field_guide_history" | "research_manual";
    contentSha256?: string;
  };
  reasoning: {
    mode: "provider_default" | "fixed" | "condition_variable";
    value?: GenerationSettings["reasoningEffort"];
  };
  temperature: {
    mode: "provider_default" | "fixed" | "condition_variable";
    value?: number;
  };
  maxOutputTokens: number;
}

export type ResearchProtocolSelection =
  | { id: "full-rcp"; version: "1.5a"; contentSha256?: string }
  | { id: "rv-lite"; version: "1.1.0"; variant: "extended"; contentSha256: string };

export interface ResearchConfig {
  schemaVersion: 1;
  name: string;
  workspaceId: string;
  templateType: ResearchTemplateType;
  sessionLanguage: InterfaceLanguage;
  protocol: ResearchProtocolSelection;
  targetIds: string[];
  targetSelection?: { source: ResearchTargetSource; mode: ResearchTargetSelectionMode; requestedCount?: number };
  repetitions: number;
  requireUnusedTargets: boolean;
  sessionPolicy?: {
    requestTimeoutMs: number;
    maxRetries: number;
    defaultMaxOutputTokens: number;
    maxSessionCostUsd: number;
    sessionCodePrefix: string;
  };
  viewerControl?: ResearchViewerControl;
  fieldGuideControl?: ResearchFieldGuideControl;
  viewerNotesControl?: ResearchViewerNotesControl;
  promptResearchSource?: ResearchPromptResearchSource;
  conditions: ResearchConditionDefinition[];
  evaluationMode?: "save_only" | "ai_judges";
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
  archivedAt?: string;
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
  /** Exact frozen Field Guide provenance used by this session, when enabled. */
  fieldGuideVersionId?: string;
  fieldGuideVersionNumber?: number;
  fieldGuideContentSha256?: string;
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
