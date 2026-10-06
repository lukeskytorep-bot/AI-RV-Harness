import { sha256Text } from "../application/sha256";
import { requireWorkspaceViewerRoute } from "../aiCenter/viewerIdentitySelection";
import { resolveGenerationSettings } from "../providers/capabilities";
import { executeProviderChat, type ProviderChatAttempt, ProviderExecutionError } from "../providers/requestExecutor";
import { providerErrorDetails } from "../providers/providerError";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { composeTelepathicProviderMessages, type TelepathicProviderPacket } from "./packets";
import type { TelepathicAiRouteSnapshot, TelepathicParticipant, TelepathicProviderCallRecord } from "./types";

export interface ResolvedTelepathicAiRoute {
  snapshot: TelepathicAiRouteSnapshot;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  requestedSettings: GenerationSettings;
  validatedIdentity: {
    profileId: string;
    workspaceId: string;
    aiIdentityId: string;
    credentialFingerprint: string;
  };
}

export interface TelepathicProviderCallHooks {
  createCallId(): string;
  now(): string;
  persist(record: TelepathicProviderCallRecord): Promise<void>;
}

/**
 * Resolves a frozen participant route against the live repository immediately
 * before use. Archived/moved Workspaces, changed identity bindings, rotated
 * credentials and model-route changes therefore fail closed.
 */
export async function resolveTelepathicAiRouteFromRepository(input: {
  repository: AppRepository;
  participant: TelepathicParticipant;
  requestedSettings: GenerationSettings;
}): Promise<ResolvedTelepathicAiRoute> {
  const snapshot = input.participant.ai;
  if (input.participant.kind !== "ai" || !snapshot) throw new Error("Telepathic route resolution requires an AI participant.");

  const profile = (await input.repository.listProfiles()).find((item) => item.id === snapshot.profileId) ?? null;
  if (!profile) throw new Error("Telepathic participant Profile is no longer active.");
  const workspace = (await input.repository.listWorkspaces(profile.id)).find((item) => item.id === snapshot.workspaceId);
  if (!workspace) throw new Error("Telepathic participant Workspace is no longer active for its Profile.");
  const providerConfig = (await input.repository.listProviderConfigs()).find((item) => item.id === snapshot.providerConfigId);
  if (!providerConfig) throw new Error("Telepathic participant provider configuration is no longer available.");
  const model = (await input.repository.listProviderModels(providerConfig.id)).find((item) =>
    item.modelId === snapshot.modelId && item.route === snapshot.route,
  );
  if (!model) throw new Error("Telepathic participant model route is no longer available.");

  const identity = await requireWorkspaceViewerRoute({
    repository: input.repository,
    workspace,
    profile,
    identityId: snapshot.aiIdentityId,
    providerConfig,
    model,
  });
  if (identity.credentialFingerprint !== snapshot.credentialFingerprint) {
    throw new Error("Telepathic participant credential fingerprint changed after series lock.");
  }
  if (providerConfig.credentialId !== snapshot.credentialId) {
    throw new Error("Telepathic participant credential binding changed after series lock.");
  }

  return {
    snapshot: structuredClone(snapshot),
    providerConfig,
    model,
    requestedSettings: structuredClone(input.requestedSettings),
    validatedIdentity: {
      profileId: profile.id,
      workspaceId: workspace.id,
      aiIdentityId: identity.id,
      credentialFingerprint: identity.credentialFingerprint,
    },
  };
}

function assertExactRoute(route: ResolvedTelepathicAiRoute): void {
  const { snapshot, providerConfig, model, validatedIdentity } = route;
  if (
    validatedIdentity.profileId !== snapshot.profileId
    || validatedIdentity.workspaceId !== snapshot.workspaceId
    || validatedIdentity.aiIdentityId !== snapshot.aiIdentityId
    || validatedIdentity.credentialFingerprint !== snapshot.credentialFingerprint
  ) throw new Error("Telepathic participant live Profile/Workspace/identity binding no longer matches the series snapshot.");
  if (snapshot.providerConfigId !== providerConfig.id) throw new Error("Telepathic participant provider route changed after series lock.");
  if (snapshot.credentialId !== providerConfig.credentialId) throw new Error("Telepathic participant credential changed after series lock.");
  if (snapshot.modelId !== model.modelId || snapshot.route !== model.route || model.providerConfigId !== providerConfig.id) {
    throw new Error("Telepathic participant model route changed after series lock.");
  }
}

/**
 * Once the durable call record has reached `dispatched`, any failure whose
 * provider phase is not explicitly `before_dispatch` is conservative/uncertain.
 * This includes timeouts while waiting for response headers: the request may
 * already have reached the provider and may have been billed.
 */
function isAmbiguousFailure(error: unknown): boolean {
  if (error instanceof ProviderExecutionError) {
    return error.causeError.details.phase !== "before_dispatch" || error.report.ambiguousBillingAttempts > 0;
  }
  const details = providerErrorDetails(error);
  return details?.phase !== "before_dispatch";
}

export async function executeTelepathicProviderPacket(input: {
  packet: TelepathicProviderPacket;
  route: ResolvedTelepathicAiRoute;
  technicalAttempt: number;
  hooks: TelepathicProviderCallHooks;
  attempt?: ProviderChatAttempt;
}): Promise<{ response: ProviderChatResponse; call: TelepathicProviderCallRecord }> {
  assertExactRoute(input.route);
  const messages = composeTelepathicProviderMessages(input.packet);
  if (messages.some((message) => message.continuationState)) throw new Error("Telepathic provider payload cannot contain continuation state.");
  const requestSha256 = await sha256Text(JSON.stringify({ modelId: input.route.model.modelId, messages }));
  const timestamp = input.hooks.now();
  let call: TelepathicProviderCallRecord = {
    id: input.hooks.createCallId(),
    seriesId: input.packet.scope.seriesId,
    roundId: input.packet.scope.roundId,
    participantId: input.packet.scope.participantId,
    callStage: input.packet.scope.callStage,
    technicalAttempt: input.technicalAttempt,
    status: "prepared",
    scopeKey: input.packet.scopeKey,
    requestSha256,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await input.hooks.persist(call);
  call = { ...call, status: "dispatched", updatedAt: input.hooks.now() };
  await input.hooks.persist(call);
  try {
    const response = await executeProviderChat({
      config: input.route.providerConfig,
      modelId: input.route.model.modelId,
      messages,
      settings: resolveGenerationSettings(input.route.model.capabilities, input.route.requestedSettings),
      configuredRetries: 0,
      operationId: input.packet.scopeKey,
      operationKind: "conversation",
      attempt: input.attempt,
    });
    call = {
      ...call,
      status: "succeeded",
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      responseText: response.content,
      updatedAt: input.hooks.now(),
    };
    await input.hooks.persist(call);
    return { response, call };
  } catch (error) {
    call = {
      ...call,
      status: isAmbiguousFailure(error) ? "uncertain" : "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt: input.hooks.now(),
    };
    await input.hooks.persist(call);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { telepathicCall: call });
  }
}
