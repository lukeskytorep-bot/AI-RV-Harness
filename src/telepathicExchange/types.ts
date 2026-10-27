import type { TelepathicRecoveryPolicy } from "./recovery";
import type { ProviderCallErrorDetails } from "../providers/providerError";
import type { ProviderResponseEvidence } from "../providers/responseEvidence";
import type { TelepathicOutputBudgetSnapshot, TelepathicOutputDiagnostics } from "./outputBudgets";
import type { ProviderUsage, ProviderMessage, EffectiveGenerationSettings } from "../providers/types";
import type { ProviderContinuationState } from "../providers/continuationContract";

export type TelepathicLanguage = "pl" | "en";
export type TelepathicMode = "conversation_exchange" | "ai_ai_training";
export type TelepathicParticipantKind = "human" | "ai";
export type TelepathicRole = "sender" | "receiver";
export type TelepathicTopic =
  | "location"
  | "structure_or_object"
  | "human_or_machine_activity"
  | "event"
  | "person"
  | "any";

export interface TelepathicAiRouteSnapshot {
  profileId: string;
  profileName: string;
  workspaceId: string;
  aiIdentityId: string;
  providerConfigId: string;
  credentialId: string;
  credentialFingerprint: string;
  modelId: string;
  route: string;
}

export interface TelepathicLearningSnapshotRef {
  id: string;
  version: string;
  versionNumber?: number;
  contentSha256: string;
  content?: string;
  capturedAt?: string;
  profileId?: string;
  aiIdentityId?: string;
  modelRoute?: string;
  language?: TelepathicLanguage;
  estimatedTokens?: number;
}

export interface TelepathicParticipant {
  id: string;
  kind: TelepathicParticipantKind;
  displayName: string;
  ai?: TelepathicAiRouteSnapshot;
  fieldGuide?: TelepathicLearningSnapshotRef;
  viewerNotes?: TelepathicLearningSnapshotRef;
}

export type TelepathicSenderPolicy =
  | { kind: "rotate" }
  | { kind: "human_only"; humanParticipantId: string }
  | { kind: "fixed_ai"; participantId: string };

export interface TelepathicSeriesConfig {
  recoveryPolicy?: TelepathicRecoveryPolicy;
  schemaVersion: 1;
  protocolVersion?: "fixed_lead_v1";
  leadInstructionVersion?: string;
  outputBudgetPolicyVersion?: 2 | 3 | 4;
  leadInstruction?: string;
  maxGuidanceCycles?: 3;
  seriesId: string;
  seriesWorkspaceId: string;
  mode: TelepathicMode;
  language: TelepathicLanguage;
  participants: TelepathicParticipant[];
  roundCount: number;
  topic: TelepathicTopic;
  discloseTopicToReceivers: boolean;
  senderPolicy: TelepathicSenderPolicy;
}

export interface TelepathicRoundAssignment {
  roundId: string;
  roundNumber: number;
  senderParticipantId: string;
  receiverParticipantIds: string[];
  targetGeography?: TelepathicTargetGeography;
}

export interface TelepathicSeriesPlan {
  schemaVersion: 1;
  seriesId: string;
  seriesWorkspaceId: string;
  mode: TelepathicMode;
  rounds: TelepathicRoundAssignment[];
}

export type TelepathicTargetStatus = "draft" | "locked" | "transmission_ready";

export interface TelepathicTargetAsset {
  artifactId: string;
  kind: "image";
  originalFileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  path?: string;
  shortDescription?: string;
}

export interface TelepathicTargetDraft {
  content: string;
  assets?: TelepathicTargetAsset[];
}

export interface TelepathicLockedTarget {
  schemaVersion: 1;
  roundId: string;
  senderParticipantId: string;
  content: string;
  assets: TelepathicTargetAsset[];
  contentSha256: string;
  lockedAt: string;
  status: "locked" | "transmission_ready";
  transmissionReadyAt?: string;
}

export type BlindStageStatus =
  | "waiting"
  | "first_complete"
  | "second_complete"
  | "no_submission"
  | "sealed";

export interface TelepathicBlindSubmission {
  participantId: string;
  status: BlindStageStatus;
  first?: string;
  second?: string;
  guidanceResponses?: Array<{ cycle: 1 | 2 | 3; instruction: string; response: string }>;
  providerAttemptCount: number;
  sealedAt?: string;
  contentSha256?: string;
}

export interface TelepathicReflectionRecord {
  participantId: string;
  role: TelepathicRole;
  reflection?: string;
  shareOthersConsent?: "yes" | "no";
  sharedAnswersComment?: string;
}

export interface TelepathicReadableReasoningRecord {
  availability: "available" | "unavailable";
  text?: string;
}

export interface TelepathicContinuationRecord {
  availability: "available" | "unavailable";
  state?: ProviderContinuationState;
}

export interface TelepathicCompletedRoundForParticipant {
  roundNumber: number;
  role: TelepathicRole;
  target?: TelepathicLockedTarget;
  ownBlind?: TelepathicBlindSubmission;
  revealText: string;
  reflection?: string;
  othersAnswersShared?: string;
  postSharingComment?: string;
  reasoning?: TelepathicReadableReasoningRecord;
}

export interface TelepathicSeriesParticipantPacket {
  participantId: string;
  participantName: string;
  rounds: TelepathicCompletedRoundForParticipant[];
}

export interface TelepathicProviderScope {
  seriesId: string;
  roundId: string;
  participantId: string;
  callStage: string;
}

export function telepathicRoundScopeKey(scope: Pick<TelepathicProviderScope, "seriesId" | "roundId" | "participantId">): string {
  return `telepathic-series:${scope.seriesId}:round:${scope.roundId}:participant:${scope.participantId}`;
}

export function telepathicProviderScopeKey(scope: TelepathicProviderScope): string {
  return `${telepathicRoundScopeKey(scope)}:stage:${scope.callStage}`;
}


export type TelepathicProviderCallStatus = "prepared" | "dispatched" | "succeeded" | "failed" | "uncertain";

export interface TelepathicProviderCallRecord {
  responseEvidence?: ProviderResponseEvidence;
  transportFailure?: Pick<ProviderCallErrorDetails, "code" | "phase" | "retryAfterMs"> & { retryable: boolean; earlierAmbiguousAttempt?: boolean };
  recovery?: { action: "transport_retry" | "recovered_response" | "rejected_response" | "manual_resolution"; originalStatus: TelepathicProviderCallStatus; at: string };
  retryOfCallId?: string;
  manualRetryAuthorization?: { at: string; originalStatus: TelepathicProviderCallStatus };
  manualRetryOfCallId?: string;
  id: string;
  seriesId: string;
  roundId: string;
  participantId: string;
  callStage: string;
  technicalAttempt: number;
  status: TelepathicProviderCallStatus;
  scopeKey: string;
  requestSha256: string;
  providerRequestId?: string;
  responseText?: string;
  usage?: ProviderUsage;
  elapsedMs?: number;
  physicalAttempts?: number;
  costSource?: "provider" | "estimated" | "unknown";
  finishReason?: string;
  requestMessages?: ProviderMessage[];
  requestSettings?: EffectiveGenerationSettings;
  outputBudgetSnapshot?: TelepathicOutputBudgetSnapshot;
  outputDiagnostics?: TelepathicOutputDiagnostics;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelepathicRoundState {
  assignment: TelepathicRoundAssignment;
  status: "pending" | "preparing_target" | "blind" | "revealed" | "reflections" | "sharing" | "completed" | "cancelled" | "blocked";
  target?: TelepathicLockedTarget;
  blindByParticipant: Record<string, TelepathicBlindSubmission>;
  reflectionsByParticipant: Record<string, TelepathicReflectionRecord>;
  revealedAt?: string;
  completedAt?: string;
  guidance?: TelepathicGuidanceState;
  blockedReason?: string;
}

export interface TelepathicSeriesState {
  recoveryBlock?: { kind: "configuration"; message: string;
    validation?: { participantId: string; callStage: string; scopeKey: string; messages: ProviderMessage[] } };
  termination?: { reason: "user_finished"; endedAt: string };
  schemaVersion: 1;
  config: TelepathicSeriesConfig;
  plan: TelepathicSeriesPlan;
  currentRoundIndex: number;
  status: "ready" | "running" | "paused" | "completed" | "cancelled" | "blocked";
  rounds: TelepathicRoundState[];
  providerCalls: TelepathicProviderCallRecord[];
  transcript?: TelepathicTranscriptEvent[];
  finalization?: "pending" | "running" | "completed" | "blocked";
  activeElapsedMs?: number;
  archivedAt?: string;
  archiveRevision?: number;
  finalReflections: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface TelepathicTargetGeography {
  areaId: string;
  labelPl: string;
  labelEn: string;
  poolVersion: string;
}
export interface LegacyLeadGuidanceDecision {
  cycle: 1 | 2 | 3;
  finishRound: boolean;
  finishParticipantIds: string[];
  broadcast?: { recipientIds: string[]; instruction: string };
  individual?: Array<{ participantId: string; instruction: string }>;
}
/** New instructions have one addressed list; legacy broadcast stays read-only compatible. */
export interface LeadGuidanceDecision {
  cycle: 1 | 2 | 3;
  finishRound: boolean;
  finishParticipantIds: string[];
  individual: Array<{ participantId: string; instruction: string }>;
}
export type StoredLeadGuidanceDecision = LeadGuidanceDecision | LegacyLeadGuidanceDecision;
export interface TelepathicGuidanceState {
  decisions: StoredLeadGuidanceDecision[];
  finishedParticipantIds: string[];
  closed: boolean;
}
export interface TelepathicDisplayInstruction {
  version: 1;
  instruction: string;
}

export interface TelepathicTranscriptEvent {
  id: string;
  seriesId: string;
  roundId?: string;
  sequence: number;
  stage: string;
  kind: "instruction" | "materials" | "response" | "consent" | "reveal" | "reflection" | "notice";
  authorId: string;
  recipientIds: string[];
  text: string;
  providerCallId?: string;
  providerCallStatus?: TelepathicProviderCallRecord["status"];
  /** Durable validation reason; raw response stays in text and providerCalls. */
  decisionRejectionReason?: string;
  /** Exact human-readable prompt fragment; technical request remains in text/ledger. */
  display?: TelepathicDisplayInstruction;
  cycle?: 1 | 2 | 3;
  attachmentRefs?: string[];
  createdAt: string;
}
