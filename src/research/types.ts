import type { FrozenAnalyticalOutputPolicy } from "../providers/outputRecovery";
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
  "context_instructions",
  "sampling",
  "target_code",
  "custom",
] as const;

export type ResearchTemplateType = (typeof RESEARCH_TEMPLATE_TYPES)[number];

/** Context & Instructions research contract. Runtime message application is enabled only in C3. */
export const RESEARCH_CONTEXT_BLOCK_KEYS = [
  "system_prompt", "viewer_notes", "viewer_identity", "base_vocabulary",
] as const;
export type ResearchContextBlockKey = (typeof RESEARCH_CONTEXT_BLOCK_KEYS)[number];

export type ResearchContextConditionDesign =
  | { version: 1; mode: "standard" }
  | { version: 1; mode: "replace_all"; content: string }
  | { version: 1; mode: "add_to_selected"; additions: Partial<Record<ResearchContextBlockKey, string>> };

export interface ResearchContextBaseBlock {
  /** Exact input, no trimming or fallback. Empty means absent, not a factory default. */
  content: string;
  source: string;
  version?: string;
  /** Must explicitly distinguish unavailable from disabled. */
  availability: "available" | "unavailable" | "disabled";
}

export interface ResearchContextFrozenBlock {
  content: string;
  sha256: string;
  enabled: boolean;
  source: string;
  version?: string;
  availability: ResearchContextBaseBlock["availability"];
}

export interface ResearchContextApplicationMessage {
  role: "system";
  origin: ResearchContextBlockKey | "replace_all";
  content: string;
  sha256: string;
}

export interface ResearchFrozenContextComposition {
  version: 1;
  design: ResearchContextConditionDesign;
  baseBlocks: Record<ResearchContextBlockKey, ResearchContextFrozenBlock>;
  effectiveBlocks: Record<ResearchContextBlockKey, ResearchContextFrozenBlock>;
  /** Logical messages, NOT the final provider wire payload or protocol messages. */
  applicationMessages: ResearchContextApplicationMessage[];
  compositionSha256: string;
}

export interface ResearchPreparedContextDraft {
  version: 1;
  kind: "context_instructions_prepared";
  baseBlocks: Record<ResearchContextBlockKey, ResearchContextBaseBlock>;
  conditions: Array<{ id: string; label: string; composition: ResearchFrozenContextComposition }>;
  preparationSha256: string;
}

export type ResearchSamplingParameter = "topP" | "topK" | "seed";

export type ResearchSamplingAxis =
  | { mode: "fixed"; value?: number }
  | { mode: "varied"; values: number[] };

export interface ResearchSamplingDesign {
  version: 1;
  topP: ResearchSamplingAxis;
  topK: ResearchSamplingAxis;
  seed: ResearchSamplingAxis;
}

export interface ResearchSamplingConditionValues {
  topP?: number;
  topK?: number;
  seed?: number;
}

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


export interface ResearchViewerOutputPolicy {
  version: 1;
  initialTokens: number;
  recoveryTokens: number;
  preserveConfiguredBudget: boolean;
}

export interface ResearchConditionDefinition {
  targetCode?: import("../resources/rvLiteTargetCode").TargetCodePolicy;
  key: string;
  label: string;
  /** C1 reserved metadata. MUST NOT be used by runtime before C2/C3 integration. */
  contextDesign?: ResearchContextConditionDesign;
  contextComposition?: ResearchFrozenContextComposition;
  profileId: string;
  providerConfigId: string;
  modelId: string;
  requestedSettings: GenerationSettings;
  /** Frozen at Experiment Lock for new projects. Absent means legacy single-budget compatibility. */
  viewerOutputPolicy?: ResearchViewerOutputPolicy;
  effectiveSettings?: EffectiveGenerationSettings;
  capabilitySnapshot?: ModelCapabilities;
  systemPrompt?: ResearchSystemPromptSnapshot;
  conditionInstruction?: ResearchSystemPromptSnapshot;
  practiceOrder?: "FIRST" | "SECOND";
  customValue?: string;
  /** Structural sampler values for Sampling configurations; never parse these values from labels. */
  samplingValues?: ResearchSamplingConditionValues;
  /** Immutable Viewer Notes snapshot captured for and frozen by Experiment Lock. */
  viewerNotes?: ViewerNotesSessionSnapshot;
  /** Immutable trained Field Guide snapshot. Research never mutates it. */
  fieldGuide?: ResearchFieldGuideSnapshot;
  /** Makes manual prompt vs trained Field Guide provenance explicit in stored conditions. */
  promptSource?: "locked_only" | "active_field_guide" | "historical_field_guide" | "manual_research_prompt" | "legacy";
}

export interface ResearchJudgeDefinition {
  generationSettings?: import("../providers/types").GenerationSettings;
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
  /** Frozen common OpenRouter sampling inherited from the base Profile. Missing means legacy Research. */
  sampling?: { source: "profile" | "research"; profileId: string; mode?: "fixed" | "condition_variable"; topP?: number; topK?: number; seed?: number };
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
    /** Legacy v0.7.13 field; retained only for old locked-project compatibility and ignored by execution. */
    maxSessionCostUsd?: number;
    sessionCodePrefix: string;
  };
  viewerControl?: ResearchViewerControl;
  fieldGuideControl?: ResearchFieldGuideControl;
  viewerNotesControl?: ResearchViewerNotesControl;
  promptResearchSource?: ResearchPromptResearchSource;
  /** Versioned design metadata for the Sampling configurations template. */
  samplingDesign?: ResearchSamplingDesign;
  /** Frozen C2 design/manifest for Context & Instructions projects. */
  contextPreparation?: ResearchPreparedContextDraft;
  conditions: ResearchConditionDefinition[];
  evaluationMode?: "save_only" | "ai_judges";
  judges: ResearchJudgeDefinition[];
  /** Frozen for new projects; absent means the historical Judge 8K/16K contract. */
  judgeOutputPolicy?: FrozenAnalyticalOutputPolicy;
  /** Frozen independently of blind output; absent preserves the historical 16K/32K analysis. */
  postRevealOutputPolicy?: FrozenAnalyticalOutputPolicy;
  randomization: { matchedTargets: true; randomizedExecution: true; randomizedJudgeOrder: true };
}

export interface ResearchProjectRecord {
  /** Mutable execution marker outside Experiment Lock/config. Native stores it in reserved app_settings. */
  executionTermination?:import("./executionLifecycle").ResearchExecutionTermination;
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

export interface ResearchSessionExecutionMetadata {
  configuredProviderConfigId: string;
  configuredModelId: string;
  actualProviders?: string[];
  actualModels?: string[];
  generationIds?: string[];
  providerRequestIds?: string[];
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  requestDurationMs?: number;
  firstViewerResponseAt?: string;
  lastViewerResponseAt?: string;
  viewerCallCount: number;
}

export interface ResearchContextSessionAudit {
  mode: ResearchContextConditionDesign["mode"];
  additionTargets: ResearchContextBlockKey[];
  compositionSha256: string;
  logicalContextCharacters: number;
  logicalContextMessages: number;
  requestEvidence: {
    physicalAttempts: number;
    logicalRequests: number;
    transportRetries: number;
    recoveryAttempts: number;
    requestHashes: string[];
  };
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
  samplingValues?: ResearchSamplingConditionValues;
  requestedSettings?: GenerationSettings;
  effectiveSettings?: GenerationSettings;
  providerConfigId?: string;
  modelId?: string;
  execution?: ResearchSessionExecutionMetadata;
  /** Context & Instructions provenance and execution evidence, when applicable. */
  contextAudit?: ResearchContextSessionAudit;
  /** Exact frozen Field Guide provenance used by this session, when enabled. */
  fieldGuideVersionId?: string;
  fieldGuideVersionNumber?: number;
  fieldGuideContentSha256?: string;
}

export interface ConditionStatistics {
  conditionKey: string;
  label: string;
  contextMode?: ResearchContextConditionDesign["mode"];
  contextAdditionTargets?: ResearchContextBlockKey[];
  compositionSha256?: string;
  logicalContextCharacters?: number;
  logicalContextMessages?: number;
  plannedN?: number;
  completionRate?: number;
  samplingValues?: ResearchSamplingConditionValues;
  requestedSettings?: GenerationSettings;
  effectiveSettings?: GenerationSettings;
  providerConfigId?: string;
  modelId?: string;
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
  targetCodeComparison?: import("./targetCodeResults").TargetCodeComparison;
  schemaVersion: 1;
  projectId: string;
  templateType: ResearchTemplateType;
  sessions: UnblindedSessionResult[];
  conditions: ConditionStatistics[];
  pairwise: PairwiseStatistics[];
  computedAt: string;
}
