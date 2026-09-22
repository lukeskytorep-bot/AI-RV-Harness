import type { EffectiveGenerationSettings, OpenRouterProviderRouting } from "./types";

export const ROUTING_SAFETY_MARGIN_MIN_TOKENS = 2048;
export const ROUTING_SAFETY_MARGIN_RATIO = 0.25;
/** Initial E1 trigger. Requests below this remain normal unless cached endpoint data proves heterogeneity. */
export const OPENROUTER_CAPACITY_RISK_THRESHOLD_TOKENS = 32_768;
export const OPENROUTER_ENDPOINT_CACHE_FRESH_MS = 5 * 60_000;
export const OPENROUTER_ENDPOINT_CACHE_LKG_MS = 60 * 60_000;
export const OPENROUTER_ENDPOINT_CACHE_MAX_ENTRIES = 64;

export type EndpointCapacityState = "PROVEN_FIT" | "PROVEN_NO" | "UNKNOWN";
export type EndpointMetadataSource = "fresh" | "last_known_good" | "unavailable" | "not_needed";
export type EndpointRoutingMode = "normal" | "verified_fit" | "unknown_attempt" | "local_stop";

export interface OpenRouterEndpointCapability {
  routeTag?: string;
  providerName?: string;
  displayName?: string;
  contextLength?: number;
  maxPromptTokens?: number;
  maxCompletionTokens?: number;
  supportedParameters?: string[];
  available?: boolean;
  status?: unknown;
}

export interface ClassifiedOpenRouterEndpoint extends OpenRouterEndpointCapability {
  capacityState: EndpointCapacityState;
  reasons: string[];
}

export interface OpenRouterEndpointSnapshot {
  endpoints: OpenRouterEndpointCapability[];
  capturedAtMs: number;
}

export interface OpenRouterCapacityEnvelope {
  estimatedInputTokens: number;
  routingSafetyMarginTokens: number;
  conservativeInputTokens: number;
  requestedCompletionAllowance: number;
  effectiveRequiredContext: number;
  requiredParameters: string[];
}

export interface OpenRouterRoutingDecision {
  mode: EndpointRoutingMode;
  capacitySensitive: boolean;
  metadataSource: EndpointMetadataSource;
  envelope: OpenRouterCapacityEnvelope;
  endpoints: ClassifiedOpenRouterEndpoint[];
  providerRouting?: OpenRouterProviderRouting;
  humanMessage?: string;
}

export type OpenRouterEndpointDiscovery = (modelId: string) => Promise<unknown>;

const cache = new Map<string, OpenRouterEndpointSnapshot>();

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

const stringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
};

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Normalizes only documented capacity/routing fields and preserves unknown status metadata opaquely. */
export function normalizeOpenRouterEndpointDiscovery(payload: unknown): OpenRouterEndpointCapability[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
  const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
  return endpoints.flatMap((raw): OpenRouterEndpointCapability[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    return [{
      routeTag: text(item.tag),
      providerName: text(item.provider_name),
      displayName: text(item.name),
      contextLength: positiveInteger(item.context_length),
      maxPromptTokens: positiveInteger(item.max_prompt_tokens),
      maxCompletionTokens: positiveInteger(item.max_completion_tokens),
      supportedParameters: stringArray(item.supported_parameters),
      ...(typeof item.available === "boolean" ? { available: item.available } : {}),
      ...(typeof item.is_available === "boolean" ? { available: item.is_available } : {}),
      ...(Object.prototype.hasOwnProperty.call(item, "status") ? { status: item.status } : {}),
    }];
  });
}

export function routingSafetyMarginTokens(estimatedInputTokens: number): number {
  const estimate = Math.max(0, Math.ceil(estimatedInputTokens));
  return Math.max(ROUTING_SAFETY_MARGIN_MIN_TOKENS, Math.ceil(estimate * ROUTING_SAFETY_MARGIN_RATIO));
}

export function createOpenRouterCapacityEnvelope(input: {
  estimatedInputTokens: number;
  settings: EffectiveGenerationSettings;
}): OpenRouterCapacityEnvelope {
  const estimatedInputTokens = Math.max(0, Math.ceil(input.estimatedInputTokens));
  const margin = routingSafetyMarginTokens(estimatedInputTokens);
  const requestedCompletionAllowance = Math.max(1, Math.floor(input.settings.effective.maxOutputTokens ?? 8192));
  const requiredParameters = new Set<string>();
  if (input.settings.effective.temperature !== undefined) requiredParameters.add("temperature");
  if (input.settings.reasoningResolution || input.settings.effective.reasoningEffort) requiredParameters.add("reasoning");
  return {
    estimatedInputTokens,
    routingSafetyMarginTokens: margin,
    conservativeInputTokens: estimatedInputTokens + margin,
    requestedCompletionAllowance,
    effectiveRequiredContext: estimatedInputTokens + margin + requestedCompletionAllowance,
    requiredParameters: [...requiredParameters],
  };
}

export function classifyOpenRouterEndpoint(
  endpoint: OpenRouterEndpointCapability,
  envelope: OpenRouterCapacityEnvelope,
): ClassifiedOpenRouterEndpoint {
  const reasons: string[] = [];
  if (endpoint.available === false) reasons.push("endpoint_explicitly_unavailable");
  if (endpoint.contextLength !== undefined && envelope.effectiveRequiredContext > endpoint.contextLength) {
    reasons.push("required_context_exceeds_context_length");
  }
  if (endpoint.maxPromptTokens !== undefined && envelope.conservativeInputTokens > endpoint.maxPromptTokens) {
    reasons.push("conservative_input_exceeds_max_prompt_tokens");
  }
  if (endpoint.maxCompletionTokens !== undefined && envelope.requestedCompletionAllowance > endpoint.maxCompletionTokens) {
    reasons.push("requested_completion_exceeds_max_completion_tokens");
  }
  if (endpoint.supportedParameters !== undefined) {
    for (const parameter of envelope.requiredParameters) {
      if (!endpoint.supportedParameters.includes(parameter)) reasons.push(`unsupported_parameter:${parameter}`);
    }
  }
  if (reasons.length > 0) return { ...endpoint, capacityState: "PROVEN_NO", reasons };

  // PROVEN_FIT requires enough documented bounds to establish both total and completion fit.
  // Missing capacity metadata remains UNKNOWN instead of being converted to a rejection.
  if (endpoint.contextLength !== undefined && endpoint.maxCompletionTokens !== undefined) {
    return { ...endpoint, capacityState: "PROVEN_FIT", reasons: [] };
  }
  return { ...endpoint, capacityState: "UNKNOWN", reasons: ["incomplete_capacity_metadata"] };
}

const OPENROUTER_SERVICE_TIER_SUFFIXES = new Set(["flex", "fast", "priority"]);

function splitOpenRouterProviderSlug(slug: string): { base: string; suffix?: string } {
  const normalized = slug.trim();
  const separator = normalized.indexOf("/");
  if (separator < 0) return { base: normalized };
  return { base: normalized.slice(0, separator), suffix: normalized.slice(separator + 1) };
}

function openRouterServiceTierKind(slug: string): "flex" | "priority" | undefined {
  const { suffix } = splitOpenRouterProviderSlug(slug);
  if (!suffix || !OPENROUTER_SERVICE_TIER_SUFFIXES.has(suffix)) return undefined;
  return suffix === "flex" ? "flex" : "priority";
}

/**
 * Mirrors OpenRouter provider-selector semantics for a selector against one discovered endpoint tag.
 * Base slugs match ordinary variants/regions, but not opt-in service-tier endpoints.
 * The documented `fast` and `priority` tier suffixes identify the same priority tier.
 */
export function openRouterProviderSlugMatches(selector: string, endpointTag: string): boolean {
  const selected = selector.trim();
  const endpoint = endpointTag.trim();
  if (!selected || !endpoint) return false;
  if (selected === endpoint) return true;

  const selectedParts = splitOpenRouterProviderSlug(selected);
  const endpointParts = splitOpenRouterProviderSlug(endpoint);
  if (selectedParts.base !== endpointParts.base) return false;

  const selectedTier = openRouterServiceTierKind(selected);
  const endpointTier = openRouterServiceTierKind(endpoint);
  if (selectedTier || endpointTier) {
    return selectedTier !== undefined && endpointTier !== undefined && selectedTier === endpointTier;
  }

  return selectedParts.suffix === undefined;
}

function openRouterProviderSlugSelectorsOverlap(left: string, right: string): boolean {
  return openRouterProviderSlugMatches(left, right) || openRouterProviderSlugMatches(right, left);
}

function selectorIsFullyIgnored(selector: string, ignore: string[]): boolean {
  return ignore.some((ignoredSelector) => openRouterProviderSlugMatches(ignoredSelector, selector));
}

export function mergeOpenRouterProviderRouting(
  existing: OpenRouterProviderRouting | undefined,
  capacity: OpenRouterProviderRouting | undefined,
): OpenRouterProviderRouting | undefined {
  if (!existing && !capacity) return undefined;
  const existingOnly = existing?.only?.filter(Boolean);
  const capacityOnly = capacity?.only?.filter(Boolean);
  let only: string[] | undefined;
  if (existingOnly?.length && capacityOnly?.length) {
    // Capacity entries are discovered endpoint tags. Keep those exact tags only when
    // the user's/provider's pre-existing selector semantically permits that endpoint.
    only = [...new Set(capacityOnly.filter((routeTag) =>
      existingOnly.some((selector) => openRouterProviderSlugMatches(selector, routeTag)),
    ))];
  } else {
    only = existingOnly?.length ? [...existingOnly] : capacityOnly?.length ? [...capacityOnly] : undefined;
  }

  const ignore = [...new Set([...(existing?.ignore ?? []), ...(capacity?.ignore ?? [])].filter(Boolean))];
  if (only) only = only.filter((selector) => !selectorIsFullyIgnored(selector, ignore));

  let order = existing?.order?.filter(Boolean);
  if (order?.length) {
    order = order.filter((selector) =>
      !selectorIsFullyIgnored(selector, ignore)
      && (!only || only.some((allowed) => openRouterProviderSlugSelectorsOverlap(selector, allowed))),
    );
  }
  const allowFallbacks = existing?.allowFallbacks ?? capacity?.allowFallbacks;
  return {
    ...(order ? { order } : {}),
    ...(only ? { only } : {}),
    ...(ignore.length ? { ignore } : {}),
    ...(allowFallbacks !== undefined ? { allowFallbacks } : {}),
  };
}

function classifyEndpoints(endpoints: OpenRouterEndpointCapability[], envelope: OpenRouterCapacityEnvelope): ClassifiedOpenRouterEndpoint[] {
  return endpoints.map((endpoint) => classifyOpenRouterEndpoint(endpoint, envelope));
}

function hasKnownExclusion(endpoints: OpenRouterEndpointCapability[], envelope: OpenRouterCapacityEnvelope): boolean {
  return classifyEndpoints(endpoints, envelope).some((entry) => entry.capacityState === "PROVEN_NO");
}

function routingFromClassified(endpoints: ClassifiedOpenRouterEndpoint[]): Pick<OpenRouterRoutingDecision, "mode" | "providerRouting" | "humanMessage"> {
  const fit = endpoints.filter((entry) => entry.capacityState === "PROVEN_FIT" && entry.routeTag);
  const no = endpoints.filter((entry) => entry.capacityState === "PROVEN_NO");
  const unknown = endpoints.filter((entry) => entry.capacityState === "UNKNOWN");
  const notProvenNo = endpoints.filter((entry) => entry.capacityState !== "PROVEN_NO");

  if (no.length === 0 && unknown.length === 0) return { mode: "normal" };
  if (fit.length > 0 && (no.length > 0 || unknown.length > 0)) {
    return { mode: "verified_fit", providerRouting: { only: [...new Set(fit.map((entry) => entry.routeTag!))], allowFallbacks: true } };
  }
  if (notProvenNo.length > 0) {
    const knownTooSmallTags = [...new Set(no.flatMap((entry) => entry.routeTag ? [entry.routeTag] : []))];
    return {
      mode: "unknown_attempt",
      ...(knownTooSmallTags.length ? { providerRouting: { ignore: knownTooSmallTags, allowFallbacks: true } } : {}),
    };
  }
  if (endpoints.length > 0 && no.length === endpoints.length) {
    return {
      mode: "local_stop",
      humanMessage: "This operation is larger than the verified context capacity of the available OpenRouter routes. Choose a model or provider route with a larger context window.",
    };
  }
  return { mode: "unknown_attempt" };
}

function setCache(key: string, snapshot: OpenRouterEndpointSnapshot): void {
  cache.delete(key);
  cache.set(key, snapshot);
  while (cache.size > OPENROUTER_ENDPOINT_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function clearOpenRouterEndpointCapabilityCache(): void {
  cache.clear();
}

export function seedOpenRouterEndpointCapabilityCacheForTest(key: string, snapshot: OpenRouterEndpointSnapshot): void {
  setCache(key, snapshot);
}

export function openRouterEndpointCacheKey(
  providerConfigId: string,
  modelId: string,
  credentialScope?: string,
  endpointScope?: string,
): string {
  return `${providerConfigId}\u0000${credentialScope ?? ""}\u0000${endpointScope ?? ""}\u0000${modelId.trim()}`;
}

export async function resolveOpenRouterRoutingDecision(input: {
  providerConfigId: string;
  modelId: string;
  credentialScope?: string;
  endpointScope?: string;
  forceCapacityProtection?: boolean;
  envelope: OpenRouterCapacityEnvelope;
  discover: OpenRouterEndpointDiscovery;
  existingRouting?: OpenRouterProviderRouting;
  nowMs?: number;
}): Promise<OpenRouterRoutingDecision> {
  const now = input.nowMs ?? Date.now();
  const key = openRouterEndpointCacheKey(input.providerConfigId, input.modelId, input.credentialScope, input.endpointScope);
  const cached = cache.get(key);
  const fresh = cached && now - cached.capturedAtMs <= OPENROUTER_ENDPOINT_CACHE_FRESH_MS ? cached : undefined;
  const capacitySensitiveByThreshold = input.envelope.effectiveRequiredContext >= OPENROUTER_CAPACITY_RISK_THRESHOLD_TOKENS;
  const capacitySensitiveByKnownExclusion = Boolean(fresh && hasKnownExclusion(fresh.endpoints, input.envelope));
  const capacitySensitive = Boolean(input.forceCapacityProtection) || capacitySensitiveByThreshold || capacitySensitiveByKnownExclusion;

  if (!capacitySensitive) {
    return {
      mode: "normal",
      capacitySensitive: false,
      metadataSource: fresh ? "fresh" : "not_needed",
      envelope: input.envelope,
      endpoints: fresh ? classifyEndpoints(fresh.endpoints, input.envelope) : [],
      providerRouting: input.existingRouting,
    };
  }

  let snapshot = fresh;
  let metadataSource: EndpointMetadataSource = fresh ? "fresh" : "unavailable";
  if (!snapshot) {
    try {
      const endpoints = normalizeOpenRouterEndpointDiscovery(await input.discover(input.modelId));
      snapshot = { endpoints, capturedAtMs: now };
      setCache(key, snapshot);
      metadataSource = "fresh";
    } catch {
      if (cached && now - cached.capturedAtMs <= OPENROUTER_ENDPOINT_CACHE_LKG_MS) {
        snapshot = cached;
        metadataSource = "last_known_good";
      }
    }
  }

  if (!snapshot || snapshot.endpoints.length === 0) {
    return {
      mode: "unknown_attempt",
      capacitySensitive: true,
      metadataSource,
      envelope: input.envelope,
      endpoints: [],
      providerRouting: input.existingRouting,
    };
  }

  const endpoints = classifyEndpoints(snapshot.endpoints, input.envelope);
  const base = routingFromClassified(endpoints);
  const providerRouting = mergeOpenRouterProviderRouting(input.existingRouting, base.providerRouting);
  const explicitOrderLost = Boolean(
    input.existingRouting?.allowFallbacks === false
    && input.existingRouting.order?.length
    && providerRouting?.order
    && providerRouting.order.length === 0,
  );
  if ((providerRouting?.only && providerRouting.only.length === 0) || explicitOrderLost) {
    return {
      mode: "local_stop",
      capacitySensitive: true,
      metadataSource,
      envelope: input.envelope,
      endpoints,
      humanMessage: "The selected OpenRouter provider restriction does not include a verified route with enough context for this operation.",
    };
  }
  return {
    ...base,
    capacitySensitive: true,
    metadataSource,
    envelope: input.envelope,
    endpoints,
    ...(providerRouting ? { providerRouting } : {}),
  };
}

export const OPENROUTER_UNKNOWN_CAPACITY_ERROR =
  "This operation is larger than the context available on the OpenRouter route that was tried. AI RV Harness could not verify another route with enough capacity. Try again later or choose a model/provider route with a larger context window.";

export function isOpenRouterContextCapacityError(message: string): boolean {
  return /context(?: length| window)?|maximum context|max(?:imum)?[_ -]?(?:prompt|context|tokens?)|too many tokens|token limit/i.test(message);
}
