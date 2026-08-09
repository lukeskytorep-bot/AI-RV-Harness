import type { ProviderModel, ReasoningEffort } from "../providers/types";

export interface SharedResearchCapabilities {
  reasoningEfforts: ReasoningEffort[];
  temperatureSupported: boolean;
  temperatureMin?: number;
  temperatureMax?: number;
  maxOutputTokens?: number;
}

const REASONING_ORDER: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Returns only controls that can be requested identically on every participating
 * Viewer route. Research must omit a control when even one route cannot honor it.
 */
export function sharedResearchCapabilities(models: ProviderModel[]): SharedResearchCapabilities {
  if (!models.length) return { reasoningEfforts: [], temperatureSupported: false };

  const reasoningEfforts = REASONING_ORDER.filter((effort) =>
    models.every((model) => model.capabilities.reasoning.supported && model.capabilities.reasoning.efforts.includes(effort)),
  );
  const everyRouteSupportsTemperature = models.every((model) => model.capabilities.temperature.supported);
  const temperatureMins = models
    .map((model) => model.capabilities.temperature.min)
    .filter((value): value is number => value !== undefined);
  const temperatureMaxes = models
    .map((model) => model.capabilities.temperature.max)
    .filter((value): value is number => value !== undefined);
  const outputLimits = models
    .map((model) => model.capabilities.maxOutputTokens)
    .filter((value): value is number => value !== undefined);
  const temperatureMin = temperatureMins.length ? Math.max(...temperatureMins) : undefined;
  const temperatureMax = temperatureMaxes.length ? Math.min(...temperatureMaxes) : undefined;
  const temperatureSupported = everyRouteSupportsTemperature
    && (temperatureMin === undefined || temperatureMax === undefined || temperatureMin <= temperatureMax);

  return {
    reasoningEfforts,
    temperatureSupported,
    ...(temperatureSupported && temperatureMin !== undefined ? { temperatureMin } : {}),
    ...(temperatureSupported && temperatureMax !== undefined ? { temperatureMax } : {}),
    ...(outputLimits.length ? { maxOutputTokens: Math.min(...outputLimits) } : {}),
  };
}
