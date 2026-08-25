import type { EffectiveGenerationSettings, ProviderMessage, ProviderModel, ProviderUsage } from "../providers/types";

const COST_EPSILON = 1e-12;

export class SessionCostGuard {
  private upperBoundSpentUsd: number;

  constructor(private readonly limitUsd?: number, initialSpentUsd = 0) {
    this.upperBoundSpentUsd = Number.isFinite(initialSpentUsd) && initialSpentUsd > 0 ? initialSpentUsd : 0;
  }

  validateModel(model: ProviderModel): void {
    if (!this.enabled) return;
    if (!hasFinitePrice(model.pricing.promptPerToken) || !hasFinitePrice(model.pricing.completionPerToken)) {
      throw new Error("Hard session cost limit cannot be enforced for this model because its cached input/output pricing is unavailable. Disable the limit or refresh/select a route with pricing metadata.");
    }
  }

  authorize(
    model: ProviderModel,
    messages: ProviderMessage[],
    settings: EffectiveGenerationSettings,
  ): CostAuthorization {
    const estimatedUsageCost = (usage: ProviderUsage): ProviderUsage => withEstimatedCost(usage, model);
    if (!this.enabled) return new CostAuthorization(0, estimatedUsageCost, () => undefined);

    this.validateModel(model);
    if (messages.some((message) => Boolean(message.images?.length))) {
      throw new CostGuardStop("AUTO-STOP: hard session cost limit cannot safely pre-authorize image-token billing for this request");
    }
    const maximumOutputTokens = settings.effective.maxOutputTokens ?? model.capabilities.maxOutputTokens;
    if (!maximumOutputTokens || maximumOutputTokens < 1) {
      throw new CostGuardStop("AUTO-STOP: hard session cost limit requires a known maximum output-token setting");
    }
    const inputUpperBoundTokens = messages.reduce(
      (sum, message) => sum + new TextEncoder().encode(message.content).byteLength + 32,
      32,
    );
    const maximumCostUsd =
      inputUpperBoundTokens * model.pricing.promptPerToken!
      + maximumOutputTokens * model.pricing.completionPerToken!;
    if (this.upperBoundSpentUsd + maximumCostUsd > this.limitUsd! + COST_EPSILON) {
      throw new CostGuardStop("AUTO-STOP: next provider request could exceed the configured hard session cost limit");
    }

    let settled = false;
    return new CostAuthorization(maximumCostUsd, estimatedUsageCost, (actualCost) => {
      if (settled) return;
      settled = true;
      this.upperBoundSpentUsd += actualCost ?? maximumCostUsd;
    });
  }

  private get enabled(): boolean {
    return Boolean(this.limitUsd && Number.isFinite(this.limitUsd) && this.limitUsd > 0);
  }
}

export class CostGuardStop extends Error {}

export class CostAuthorization {
  constructor(
    readonly maximumCostUsd: number,
    private readonly estimate: (usage: ProviderUsage) => ProviderUsage,
    private readonly settleUpperBound: (actualCost?: number) => void,
  ) {}

  success(usage: ProviderUsage): ProviderUsage {
    const accounted = this.estimate(usage);
    this.settleUpperBound(accounted.costUsd);
    return accounted;
  }

  failure(): void {
    this.settleUpperBound(undefined);
  }
}

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
