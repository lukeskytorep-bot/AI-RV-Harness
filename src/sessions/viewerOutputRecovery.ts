import { resolveGenerationSettings } from "../providers/capabilities";
import { estimateContextBudget } from "../chat/contextBudget";
import type { OperationKind } from "../providers/operationResourceProfiles";
import type { EffectiveGenerationSettings, ProviderChatResponse, ProviderMessage, ProviderModel } from "../providers/types";
import { providerErrorDetails } from "../providers/providerError";
import type { InterfaceLanguage } from "../types";
import { sanitizeRepetitiveOutput } from "./repetitionGuard";
import { isStreamingRepetitionRunawayError } from "./streamingRepetitionGuard";
import { sha256Text } from "../application/sha256";

export const VIEWER_OUTPUT_POLICY_VERSION = 1;
export const VIEWER_OUTPUT_INITIAL_TOKENS = 16_384;
export const VIEWER_OUTPUT_RECOVERY_TOKENS = 32_768;

export interface ViewerOutputBudgetProfile {
  readonly version: number;
  readonly initialTokens: number;
  readonly recoveryTokens: number;
}

export type ViewerOutputCompletion = "complete" | "output_limit" | "repetition_runaway" | "empty" | "provider_error" | "refusal";

export interface ViewerOutputAttemptRecord {
  viewerOutputPolicyVersion?: number;
  attemptId: string;
  semanticAttempt: 1 | 2;
  recoveryLevel: 0 | 1;
  completion: Exclude<ViewerOutputCompletion, "complete">;
  requestedMaxOutputTokens: number;
  effectiveMaxOutputTokens: number;
  finishReason?: string;
  providerRequestId?: string;
  rawOutputSha256?: string;
  originalLength?: number;
  retainedLength?: number;
  repetitionRule?: string;
  content: string;
  response: ProviderChatResponse;
}

export class ViewerOutputIncompleteError extends Error {
  readonly reason: "output_limit" | "repetition_runaway" | "empty" | "no_larger_recovery_budget" | "provider_error" | "refusal" | "context_limit";
  readonly attempts: ViewerOutputAttemptRecord[];

  constructor(reason: ViewerOutputIncompleteError["reason"], attempts: ViewerOutputAttemptRecord[], message: string) {
    super(message);
    this.name = "ViewerOutputIncompleteError";
    this.reason = reason;
    this.attempts = attempts;
  }
}

export function viewerResponseCompletion(response: ProviderChatResponse): ViewerOutputCompletion {
  const reason = response.finishReason?.trim().toLowerCase().replace(/[ -]/g, "_");
  if (reason && ["length", "max_tokens", "max_output_tokens", "max_completion_tokens"].includes(reason)) return "output_limit";
  if (reason === "repetition_runaway") return "repetition_runaway";
  if (reason && ["content_filter", "safety", "blocked", "refusal", "refused"].includes(reason)) return "refusal";
  if (reason && ["error", "failed", "failure"].includes(reason)) return "provider_error";
  if (!response.content.trim()) return "empty";
  // Legacy persisted responses may not have a finish reason. Non-empty legacy
  // content stays compatible unless it carries an explicit failure marker.
  return "complete";
}

export function isViewerOutputRecoveryOperation(operationKind: OperationKind | undefined): boolean {
  return operationKind === "rv_session_viewer"
    || operationKind === "training_blind_viewer"
    || operationKind === "research_viewer"
    || operationKind === "manual_rv_viewer";
}

function effectiveOperationKind(operationKind: OperationKind | undefined): OperationKind {
  return operationKind ?? "rv_session_viewer";
}

function configuredOutputTokens(baseSettings: EffectiveGenerationSettings, model: ProviderModel): number {
  return Math.max(1, Math.floor(
    baseSettings.requested.maxOutputTokens
      ?? baseSettings.effective.maxOutputTokens
      ?? model.capabilities.maxOutputTokens
      ?? VIEWER_OUTPUT_INITIAL_TOKENS,
  ));
}


export function viewerOutputPreferredBudget(input: {
  model: ProviderModel;
  explicitRequested?: number;
  recoveryLevel: 0 | 1;
  preserveConfiguredBudget?: boolean;
  configuredBudget?: number;
  budgetProfile?: ViewerOutputBudgetProfile;
}): number {
  const standardPreferred = input.recoveryLevel === 0
    ? input.budgetProfile?.initialTokens ?? VIEWER_OUTPUT_INITIAL_TOKENS
    : input.budgetProfile?.recoveryTokens ?? VIEWER_OUTPUT_RECOVERY_TOKENS;
  let preferred = input.preserveConfiguredBudget
    ? Math.max(1, Math.floor(input.configuredBudget ?? input.explicitRequested ?? standardPreferred))
    : input.explicitRequested !== undefined && input.explicitRequested > standardPreferred
      ? Math.floor(input.explicitRequested)
      : standardPreferred;

  const knownOutputLimit = input.model.capabilities.maxOutputTokens;
  if (knownOutputLimit) {
    if (input.explicitRequested !== undefined && input.explicitRequested > knownOutputLimit) {
      throw new Error(`Requested Viewer output budget (${input.explicitRequested}) exceeds the selected model limit (${knownOutputLimit}).`);
    }
    preferred = Math.min(preferred, knownOutputLimit);
  }
  return Math.max(1, preferred);
}

/**
 * Default Viewer policy for automatic RV/Training. Manual RV selects its own
 * explicit budget profile at the chat call site.
 * Research can preserve its locked output budget until the project explicitly
 * freezes a policy version in a later compatibility step.
 */
export function viewerOutputAttemptSettings(input: {
  model: ProviderModel;
  baseSettings: EffectiveGenerationSettings;
  operationKind?: OperationKind;
  recoveryLevel: 0 | 1;
  preserveConfiguredBudget?: boolean;
  budgetProfile?: ViewerOutputBudgetProfile;
  lockedPolicy?: { initialTokens: number; recoveryTokens: number; preserveConfiguredBudget: boolean };
}): EffectiveGenerationSettings {
  const configured = configuredOutputTokens(input.baseSettings, input.model);
  const explicitRequested = input.baseSettings.requested.maxOutputTokens;
  const lockedPreferred = input.lockedPolicy ? (input.recoveryLevel === 0 ? input.lockedPolicy.initialTokens : input.lockedPolicy.recoveryTokens) : undefined;
  const preferred = lockedPreferred !== undefined ? Math.min(lockedPreferred, input.model.capabilities.maxOutputTokens ?? lockedPreferred) : viewerOutputPreferredBudget({
    model: input.model,
    explicitRequested,
    recoveryLevel: input.recoveryLevel,
    preserveConfiguredBudget: input.preserveConfiguredBudget,
    configuredBudget: configured,
    budgetProfile: input.budgetProfile,
  });

  const requested = { ...input.baseSettings.requested, maxOutputTokens: preferred };
  const settings = resolveGenerationSettings(input.model.capabilities, requested);
  if (!settings.effective.maxOutputTokens || settings.omitted.includes("maxOutputTokens")) {
    throw new Error("Selected model route rejected the Viewer output budget required for this step.");
  }
  return settings;
}


export function viewerOutputAttemptMetadata(attempt: ViewerOutputAttemptRecord): Record<string, unknown> {
  return {
    viewerOutputPolicyVersion: attempt.viewerOutputPolicyVersion ?? VIEWER_OUTPUT_POLICY_VERSION,
    accepted: false,
    reason: attempt.completion,
    semanticAttempt: attempt.semanticAttempt,
    recoveryLevel: attempt.recoveryLevel,
    requestedMaxOutputTokens: attempt.requestedMaxOutputTokens,
    effectiveMaxOutputTokens: attempt.effectiveMaxOutputTokens,
    ...(attempt.finishReason ? { finishReason: attempt.finishReason } : {}),
    ...(attempt.providerRequestId ? { providerRequestId: attempt.providerRequestId } : {}),
    ...(attempt.rawOutputSha256 ? { rawOutputSha256: attempt.rawOutputSha256 } : {}),
    ...(attempt.originalLength !== undefined ? { originalLength: attempt.originalLength } : {}),
    ...(attempt.retainedLength !== undefined ? { retainedLength: attempt.retainedLength } : {}),
    ...(attempt.repetitionRule ? { repetitionRule: attempt.repetitionRule } : {}),
    attemptId: attempt.attemptId,
    usage: attempt.response.usage,
  };
}

export function viewerOutputAcceptedMetadata(result: { settings: EffectiveGenerationSettings; semanticAttempt: 1 | 2; attemptId?: string; viewerOutputPolicyVersion?: number }): Record<string, unknown> {
  const effective = result.settings.effective.maxOutputTokens;
  return {
    viewerOutputPolicyVersion: result.viewerOutputPolicyVersion ?? VIEWER_OUTPUT_POLICY_VERSION,
    accepted: true,
    ...(result.attemptId ? { attemptId: result.attemptId } : {}),
    semanticAttempt: result.semanticAttempt,
    recoveryLevel: result.semanticAttempt - 1,
    requestedMaxOutputTokens: result.settings.requested.maxOutputTokens ?? effective,
    effectiveMaxOutputTokens: effective,
  };
}


export interface ViewerOutputDispatchAttempt {
  attemptId: string;
  semanticAttempt: 1 | 2;
  recoveryLevel: 0 | 1;
  requestedMaxOutputTokens: number;
  effectiveMaxOutputTokens: number;
}


function nestedProviderErrorDetails(cause: unknown): ReturnType<typeof providerErrorDetails> {
  const direct = providerErrorDetails(cause);
  if (direct) return direct;
  if (!cause || typeof cause !== "object") return undefined;
  const candidate = cause as { causeError?: unknown; cause?: unknown };
  if (candidate.causeError !== undefined) {
    const nested = nestedProviderErrorDetails(candidate.causeError);
    if (nested) return nested;
  }
  if (candidate.cause !== undefined && candidate.cause !== cause) return nestedProviderErrorDetails(candidate.cause);
  return undefined;
}

export function viewerDispatchOutcome(cause: unknown): "not_dispatched" | "unknown" {
  // AbortError is not enough to prove that no request left the process. A user
  // can abort while headers/body are already in flight, so only an explicit
  // provider failure phase before_dispatch is safe to classify as unsent.
  const details = nestedProviderErrorDetails(cause);
  return details?.phase === "before_dispatch" ? "not_dispatched" : "unknown";
}

export async function callViewerWithOutputRecovery(input: {
  model: ProviderModel;
  baseSettings: EffectiveGenerationSettings;
  operationKind?: OperationKind;
  messages: ProviderMessage[];
  preserveConfiguredBudget?: boolean;
  budgetProfile?: ViewerOutputBudgetProfile;
  lockedPolicy?: { initialTokens: number; recoveryTokens: number; preserveConfiguredBudget: boolean };
  call: (settings: EffectiveGenerationSettings, semanticAttempt: 1 | 2, attempt: ViewerOutputDispatchAttempt) => Promise<ProviderChatResponse>;
  onIncompleteAttempt?: (attempt: ViewerOutputAttemptRecord) => void | Promise<void>;
  startRecoveryLevel?: 0 | 1;
  priorEffectiveMaxOutputTokens?: number;
  priorIncompleteReason?: "output_limit" | "repetition_runaway";
  sessionLanguage?: InterfaceLanguage;
  abortSignal?: AbortSignal;
}): Promise<{ response: ProviderChatResponse; settings: EffectiveGenerationSettings; semanticAttempt: 1 | 2; attemptId?: string; viewerOutputPolicyVersion?: number; attempts: ViewerOutputAttemptRecord[] }> {
  const kind = effectiveOperationKind(input.operationKind);
  if (!isViewerOutputRecoveryOperation(kind)) {
    const budget = input.baseSettings.effective.maxOutputTokens ?? input.baseSettings.requested.maxOutputTokens ?? 1;
    const dispatchAttempt: ViewerOutputDispatchAttempt = {
      attemptId: `viewer_attempt_${crypto.randomUUID()}`,
      semanticAttempt: 1,
      recoveryLevel: 0,
      requestedMaxOutputTokens: input.baseSettings.requested.maxOutputTokens ?? budget,
      effectiveMaxOutputTokens: budget,
    };
    const response = await input.call(input.baseSettings, 1, dispatchAttempt);
    return { response, settings: input.baseSettings, semanticAttempt: 1, attemptId: dispatchAttempt.attemptId, attempts: [] };
  }

  const attempts: ViewerOutputAttemptRecord[] = [];
  let firstBudget = input.startRecoveryLevel === 1 ? Math.max(0, input.priorEffectiveMaxOutputTokens ?? 0) : 0;
  let previousIncompleteReason: "output_limit" | "repetition_runaway" | undefined = input.startRecoveryLevel === 1 ? input.priorIncompleteReason : undefined;
  const levels = input.startRecoveryLevel === 1 ? ([1] as const) : ([0, 1] as const);
  for (const recoveryLevel of levels) {
    input.abortSignal?.throwIfAborted();
    const settings = viewerOutputAttemptSettings({
      model: input.model,
      baseSettings: input.baseSettings,
      operationKind: kind,
      recoveryLevel,
      preserveConfiguredBudget: input.lockedPolicy?.preserveConfiguredBudget ?? input.preserveConfiguredBudget,
      lockedPolicy: input.lockedPolicy,
      budgetProfile: input.budgetProfile,
    });
    const budget = settings.effective.maxOutputTokens!;
    const context = estimateContextBudget(input.messages, input.model.capabilities.contextTokens, budget);
    if (context.exceeded) {
      throw new ViewerOutputIncompleteError(
        "context_limit",
        attempts,
        `Viewer ${recoveryLevel === 0 ? "primary" : "recovery"} attempt requires about ${context.estimatedTotalTokens} tokens, exceeding the selected model context limit (${context.contextLimit}).`,
      );
    }
    if (recoveryLevel === 0) firstBudget = budget;
    if (recoveryLevel === 1 && budget <= firstBudget && previousIncompleteReason !== "repetition_runaway") {
      throw new ViewerOutputIncompleteError(
        "no_larger_recovery_budget",
        attempts,
        `Viewer output reached the available limit (${firstBudget} tokens), and this route cannot provide a larger recovery budget.`,
      );
    }

    const semanticAttempt = (recoveryLevel + 1) as 1 | 2;
    const dispatchAttempt: ViewerOutputDispatchAttempt = { attemptId: `viewer_attempt_${crypto.randomUUID()}`, semanticAttempt, recoveryLevel, requestedMaxOutputTokens: settings.requested.maxOutputTokens ?? budget, effectiveMaxOutputTokens: budget };
    let response: ProviderChatResponse;
    let repetitionMetadata: Pick<ViewerOutputAttemptRecord, "rawOutputSha256" | "originalLength" | "retainedLength" | "repetitionRule"> = {};
    try {
      response = await input.call(settings, semanticAttempt, dispatchAttempt);
    } catch (cause) {
      if (!isStreamingRepetitionRunawayError(cause)) throw cause;
      repetitionMetadata = {
        rawOutputSha256: await sha256Text(cause.rawContent),
        originalLength: cause.originalLength,
        retainedLength: cause.retainedLength,
        ...(cause.finding.rule ? { repetitionRule: cause.finding.rule } : {}),
      };
      response = {
        content: cause.sanitizedContent,
        finishReason: "repetition_runaway",
        usage: {},
        ...(cause.providerRequestId ? { providerRequestId: cause.providerRequestId } : {}),
      };
    }
    let completion = viewerResponseCompletion(response);
    if (completion === "complete") {
      const sanitized = sanitizeRepetitiveOutput(response.content, input.sessionLanguage ?? "en");
      if (sanitized.truncated) {
        repetitionMetadata = {
          rawOutputSha256: await sha256Text(response.content),
          originalLength: sanitized.originalLength,
          retainedLength: sanitized.retainedLength,
          ...(sanitized.finding?.rule ? { repetitionRule: sanitized.finding.rule } : {}),
        };
        response = { ...response, content: sanitized.content, finishReason: "repetition_runaway" };
        completion = "repetition_runaway";
      }
    }
    if (completion === "complete") return { response, settings, semanticAttempt, attemptId: dispatchAttempt.attemptId, viewerOutputPolicyVersion: input.budgetProfile?.version ?? VIEWER_OUTPUT_POLICY_VERSION, attempts };

    const record: ViewerOutputAttemptRecord = {
      viewerOutputPolicyVersion: input.budgetProfile?.version ?? VIEWER_OUTPUT_POLICY_VERSION,
      semanticAttempt,
      recoveryLevel,
      completion,
      requestedMaxOutputTokens: settings.requested.maxOutputTokens ?? budget,
      effectiveMaxOutputTokens: budget,
      ...(response.finishReason ? { finishReason: response.finishReason } : {}),
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      content: response.content,
      response,
      attemptId: dispatchAttempt.attemptId,
      ...repetitionMetadata,
    };
    attempts.push(record);
    if (completion === "output_limit" || completion === "repetition_runaway") previousIncompleteReason = completion;
    await input.onIncompleteAttempt?.(record);
    // A definitive incomplete response must be durably recorded before honoring
    // a concurrent parent Stop/lease. Never start the next paid recovery attempt
    // after cancellation; Resume will continue from the persisted recovery level.
    input.abortSignal?.throwIfAborted();

    if (completion === "empty") {
      throw new ViewerOutputIncompleteError("empty", attempts, "Viewer returned an empty response; the step was not accepted.");
    }
    if (completion === "refusal") {
      throw new ViewerOutputIncompleteError("refusal", attempts, "Viewer response was refused or content-filtered; the step was not accepted.");
    }
    if (completion === "provider_error") {
      throw new ViewerOutputIncompleteError("provider_error", attempts, "Viewer response ended with a provider error; the step was not accepted.");
    }
    if (completion === "repetition_runaway" && recoveryLevel === 1) {
      throw new ViewerOutputIncompleteError(
        "repetition_runaway",
        attempts,
        "Viewer output entered a clear repetition runaway on the recovery attempt; the step remains incomplete and no third paid attempt is allowed.",
      );
    }
    if (recoveryLevel === 1) {
      throw new ViewerOutputIncompleteError(
        "output_limit",
        attempts,
        `Viewer output reached the recovery limit (${budget} tokens); the step remains incomplete and the next protocol step was not started.`,
      );
    }
  }
  throw new ViewerOutputIncompleteError("output_limit", attempts, "Viewer output recovery failed.");
}
