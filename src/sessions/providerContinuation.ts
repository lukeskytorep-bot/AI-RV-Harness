import { captureOpenRouterContinuationState, validateOpenRouterReplayBudget, validateOpenRouterReplayForRequest } from "../providers/openRouterContinuation";
import type { ProviderContinuationState } from "../providers/continuationContract";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import type { SessionContinuationRouteSnapshot, SessionEventInput, SessionEventRecord, SessionSnapshot } from "./types";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";

export class SessionContinuationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionContinuationError";
  }
}

export function captureSessionContinuationRoute(config: ProviderConfig, model: ProviderModel): SessionContinuationRouteSnapshot | undefined {
  if (config.provider !== "openrouter") return undefined;
  if (model.providerConfigId !== config.id || model.provider !== config.provider) throw new SessionContinuationError("Viewer model/provider route mismatch while freezing continuation state.");
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


export function validateFrozenSessionContinuationRequest(
  snapshot: SessionSnapshot,
  config: ProviderConfig,
  requestedModelId: string,
): SessionContinuationRouteSnapshot | undefined {
  const route = snapshot.continuationRoute;
  if (!route) return undefined;
  if (
    route.transport !== "openrouter"
    || route.normalizedEndpoint !== OPENROUTER_ENDPOINT
    || route.providerConfigId !== config.id
    || route.credentialId !== config.credentialId
    || route.requestedModelId !== requestedModelId
    || route.stateFormat !== "openrouter-reasoning-details"
    || route.stateFormatVersion !== 1
    || config.provider !== "openrouter"
  ) {
    throw new SessionContinuationError("The frozen OpenRouter continuation route no longer matches the captured provider, credential, endpoint, or model.");
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
  if (model.provider !== "openrouter" || model.providerConfigId !== config.id) {
    throw new SessionContinuationError("The frozen OpenRouter continuation route no longer matches the captured Viewer model route.");
  }
  return route;
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
  if (!input.route || input.providerConfig.provider !== "openrouter") {
    await input.repository.appendSessionEvent(input.sessionId, input.event);
    return {};
  }
  const captured = captureOpenRouterContinuationState({
    config: input.providerConfig,
    requestedModelId: input.model.modelId,
    normalizedEndpoint: input.route.normalizedEndpoint,
    reasoningDetails: input.response.reasoningDetails,
  });
  if (captured.issue) {
    await input.repository.appendSessionEvent(input.sessionId, {
      ...input.event,
      metadata: { ...(input.event.metadata ?? {}), continuationState: { status: "invalid", code: captured.issue.code } },
    });
    throw new SessionContinuationError(`OpenRouter continuation state was returned but failed validation: ${captured.issue.message}`);
  }
  if (!captured.state) {
    await input.repository.appendSessionEvent(input.sessionId, input.event);
    return {};
  }
  if (!input.repository.appendSessionEventWithProviderState) {
    throw new SessionContinuationError("The repository cannot persist the OpenRouter continuation state returned for this Session turn.");
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
    if (marker?.status === "stored") throw new SessionContinuationError("Required OpenRouter continuation state is missing for a persisted assistant Session event.");
    if (marker?.status === "invalid") throw new SessionContinuationError("A persisted assistant Session event records invalid OpenRouter continuation state.");
    return input.message;
  }
  const replay = validateOpenRouterReplayForRequest({ state: binding.state, config: input.config, requestedModelId: input.requestedModelId, normalizedEndpoint: route.normalizedEndpoint });
  if (!replay.ok) throw new SessionContinuationError(`Persisted OpenRouter continuation state is incompatible with the frozen session route: ${replay.issue.message}`);
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
    if (marker?.status === "stored") throw new SessionContinuationError("Required OpenRouter continuation state is missing for a persisted assistant Session event.");
    if (marker?.status === "invalid") throw new SessionContinuationError("A persisted assistant Session event records invalid OpenRouter continuation state.");
    return input.message;
  }
  const replay = validateOpenRouterReplayForRequest({
    state: binding.state,
    config: input.config,
    requestedModelId: input.model.modelId,
    normalizedEndpoint: route.normalizedEndpoint,
  });
  if (!replay.ok) throw new SessionContinuationError(`Persisted OpenRouter continuation state is incompatible with the frozen session route: ${replay.issue.message}`);
  return { ...input.message, continuationState: structuredClone(replay.state) };
}

export function validateSessionContinuationBudget(messages: readonly ProviderMessage[]): void {
  const states = messages.flatMap((message) => message.continuationState ? [message.continuationState] : []);
  const checked = validateOpenRouterReplayBudget(states);
  if (!checked.ok) throw new SessionContinuationError(`OpenRouter continuation state cannot fit this request: ${checked.issue.message}`);
}
