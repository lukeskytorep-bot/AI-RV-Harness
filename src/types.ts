export type InterfaceLanguage = "pl" | "en";
export type SessionLanguageSetting = "same" | InterfaceLanguage;
export type Theme = "aurora" | "light" | "dark";
export type ChatMode = "conversation" | "manual_rv";

export interface ChatThread {
  id: string;
  workspaceId: string;
  mode: ChatMode;
  title: string;
  formalRvState?: "BLIND" | "REVEALED" | "INTERRUPTED" | "FAILED";
  createdAt: string;
  updatedAt: string;
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
}

export interface Profile {
  id: string;
  name: string;
  note?: string;
  credentialId?: string;
  credentialProvider?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
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
  note?: string;
}

export interface UpdateProfileInput {
  name: string;
  note?: string;
}

export interface CreateWorkspaceInput {
  profileId: string;
  name: string;
  description?: string;
}
