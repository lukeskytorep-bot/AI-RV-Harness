import type { ProviderModel, ProviderUsage } from "../providers/types";

/** Cost reporting only. The former hard per-session cost stop was removed. */
export function withEstimatedCost(usage: ProviderUsage, model: ProviderModel): ProviderUsage {
  if (hasFinitePrice(usage.costUsd)) return usage;
  if (
    !hasFinitePrice(usage.inputTokens)
    || !hasFinitePrice(usage.outputTokens)
    || !hasFinitePrice(model.pricing.promptPerToken)
    || !hasFinitePrice(model.pricing.completionPerToken)
  ) return usage;
  return {
    ...usage,
    costUsd: usage.inputTokens! * model.pricing.promptPerToken!
      + usage.outputTokens! * model.pricing.completionPerToken!,
  };
}

function hasFinitePrice(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}
