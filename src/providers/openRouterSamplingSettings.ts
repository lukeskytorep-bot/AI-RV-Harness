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
  settings: unknown,
): OpenRouterAdditionalSamplingSettings {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Additional sampling settings must be an object.");
  }

  const candidate = settings as Record<string, unknown>;
  if (typeof candidate.enabled !== "boolean") {
    throw new TypeError("Additional sampling enabled must be a boolean.");
  }

  const topP = candidate.topP;
  if (topP !== undefined) {
    if (typeof topP !== "number" || !Number.isFinite(topP) || topP < OPENROUTER_TOP_P_MIN || topP > OPENROUTER_TOP_P_MAX) {
      throw new RangeError(`top_p must be a finite number between ${OPENROUTER_TOP_P_MIN} and ${OPENROUTER_TOP_P_MAX}.`);
    }
  }

  const topK = candidate.topK;
  if (topK !== undefined) {
    if (typeof topK !== "number" || !Number.isSafeInteger(topK) || topK < OPENROUTER_TOP_K_MIN) {
      throw new RangeError("top_k must be a non-negative safe integer.");
    }
  }

  const seed = candidate.seed;
  if (seed !== undefined) {
    if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < OPENROUTER_SEED_MIN || seed > OPENROUTER_SEED_MAX) {
      throw new RangeError(`seed must be a safe integer between ${OPENROUTER_SEED_MIN} and ${OPENROUTER_SEED_MAX}.`);
    }
  }

  return {
    enabled: candidate.enabled,
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };
}


export function supportsAdditionalSamplingProvider(provider: string | undefined): boolean {
  return provider === "openrouter" || provider === "custom_openai" || provider === "mistral" || provider === "blackbox";
}

export function validateOpenRouterSamplingForProvider(
  provider: string | undefined,
  settings: OpenRouterAdditionalSamplingSettings | undefined,
): OpenRouterAdditionalSamplingSettings | undefined {
  if (settings === undefined) return undefined;
  if (!supportsAdditionalSamplingProvider(provider)) {
    throw new Error("Additional sampling parameters are valid only for OpenRouter, Custom OpenAI-compatible, or Mistral direct profiles.");
  }
  return validateOpenRouterAdditionalSamplingSettings(settings);
}

export function hasManualOpenRouterSampling(settings?: OpenRouterAdditionalSamplingSettings): boolean {
  return settings?.enabled === true && (settings.topP !== undefined || settings.topK !== undefined || settings.seed !== undefined);
}
