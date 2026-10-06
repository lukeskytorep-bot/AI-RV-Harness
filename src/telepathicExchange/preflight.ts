import { estimateContextBudget, type ContextBudget } from "../chat/contextBudget";
import type { ProviderMessage, ProviderModel } from "../providers/types";
import type { TelepathicProviderPacket } from "./packets";

export type TelepathicCostKnowledge = "unavailable" | "estimated";
export type TelepathicHardCostLimitEligibility = "eligible" | "image_billing_not_hard_preflightable" | "pricing_unavailable" | "output_limit_unknown";

export interface TelepathicPacketPreflight {
  budget: ContextBudget;
  estimatedCostUsd?: number;
  costKnowledge: TelepathicCostKnowledge;
  hardCostLimitEligibility: TelepathicHardCostLimitEligibility;
}

function finiteNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

export function preflightTelepathicMessages(input: {
  messages: ProviderMessage[];
  model: ProviderModel;
  reservedOutputTokens?: number;
}): TelepathicPacketPreflight {
  const reservedOutputTokens = Math.max(1, Math.floor(
    input.reservedOutputTokens
      ?? input.model.capabilities.maxOutputTokens
      ?? 8192,
  ));
  const budget = estimateContextBudget(input.messages, input.model.capabilities.contextTokens, reservedOutputTokens);
  const promptPrice = input.model.pricing.promptPerToken;
  const completionPrice = input.model.pricing.completionPerToken;
  const pricingKnown = finiteNonNegative(promptPrice) && finiteNonNegative(completionPrice);
  const estimatedCostUsd = pricingKnown
    ? budget.estimatedInputTokens * promptPrice + reservedOutputTokens * completionPrice
    : undefined;

  let hardCostLimitEligibility: TelepathicHardCostLimitEligibility;
  if (!pricingKnown) hardCostLimitEligibility = "pricing_unavailable";
  else if (budget.imageCount > 0) hardCostLimitEligibility = "image_billing_not_hard_preflightable";
  else if (!input.model.capabilities.maxOutputTokens && !input.reservedOutputTokens) hardCostLimitEligibility = "output_limit_unknown";
  else hardCostLimitEligibility = "eligible";

  return {
    budget,
    estimatedCostUsd,
    costKnowledge: estimatedCostUsd === undefined ? "unavailable" : "estimated",
    hardCostLimitEligibility,
  };
}

export function preflightTelepathicPacket(input: {
  packet: TelepathicProviderPacket;
  model: ProviderModel;
  reservedOutputTokens?: number;
}): TelepathicPacketPreflight {
  return preflightTelepathicMessages({
    messages: input.packet.messages,
    model: input.model,
    reservedOutputTokens: input.reservedOutputTokens,
  });
}
