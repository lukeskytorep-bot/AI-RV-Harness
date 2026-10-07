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
  allowOpenRouterEndpointRecoveryEscalation?: boolean;
}): number {
  const preferred = preferredAnalyticalOutputTokens(input);
  // OpenRouter analytical recovery must reach endpoint-level capacity discovery
  // before a generic model-level maxOutputTokens value can reject a larger route.
  // The first attempt and every non-OpenRouter provider retain the existing hard cap.
  const deferRecoveryOutputLimitToEndpointDiscovery = input.attempt === 1
    && input.model.provider === "openrouter"
    && input.allowOpenRouterEndpointRecoveryEscalation === true;
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

export async function callWithAnalyticalOutputRecovery(input: {
  model: ProviderModel;
  messages: ProviderMessage[];
  operationKind: OperationKind;
  requestedSettings?: GenerationSettings;
  learningObjectCapacityTokens?: number;
  minimumUsefulTokens?: number;
  recoveryInstruction?: string;
  recoveryReasoningMaxTokens?: number;
  recoveryReasoningMaxTokensSupported?: boolean;
  allowOpenRouterEndpointRecoveryEscalation?: boolean;
  call: (settings: EffectiveGenerationSettings, attempt: 0 | 1, messages: ProviderMessage[]) => Promise<ProviderChatResponse>;
}): Promise<{ response: ProviderChatResponse; settings: EffectiveGenerationSettings; attempt: 0 | 1 }> {
  let firstBudget = 0;
  for (const attempt of [0, 1] as const) {
    const attemptMessages = attempt === 1 && input.recoveryInstruction?.trim()
      ? input.messages.map((message, index) => index === input.messages.length - 1 && message.role === "user"
        ? { ...message, content: `${message.content}\n\n[ANALYTICAL OUTPUT RECOVERY]\n${input.recoveryInstruction!.trim()}` }
        : message)
      : input.messages;
    const budget = analyticalOutputBudget({
      model: input.model,
      messages: attemptMessages,
      operationKind: input.operationKind,
      attempt,
      learningObjectCapacityTokens: input.learningObjectCapacityTokens,
      minimumUsefulTokens: input.minimumUsefulTokens,
      allowOpenRouterEndpointRecoveryEscalation: input.allowOpenRouterEndpointRecoveryEscalation,
    });
    if (attempt === 1 && budget <= firstBudget) throw new Error(`Provider exhausted the available analytical output budget; this route cannot increase beyond ${firstBudget} tokens.`);
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
    const settingsCapabilities = attempt === 1
      && input.model.provider === "openrouter"
      && input.allowOpenRouterEndpointRecoveryEscalation === true
      ? { ...capabilities, maxOutputTokens: undefined }
      : capabilities;
    const settings = resolveGenerationSettings(settingsCapabilities, requestedSettings);
    if (!settings.effective.maxOutputTokens || settings.omitted.includes("maxOutputTokens")) {
      throw new Error("Model route rejected the required analytical output budget.");
    }
    if (requestedSettings.reasoningMaxTokens !== undefined && (settings.effective.reasoningMaxTokens !== requestedSettings.reasoningMaxTokens || settings.omitted.includes("reasoningMaxTokens"))) {
      throw new Error("Model route rejected the exact reasoning token budget required for analytical recovery.");
    }
    try {
      const response = await input.call(settings, attempt, attemptMessages);
      assertCompleteAnalyticalResponse(response);
      return { response, settings, attempt };
    } catch (cause) {
      if (attempt === 0 && isOutputLimitFailure(cause)) continue;
      throw cause;
    }
  }
  throw new Error("Analytical response recovery failed.");
}
