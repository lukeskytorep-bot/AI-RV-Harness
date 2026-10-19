import { validateOpenRouterAdditionalSamplingSettings } from "../providers/openRouterSamplingSettings";
import type { GenerationSettings, ProviderModel } from "../providers/types";
import type { Profile } from "../types";
import type { ResearchSamplingConditionValues } from "./types";

export type ResearchSamplingParameter = "topP" | "topK" | "seed";
export type ResearchSamplingCapabilityState = "supported" | "unsupported" | "unknown";

export interface ResearchSamplingProfileSnapshot {
  source: "profile";
  profileId: string;
  topP?: number;
  topK?: number;
  seed?: number;
}

const WIRE_NAME: Record<ResearchSamplingParameter, "top_p" | "top_k" | "seed"> = {
  topP: "top_p",
  topK: "top_k",
  seed: "seed",
};

function rawSupportedParameters(model: ProviderModel): string[] | null {
  const raw = model.rawMetadata.supported_parameters;
  return Array.isArray(raw) && raw.every((item) => typeof item === "string") ? raw as string[] : null;
}

export function researchSamplingCapabilityState(
  model: ProviderModel,
  parameter: ResearchSamplingParameter,
): ResearchSamplingCapabilityState {
  if (model.provider === "custom_openai" || model.provider === "mistral") return "supported";
  if (model.provider !== "openrouter") return "unsupported";
  const wireName = WIRE_NAME[parameter];
  if (model.capabilities.supportedParameters.includes(wireName)) return "supported";
  return rawSupportedParameters(model) ? "unsupported" : "unknown";
}

/**
 * Reads the user's stored OpenRouter/Custom sampling intent without passing through
 * capability resolution. Disabled/all-Auto profiles intentionally return an
 * empty GenerationSettings object. Zero remains a manual value.
 */
export function researchSamplingFromProfile(profile: Profile | null, provider: ProviderModel["provider"] | undefined): {
  requested: GenerationSettings;
  snapshot: ResearchSamplingProfileSnapshot;
} {
  const snapshot: ResearchSamplingProfileSnapshot = { source: "profile", profileId: profile?.id ?? "" };
  const stored = profile?.defaultViewerOpenRouterSampling;
  if (!stored || (provider !== "openrouter" && provider !== "custom_openai" && provider !== "mistral")) return { requested: {}, snapshot };
  const validated = validateOpenRouterAdditionalSamplingSettings(stored);
  if (!validated.enabled) return { requested: {}, snapshot };
  const requested: GenerationSettings = {
    ...(validated.topP !== undefined ? { topP: validated.topP } : {}),
    ...(validated.topK !== undefined ? { topK: validated.topK } : {}),
    ...(validated.seed !== undefined ? { seed: validated.seed } : {}),
  };
  return {
    requested,
    snapshot: {
      ...snapshot,
      ...(validated.topP !== undefined ? { topP: validated.topP } : {}),
      ...(validated.topK !== undefined ? { topK: validated.topK } : {}),
      ...(validated.seed !== undefined ? { seed: validated.seed } : {}),
    },
  };
}

export function assertResearchSamplingSupported(
  requested: GenerationSettings,
  models: ProviderModel[],
): void {
  const parameters = (["topP", "topK", "seed"] as const).filter((key) => requested[key] !== undefined);
  if (!parameters.length) return;
  if (!models.length) throw new Error("Research sampling cannot be verified because no Viewer route is selected.");
  for (const model of models) {
    for (const parameter of parameters) {
      const state = researchSamplingCapabilityState(model, parameter);
      if (state !== "supported") {
        const wireName = WIRE_NAME[parameter];
        throw new Error(`Research sampling ${wireName} is ${state} for Viewer route ${model.route}. Set it to Auto or use a route that confirms support before Experiment Lock.`);
      }
    }
  }
}

export function researchRequestedSamplingValue(
  requested: GenerationSettings | undefined,
  samplingValues: ResearchSamplingConditionValues | undefined,
  parameter: ResearchSamplingParameter,
): number | undefined {
  return requested?.[parameter] ?? samplingValues?.[parameter];
}

export function researchSamplingSignature(settings: GenerationSettings): string {
  return JSON.stringify({
    topP: settings.topP ?? null,
    topK: settings.topK ?? null,
    seed: settings.seed ?? null,
  });
}
