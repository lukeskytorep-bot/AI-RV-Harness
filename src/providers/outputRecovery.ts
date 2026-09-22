import { resolveGenerationSettings } from "./capabilities";
import { getOperationResourceProfile, learningObjectOutputAllowance, type OperationKind } from "./operationResourceProfiles";
import type { EffectiveGenerationSettings, GenerationSettings, ProviderChatResponse, ProviderMessage, ProviderModel } from "./types";

export const ANALYTICAL_OUTPUT_INITIAL_TOKENS = 8192;
export const ANALYTICAL_OUTPUT_RECOVERY_TOKENS = 16384;
export const ANALYTICAL_CONTEXT_SAFETY_TOKENS = 1024;

export function estimateProviderMessageTokens(messages: ProviderMessage[]): number {
  const textTokens = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 3.5);
  const imageTokens = messages.reduce((sum, message) => sum + (message.images?.length ?? 0) * 1500, 0);
  return textTokens + imageTokens;
}

function preferredAnalyticalOutputTokens(input: {
  operationKind: OperationKind;
  attempt: 0 | 1;
  learningObjectCapacityTokens?: number;
}): number {
  const profile = getOperationResourceProfile(input.operationKind);
  if (profile.outputPolicy === "capacity_bound_learning_object") {
    if (!input.learningObjectCapacityTokens || input.learningObjectCapacityTokens <= 0) {
      throw new Error(`Operation ${input.operationKind} requires a positive learning-object capacity.`);
    }
    return learningObjectOutputAllowance(input.learningObjectCapacityTokens, input.attempt);
  }
  if (profile.outputPolicy !== "reasoning_heavy_analytical") {
    throw new Error(`Operation ${input.operationKind} does not use analytical output recovery.`);
  }
  return input.attempt === 0 ? ANALYTICAL_OUTPUT_INITIAL_TOKENS : ANALYTICAL_OUTPUT_RECOVERY_TOKENS;
}

export function analyticalOutputBudget(input: {
  model: ProviderModel;
  messages: ProviderMessage[];
  operationKind: OperationKind;
  attempt: 0 | 1;
  learningObjectCapacityTokens?: number;
  minimumUsefulTokens?: number;
}): number {
  const preferred = preferredAnalyticalOutputTokens(input);
  const routeMaximum = input.model.capabilities.maxOutputTokens ?? preferred;
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
  return /finish[-_ ]?reason\s*[=:]\s*(?:length|max[_ -]?tokens)|reasoning without a final assistant response|incomplete assistant response.*(?:length|max[_ -]?tokens)|maximum output|output token limit/.test(message);
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

export async function callWithAnalyticalOutputRecovery(input: {
  model: ProviderModel;
  messages: ProviderMessage[];
  operationKind: OperationKind;
  requestedSettings?: GenerationSettings;
  learningObjectCapacityTokens?: number;
  minimumUsefulTokens?: number;
  call: (settings: EffectiveGenerationSettings, attempt: 0 | 1) => Promise<ProviderChatResponse>;
}): Promise<{ response: ProviderChatResponse; settings: EffectiveGenerationSettings; attempt: 0 | 1 }> {
  let firstBudget = 0;
  for (const attempt of [0, 1] as const) {
    const budget = analyticalOutputBudget({
      model: input.model,
      messages: input.messages,
      operationKind: input.operationKind,
      attempt,
      learningObjectCapacityTokens: input.learningObjectCapacityTokens,
      minimumUsefulTokens: input.minimumUsefulTokens,
    });
    if (attempt === 1 && budget <= firstBudget) throw new Error(`Provider exhausted the available analytical output budget; this route cannot increase beyond ${firstBudget} tokens.`);
    if (attempt === 0) firstBudget = budget;
    const settings = resolveGenerationSettings(input.model.capabilities, { ...input.requestedSettings, maxOutputTokens: budget });
    if (!settings.effective.maxOutputTokens || settings.omitted.includes("maxOutputTokens")) {
      throw new Error("Model route rejected the required analytical output budget.");
    }
    try {
      const response = await input.call(settings, attempt);
      assertCompleteAnalyticalResponse(response);
      return { response, settings, attempt };
    } catch (cause) {
      if (attempt === 0 && isOutputLimitFailure(cause)) continue;
      throw cause;
    }
  }
  throw new Error("Analytical response recovery failed.");
}
