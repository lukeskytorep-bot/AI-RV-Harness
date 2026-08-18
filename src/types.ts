import type { ReasoningEffort } from "./providers/types";

export type InterfaceLanguage = "pl" | "en";
export type SessionLanguageSetting = "same" | InterfaceLanguage;
export type Theme = "blue" | "aurora" | "light" | "dark" | "green";
export type ChatMode = "conversation" | "manual_rv";

export interface ChatThreadGroup {
  id: string;
  workspaceId: string;
  mode: ChatMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ChatThread {
  id: string;
  workspaceId: string;
  mode: ChatMode;
  threadGroupId?: string;
  title: string;
  formalRvState?: "BLIND" | "REVEALED" | "INTERRUPTED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AppSettings {
  interfaceLanguage: InterfaceLanguage;
  sessionLanguage: SessionLanguageSetting;
  theme: Theme;
  requestTimeoutMs: number;
  maxRetries: number;
  defaultMaxOutputTokens: number;
  maxSessionCostUsd: number;
  defaultRevealSource: "external" | "automatic";
  targetRepeatPolicy: "allow" | "avoid_profile";
  sessionCodePrefix: string;
  textScale: "small" | "normal" | "large";
  animations: boolean;
  trainingDirectory?: string;
}

export interface Profile {
  id: string;
  name: string;
  humanName?: string;
  note?: string;
  credentialId?: string;
  credentialProvider?: string;
  defaultViewerModelId?: string;
  defaultViewerReasoningEffort?: ReasoningEffort;
  defaultViewerTemperature?: number;
  defaultViewerSystemPrompt?: string;
  defaultMonitorSystemPrompt?: string;
  defaultMonitorProviderConfigId?: string;
  defaultMonitorModelId?: string;
  defaultJudgeProviderConfigId?: string;
  defaultJudgeModelId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ProfileAiConfigurationInput {
  credentialId?: string;
  credentialProvider?: string;
  defaultViewerModelId?: string;
  defaultViewerReasoningEffort?: ReasoningEffort;
  defaultViewerTemperature?: number;
  defaultViewerSystemPrompt?: string;
  defaultMonitorSystemPrompt?: string;
  defaultMonitorProviderConfigId?: string;
  defaultMonitorModelId?: string;
  defaultJudgeProviderConfigId?: string;
  defaultJudgeModelId?: string;
}

export interface ViewerSystemPromptSnapshot {
  id: string;
  version: string;
  content: string;
  contentSha256: string;
}

export interface Workspace {
  id: string;
  profileId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  archivedAt?: string;
}

export interface CreateProfileInput {
  name: string;
  humanName?: string;
  note?: string;
  aiConfiguration?: ProfileAiConfigurationInput;
}

export interface UpdateProfileInput {
  name: string;
  humanName?: string;
  note?: string;
}

export interface CreateWorkspaceInput {
  profileId: string;
  name: string;
  description?: string;
}
