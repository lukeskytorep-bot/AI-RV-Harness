import { estimateProviderInputTokens } from "./inputTokenEstimate";
import {
  createOpenRouterCapacityEnvelope,
  openRouterProviderSlugMatches,
  resolveOpenRouterRoutingDecision,
  type ClassifiedOpenRouterEndpoint,
  type EndpointMetadataSource,
  type EndpointRoutingMode,
  type OpenRouterEndpointDiscovery,
  type OpenRouterRoutingDecision,
} from "./openRouterEndpointCapability";
import {
  resolveOperationResourceProfile,
  type CapacityRoutingPolicy,
  type OperationKind,
  type OperationRetryClass,
  type OperationTimeoutClass,
  type StreamPresentation,
} from "./operationResourceProfiles";
import { resolveStreamPresentation, type StreamWorkflowContext } from "./streamPresentation";
import { resolveProviderTimeoutPolicy, type ProviderTimeoutPolicy } from "./streamingPolicy";
import type {
  EffectiveGenerationSettings,
  OpenRouterProviderRouting,
  ProviderConfig,
  ProviderMessage,
} from "./types";

export type EffectiveRouteCertainty =
  | "not_applicable"
  | "not_required"
  | "verified_fit"
  | "unknown"
  | "blocked";

export type StreamingTransportMode = "streaming" | "non_streaming";

/**
 * Neutral pre-dispatch transport/resource view used by I1.
 * Workflow code should not need to know OpenRouter endpoint metadata shapes.
 */
export interface EffectiveRequestEnvelope {
  operationKind: OperationKind;
  modelId: string;
  estimatedInputTokens: number;
  routingSafetyMarginTokens: number;
  conservativeInputTokens: number;
  requestedCompletionAllowance: number;
  effectiveRequiredContext: number;
  capacityRoutingPolicy: CapacityRoutingPolicy;
  eligibleProviderRoutes: string[];
  unknownProviderRoutes: string[];
  routeCertainty: EffectiveRouteCertainty;
  streamingMode: StreamingTransportMode;
  timeoutClass: OperationTimeoutClass;
  retryClass: OperationRetryClass;
  presentationMode: StreamPresentation;
}

export interface EffectiveDispatchDecision {
  envelope: EffectiveRequestEnvelope;
  timeoutPolicy: ProviderTimeoutPolicy;
  providerRouting?: OpenRouterProviderRouting;
  endpointRoutingMode?: EndpointRoutingMode;
  endpointMetadataSource?: EndpointMetadataSource;
  localStopMessage?: string;
}

function hardOrderSelectors(routing: OpenRouterProviderRouting | undefined): string[] {
  return routing?.allowFallbacks === false ? (routing.order ?? []).filter(Boolean) : [];
}

function selectorSetsOverlap(left: string, right: string): boolean {
  return openRouterProviderSlugMatches(left, right) || openRouterProviderSlugMatches(right, left);
}

function routeAllowedByFinalRouting(routeTag: string, routing: OpenRouterProviderRouting | undefined): boolean {
  if (routing?.only && routing.only.length === 0) return false;
  if (routing?.only?.length && !routing.only.some((selector) => openRouterProviderSlugMatches(selector, routeTag))) return false;
  if (routing?.ignore?.some((selector) => openRouterProviderSlugMatches(selector, routeTag))) return false;

  const hardOrder = hardOrderSelectors(routing);
  if (hardOrder.length && !hardOrder.some((selector) => openRouterProviderSlugMatches(selector, routeTag))) return false;
  return true;
}

function endpointAllowedByFinalRouting(
  endpoint: ClassifiedOpenRouterEndpoint,
  routing: OpenRouterProviderRouting | undefined,
): boolean {
  if (endpoint.routeTag) return routeAllowedByFinalRouting(endpoint.routeTag, routing);
  if (routing?.only && routing.only.length === 0) return false;

  // Untagged discovery can still prove capacity for ordinary routing, but it cannot
  // prove that a positive only/hard-order selector is satisfied.
  return !(routing?.only?.length || hardOrderSelectors(routing).length);
}

function routeTags(
  endpoints: ClassifiedOpenRouterEndpoint[],
  routing: OpenRouterProviderRouting | undefined,
  state: "PROVEN_FIT" | "UNKNOWN",
): string[] {
  return [...new Set(endpoints.flatMap((endpoint) =>
    endpoint.capacityState === state
      && endpoint.routeTag
      && routeAllowedByFinalRouting(endpoint.routeTag, routing)
      ? [endpoint.routeTag]
      : [],
  ))];
}

function positiveUnknownSelectors(
  existingRouting: OpenRouterProviderRouting | undefined,
  finalRouting: OpenRouterProviderRouting | undefined,
  endpoints: ClassifiedOpenRouterEndpoint[],
): string[] {
  const only = (existingRouting?.only ?? []).filter(Boolean);
  const hardOrder = hardOrderSelectors(existingRouting);

  let candidates: string[] = [];
  if (hardOrder.length) {
    candidates = hardOrder.filter((selector) =>
      !only.length || only.some((onlySelector) => selectorSetsOverlap(selector, onlySelector)),
    );
  } else if (only.length) {
    candidates = only;
  }

  const ignore = finalRouting?.ignore ?? [];
  return [...new Set(candidates.filter((selector) => {
    if (ignore.some((ignoredSelector) => openRouterProviderSlugMatches(ignoredSelector, selector))) return false;

    // If discovery contains a matching route, its real FIT/NO/UNKNOWN classification
    // must decide the result. Absence from discovery is UNKNOWN, never PROVEN_NO.
    return !endpoints.some((endpoint) =>
      endpoint.routeTag && openRouterProviderSlugMatches(selector, endpoint.routeTag),
    );
  }))];
}

interface FinalRoutingReconciliation {
  providerRouting?: OpenRouterProviderRouting;
  endpointRoutingMode: EndpointRoutingMode;
  eligibleProviderRoutes: string[];
  unknownProviderRoutes: string[];
  routeCertainty: EffectiveRouteCertainty;
  localStopMessage?: string;
}

function reconcileFinalOpenRouterRouting(
  decision: OpenRouterRoutingDecision,
  existingRouting: OpenRouterProviderRouting | undefined,
): FinalRoutingReconciliation {
  const providerRouting = decision.providerRouting
    ? structuredClone(decision.providerRouting)
    : existingRouting
      ? structuredClone(existingRouting)
      : undefined;

  const eligibleProviderRoutes = routeTags(decision.endpoints, providerRouting, "PROVEN_FIT");
  const unknownProviderRoutes = routeTags(decision.endpoints, providerRouting, "UNKNOWN");

  if (!decision.capacitySensitive) {
    return {
      ...(providerRouting ? { providerRouting } : {}),
      endpointRoutingMode: decision.mode,
      eligibleProviderRoutes,
      unknownProviderRoutes,
      routeCertainty: "not_required",
      ...(decision.humanMessage ? { localStopMessage: decision.humanMessage } : {}),
    };
  }

  const hasAllowedFit = decision.endpoints.some((endpoint) =>
    endpoint.capacityState === "PROVEN_FIT" && endpointAllowedByFinalRouting(endpoint, providerRouting),
  );
  const hasAllowedUnknown = decision.endpoints.some((endpoint) =>
    endpoint.capacityState === "UNKNOWN" && endpointAllowedByFinalRouting(endpoint, providerRouting),
  );
  const selectedUnknown = positiveUnknownSelectors(existingRouting, providerRouting, decision.endpoints);

  if (hasAllowedFit) {
    return {
      ...(providerRouting ? { providerRouting } : {}),
      endpointRoutingMode: decision.mode === "normal" ? "normal" : "verified_fit",
      eligibleProviderRoutes,
      unknownProviderRoutes,
      routeCertainty: "verified_fit",
    };
  }

  if (hasAllowedUnknown || selectedUnknown.length > 0 || (decision.endpoints.length === 0 && decision.mode === "unknown_attempt")) {
    return {
      ...(providerRouting ? { providerRouting } : {}),
      endpointRoutingMode: "unknown_attempt",
      eligibleProviderRoutes,
      unknownProviderRoutes: [...new Set([...unknownProviderRoutes, ...selectedUnknown])],
      routeCertainty: "unknown",
    };
  }

  return {
    ...(providerRouting ? { providerRouting } : {}),
    endpointRoutingMode: "local_stop",
    eligibleProviderRoutes,
    unknownProviderRoutes,
    routeCertainty: "blocked",
    localStopMessage: decision.humanMessage
      ?? "The selected OpenRouter provider restrictions leave no route with verified capacity for this operation.",
  };
}

export function streamingTransportMode(config: ProviderConfig): StreamingTransportMode {
  return config.provider === "openrouter" ? "streaming" : "non_streaming";
}

/**
 * I1 single pre-dispatch decision point.
 * The caller must pass the fully assembled logical messages, including any
 * continuation state, because sizing must describe the payload that will
 * actually be dispatched.
 */
export async function resolveEffectiveRequestEnvelope(input: {
  config: ProviderConfig;
  modelId: string;
  messages: ProviderMessage[];
  settings: EffectiveGenerationSettings;
  timeoutMs?: number;
  operationId?: string;
  operationKind?: OperationKind;
  providerRouting?: OpenRouterProviderRouting;
  endpointDiscovery?: OpenRouterEndpointDiscovery;
  capacityProtectedRouting?: boolean;
  streamWorkflowContext?: StreamWorkflowContext;
}): Promise<EffectiveDispatchDecision> {
  const inputEstimate = estimateProviderInputTokens(input.messages);
  const capacityEnvelope = createOpenRouterCapacityEnvelope({
    estimatedInputTokens: inputEstimate.estimatedInputTokens,
    settings: input.settings,
  });

  const resourceProfile = resolveOperationResourceProfile({
    operationId: input.operationId,
    operationKind: input.operationKind,
  });
  const capacityRoutingPolicy: CapacityRoutingPolicy = input.capacityProtectedRouting
    ? "prefer_verified_fit"
    : resourceProfile.capacityRoutingPolicy;

  let providerRouting = input.providerRouting ? structuredClone(input.providerRouting) : undefined;
  let endpointRoutingMode: EndpointRoutingMode | undefined;
  let endpointMetadataSource: EndpointMetadataSource | undefined;
  let eligibleProviderRoutes: string[] = [];
  let unknownProviderRoutes: string[] = [];
  let certainty: EffectiveRouteCertainty = "not_applicable";
  let localStopMessage: string | undefined;

  if (input.config.provider === "openrouter") {
    if (!input.endpointDiscovery) {
      throw new Error("OpenRouter endpoint discovery callback is required for effective request resolution.");
    }
    const decision = await resolveOpenRouterRoutingDecision({
      providerConfigId: input.config.id,
      modelId: input.modelId,
      credentialScope: input.config.credentialFingerprint ?? input.config.credentialId,
      endpointScope: input.config.baseUrl ?? "",
      envelope: capacityEnvelope,
      forceCapacityProtection: capacityRoutingPolicy === "prefer_verified_fit",
      existingRouting: providerRouting,
      discover: input.endpointDiscovery,
    });
    const reconciled = reconcileFinalOpenRouterRouting(decision, providerRouting);
    providerRouting = reconciled.providerRouting;
    endpointRoutingMode = reconciled.endpointRoutingMode;
    endpointMetadataSource = decision.metadataSource;
    eligibleProviderRoutes = reconciled.eligibleProviderRoutes;
    unknownProviderRoutes = reconciled.unknownProviderRoutes;
    certainty = reconciled.routeCertainty;
    localStopMessage = reconciled.localStopMessage;
  }

  const streamPresentation = resolveStreamPresentation({
    operationKind: resourceProfile.operationKind,
    workflowContext: input.streamWorkflowContext,
  });
  const timeoutPolicy = resolveProviderTimeoutPolicy(resourceProfile.timeoutClass, input.timeoutMs);

  return {
    envelope: {
      operationKind: resourceProfile.operationKind,
      modelId: input.modelId,
      estimatedInputTokens: capacityEnvelope.estimatedInputTokens,
      routingSafetyMarginTokens: capacityEnvelope.routingSafetyMarginTokens,
      conservativeInputTokens: capacityEnvelope.conservativeInputTokens,
      requestedCompletionAllowance: capacityEnvelope.requestedCompletionAllowance,
      effectiveRequiredContext: capacityEnvelope.effectiveRequiredContext,
      capacityRoutingPolicy,
      eligibleProviderRoutes,
      unknownProviderRoutes,
      routeCertainty: certainty,
      streamingMode: streamingTransportMode(input.config),
      timeoutClass: resourceProfile.timeoutClass,
      retryClass: resourceProfile.retryClass,
      presentationMode: streamPresentation.presentation,
    },
    timeoutPolicy,
    ...(providerRouting ? { providerRouting } : {}),
    ...(endpointRoutingMode ? { endpointRoutingMode } : {}),
    ...(endpointMetadataSource ? { endpointMetadataSource } : {}),
    ...(localStopMessage ? { localStopMessage } : {}),
  };
}
