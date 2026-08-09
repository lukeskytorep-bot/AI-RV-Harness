import type { InterfaceLanguage } from "../types";
import type { EffectiveGenerationSettings, ProviderKind } from "../providers/types";

export type RvSessionState =
  | "Draft"
  | "Preflight"
  | "BlindRunning"
  | "AwaitingReveal"
  | "Revealed"
  | "Completed"
  | "Interrupted"
  | "Failed";

export interface RvSession {
  id: string;
  workspaceId: string;
  profileId: string;
  sessionCode: string;
  state: RvSessionState;
  runType: "automatic" | "automatic_monitor" | "manual";
  preRevealTranscript: string;
  preRevealHash?: string;
  preRevealSealedAt?: string;
  postRevealTranscript: string;
  targetId?: string;
  researchProjectId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateRvSessionInput {
  id: string;
  workspaceId: string;
  profileId: string;
  sessionCode: string;
  runType: "automatic" | "automatic_monitor" | "manual";
  targetId?: string;
  researchProjectId?: string;
}

export interface SessionEventInput {
  eventType: string;
  role?: "system" | "user" | "assistant" | "controller";
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionSnapshot {
  schemaVersion: 1;
  sessionId: string;
  sessionCode: string;
  profileId: string;
  workspaceId: string;
  providerConfigId: string;
  credentialId: string;
  credentialHint?: string;
  provider: ProviderKind;
  modelId: string;
  modelRoute: string;
  capabilitySnapshot: Record<string, unknown>;
  capabilityCapturedAt: string;
  generationSettings: EffectiveGenerationSettings;
  sessionLanguage: InterfaceLanguage;
  protocol: {
    id: string;
    version: string;
    language: InterfaceLanguage;
    contentSha256: string;
    fullContent: string;
  };
  controllerPrompt: {
    id: string;
    version: string;
    language: InterfaceLanguage;
  };
  monitor?: {
    providerConfigId: string;
    provider: ProviderKind;
    modelId: string;
    modelRoute: string;
    promptVersion: string;
    libraryVersion: string;
    maxInterventions: number;
  };
  rvSystemPrompt?: {
    id: string;
    version: string;
    language: InterfaceLanguage;
    contentSha256: string;
    fullContent: string;
  };
  researchConditionInstruction?: {
    id: string;
    version: string;
    language: InterfaceLanguage;
    contentSha256: string;
    fullContent: string;
  };
  revealSource: "external" | "automatic";
  targetId?: string;
  researchProjectId?: string;
  applicationVersion: string;
  createdAt: string;
}

export interface RevealInput {
  source: "external_text" | "external_artifact" | "external_mixed" | "automatic_target";
  text?: string;
  artifactManifest?: RevealArtifactRecord[];
  hash: string;
}

export interface RevealArtifactRecord {
  artifactId: string;
  path: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface TargetClarificationRecord {
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
}
