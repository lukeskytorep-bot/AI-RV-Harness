import type { EffectiveGenerationSettings, ProviderKind } from "../providers/types";

export type AiRole = "viewer" | "monitor" | "judge";
export type AiRouteStatus = "available" | "unavailable";
export type ViewerNoteCapacity = 1024 | 2048 | 4096 | 8192;
export type ViewerNoteExperimentalStatus = "experimental";
export type ViewerNoteReflectionStatus =
  | "PENDING"
  | "UPDATE"
  | "NO_CHANGE"
  | "FAILED_PROVIDER"
  | "FAILED_PARSE"
  | "FAILED_SCHEMA"
  | "FAILED_CAPACITY"
  | "FAILED_OUTPUT_PREFLIGHT"
  | "FAILED_MEMORY_SAFETY"
  | "STALE_BASE"
  | "BLOCKED_RESEARCH_LOCK";

export interface AiIdentity {
  id: string;
  profileId: string;
  credentialFingerprint: string;
  credentialDisplay: string;
  providerConfigId: string;
  provider: ProviderKind;
  normalizedBaseUrl?: string;
  modelId: string;
  modelRoute: string;
  modelDisplayName: string;
  role: AiRole;
  routeStatus: AiRouteStatus;
  firstUsedAt: string;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnsureAiIdentityInput {
  profileId: string;
  credentialFingerprint: string;
  credentialDisplay: string;
  providerConfigId: string;
  provider: ProviderKind;
  baseUrl?: string;
  modelId: string;
  modelRoute: string;
  modelDisplayName: string;
  role: AiRole;
}

export interface ViewerNoteSettings {
  aiIdentityId: string;
  noteType: "viewer_self_notes";
  capacityTokens: ViewerNoteCapacity;
  defaultEnabled: boolean;
  activeVersionId?: string;
  experimentalStatus: ViewerNoteExperimentalStatus;
  updatedAt: string;
}

export interface ViewerNoteVersion {
  id: string;
  aiIdentityId: string;
  versionNumber: number;
  content: string;
  contentSha256: string;
  estimatedTokens: number;
  estimatorVersion: "conservative-char-v1";
  capacityTokensAtCreation: ViewerNoteCapacity;
  sourceSessionId: string;
  sourceWorkspaceId: string;
  protocolId: string;
  sessionRunType: string;
  changeSummary: string;
  baseVersionId?: string;
  baseContentSha256?: string;
  reflectionRunId: string;
  reflectionPacketSha256: string;
  modelRouteSnapshot: string;
  generationSettingsSnapshot: EffectiveGenerationSettings;
  upstreamProviderSnapshot?: string;
  createdAt: string;
}

export interface ViewerNoteActivationEvent {
  id: string;
  aiIdentityId: string;
  fromVersionId?: string;
  toVersionId: string;
  activationSource: "model_update" | "model_confirmed" | "human_restore" | "initial_version";
  workspaceId?: string;
  sourceSessionId?: string;
  createdAt: string;
}

export interface ViewerNoteReflectionRun {
  id: string;
  aiIdentityId: string;
  noteType: "viewer_self_notes";
  sourceSessionId: string;
  sourceWorkspaceId: string;
  baseVersionId?: string;
  baseContentSha256?: string;
  reflectionPacketSha256: string;
  packetJson: string;
  attemptCount: number;
  status: ViewerNoteReflectionStatus;
  providerRequestId?: string;
  rawFinalResponseSha256?: string;
  changeSummary?: string;
  failureMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ViewerNoteBundle {
  identity: AiIdentity;
  settings: ViewerNoteSettings;
  activeVersion?: ViewerNoteVersion;
  versions: ViewerNoteVersion[];
  activationEvents: ViewerNoteActivationEvent[];
  reflectionRuns: ViewerNoteReflectionRun[];
}

export interface ViewerNotesSessionSnapshot {
  enabled: boolean;
  aiIdentityId: string;
  noteType: "viewer_self_notes";
  versionId?: string;
  versionNumber?: number;
  content: string;
  contentSha256: string;
  estimatedTokens: number;
  estimatorVersion: "conservative-char-v1";
  capacityTokens: ViewerNoteCapacity;
  modelRoute: string;
  capturedAt: string;
}

export interface BeginViewerNoteReflectionInput {
  id: string;
  aiIdentityId: string;
  sourceSessionId: string;
  sourceWorkspaceId: string;
  baseVersionId?: string;
  baseContentSha256?: string;
  reflectionPacketSha256: string;
  packetJson: string;
}

export interface CommitViewerNoteReflectionInput {
  runId: string;
  aiIdentityId: string;
  sourceSessionId: string;
  sourceWorkspaceId: string;
  baseVersionId?: string;
  baseContentSha256?: string;
  decision: "UPDATE" | "NO_CHANGE";
  notes?: string;
  contentSha256?: string;
  estimatedTokens?: number;
  capacityTokens: ViewerNoteCapacity;
  protocolId: string;
  sessionRunType: string;
  changeSummary: string;
  reflectionPacketSha256: string;
  modelRouteSnapshot: string;
  generationSettingsSnapshot: EffectiveGenerationSettings;
  providerRequestId?: string;
  rawFinalResponseSha256: string;
}

export interface ViewerNoteReflectionResult {
  status: "UPDATE" | "NO_CHANGE" | "STALE_BASE";
  version?: ViewerNoteVersion;
}
