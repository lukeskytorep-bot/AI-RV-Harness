import type { getCopy } from "../../i18n";
import { isRouteAllowedForCredential, splitModelRouteKey } from "../../modelRoutes";
import { defaultTemperatureForModel, reasoningEffortForModel } from "../../profileViewerDefaults";
import type { ProviderConfig, ProviderModel, ReasoningEffort } from "../../providers/types";
import type { ProfileAiConfigurationInput } from "../../types";

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
): ProfileAiConfigurationInput {
  if (!provider || !viewerModel || viewerModel.providerConfigId !== provider.id) {
    throw new Error(copy.selectViewerBeforeSaving);
  }
  const normalizedReasoning = reasoning ? reasoningEffortForModel(viewerModel, reasoning) : undefined;
  if (reasoning && !normalizedReasoning) throw new Error(copy.reasoningNotSupported);

  let temperature: number | undefined;
  if (viewerModel.capabilities.temperature.supported) {
    temperature = temperatureInput.trim() ? Number(temperatureInput) : defaultTemperatureForModel(viewerModel);
    const capability = viewerModel.capabilities.temperature;
    if (
      !Number.isFinite(temperature)
      || (capability.min !== undefined && temperature! < capability.min)
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
    ...(systemPrompt.trim() ? { defaultViewerSystemPrompt: systemPrompt.trim() } : {}),
    ...(monitor ? { defaultMonitorProviderConfigId: monitor.providerConfigId, defaultMonitorModelId: monitor.modelId } : {}),
    ...(judge ? { defaultJudgeProviderConfigId: judge.providerConfigId, defaultJudgeModelId: judge.modelId } : {}),
  };
}
