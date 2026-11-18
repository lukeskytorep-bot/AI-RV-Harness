import type { CustomOpenAiCompatibilityProfile, GenerationSettings, ProviderConfig } from "./types";

export function customCompatibilityProfile(value: unknown): CustomOpenAiCompatibilityProfile {
  if (value === undefined || value === null) return "generic";
  if (value === "generic" || value === "llama_cpp") return value;
  throw new Error("Invalid Custom OpenAI compatibility profile.");
}

/** Call only when creating new settings, before freezing a run; never to fill legacy Resume settings. */
export function newRunGenerationSettings(config: ProviderConfig, requested: GenerationSettings): GenerationSettings {
  return config.provider === "custom_openai"
    ? { ...requested, customCompatibilityProfile: customCompatibilityProfile(config.customCompatibilityProfile) }
    : { ...requested };
}
