import type { ChatMode } from "../types";
import type { ProviderModel } from "../providers/types";
import { viewerOutputPreferredBudget, type ViewerOutputBudgetProfile } from "../sessions/viewerOutputRecovery";
import { defaultChatOutputTokens } from "./outputPreference";

// B1 is intentionally scoped to Manual RV. Automatic blind workflows retain
// the shared default 16K/32K policy; historical evidence is never rewritten.
export const MANUAL_RV_OUTPUT_BUDGET_PROFILE = Object.freeze({
  version: 2,
  initialTokens: 32_768,
  recoveryTokens: 49_152,
} satisfies ViewerOutputBudgetProfile);

export function chatOutputTokens(mode: ChatMode, configuredTokens: number, model?: ProviderModel | null): number {
  if (mode === "conversation") return defaultChatOutputTokens(configuredTokens, model?.capabilities.maxOutputTokens);
  if (!model) return Math.max(configuredTokens, MANUAL_RV_OUTPUT_BUDGET_PROFILE.initialTokens);
  return viewerOutputPreferredBudget({
    model,
    explicitRequested: defaultChatOutputTokens(configuredTokens, model.capabilities.maxOutputTokens),
    recoveryLevel: 0,
    budgetProfile: MANUAL_RV_OUTPUT_BUDGET_PROFILE,
  });
}
