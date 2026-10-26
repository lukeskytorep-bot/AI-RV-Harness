import type { ProviderModel } from "../../providers/types";

export type OpenRouterSamplingModelCapabilityState = "supported" | "unsupported" | "unknown";
export type OpenRouterSamplingModelParameter = "top_p" | "top_k" | "seed";

function rawSupportedParameters(model: ProviderModel | null): string[] | null {
  if (!model) return null;
  const raw = model.rawMetadata.supported_parameters;
  return Array.isArray(raw) && raw.every((item) => typeof item === "string") ? raw as string[] : null;
}

export function openRouterSamplingModelCapabilityState(
  model: ProviderModel | null,
  parameter: OpenRouterSamplingModelParameter,
): OpenRouterSamplingModelCapabilityState {
  if (!model) return "unknown";
  if (model.capabilities.supportedParameters.includes(parameter)) return "supported";
  return rawSupportedParameters(model) ? "unsupported" : "unknown";
}
