import { validateContinuationRequestBudget, type ProviderContinuationState } from "../providers/continuationContract";
import { captureAnthropicContinuationState, validateAnthropicReplayForRequest } from "../providers/anthropicContinuation";
import { captureGoogleContinuationState, validateGoogleReplayForRequest } from "../providers/googleContinuation";
import { captureOpenRouterContinuationState, validateOpenRouterReplayForRequest } from "../providers/openRouterContinuation";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { SessionContinuationRouteSnapshot, SessionEventInput, SessionEventRecord, SessionSnapshot } from "./types";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";
const GOOGLE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1";

export const ANTHROPIC_SANITIZED_TURN_AUTO_STOP_REASON = "AUTO-STOP: Anthropic continuation cannot safely replay a signed assistant turn after output sanitization modified its visible text.";

export function requiresAnthropicContinuationStopAfterContentMutation(
  route: SessionContinuationRouteSnapshot | undefined,
  originalContent: string,
  persistedContent: string,
): boolean {
  return route?.transport === "anthropic-native" && originalContent !== persistedContent;
}

export class SessionContinuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionContinuationError";
  }
}

type RuntimeSessionContinuationRouteSnapshot = {
  transport?: unknown;
};

function requireSupportedSessionContinuationRoute(
  route: SessionContinuationRouteSnapshot,
): SessionContinuationRouteSnapshot {
  const runtimeRoute = route as unknown as RuntimeSessionContinuationRouteSnapshot;
  if (runtimeRoute.transport === "openrouter" || runtimeRoute.transport === "google-native" || runtimeRoute.transport === "anthropic-native") return route;
  throw new SessionContinuationError("Unsupported frozen provider continuation transport.");
}

export function captureSessionContinuationRoute(config: ProviderConfig, model: ProviderModel): SessionContinuationRouteSnapshot | undefined {
  if (model.providerConfigId !== config.id || model.provider !== config.provider) {
    if (config.provider === "openrouter" || config.provider === "google" || config.provider === "anthropic") throw new SessionContinuationError("Viewer model/provider route mismatch while freezing continuation state.");
    return undefined;
  }
  if (config.provider === "openrouter") {
    return {
      transport: "openrouter",
      normalizedEndpoint: OPENROUTER_ENDPOINT,
      providerConfigId: config.id,
      credentialId: config.credentialId,
      requestedModelId: model.modelId,
      stateFormat: "openrouter-reasoning-details",
      stateFormatVersion: 1,
    };
  }
  if (config.provider === "google") {
    return {
      transport: "google-native",
      normalizedEndpoint: GOOGLE_ENDPOINT,
      providerConfigId: config.id,
      credentialId: config.credentialId,
      requestedModelId: model.modelId,
      stateFormat: "google-thought-parts",
      stateFormatVersion: 1,
    };
  }
  if (config.provider === "anthropic") {
    return {
      transport: "anthropic-native",
      normalizedEndpoint: ANTHROPIC_ENDPOINT,
      providerConfigId: config.id,
      credentialId: config.credentialId,
      requestedModelId: model.modelId,
      stateFormat: "anthropic-thinking-blocks",
      stateFormatVersion: 1,
      prefixPolicy: "append-only",
    };
  }
  return undefined;
}

export function validateFrozenSessionContinuationRequest(
  snapshot: SessionSnapshot,
  config: ProviderConfig,
  requestedModelId: string,
): SessionContinuationRouteSnapshot | undefined {
  const frozenRoute = snapshot.continuationRoute;
  if (!frozenRoute) return undefined;
  const route = requireSupportedSessionContinuationRoute(frozenRoute);
  const commonMismatch = route.providerConfigId !== config.id
    || route.credentialId !== config.credentialId
    || route.requestedModelId !== requestedModelId
    || route.stateFormatVersion !== 1;
  let transportMismatch: boolean;
  if (route.transport === "openrouter") {
    transportMismatch = config.provider !== "openrouter"
      || route.normalizedEndpoint !== OPENROUTER_ENDPOINT
      || route.stateFormat !== "openrouter-reasoning-details";
  } else if (route.transport === "google-native") {
    transportMismatch = config.provider !== "google"
      || route.normalizedEndpoint !== GOOGLE_ENDPOINT
      || route.stateFormat !== "google-thought-parts";
  } else if (route.transport === "anthropic-native") {
    transportMismatch = config.provider !== "anthropic"
      || route.normalizedEndpoint !== ANTHROPIC_ENDPOINT
      || route.stateFormat !== "anthropic-thinking-blocks"
      || route.prefixPolicy !== "append-only";
  } else {
    throw new SessionContinuationError("Unsupported frozen provider continuation transport.");
  }
  if (commonMismatch || transportMismatch) {
    throw new SessionContinuationError("The frozen provider continuation route no longer matches the captured provider, credential, endpoint, or model.");
  }
  return route;
}

export function validateFrozenSessionContinuationRoute(
  snapshot: SessionSnapshot,
  config: ProviderConfig,
  model: ProviderModel,
): SessionContinuationRouteSnapshot | undefined {
  const route = validateFrozenSessionContinuationRequest(snapshot, config, model.modelId);
  if (!route) return undefined;
  let expectedProvider: ProviderModel["provider"];
  if (route.transport === "openrouter") {
    expectedProvider = "openrouter";
  } else if (route.transport === "google-native") {
    expectedProvider = "google";
  } else if (route.transport === "anthropic-native") {
    expectedProvider = "anthropic";
  } else {
    throw new SessionContinuationError("Unsupported frozen provider continuation transport.");
  }
  if (model.provider !== expectedProvider || model.providerConfigId !== config.id) {
    throw new SessionContinuationError("The frozen provider continuation route no longer matches the captured Viewer model route.");
  }
  return route;
}

export function captureSessionContinuationState(input: {
  response: ProviderChatResponse;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  route?: SessionContinuationRouteSnapshot;
}):
  | { state: ProviderContinuationState; issue?: never }
  | { state?: never; issue: { code: string; message: string } }
  | { state?: never; issue?: never } {
  const frozenRoute = input.route;
  if (!frozenRoute) return {};
  const route = requireSupportedSessionContinuationRoute(frozenRoute);
  if (!input.response.reasoningDetails?.length) return {};
  if (route.transport === "openrouter") {
    return captureOpenRouterContinuationState({
      config: input.providerConfig,
      requestedModelId: input.model.modelId,
      normalizedEndpoint: route.normalizedEndpoint,
      reasoningDetails: input.response.reasoningDetails,
    });
  }
  if (route.transport === "google-native") {
    return captureGoogleContinuationState({
      config: input.providerConfig,
      requestedModelId: input.model.modelId,
      normalizedEndpoint: route.normalizedEndpoint,
      parts: input.response.reasoningDetails,
      visibleContent: input.response.content,
    });
  }
  if (route.transport === "anthropic-native") {
    return captureAnthropicContinuationState({
      config: input.providerConfig,
      requestedModelId: input.model.modelId,
      normalizedEndpoint: route.normalizedEndpoint,
      blocks: input.response.reasoningDetails,
    });
  }
  throw new SessionContinuationError("Unsupported frozen provider continuation transport.");
}

export async function persistSessionAssistantResponse(input: {
  repository: Pick<AppRepository, "appendSessionEvent"> & Partial<Pick<AppRepository, "appendSessionEventWithProviderState">>;
  sessionId: string;
  event: SessionEventInput;
  response: ProviderChatResponse;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  route?: SessionContinuationRouteSnapshot;
}): Promise<{ state?: ProviderContinuationState; event?: SessionEventRecord }> {
  if (!input.route) {
    await input.repository.appendSessionEvent(input.sessionId, input.event);
    return {};
  }
  const captured = captureSessionContinuationState(input);
  if (captured.issue) {
    await input.repository.appendSessionEvent(input.sessionId, {
      ...input.event,
      metadata: { ...(input.event.metadata ?? {}), continuationState: { status: "invalid", code: captured.issue.code } },
    });
    throw new SessionContinuationError(`Provider continuation state was returned but failed validation: ${captured.issue.message}`);
  }
  if (!captured.state) {
    await input.repository.appendSessionEvent(input.sessionId, input.event);
    return {};
  }
  if (!input.repository.appendSessionEventWithProviderState) {
    throw new SessionContinuationError("The repository cannot persist the provider continuation state returned for this Session turn.");
  }
  const event = await input.repository.appendSessionEventWithProviderState(input.sessionId, {
    ...input.event,
    metadata: {
      ...(input.event.metadata ?? {}),
      continuationState: { status: "stored", format: captured.state.format, version: captured.state.schemaVersion },
    },
  }, captured.state);
  return { state: captured.state, event };
}

export function appendAssistantMessageWithContinuation(messages: ProviderMessage[], content: string, state?: ProviderContinuationState): void {
  messages.push({ role: "assistant", content, ...(state ? { continuationState: structuredClone(state) } : {}) });
}

function replayStateForRoute(input: {
  state: ProviderContinuationState;
  route: SessionContinuationRouteSnapshot;
  config: ProviderConfig;
  requestedModelId: string;
}): { ok: true; state: ProviderContinuationState } | { ok: false; issue: { message: string } } {
  const route = requireSupportedSessionContinuationRoute(input.route);
  if (route.transport === "openrouter") {
    return validateOpenRouterReplayForRequest({
      state: input.state, config: input.config, requestedModelId: input.requestedModelId, normalizedEndpoint: route.normalizedEndpoint,
    });
  }
  if (route.transport === "google-native") {
    return validateGoogleReplayForRequest({
      state: input.state, config: input.config, requestedModelId: input.requestedModelId, normalizedEndpoint: route.normalizedEndpoint,
    });
  }
  if (route.transport === "anthropic-native") {
    return validateAnthropicReplayForRequest({
      state: input.state, config: input.config, requestedModelId: input.requestedModelId, normalizedEndpoint: route.normalizedEndpoint,
    });
  }
  throw new SessionContinuationError("Unsupported frozen provider continuation transport.");
}

export async function hydrateSessionMessageContinuationForRequest(input: {
  repository: Pick<AppRepository, "getSessionEventProviderState">;
  snapshot: SessionSnapshot;
  config: ProviderConfig;
  requestedModelId: string;
  event: SessionEventRecord;
  message: ProviderMessage;
}): Promise<ProviderMessage> {
  const route = validateFrozenSessionContinuationRequest(input.snapshot, input.config, input.requestedModelId);
  if (!route || input.message.role !== "assistant") return input.message;
  const marker = input.event.metadata?.continuationState as { status?: unknown } | undefined;
  const binding = await input.repository.getSessionEventProviderState(input.event.id);
  if (!binding) {
    if (marker?.status === "stored") throw new SessionContinuationError("Required provider continuation state is missing for a persisted assistant Session event.");
    if (marker?.status === "invalid") throw new SessionContinuationError("A persisted assistant Session event records invalid provider continuation state.");
    return input.message;
  }
  const replay = replayStateForRoute({ state: binding.state, route, config: input.config, requestedModelId: input.requestedModelId });
  if (!replay.ok) throw new SessionContinuationError(`Persisted provider continuation state is incompatible with the frozen session route: ${replay.issue.message}`);
  return { ...input.message, continuationState: structuredClone(replay.state) };
}

export async function hydrateSessionMessageContinuation(input: {
  repository: Pick<AppRepository, "getSessionEventProviderState">;
  snapshot: SessionSnapshot;
  config: ProviderConfig;
  model: ProviderModel;
  event: SessionEventRecord;
  message: ProviderMessage;
}): Promise<ProviderMessage> {
  const route = validateFrozenSessionContinuationRoute(input.snapshot, input.config, input.model);
  if (!route || input.message.role !== "assistant") return input.message;
  const marker = input.event.metadata?.continuationState as { status?: unknown } | undefined;
  const binding = await input.repository.getSessionEventProviderState(input.event.id);
  if (!binding) {
    if (marker?.status === "stored") throw new SessionContinuationError("Required provider continuation state is missing for a persisted assistant Session event.");
    if (marker?.status === "invalid") throw new SessionContinuationError("A persisted assistant Session event records invalid provider continuation state.");
    return input.message;
  }
  const replay = replayStateForRoute({ state: binding.state, route, config: input.config, requestedModelId: input.model.modelId });
  if (!replay.ok) throw new SessionContinuationError(`Persisted provider continuation state is incompatible with the frozen session route: ${replay.issue.message}`);
  return { ...input.message, continuationState: structuredClone(replay.state) };
}

export function validateSessionContinuationBudget(messages: readonly ProviderMessage[]): void {
  const states = messages.flatMap((message) => message.continuationState ? [message.continuationState] : []);
  const checked = validateContinuationRequestBudget(states);
  if (!checked.ok) throw new SessionContinuationError(`Provider continuation state cannot fit this request: ${checked.message}`);
}
