import { scopeOutputBudget, outputAttemptBudget, validateOutputBudgetSnapshot, type TelepathicOutputBudgetSnapshot } from "./outputBudgets";
import { viewerResponseCompletion } from "../sessions/viewerOutputRecovery";
import { preflightTelepathicPacket } from "./preflight";
import { sha256Text } from "../application/sha256";
import { requireWorkspaceViewerRoute } from "../aiCenter/viewerIdentitySelection";
import { resolveGenerationSettings } from "../providers/capabilities";
import { executeProviderChat, type ProviderChatAttempt, ProviderExecutionError } from "../providers/requestExecutor";
import { providerErrorDetails } from "../providers/providerError";
import type { GenerationSettings, ProviderChatResponse, ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { composeTelepathicProviderMessages, type TelepathicProviderPacket } from "./packets";
import type { TelepathicAiRouteSnapshot, TelepathicLanguage, TelepathicParticipant, TelepathicProviderCallRecord } from "./types";
import { isStreamingRepetitionRunawayError, runWithStreamingRepetitionGuard } from "../sessions/streamingRepetitionGuard";
import { sanitizeRepetitiveOutput } from "../sessions/repetitionGuard";

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

// The scope contract excludes only the deliberate per-attempt output escalation.
// Effective generation and the actual provider endpoint/route are otherwise fixed.
export async function telepathicRequestFingerprint(packet: TelepathicProviderPacket, route: ResolvedTelepathicAiRoute, fixedLead: boolean, outputBudget?: TelepathicOutputBudgetSnapshot): Promise<string> {
  const messages = composeTelepathicProviderMessages(packet);
  if (!fixedLead) return sha256Text(JSON.stringify({ modelId: route.model.modelId, messages }));
  const settings = resolveGenerationSettings(route.model.capabilities, route.requestedSettings);
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
  return sha256Text(JSON.stringify(canonical({ modelId: route.model.modelId, messages, settings,
    outputCeiling: route.model.capabilities.maxOutputTokens, provider: route.providerConfig.provider,
    baseUrl: route.providerConfig.baseUrl, outputTokenField: route.providerConfig.customOutputTokenField, route: route.model.route, ...(outputBudget?.version === 2 ? { outputBudget } : {}) })));
}

export async function executeTelepathicProviderPacket(input: {
  packet: TelepathicProviderPacket;
  route: ResolvedTelepathicAiRoute;
  technicalAttempt: number;
  hooks: TelepathicProviderCallHooks;
  attempt?: ProviderChatAttempt;
  signal?: AbortSignal;
  fixedLead?: boolean;
  outputBudgetSnapshot?: TelepathicOutputBudgetSnapshot;
  validateResponse?: (text: string) => void;
  repetitionGuardLanguage?: TelepathicLanguage;
}): Promise<{ response: ProviderChatResponse; call: TelepathicProviderCallRecord }> {
  assertExactRoute(input.route);
  const messages = composeTelepathicProviderMessages(input.packet);
  if (messages.some((message) => message.continuationState)) throw new Error("Telepathic provider payload cannot contain continuation state.");
  const outputBudget = input.fixedLead ? input.outputBudgetSnapshot ?? scopeOutputBudget(input.packet.scope.callStage, input.route.model.capabilities.maxOutputTokens) : undefined;
  if (outputBudget) validateOutputBudgetSnapshot(outputBudget, input.packet.scope.callStage, input.route.model.capabilities.maxOutputTokens);
  const budget = outputBudget ? outputAttemptBudget(outputBudget, input.technicalAttempt) : undefined;
  if (!Number.isSafeInteger(input.technicalAttempt) || ![1, 2].includes(input.technicalAttempt)) throw new Error("Telepathic stage attempts exhausted; only two attempts are allowed.");
  const requestSha256 = await telepathicRequestFingerprint(input.packet, input.route, Boolean(input.fixedLead), outputBudget);
  input.signal?.throwIfAborted();
  const requestedSettings = budget ? { ...input.route.requestedSettings, maxOutputTokens: budget.effective } : input.route.requestedSettings;
  const validation = preflightTelepathicPacket({ packet: input.packet, model: input.route.model, reservedOutputTokens: requestedSettings.maxOutputTokens });
  if (input.fixedLead && validation.budget.exceeded) throw new Error("Telepathic packet exceeds the model context budget; no materials were truncated.");
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
    requestSettings: resolveGenerationSettings(input.route.model.capabilities, requestedSettings),
    ...(outputBudget ? { outputBudgetSnapshot: structuredClone(outputBudget) } : {}),
    outputDiagnostics: { ...(outputBudget ? { policyVersion: outputBudget.version } : {}), requestedMaxOutputTokens: budget?.requested ?? requestedSettings.maxOutputTokens, effectiveMaxOutputTokens: resolveGenerationSettings(input.route.model.capabilities, requestedSettings).effective.maxOutputTokens, modelMaxOutputTokens: input.route.model.capabilities.maxOutputTokens, completion: "unknown" },
    ...(input.fixedLead ? { requestMessages: messages.map(({role,content,images}) => ({ role, content, ...(images?.length ? { images: images.map(({mimeType}) => ({ mimeType, dataBase64: "[attachment transmitted]" })) } : {}) })) } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await input.hooks.persist(call);
  input.signal?.throwIfAborted();
  call = { ...call, status: "dispatched", updatedAt: input.hooks.now() };
  await input.hooks.persist(call);
  try {
    const response = await runWithStreamingRepetitionGuard({
      parentSignal: input.signal,
      language: input.repetitionGuardLanguage,
      execute: (signal, internalOnStreamEvent) => executeProviderChat({
        config: input.route.providerConfig,
        modelId: input.route.model.modelId,
        messages,
        settings: resolveGenerationSettings(input.route.model.capabilities, requestedSettings),
        configuredRetries: 0,
        operationId: input.packet.scopeKey,
        operationKind: "conversation",
        attempt: input.attempt,
        signal,
        internalOnStreamEvent,
      }),
    });
    const sanitized = sanitizeRepetitiveOutput(response.content, input.repetitionGuardLanguage ?? "en");
    if (sanitized.truncated) {
      call = {
        ...call,
        status: "failed",
        outputDiagnostics: { ...call.outputDiagnostics!, completion: "partial" },
        usage: response.usage,
        elapsedMs: response.execution?.elapsedMs ?? Math.max(0, Date.parse(input.hooks.now()) - Date.parse(timestamp)),
        physicalAttempts: response.execution?.physicalAttempts ?? 1,
        costSource: response.usage.costUsd !== undefined ? "provider" : "unknown",
        finishReason: "repetition_runaway",
        ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
        responseText: sanitized.content,
        errorMessage: "Detected repetition runaway; the partial output was not accepted.",
        updatedAt: input.hooks.now(),
      };
      await input.hooks.persist(call);
      throw Object.assign(new Error(call.errorMessage), { telepathicCall: call });
    }
    let domainError: string | undefined;
    if (!input.fixedLead || viewerResponseCompletion(response) === "complete") {
      try { input.validateResponse?.(response.content); }
      catch (error) { domainError = error instanceof Error ? error.message : String(error); }
    }
    call = {
      ...call,
      ...(domainError ? { errorMessage: domainError } : {}),
      status: domainError || input.fixedLead && viewerResponseCompletion(response) !== "complete" ? "failed" : "succeeded",
      outputDiagnostics: { ...call.outputDiagnostics!, completion: viewerResponseCompletion(response) === "complete" ? "complete" : "partial" },
      usage: response.usage, elapsedMs: response.execution?.elapsedMs ?? Math.max(0, Date.parse(input.hooks.now()) - Date.parse(timestamp)),
      physicalAttempts: response.execution?.physicalAttempts ?? 1,
      costSource: response.usage.costUsd !== undefined ? "provider" : "unknown", finishReason: response.finishReason,
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      responseText: response.content,
      updatedAt: input.hooks.now(),
    };
    await input.hooks.persist(call);
    if (call.status === "failed") throw Object.assign(new Error(domainError ?? `Incomplete telepathic output: ${viewerResponseCompletion(response)}`), { telepathicCall: call });
    return { response, call };
  } catch (error) {
    if ((error as { telepathicCall?: TelepathicProviderCallRecord })?.telepathicCall?.status === "failed") throw error;
    if (isStreamingRepetitionRunawayError(error)) {
      call = {
        ...call,
        status: "failed",
        outputDiagnostics: { ...call.outputDiagnostics!, completion: "partial" },
        elapsedMs: Math.max(0, Date.parse(input.hooks.now()) - Date.parse(timestamp)),
        physicalAttempts: 1,
        errorMessage: "Detected repetition runaway; the partial output was not accepted.",
        finishReason: "repetition_runaway",
        responseText: error.sanitizedContent,
        ...(error.providerRequestId ? { providerRequestId: error.providerRequestId } : {}),
        updatedAt: input.hooks.now(),
      };
      await input.hooks.persist(call);
      throw Object.assign(error, { telepathicCall: call });
    }
    call = {
      ...call,
      status: isAmbiguousFailure(error) ? "uncertain" : "failed",
      elapsedMs: error instanceof ProviderExecutionError ? error.report.elapsedMs : Math.max(0,Date.parse(input.hooks.now())-Date.parse(timestamp)),
      physicalAttempts: error instanceof ProviderExecutionError ? error.report.physicalAttempts : 1,
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt: input.hooks.now(),
    };
    await input.hooks.persist(call);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { telepathicCall: call });
  }
}
