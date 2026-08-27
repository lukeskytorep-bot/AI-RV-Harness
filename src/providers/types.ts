export const PROVIDER_KINDS = [
  "openrouter",
  "google",
  "openai",
  "anthropic",
  "zai",
  "deepseek",
  "mistral",
  "blackbox",
  "custom_openai",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type CapabilityConfidence = "provider_metadata" | "verified" | "unknown";
export type ReasoningOptionVerification = "registry" | "provider_metadata" | "unverified";
export type ReasoningTransportKind = "effort" | "enabled_boolean" | "thinking_level";

export interface ReasoningTransport {
  kind: ReasoningTransportKind;
  value: string;
}

export interface ReasoningOption {
  value: ReasoningEffort;
  label: string;
  verification: ReasoningOptionVerification;
  transport: ReasoningTransport;
}

export interface ProviderConfig {
  id: string;
  provider: ProviderKind;
  label: string;
  credentialId: string;
  credentialHint?: string;
  credentialFingerprint?: string;
  baseUrl?: string;
  enabled: boolean;
  lastTestedAt?: string;
  lastStatus?: "ok" | "error";
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderConfigInput {
  id: string;
  provider: ProviderKind;
  label: string;
  credentialId: string;
  credentialHint?: string;
  baseUrl?: string;
  fingerprint?: string;
}

export interface ReasoningCapability {
  supported: boolean;
  efforts: ReasoningEffort[];
  mandatory?: boolean;
  defaultEffort?: ReasoningEffort;
  confidence: CapabilityConfidence;
  options?: ReasoningOption[];
  registryStatus?: "known" | "unknown";
  registryModelId?: string;
  registryVersion?: string;
  verifiedAt?: string;
  verificationSource?: string;
  providerEfforts?: ReasoningEffort[];
}

export interface TemperatureCapability {
  supported: boolean;
  min?: number;
  max?: number;
  default?: number;
  confidence: CapabilityConfidence;
}

export interface ModelCapabilities {
  contextTokens?: number;
  maxOutputTokens?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportsVision: boolean;
  supportsStreaming: boolean;
  reasoning: ReasoningCapability;
  temperature: TemperatureCapability;
  supportedParameters: string[];
  source: "provider" | "compatibility";
  capturedAt: string;
}

export interface ModelPricing {
  promptPerToken?: number;
  completionPerToken?: number;
  currency?: "USD";
}

export interface ProviderModel {
  providerConfigId: string;
  provider: ProviderKind;
  modelId: string;
  displayName: string;
  route: string;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
  recommended: boolean;
  favorite?: boolean;
  rawMetadata: Record<string, unknown>;
  refreshedAt: string;
}

export interface GenerationSettings {
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface EffectiveGenerationSettings {
  requested: GenerationSettings;
  effective: GenerationSettings;
  omitted: Array<"reasoningEffort" | "temperature" | "maxOutputTokens">;
  reasoningResolution?: {
    selected: ReasoningEffort;
    label: string;
    verification: ReasoningOptionVerification;
    transport: ReasoningTransport;
  };
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: ProviderImageInput[];
}

export interface ProviderImageInput {
  mimeType: string;
  dataBase64: string;
}

export interface ProviderChatRequest {
  providerConfigId: string;
  provider: ProviderKind;
  credentialId: string;
  baseUrl?: string;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface ProviderChatResponse {
  content: string;
  reasoningContent?: string;
  reasoningDetails?: unknown[];
  reasoningSource?: "openai_reasoning" | "openai_reasoning_content" | "openai_reasoning_details" | "openai_thinking" | "google_thought_parts" | "anthropic_thinking" | "tagged_content" | string;
  finishReason?: string;
  actualModel?: string;
  usage: ProviderUsage;
  providerRequestId?: string;
}

export interface ProviderConnectionResult {
  ok: boolean;
  modelCount: number;
  refreshedAt: string;
}
