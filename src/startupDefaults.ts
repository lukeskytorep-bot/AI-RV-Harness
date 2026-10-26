import type { AppSettings } from "./types";

export const DEFAULT_CONVERSATION_MAX_OUTPUT_TOKENS = 16_384;
export const MIN_CONVERSATION_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_RV_SESSION_MAX_OUTPUT_TOKENS = 16_384;
export const MIN_RV_SESSION_MAX_OUTPUT_TOKENS = 16_384;
export const CONVERSATION_OUTPUT_BUDGET_VERSION = 1;

export const DEFAULT_INTERFACE_LANGUAGE = "en" as const;
export const DEFAULT_THEME = "blue" as const;

export function createDefaultSettings(): AppSettings {
  return {
    interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
    sessionLanguage: "same",
    theme: DEFAULT_THEME,
    requestTimeoutMs: 120_000,
    maxRetries: 2,
    defaultMaxOutputTokens: 8192,
    conversationMaxOutputTokens: DEFAULT_CONVERSATION_MAX_OUTPUT_TOKENS,
    conversationOutputBudgetVersion: CONVERSATION_OUTPUT_BUDGET_VERSION,
    rvSessionMaxOutputTokens: DEFAULT_RV_SESSION_MAX_OUTPUT_TOKENS,
    maxSessionCostUsd: 0,
    defaultRevealSource: "external",
    targetRepeatPolicy: "avoid_profile",
    sessionCodePrefix: "RVH",
    textScale: "large",
    animations: true,
    activeConversationWorkspaceId: "",
    activeRvWorkspaceId: "",
  };
}

// Conversation and automatic RV Sessions now have a persistent 16K floor in Settings.
// The legacy global default remains 8K and all unrelated output budgets stay untouched.
function normalizeOutputSetting(value: number | undefined, fallback: number, minimum: number): number {
  const resolved = Number.isFinite(value) ? value as number : fallback;
  return Math.max(minimum, resolved);
}

export function storedOutputSettingsNeedUpgrade(storedSettings: Partial<AppSettings>): boolean {
  return storedSettings.conversationMaxOutputTokens === undefined
    || storedSettings.rvSessionMaxOutputTokens === undefined
    || !Number.isFinite(storedSettings.conversationMaxOutputTokens)
    || !Number.isFinite(storedSettings.rvSessionMaxOutputTokens)
    || storedSettings.conversationMaxOutputTokens < MIN_CONVERSATION_MAX_OUTPUT_TOKENS
    || storedSettings.rvSessionMaxOutputTokens < MIN_RV_SESSION_MAX_OUTPUT_TOKENS
    || (storedSettings.conversationOutputBudgetVersion ?? 0) < CONVERSATION_OUTPUT_BUDGET_VERSION;
}

export function applyStoredOutputSettings(nextSettings: AppSettings, storedSettings: Partial<AppSettings>): AppSettings {
  const legacyOutput = storedSettings.defaultMaxOutputTokens;
  const conversation = storedSettings.conversationMaxOutputTokens ?? legacyOutput ?? nextSettings.conversationMaxOutputTokens;
  const rvSession = storedSettings.rvSessionMaxOutputTokens ?? legacyOutput ?? nextSettings.rvSessionMaxOutputTokens;
  return {
    ...nextSettings,
    conversationMaxOutputTokens: normalizeOutputSetting(conversation, DEFAULT_CONVERSATION_MAX_OUTPUT_TOKENS, MIN_CONVERSATION_MAX_OUTPUT_TOKENS),
    conversationOutputBudgetVersion: Math.max(storedSettings.conversationOutputBudgetVersion ?? 0, CONVERSATION_OUTPUT_BUDGET_VERSION),
    rvSessionMaxOutputTokens: normalizeOutputSetting(rvSession, DEFAULT_RV_SESSION_MAX_OUTPUT_TOKENS, MIN_RV_SESSION_MAX_OUTPUT_TOKENS),
  };
}
