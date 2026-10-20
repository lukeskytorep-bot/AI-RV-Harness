import type { getCopy } from "../../i18n";
import { isRouteAllowedForCredential, splitModelRouteKey } from "../../modelRoutes";
import { defaultTemperatureForModel, reasoningEffortForModel } from "../../profileViewerDefaults";
import type { CustomReasoningMode, ProviderConfig, ProviderModel, ReasoningEffort } from "../../providers/types";
import { validateOpenRouterAdditionalSamplingSettings, type OpenRouterAdditionalSamplingSettings } from "../../providers/openRouterSamplingSettings";
import type { CustomTemperatureMode, ProfileAiConfigurationInput } from "../../types";
import { openRouterSamplingModelCapabilityState, type OpenRouterSamplingModelParameter } from "./openRouterSamplingModelCapability";

export function parseOpenRouterAdditionalSamplingInputs(
  copy: ReturnType<typeof getCopy>,
  enabled: boolean,
  topPInput: string,
  topKInput: string,
  seedInput: string,
): OpenRouterAdditionalSamplingSettings {
  const parseOptional = (input: string): number | undefined => input.trim() === "" ? undefined : Number(input);
  const topP = parseOptional(topPInput);
  const topK = parseOptional(topKInput);
  const seed = parseOptional(seedInput);

  if (topP !== undefined && (!Number.isFinite(topP) || topP < 0 || topP > 1)) {
    throw new Error(copy.topPOutOfRange);
  }
  if (topK !== undefined && (!Number.isSafeInteger(topK) || topK < 0)) {
    throw new Error(copy.topKOutOfRange);
  }
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER)) {
    throw new Error(copy.seedOutOfRange);
  }

  return validateOpenRouterAdditionalSamplingSettings({
    enabled,
    ...(topP !== undefined ? { topP } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ...(seed !== undefined ? { seed } : {}),
  });
}


function assertManualOpenRouterSamplingSupportedByModel(
  copy: ReturnType<typeof getCopy>,
  model: ProviderModel,
  settings: OpenRouterAdditionalSamplingSettings,
): void {
  if (!settings.enabled) return;
  const manual: Array<[OpenRouterSamplingModelParameter, string, number | undefined]> = [
    ["top_p", "Top P", settings.topP],
    ["top_k", "Top K", settings.topK],
    ["seed", "Seed", settings.seed],
  ];
  for (const [parameter, label, value] of manual) {
    if (value === undefined) continue;
    const state = openRouterSamplingModelCapabilityState(model, parameter);
    if (state === "supported") continue;
    const stateLabel = state === "unsupported" ? copy.samplingUnsupported : copy.samplingUnknown;
    throw new Error(`${label}: ${stateLabel}. ${copy.samplingResolveManualCapability}`);
  }
}

export function buildProfileAiConfiguration(
  copy: ReturnType<typeof getCopy>,
  provider: ProviderConfig | null,
  viewerModel: ProviderModel | null,
  reasoning: "" | ReasoningEffort,
  temperatureInput: string,
  systemPrompt: string,
  monitorModelKey: string,
  judgeModelKey: string,
  providers: ProviderConfig[] = provider ? [provider] : [],
  models: ProviderModel[] = viewerModel ? [viewerModel] : [],
  openRouterSampling?: OpenRouterAdditionalSamplingSettings,
  customTemperatureMode?: CustomTemperatureMode | "legacy",
  customReasoningMode?: CustomReasoningMode,
): ProfileAiConfigurationInput {
  if (!provider || !viewerModel || viewerModel.providerConfigId !== provider.id) {
    throw new Error(copy.selectViewerBeforeSaving);
  }
  const normalizedReasoning = reasoning ? reasoningEffortForModel(viewerModel, reasoning) : undefined;
  if (reasoning && !normalizedReasoning) throw new Error(copy.reasoningNotSupported);

  let temperature: number | undefined;
  const customTemperatureOverride = provider.provider === "custom_openai" && customTemperatureMode && customTemperatureMode !== "legacy";
  if (customTemperatureOverride) {
    if (customTemperatureMode === "manual") {
      if (!temperatureInput.trim()) throw new Error(copy.temperatureRequired);
      temperature = Number(temperatureInput);
      if (!Number.isFinite(temperature)) throw new Error(copy.temperatureInvalid);
    }
  } else if (viewerModel.capabilities.temperature.supported) {
    temperature = temperatureInput.trim() ? Number(temperatureInput) : defaultTemperatureForModel(viewerModel);
    const capability = viewerModel.capabilities.temperature;
    if (!Number.isFinite(temperature)) throw new Error(copy.temperatureInvalid);
    if (
      (capability.min !== undefined && temperature! < capability.min)
      || (capability.max !== undefined && temperature! > capability.max)
    ) {
      throw new Error(copy.temperatureOutOfRange);
    }
  }

  const monitor = splitModelRouteKey(monitorModelKey);
  const judge = splitModelRouteKey(judgeModelKey);
  if (monitor && !isRouteAllowedForCredential(monitorModelKey, provider.credentialId, providers, models)) {
    throw new Error(copy.selectModel);
  }
  if (judge && !isRouteAllowedForCredential(judgeModelKey, provider.credentialId, providers, models)) {
    throw new Error(copy.selectModel);
  }

  return {
    credentialId: provider.credentialId,
    credentialProvider: provider.provider,
    defaultViewerModelId: viewerModel.modelId,
    ...(normalizedReasoning ? { defaultViewerReasoningEffort: normalizedReasoning } : {}),
    ...(temperature !== undefined ? { defaultViewerTemperature: temperature } : {}),
    ...(provider.provider === "custom_openai" && customTemperatureMode && customTemperatureMode !== "legacy" ? { defaultViewerCustomTemperatureMode: customTemperatureMode } : {}),
    ...(provider.provider === "custom_openai" && customReasoningMode ? { defaultViewerCustomReasoningMode: customReasoningMode } : {}),
    ...((provider.provider === "openrouter" || provider.provider === "custom_openai" || provider.provider === "mistral" || provider.provider === "blackbox") && openRouterSampling !== undefined
      ? (() => {
          const validatedSampling = validateOpenRouterAdditionalSamplingSettings(openRouterSampling);
          if (provider.provider === "openrouter") {
            assertManualOpenRouterSamplingSupportedByModel(copy, viewerModel, validatedSampling);
          }
          return { defaultViewerOpenRouterSampling: validatedSampling };
        })()
      : {}),
    ...(systemPrompt.trim() ? { defaultViewerSystemPrompt: systemPrompt.trim() } : {}),
    ...(monitor ? { defaultMonitorProviderConfigId: monitor.providerConfigId, defaultMonitorModelId: monitor.modelId } : {}),
    ...(judge ? { defaultJudgeProviderConfigId: judge.providerConfigId, defaultJudgeModelId: judge.modelId } : {}),
  };
}
