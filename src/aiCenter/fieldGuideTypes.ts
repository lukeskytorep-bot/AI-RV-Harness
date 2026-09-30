export type FieldGuideLanguage = "pl" | "en";

export type FieldGuideCapacity = 2048 | 4096 | 8192;
export type FieldGuideSourceKind = "factory-baseline" | "legacy-profile-baseline" | "human-restore" | "training-reflection";
export type FieldGuideLegacyResolutionStatus = "unresolved" | "resolved" | "factory-equivalent";

export interface FieldGuideSettings {
  aiIdentityId: string;
  language: FieldGuideLanguage;
  capacityTokens: FieldGuideCapacity;
  activeVersionId?: string;
  updatedAt: string;
}

export interface FieldGuideIdentitySnapshot {
  aiIdentityId: string;
  profileId: string;
  credentialFingerprint: string;
  provider: string;
  normalizedBaseUrl?: string;
  modelId: string;
  modelRoute: string;
}

export interface FieldGuideSourceSnapshot {
  schemaVersion: 1;
  sourceKind: FieldGuideSourceKind;
  profileId: string;
  capturedAt: string;
  identitySnapshot?: FieldGuideIdentitySnapshot;
  sourceTrainingRunId?: string;
  sourceSessionId?: string;
  sourceSessionCode?: string;
  legacyBaselineId?: string;
  legacyProfileUpdatedAt?: string;
  restoredFromVersionId?: string;
  lexiconId?: string;
  lexiconVersion?: string;
  lexiconSha256?: string;
  fieldGuideUpdatePacketSha256?: string;
}

export interface FieldGuideVersion {
  id: string;
  aiIdentityId: string;
  language: FieldGuideLanguage;
  versionNumber: number;
  content: string;
  contentSha256: string;
  estimatedTokens: number;
  estimatorVersion: "conservative-char-v1";
  capacityTokensAtCreation: FieldGuideCapacity;
  activationStatus: "active" | "historical";
  sourceTrainingRunId?: string;
  sourceSessionId?: string;
  sourceSnapshot: FieldGuideSourceSnapshot;
  lexiconId?: string;
  lexiconVersion?: string;
  previousVersionId?: string;
  restoredFromVersionId?: string;
  createdAt: string;
}

export interface FieldGuideActivationEvent {
  id: string;
  aiIdentityId: string;
  language: FieldGuideLanguage;
  fromVersionId?: string;
  toVersionId: string;
  activationSource: "initial_version" | "legacy_profile_baseline" | "human_restore" | "training_reflection";
  createdAt: string;
}

export interface FieldGuideBundle {
  identityId: string;
  language: FieldGuideLanguage;
  settings: FieldGuideSettings;
  activeVersion?: FieldGuideVersion;
  versions: FieldGuideVersion[];
  activationEvents: FieldGuideActivationEvent[];
}

export interface FieldGuideSessionSnapshot {
  aiIdentityId: string;
  language: FieldGuideLanguage;
  versionId: string;
  versionNumber: number;
  content: string;
  contentSha256: string;
  estimatedTokens: number;
  estimatorVersion: "conservative-char-v1";
  capacityTokens: FieldGuideCapacity;
  modelRoute: string;
  capturedAt: string;
  sourceKind: FieldGuideSourceKind;
  lexiconId?: string;
  lexiconVersion?: string;
}

export interface FieldGuideLegacyBaseline {
  id: string;
  profileId: string;
  originalContent: string;
  sourceProfileUpdatedAt: string;
  resolutionStatus: FieldGuideLegacyResolutionStatus;
  resolvedAiIdentityId?: string;
  resolvedLanguage?: FieldGuideLanguage;
  resolvedVersionId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface CreateFieldGuideVersionInput {
  aiIdentityId: string;
  language: FieldGuideLanguage;
  content: string;
  contentSha256: string;
  estimatedTokens: number;
  sourceSnapshot: FieldGuideSourceSnapshot;
  sourceTrainingRunId?: string;
  sourceSessionId?: string;
  lexiconId?: string;
  lexiconVersion?: string;
  previousVersionId?: string;
  restoredFromVersionId?: string;
  activationSource: FieldGuideActivationEvent["activationSource"];
  legacyBaselineId?: string;
}

export interface ResolveLegacyFieldGuideBaselineInput {
  baselineId: string;
  aiIdentityId: string;
  language: FieldGuideLanguage;
  content: string;
  contentSha256: string;
  estimatedTokens: number;
  sourceSnapshot: FieldGuideSourceSnapshot;
}


export type FieldGuideUpdateStatus =
  | "PENDING"
  | "UPDATE"
  | "NO_CHANGE"
  | "FAILED_PROVIDER"
  | "FAILED_PARSE"
  | "FAILED_SCHEMA"
  | "FAILED_CAPACITY"
  | "FAILED_OUTPUT_PREFLIGHT"
  | "STALE_BASE";

export interface FieldGuideUpdateAuditRecord {
  id: string;
  sourceTrainingRunId: string;
  sourceSessionId: string;
  aiIdentityId: string;
  language: FieldGuideLanguage;
  baseVersionId: string;
  baseContentSha256: string;
  packetSha256: string;
  lexiconId: string;
  lexiconVersion: string;
  lexiconSha256: string;
  capacityTokens: FieldGuideCapacity;
  attemptCount: number;
  status: FieldGuideUpdateStatus;
  resultVersionId?: string;
  providerRequestId?: string;
  rawFinalResponseSha256?: string;
  changeSummary?: string;
  failureMessage?: string;
  createdAt: string;
  completedAt?: string;
}
