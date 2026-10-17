export const OPENROUTER_TOP_P_MIN = 0;
export const OPENROUTER_TOP_P_MAX = 1;
export const OPENROUTER_TOP_K_MIN = 0;
export const OPENROUTER_SEED_MIN = 0;
export const OPENROUTER_SEED_MAX = Number.MAX_SAFE_INTEGER;

export interface OpenRouterAdditionalSamplingSettings {
  enabled: boolean;
  topP?: number;
  topK?: number;
  seed?: number;
}

export function validateOpenRouterAdditionalSamplingSettings(
  settings: OpenRouterAdditionalSamplingSettings,
): OpenRouterAdditionalSamplingSettings {
  if (settings.topP !== undefined) {
    if (!Number.isFinite(settings.topP) || settings.topP < OPENROUTER_TOP_P_MIN || settings.topP > OPENROUTER_TOP_P_MAX) {
      throw new RangeError(`top_p must be a finite number between ${OPENROUTER_TOP_P_MIN} and ${OPENROUTER_TOP_P_MAX}.`);
    }
  }
  if (settings.topK !== undefined) {
    if (!Number.isSafeInteger(settings.topK) || settings.topK < OPENROUTER_TOP_K_MIN) {
      throw new RangeError("top_k must be a non-negative safe integer.");
    }
  }
  if (settings.seed !== undefined) {
    if (!Number.isSafeInteger(settings.seed) || settings.seed < OPENROUTER_SEED_MIN || settings.seed > OPENROUTER_SEED_MAX) {
      throw new RangeError(`seed must be a safe integer between ${OPENROUTER_SEED_MIN} and ${OPENROUTER_SEED_MAX}.`);
    }
  }
  return { ...settings };
}


export function validateOpenRouterSamplingForProvider(
  provider: string | undefined,
  settings: OpenRouterAdditionalSamplingSettings | undefined,
): OpenRouterAdditionalSamplingSettings | undefined {
  if (settings === undefined) return undefined;
  if (provider !== "openrouter") {
    throw new Error("Additional sampling parameters are only valid for OpenRouter profiles.");
  }
  return validateOpenRouterAdditionalSamplingSettings(settings);
}

export function hasManualOpenRouterSampling(settings?: OpenRouterAdditionalSamplingSettings): boolean {
  return settings?.enabled === true && (settings.topP !== undefined || settings.topK !== undefined || settings.seed !== undefined);
}
