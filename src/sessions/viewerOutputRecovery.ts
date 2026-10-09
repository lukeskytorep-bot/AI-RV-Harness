import { resolveGenerationSettings } from "../providers/capabilities";
import { estimateContextBudget } from "../chat/contextBudget";
import type { OperationKind } from "../providers/operationResourceProfiles";
import type { EffectiveGenerationSettings, ProviderChatResponse, ProviderMessage, ProviderModel } from "../providers/types";

export const VIEWER_OUTPUT_POLICY_VERSION = 1;
export const VIEWER_OUTPUT_INITIAL_TOKENS = 16_384;
export const VIEWER_OUTPUT_RECOVERY_TOKENS = 32_768;

export type ViewerOutputCompletion = "complete" | "output_limit" | "empty" | "provider_error" | "refusal";

export interface ViewerOutputAttemptRecord {
  semanticAttempt: 1 | 2;
  recoveryLevel: 0 | 1;
  completion: Exclude<ViewerOutputCompletion, "complete">;
  requestedMaxOutputTokens: number;
  effectiveMaxOutputTokens: number;
  finishReason?: string;
  providerRequestId?: string;
  content: string;
  response: ProviderChatResponse;
}

export class ViewerOutputIncompleteError extends Error {
  readonly reason: "output_limit" | "empty" | "no_larger_recovery_budget" | "provider_error" | "refusal" | "context_limit";
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
}): number {
  const standardPreferred = input.recoveryLevel === 0 ? VIEWER_OUTPUT_INITIAL_TOKENS : VIEWER_OUTPUT_RECOVERY_TOKENS;
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
 * Standard Viewer policy for ordinary RV/Training/manual-RV sessions.
 * Research can preserve its locked output budget until the project explicitly
 * freezes a policy version in a later compatibility step.
 */
export function viewerOutputAttemptSettings(input: {
  model: ProviderModel;
  baseSettings: EffectiveGenerationSettings;
  operationKind?: OperationKind;
  recoveryLevel: 0 | 1;
  preserveConfiguredBudget?: boolean;
}): EffectiveGenerationSettings {
  const configured = configuredOutputTokens(input.baseSettings, input.model);
  const explicitRequested = input.baseSettings.requested.maxOutputTokens;
  const preferred = viewerOutputPreferredBudget({
    model: input.model,
    explicitRequested,
    recoveryLevel: input.recoveryLevel,
    preserveConfiguredBudget: input.preserveConfiguredBudget,
    configuredBudget: configured,
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
    viewerOutputPolicyVersion: VIEWER_OUTPUT_POLICY_VERSION,
    accepted: false,
    reason: attempt.completion,
    semanticAttempt: attempt.semanticAttempt,
    recoveryLevel: attempt.recoveryLevel,
    requestedMaxOutputTokens: attempt.requestedMaxOutputTokens,
    effectiveMaxOutputTokens: attempt.effectiveMaxOutputTokens,
    ...(attempt.finishReason ? { finishReason: attempt.finishReason } : {}),
    ...(attempt.providerRequestId ? { providerRequestId: attempt.providerRequestId } : {}),
    usage: attempt.response.usage,
  };
}

export function viewerOutputAcceptedMetadata(result: { settings: EffectiveGenerationSettings; semanticAttempt: 1 | 2 }): Record<string, unknown> {
  const effective = result.settings.effective.maxOutputTokens;
  return {
    viewerOutputPolicyVersion: VIEWER_OUTPUT_POLICY_VERSION,
    accepted: true,
    semanticAttempt: result.semanticAttempt,
    recoveryLevel: result.semanticAttempt - 1,
    requestedMaxOutputTokens: result.settings.requested.maxOutputTokens ?? effective,
    effectiveMaxOutputTokens: effective,
  };
}

export async function callViewerWithOutputRecovery(input: {
  model: ProviderModel;
  baseSettings: EffectiveGenerationSettings;
  operationKind?: OperationKind;
  messages: ProviderMessage[];
  preserveConfiguredBudget?: boolean;
  call: (settings: EffectiveGenerationSettings, semanticAttempt: 1 | 2) => Promise<ProviderChatResponse>;
  onIncompleteAttempt?: (attempt: ViewerOutputAttemptRecord) => void | Promise<void>;
}): Promise<{ response: ProviderChatResponse; settings: EffectiveGenerationSettings; semanticAttempt: 1 | 2; attempts: ViewerOutputAttemptRecord[] }> {
  const kind = effectiveOperationKind(input.operationKind);
  if (!isViewerOutputRecoveryOperation(kind)) {
    const response = await input.call(input.baseSettings, 1);
    return { response, settings: input.baseSettings, semanticAttempt: 1, attempts: [] };
  }

  const attempts: ViewerOutputAttemptRecord[] = [];
  let firstBudget = 0;
  for (const recoveryLevel of [0, 1] as const) {
    const settings = viewerOutputAttemptSettings({
      model: input.model,
      baseSettings: input.baseSettings,
      operationKind: kind,
      recoveryLevel,
      preserveConfiguredBudget: input.preserveConfiguredBudget,
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
    if (recoveryLevel === 1 && budget <= firstBudget) {
      throw new ViewerOutputIncompleteError(
        "no_larger_recovery_budget",
        attempts,
        `Viewer output reached the available limit (${firstBudget} tokens), and this route cannot provide a larger recovery budget.`,
      );
    }

    const semanticAttempt = (recoveryLevel + 1) as 1 | 2;
    const response = await input.call(settings, semanticAttempt);
    const completion = viewerResponseCompletion(response);
    if (completion === "complete") return { response, settings, semanticAttempt, attempts };

    const record: ViewerOutputAttemptRecord = {
      semanticAttempt,
      recoveryLevel,
      completion,
      requestedMaxOutputTokens: settings.requested.maxOutputTokens ?? budget,
      effectiveMaxOutputTokens: budget,
      ...(response.finishReason ? { finishReason: response.finishReason } : {}),
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      content: response.content,
      response,
    };
    attempts.push(record);
    await input.onIncompleteAttempt?.(record);

    if (completion === "empty") {
      throw new ViewerOutputIncompleteError("empty", attempts, "Viewer returned an empty response; the step was not accepted.");
    }
    if (completion === "refusal") {
      throw new ViewerOutputIncompleteError("refusal", attempts, "Viewer response was refused or content-filtered; the step was not accepted.");
    }
    if (completion === "provider_error") {
      throw new ViewerOutputIncompleteError("provider_error", attempts, "Viewer response ended with a provider error; the step was not accepted.");
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
