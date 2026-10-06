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
  contentSha256: string;
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
  schemaVersion: 1;
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
  blockedReason?: string;
}

export interface TelepathicSeriesState {
  schemaVersion: 1;
  config: TelepathicSeriesConfig;
  plan: TelepathicSeriesPlan;
  currentRoundIndex: number;
  status: "ready" | "running" | "paused" | "completed" | "cancelled" | "blocked";
  rounds: TelepathicRoundState[];
  providerCalls: TelepathicProviderCallRecord[];
  finalReflections: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
