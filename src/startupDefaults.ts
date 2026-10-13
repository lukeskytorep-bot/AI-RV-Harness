import type { AppSettings } from "./types";

export const DEFAULT_CONVERSATION_MAX_OUTPUT_TOKENS = 16_384;
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
    rvSessionMaxOutputTokens: 8192,
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

// Edward explicitly opted to upgrade the former 8K Conversation setting once.
// The persisted marker distinguishes that old value from a later deliberate
// reduction to 8K. The RV/global defaults and other custom values stay intact.
export function applyStoredOutputSettings(nextSettings: AppSettings, storedSettings: Partial<AppSettings>): AppSettings {
  const legacyOutput = storedSettings.defaultMaxOutputTokens;
  const conversation = storedSettings.conversationMaxOutputTokens ?? legacyOutput ?? nextSettings.conversationMaxOutputTokens;
  const upgraded = (storedSettings.conversationOutputBudgetVersion ?? 0) >= CONVERSATION_OUTPUT_BUDGET_VERSION;
  return {
    ...nextSettings,
    conversationMaxOutputTokens: !upgraded && (conversation === 8192 || conversation === 8000)
      ? DEFAULT_CONVERSATION_MAX_OUTPUT_TOKENS : conversation,
    conversationOutputBudgetVersion: Math.max(storedSettings.conversationOutputBudgetVersion ?? 0, CONVERSATION_OUTPUT_BUDGET_VERSION),
    rvSessionMaxOutputTokens: storedSettings.rvSessionMaxOutputTokens ?? legacyOutput ?? nextSettings.rvSessionMaxOutputTokens,
  };
}
