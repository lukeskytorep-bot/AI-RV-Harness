import { providerAttemptOutcomes, type ProviderAttemptOutcome } from "./responseEvidence";
import { resolveGenerationSettings } from "./capabilities";
import { getOperationResourceProfile, learningObjectOutputAllowance, type OperationKind, type LearningBudgetPolicy } from "./operationResourceProfiles";
import type { EffectiveGenerationSettings, GenerationSettings, ProviderChatResponse, ProviderMessage, ProviderModel } from "./types";

export const ANALYTICAL_OUTPUT_INITIAL_TOKENS = 32768;
export const ANALYTICAL_OUTPUT_RECOVERY_TOKENS = 49152;
// Immutable v1 pair for live Monitor and accepted frozen Research.
export const FROZEN_ANALYTICAL_V1_INITIAL_TOKENS = 16384;
export const FROZEN_ANALYTICAL_V1_RECOVERY_TOKENS = 32768;
export type FrozenAnalyticalOutputPolicy =
  | { version: 1; initialTokens: 16384; recoveryTokens: 32768 }
  | { version: 2; initialTokens: 32768; recoveryTokens: 49152 };
export const CURRENT_ANALYTICAL_OUTPUT_POLICY: FrozenAnalyticalOutputPolicy = Object.freeze({ version: 2, initialTokens: 32768, recoveryTokens: 49152 });

export function analyticalBudgetPolicyForSnapshot(policy: FrozenAnalyticalOutputPolicy | undefined): AnalyticalBudgetPolicy {
  if (!policy) return "frozen_analytical_v1";
  if (policy.version === 1 && policy.initialTokens === 16384 && policy.recoveryTokens === 32768) return "frozen_analytical_v1";
  if (policy.version === 2 && policy.initialTokens === 32768 && policy.recoveryTokens === 49152) return "default";
  throw new Error("Unsupported frozen analytical output policy.");
}

export const ANALYTICAL_CONTEXT_SAFETY_TOKENS = 1024;
export type AnalyticalBudgetPolicy = "default" | "training_reveal" | "legacy_analytical" | "frozen_analytical_v1";

export function estimateProviderMessageTokens(messages: ProviderMessage[]): number {
  const textTokens = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 3.5);
  const imageTokens = messages.reduce((sum, message) => sum + (message.images?.length ?? 0) * 1500, 0);
  return textTokens + imageTokens;
}

export type AnalyticalOutputOperation =
  | { operationKind: "field_guide_update" | "viewer_notes_reflection"; learningObjectCapacityTokens: number; budgetPolicy: LearningBudgetPolicy }
  | { operationKind: Exclude<OperationKind, "field_guide_update" | "viewer_notes_reflection">; learningObjectCapacityTokens?: never; budgetPolicy?: AnalyticalBudgetPolicy };

function preferredAnalyticalOutputTokens(input: AnalyticalOutputOperation & { attempt: 0 | 1 }): number {
  const profile = getOperationResourceProfile(input.operationKind);
  if (input.operationKind === "field_guide_update" || input.operationKind === "viewer_notes_reflection") {
    if (!input.learningObjectCapacityTokens || input.learningObjectCapacityTokens <= 0) {
      throw new Error(`Operation ${input.operationKind} requires a positive learning-object capacity.`);
    }
    return learningObjectOutputAllowance(input.learningObjectCapacityTokens, input.attempt, input.budgetPolicy);
  }
  if (profile.outputPolicy !== "reasoning_heavy_analytical") {
    throw new Error(`Operation ${input.operationKind} does not use analytical output recovery.`);
  }
  // Existing locked Research has no new Judge snapshot: preserve its historical pair.
  if (input.budgetPolicy === "legacy_analytical") return input.attempt === 0 ? 8192 : 16384;
  if (input.budgetPolicy === "frozen_analytical_v1") return input.attempt === 0 ? FROZEN_ANALYTICAL_V1_INITIAL_TOKENS : FROZEN_ANALYTICAL_V1_RECOVERY_TOKENS;
  return input.attempt === 0 ? ANALYTICAL_OUTPUT_INITIAL_TOKENS : ANALYTICAL_OUTPUT_RECOVERY_TOKENS;
}

export function analyticalOutputBudget(input: AnalyticalOutputOperation & {
  model: ProviderModel;
  messages: ProviderMessage[];
  attempt: 0 | 1;
  minimumUsefulTokens?: number;
  allowOpenRouterEndpointRecoveryEscalation?: boolean;
}): number {
  const preferred = preferredAnalyticalOutputTokens(input);
  // OpenRouter analytical recovery must reach endpoint-level capacity discovery
  // before a generic model-level maxOutputTokens value can reject a larger route.
  // The first attempt and every non-OpenRouter provider retain the existing hard cap.
  const deferRecoveryOutputLimitToEndpointDiscovery = input.model.provider === "openrouter"
    && (input.budgetPolicy === "training_reveal" || (input.attempt === 1 && input.allowOpenRouterEndpointRecoveryEscalation === true));
  const routeMaximum = deferRecoveryOutputLimitToEndpointDiscovery
    ? preferred
    : input.model.capabilities.maxOutputTokens ?? preferred;
  const estimatedInput = estimateProviderMessageTokens(input.messages);
  const context = input.model.capabilities.contextTokens;
  const contextMaximum = context === undefined
    ? preferred
    : Math.floor(context - estimatedInput - ANALYTICAL_CONTEXT_SAFETY_TOKENS);
  const budget = Math.floor(Math.min(preferred, routeMaximum, contextMaximum));
  const profile = getOperationResourceProfile(input.operationKind);
  const minimum = profile.outputPolicy === "capacity_bound_learning_object"
    ? Math.max(1, Math.floor(input.learningObjectCapacityTokens ?? 1))
    : Math.max(1, Math.floor(input.minimumUsefulTokens ?? 1024));
  if (budget < minimum) {
    throw new Error(`Analytical response exceeds this model route's available context or output capacity (${budget}/${minimum} tokens available).`);
  }
  return budget;
}

export function isOutputLimitFailure(cause: unknown): boolean {
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  return /finish[-_ ]?reason\s*[=:]\s*(?:length|max[_ -]?tokens)|reasoning without a final assistant response|incomplete assistant response.*(?:length|max[_ -]?tokens)|maximum output|output token limit|exhausted the available analytical output budget|route cannot increase beyond/.test(message);
}

export function assertCompleteAnalyticalResponse(response: ProviderChatResponse): void {
  const finishReason = response.finishReason?.toLowerCase().replaceAll("-", "_");
  if (finishReason && (finishReason === "length" || finishReason.includes("max_token"))) {
    throw new Error(`provider returned an incomplete assistant response [finish-reason=${response.finishReason}]`);
  }
  if (!response.content.trim()) {
    const reasoning = response.reasoningContent?.trim() || response.reasoningDetails?.length;
    throw new Error(reasoning
      ? `provider returned reasoning without a final assistant response${response.finishReason ? ` [finish-reason=${response.finishReason}]` : ""}`
      : `provider returned an empty assistant response${response.finishReason ? ` [finish-reason=${response.finishReason}]` : ""}`);
  }
}

export async function callWithAnalyticalOutputRecovery(input: AnalyticalOutputOperation & {
  model: ProviderModel;
  messages: ProviderMessage[];
  requestedSettings?: GenerationSettings;
  minimumUsefulTokens?: number;
  signal?: AbortSignal;
  preserveCompleteAfterAbort?:boolean;
  initialAttempt?: 0 | 1;
  maximumAttempts?: 1 | 2;
  recoveryInstruction?: string;
  recoveryReasoningMaxTokens?: number;
  recoveryReasoningMaxTokensSupported?: boolean;
  allowOpenRouterEndpointRecoveryEscalation?: boolean;
  call: (settings: EffectiveGenerationSettings, attempt: 0 | 1, messages: ProviderMessage[]) => Promise<ProviderChatResponse>;
}): Promise<{ response: ProviderChatResponse; settings: EffectiveGenerationSettings; attempt: 0 | 1 }> {
  let firstBudget = 0;
  const physicalOutcomes: ProviderAttemptOutcome[] = [];
  const withOutcomes = (cause: unknown) => Object.assign(cause && typeof cause === "object" ? cause : new Error(String(cause)), { providerAttemptOutcomes: structuredClone(physicalOutcomes) });
  const attempts = ([0, 1] as const).filter(value => value >= (input.initialAttempt ?? 0)).slice(0, input.maximumAttempts ?? 2);
  for (const attempt of attempts) {
    if (input.signal?.aborted) throw withOutcomes(input.signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const attemptMessages = attempt === 1 && input.recoveryInstruction?.trim()
      ? input.messages.map((message, index) => index === input.messages.length - 1 && message.role === "user"
        ? { ...message, content: `${message.content}\n\n[ANALYTICAL OUTPUT RECOVERY]\n${input.recoveryInstruction!.trim()}` }
        : message)
      : input.messages;
    let budget: number;
    try { budget = analyticalOutputBudget({ ...input, messages: attemptMessages, attempt }); } catch (cause) { throw withOutcomes(cause); }
    if (attempt === 1 && firstBudget > 0 && budget <= firstBudget) throw withOutcomes(new Error(`Provider exhausted the available analytical output budget; this route cannot increase beyond ${firstBudget} tokens.`));
    if (attempt === 0) firstBudget = budget;
    const requestedSettings: GenerationSettings = { ...input.requestedSettings, maxOutputTokens: budget };
    const useExactReasoningCap = attempt === 1 && input.recoveryReasoningMaxTokens && input.recoveryReasoningMaxTokensSupported === true;
    if (useExactReasoningCap) {
      delete requestedSettings.reasoningEffort;
      requestedSettings.reasoningMaxTokens = input.recoveryReasoningMaxTokens;
    }
    const capabilities = useExactReasoningCap
      ? { ...input.model.capabilities, reasoning: { ...input.model.capabilities.reasoning, supportsMaxTokens: true } }
      : input.model.capabilities;
    const settingsCapabilities = input.model.provider === "openrouter"
      && (input.budgetPolicy === "training_reveal" || (attempt === 1 && input.allowOpenRouterEndpointRecoveryEscalation === true))
      ? { ...capabilities, maxOutputTokens: undefined }
      : capabilities;
    const settings = resolveGenerationSettings(settingsCapabilities, requestedSettings, { provider: input.model.provider });
    if (!settings.effective.maxOutputTokens || settings.omitted.includes("maxOutputTokens")) {
      throw withOutcomes(new Error("Model route rejected the required analytical output budget."));
    }
    if (requestedSettings.reasoningMaxTokens !== undefined && (settings.effective.reasoningMaxTokens !== requestedSettings.reasoningMaxTokens || settings.omitted.includes("reasoningMaxTokens"))) {
      throw withOutcomes(new Error("Model route rejected the exact reasoning token budget required for analytical recovery."));
    }
    try {
      const response = await input.call(settings, attempt, attemptMessages);
      physicalOutcomes.push(...providerAttemptOutcomes(response));
      if (input.signal?.aborted && !input.preserveCompleteAfterAbort) throw Object.assign(new DOMException("Analytical response arrived after cancellation", "AbortError"), { providerResponse: response });
      assertCompleteAnalyticalResponse(response);
      return { response, settings, attempt };
    } catch (cause) {
      const reported = providerAttemptOutcomes(cause);
      for (const outcome of reported) if (!physicalOutcomes.some(a => a.attemptId === outcome.attemptId)) physicalOutcomes.push(outcome);
      const failure = withOutcomes(cause);
      if (input.signal?.aborted) throw failure;
      if (attempt === 0 && attempts.includes(1) && isOutputLimitFailure(cause)) continue;
      throw failure;
    }
  }
  throw new Error("Analytical response recovery failed.");
}
