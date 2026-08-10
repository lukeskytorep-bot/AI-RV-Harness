import type {
  EffectiveGenerationSettings,
  GenerationSettings,
  ModelCapabilities,
  ModelPricing,
  ProviderConfig,
  ProviderKind,
  ProviderModel,
  ReasoningEffort,
} from "./types";
import { applyModelReasoningRegistry, findReasoningOption } from "./modelReasoningRegistry";

const REASONING_EFFORTS: ReasoningEffort[] = ["max", "xhigh", "high", "medium", "low", "minimal", "none"];

const RECOMMENDED_FAMILY_SEEDS = [
  "gemma",
  "gemini",
  "glm",
  "deepseek",
  "mistral",
  "qwen",
  "gpt-5.6",
  "claude-sonnet",
  "claude-opus",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function effortArray(value: unknown): ReasoningEffort[] {
  return stringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item): item is ReasoningEffort => REASONING_EFFORTS.includes(item as ReasoningEffort));
}

export function isRecommendedModel(modelId: string, displayName = ""): boolean {
  const haystack = `${modelId} ${displayName}`.toLowerCase();
  if (/gpt[-_ ]?oss.*120b/.test(haystack)) return false;
  return RECOMMENDED_FAMILY_SEEDS.some((seed) => haystack.includes(seed));
}

function normalizeOpenRouter(raw: Record<string, unknown>, capturedAt: string): { capabilities: ModelCapabilities; pricing: ModelPricing } {
  const architecture = asRecord(raw.architecture);
  const topProvider = asRecord(raw.top_provider);
  const reasoning = asRecord(raw.reasoning);
  const pricingRaw = asRecord(raw.pricing);
  const supportedParameters = stringArray(raw.supported_parameters);
  const unrestrictedEfforts = Object.prototype.hasOwnProperty.call(reasoning, "supported_efforts") && reasoning.supported_efforts === null;
  const reasoningMandatory = boolValue(reasoning.mandatory);
  const reasoningEfforts = (unrestrictedEfforts ? [...REASONING_EFFORTS] : effortArray(reasoning.supported_efforts))
    .filter((effort) => !(reasoningMandatory && effort === "none"));
  const reasoningAdvertised = supportedParameters.includes("reasoning") || supportedParameters.includes("reasoning_effort");
  const inputModalities = stringArray(architecture.input_modalities);
  const outputModalities = stringArray(architecture.output_modalities);

  return {
    capabilities: {
      contextTokens: numberValue(raw.context_length) ?? numberValue(topProvider.context_length),
      maxOutputTokens: numberValue(topProvider.max_completion_tokens),
      inputModalities: inputModalities.length ? inputModalities : ["text"],
      outputModalities: outputModalities.length ? outputModalities : ["text"],
      supportsVision: inputModalities.includes("image"),
      supportsStreaming: true,
      reasoning: {
        supported: reasoningAdvertised,
        efforts: reasoningEfforts,
        mandatory: reasoningMandatory,
        defaultEffort: effortArray([reasoning.default_effort])[0],
        confidence: reasoningAdvertised ? "provider_metadata" : "unknown",
      },
      temperature: {
        supported: supportedParameters.includes("temperature"),
        confidence: supportedParameters.includes("temperature") ? "provider_metadata" : "unknown",
      },
      supportedParameters,
      source: "provider",
      capturedAt,
    },
    pricing: {
      promptPerToken: numberValue(pricingRaw.prompt),
      completionPerToken: numberValue(pricingRaw.completion),
      currency: "USD",
    },
  };
}

function normalizeGoogle(raw: Record<string, unknown>, capturedAt: string): { capabilities: ModelCapabilities; pricing: ModelPricing } {
  const methods = stringArray(raw.supportedGenerationMethods);
  const thinking = boolValue(raw.thinking) === true;
  const maxTemperature = numberValue(raw.maxTemperature);
  const defaultTemperature = numberValue(raw.temperature);
  const supportsTemperature = maxTemperature !== undefined || defaultTemperature !== undefined;

  return {
    capabilities: {
      contextTokens: numberValue(raw.inputTokenLimit),
      maxOutputTokens: numberValue(raw.outputTokenLimit),
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: methods.some((item) => item.toLowerCase().includes("generatecontent")),
      reasoning: {
        supported: thinking,
        // Google advertises whether thinking exists in Models API, but not the per-model level set.
        // Research controls stay unavailable until an exact level set is known.
        efforts: [],
        confidence: thinking ? "provider_metadata" : "unknown",
      },
      temperature: {
        supported: supportsTemperature,
        min: supportsTemperature ? 0 : undefined,
        max: maxTemperature,
        default: defaultTemperature,
        confidence: supportsTemperature ? "provider_metadata" : "unknown",
      },
      supportedParameters: [
        ...(thinking ? ["thinking"] : []),
        ...(supportsTemperature ? ["temperature"] : []),
      ],
      source: "provider",
      capturedAt,
    },
    pricing: {},
  };
}

function normalizeCompatible(raw: Record<string, unknown>, capturedAt: string): { capabilities: ModelCapabilities; pricing: ModelPricing } {
  const capabilitiesRaw = asRecord(raw.capabilities);
  const supportedParameters = stringArray(raw.supported_parameters ?? raw.supportedParameters);
  const modalities = stringArray(raw.input_modalities ?? raw.inputModalities);
  const supportsVision =
    modalities.includes("image") ||
    boolValue(capabilitiesRaw.vision) === true ||
    boolValue(capabilitiesRaw.vision_understanding) === true;
  const reasoningEfforts = effortArray(raw.reasoning_efforts ?? raw.reasoningEfforts);
  const reasoningAdvertised =
    supportedParameters.includes("reasoning") ||
    supportedParameters.includes("reasoning_effort") ||
    reasoningEfforts.length > 0;
  const temperatureAdvertised = supportedParameters.includes("temperature");

  return {
    capabilities: {
      contextTokens:
        numberValue(raw.context_length) ??
        numberValue(raw.max_context_length) ??
        numberValue(capabilitiesRaw.max_context_length),
      maxOutputTokens: numberValue(raw.max_output_tokens) ?? numberValue(raw.max_completion_tokens),
      inputModalities: modalities.length ? modalities : ["text"],
      outputModalities: ["text"],
      supportsVision,
      supportsStreaming: true,
      reasoning: {
        supported: reasoningAdvertised,
        efforts: reasoningEfforts,
        confidence: reasoningAdvertised ? "provider_metadata" : "unknown",
      },
      temperature: {
        supported: temperatureAdvertised,
        confidence: temperatureAdvertised ? "provider_metadata" : "unknown",
      },
      supportedParameters,
      source: "compatibility",
      capturedAt,
    },
    pricing: {},
  };
}

function extractRawModels(provider: ProviderKind, payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (provider === "google") return asArray(root.models).map(asRecord);
  return asArray(root.data ?? root.models).map(asRecord);
}

function modelId(provider: ProviderKind, raw: Record<string, unknown>): string | undefined {
  if (provider === "google") {
    const base = typeof raw.baseModelId === "string" ? raw.baseModelId : undefined;
    const name = typeof raw.name === "string" ? raw.name.replace(/^models\//, "") : undefined;
    return base || name;
  }
  return typeof raw.id === "string" ? raw.id : typeof raw.name === "string" ? raw.name : undefined;
}

export function normalizeModelDiscovery(config: ProviderConfig, payload: unknown, capturedAt = new Date().toISOString()): ProviderModel[] {
  return extractRawModels(config.provider, payload)
    .map((raw): ProviderModel | null => {
      const id = modelId(config.provider, raw);
      if (!id) return null;
      const normalized =
        config.provider === "openrouter"
          ? normalizeOpenRouter(raw, capturedAt)
          : config.provider === "google"
            ? normalizeGoogle(raw, capturedAt)
            : normalizeCompatible(raw, capturedAt);
      const displayName =
        (typeof raw.displayName === "string" && raw.displayName) ||
        (typeof raw.display_name === "string" && raw.display_name) ||
        (typeof raw.name === "string" && raw.name) ||
        id;
      return {
        providerConfigId: config.id,
        provider: config.provider,
        modelId: id,
        displayName,
        route: `${config.provider}:${id}`,
        capabilities: {
          ...normalized.capabilities,
          reasoning: applyModelReasoningRegistry(config.provider, id, normalized.capabilities.reasoning),
        },
        pricing: normalized.pricing,
        recommended: isRecommendedModel(id, displayName),
        rawMetadata: raw,
        refreshedAt: capturedAt,
      };
    })
    .filter((item): item is ProviderModel => item !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function resolveGenerationSettings(capabilities: ModelCapabilities, requested: GenerationSettings): EffectiveGenerationSettings {
  const effective: GenerationSettings = {};
  const omitted: EffectiveGenerationSettings["omitted"] = [];
  let reasoningResolution: EffectiveGenerationSettings["reasoningResolution"];

  if (requested.reasoningEffort !== undefined) {
    if (capabilities.reasoning.supported && capabilities.reasoning.efforts.includes(requested.reasoningEffort)) {
      effective.reasoningEffort = requested.reasoningEffort;
      const option = findReasoningOption(capabilities.reasoning, requested.reasoningEffort);
      reasoningResolution = {
        selected: requested.reasoningEffort,
        label: option?.label ?? requested.reasoningEffort.toUpperCase(),
        verification: option?.verification ?? (capabilities.reasoning.confidence === "verified" ? "registry" : "provider_metadata"),
        transport: option?.transport ?? { kind: "effort", value: requested.reasoningEffort },
      };
    } else {
      omitted.push("reasoningEffort");
    }
  }

  if (requested.temperature !== undefined) {
    const { temperature } = capabilities;
    const inRange =
      (temperature.min === undefined || requested.temperature >= temperature.min) &&
      (temperature.max === undefined || requested.temperature <= temperature.max);
    if (temperature.supported && inRange) effective.temperature = requested.temperature;
    else omitted.push("temperature");
  }

  if (requested.maxOutputTokens !== undefined) {
    if (requested.maxOutputTokens > 0 && (!capabilities.maxOutputTokens || requested.maxOutputTokens <= capabilities.maxOutputTokens)) {
      effective.maxOutputTokens = Math.floor(requested.maxOutputTokens);
    } else {
      omitted.push("maxOutputTokens");
    }
  }

  return { requested: { ...requested }, effective, omitted, ...(reasoningResolution ? { reasoningResolution } : {}) };
}
