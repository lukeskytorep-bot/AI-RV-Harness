import { useEffect, useMemo, useState } from "react";

import { PROVIDER_LABELS } from "../../components/ProviderSettings";
import type { getCopy } from "../../i18n";
import { isRouteAllowedForCredential, preferredModelOrder } from "../../modelRoutes";
import { defaultTemperatureForModel, reasoningEffortForModel } from "../../profileViewerDefaults";
import { addProvider, refreshProviderModels } from "../../providers/service";
import { PROVIDER_KINDS, type ProviderConfig, type ProviderKind, type ProviderModel, type ReasoningEffort } from "../../providers/types";
import { factoryViewerEditablePrompt, localizedMonitorEditablePrompt } from "../../resources/systemPrompts";
import { isTauriRuntime } from "../../storage";
import type { AppRepository } from "../../storage/repository";
import type { InterfaceLanguage, Profile, ProfileAiConfigurationInput } from "../../types";
import { buildProfileAiConfiguration } from "./profileAiConfiguration";

export const NEW_PROFILE_PROVIDER_CHOICE = "__new__";

export interface ProfileSetupControllerOptions {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository;
  existingProfile?: Profile | null;
}

export interface ProfileSetupController {
  providers: ProviderConfig[];
  models: ProviderModel[];
  connectionChoice: string;
  providerKind: ProviderKind;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  viewerModelId: string;
  viewerReasoning: "" | ReasoningEffort;
  viewerTemperature: string;
  viewerSystemPrompt: string;
  modelSearch: string;
  judgeModelKey: string;
  monitorModelKey: string;
  busy: boolean;
  error: string | null;
  desktop: boolean;
  selectedProvider: ProviderConfig | null;
  providerModels: ProviderModel[];
  visibleViewerModels: ProviderModel[];
  viewerModel: ProviderModel | null;
  cachedModelCount: number;
  providerKinds: readonly ProviderKind[];
  setProviderLabel: (value: string) => void;
  setApiKey: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setViewerReasoning: (value: "" | ReasoningEffort) => void;
  setViewerTemperature: (value: string) => void;
  setModelSearch: (value: string) => void;
  setJudgeModelKey: (value: string) => void;
  setMonitorModelKey: (value: string) => void;
  setError: (value: string | null) => void;
  changeProviderKind: (kind: ProviderKind) => void;
  changeConnection: (providerId: string) => void;
  selectViewerModel: (modelId: string) => void;
  reloadInventory: (preferredProviderId?: string) => Promise<void>;
  connectProvider: () => Promise<ProviderConfig | null>;
  prepareCachedModels: () => void;
  resetAdvancedOptions: () => void;
  buildAiConfiguration: (skipOptional?: boolean) => ProfileAiConfigurationInput;
}

export function useProfileSetupController({ copy, repository, existingProfile = null }: ProfileSetupControllerOptions): ProfileSetupController {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [connectionChoice, setConnectionChoice] = useState(NEW_PROFILE_PROVIDER_CHOICE);
  const [providerKind, setProviderKind] = useState<ProviderKind>("openrouter");
  const [providerLabel, setProviderLabel] = useState(PROVIDER_LABELS.openrouter);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [viewerModelId, setViewerModelId] = useState("");
  const [viewerReasoning, setViewerReasoning] = useState<"" | ReasoningEffort>("");
  const [viewerTemperature, setViewerTemperature] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [judgeModelKey, setJudgeModelKey] = useState("");
  const [monitorModelKey, setMonitorModelKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = isTauriRuntime();
  const setupLanguage: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  const viewerSystemPrompt = existingProfile?.defaultViewerSystemPrompt ?? factoryViewerEditablePrompt(setupLanguage);

  const selectedProvider = providers.find((provider) => provider.id === connectionChoice) ?? null;
  const providerModels = useMemo(
    () => preferredModelOrder(models.filter((model) => model.providerConfigId === selectedProvider?.id)),
    [models, selectedProvider?.id],
  );
  const visibleViewerModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const matching = query
      ? providerModels.filter((model) => `${model.displayName} ${model.modelId}`.toLowerCase().includes(query))
      : providerModels;
    return matching.slice(0, 250);
  }, [modelSearch, providerModels]);
  const viewerModel = providerModels.find((model) => model.modelId === viewerModelId) ?? null;
  const cachedModelCount = models.filter((model) => model.providerConfigId === selectedProvider?.id).length;

  const reloadInventory = async (preferredProviderId?: string) => {
    const [nextProviders, nextModels] = await Promise.all([
      repository.listProviderConfigs(),
      repository.listProviderModels(),
    ]);
    setProviders(nextProviders);
    setModels(nextModels);
    setConnectionChoice((current) => {
      if (preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)) return preferredProviderId;
      if (nextProviders.some((provider) => provider.id === current)) return current;
      const bound = nextProviders.find((provider) => provider.credentialId === existingProfile?.credentialId);
      return bound?.id ?? nextProviders[0]?.id ?? NEW_PROFILE_PROVIDER_CHOICE;
    });
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([repository.listProviderConfigs(), repository.listProviderModels()])
      .then(([nextProviders, nextModels]) => {
        if (cancelled) return;
        setProviders(nextProviders);
        setModels(nextModels);
        setConnectionChoice((current) => {
          if (nextProviders.some((provider) => provider.id === current)) return current;
          const bound = nextProviders.find((provider) => provider.credentialId === existingProfile?.credentialId);
          return bound?.id ?? nextProviders[0]?.id ?? NEW_PROFILE_PROVIDER_CHOICE;
        });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [existingProfile?.credentialId, repository]);

  const resetViewerSelections = () => {
    setViewerModelId("");
    setViewerReasoning("");
    setViewerTemperature("");
    setModelSearch("");
    setJudgeModelKey("");
    setMonitorModelKey("");
  };

  const changeProviderKind = (kind: ProviderKind) => {
    setProviderKind(kind);
    setProviderLabel(PROVIDER_LABELS[kind]);
  };

  const changeConnection = (providerId: string) => {
    setConnectionChoice(providerId);
    resetViewerSelections();
  };

  const connectProvider = async (): Promise<ProviderConfig | null> => {
    if (busy || !desktop) return null;
    setBusy(true);
    setError(null);
    let provider = selectedProvider;
    try {
      if (!provider) {
        provider = await addProvider(repository, {
          provider: providerKind,
          label: providerLabel,
          apiKey,
          ...(providerKind === "custom_openai" ? { baseUrl } : {}),
        });
        setApiKey("");
      }
      await refreshProviderModels(repository, provider);
      await reloadInventory(provider.id);
      resetViewerSelections();
      return provider;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await reloadInventory(provider?.id).catch(() => undefined);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const selectViewerModel = (modelId: string) => {
    const model = providerModels.find((item) => item.modelId === modelId) ?? null;
    const sameStoredPair = existingProfile?.credentialId === selectedProvider?.credentialId
      && existingProfile?.defaultViewerModelId === modelId;
    setViewerModelId(modelId);
    setViewerReasoning(sameStoredPair ? reasoningEffortForModel(model, existingProfile?.defaultViewerReasoningEffort) ?? "" : "");
    const temperature = sameStoredPair && existingProfile?.defaultViewerTemperature !== undefined
      ? existingProfile.defaultViewerTemperature
      : defaultTemperatureForModel(model);
    setViewerTemperature(temperature === undefined ? "" : String(temperature));
  };

  const prepareCachedModels = () => {
    setViewerModelId("");
    setModelSearch("");
  };

  const resetAdvancedOptions = () => {
    setViewerReasoning("");
    const temperature = defaultTemperatureForModel(viewerModel);
    setViewerTemperature(temperature === undefined ? "" : String(temperature));
    setJudgeModelKey("");
    setMonitorModelKey("");
  };

  const buildAiConfiguration = (skipOptional = false): ProfileAiConfigurationInput => {
    const monitorKey = !skipOptional && selectedProvider
      && isRouteAllowedForCredential(monitorModelKey, selectedProvider.credentialId, providers, models)
      ? monitorModelKey
      : "";
    const judgeKey = !skipOptional && selectedProvider
      && isRouteAllowedForCredential(judgeModelKey, selectedProvider.credentialId, providers, models)
      ? judgeModelKey
      : "";
    return {
      ...buildProfileAiConfiguration(
        copy,
        selectedProvider,
        viewerModel,
        viewerReasoning,
        viewerTemperature,
        existingProfile?.defaultViewerSystemPrompt ?? "",
        monitorKey,
        judgeKey,
        providers,
        models,
      ),
      defaultMonitorSystemPrompt: localizedMonitorEditablePrompt(existingProfile?.defaultMonitorSystemPrompt, setupLanguage),
    };
  };

  return {
    providers,
    models,
    connectionChoice,
    providerKind,
    providerLabel,
    apiKey,
    baseUrl,
    viewerModelId,
    viewerReasoning,
    viewerTemperature,
    viewerSystemPrompt,
    modelSearch,
    judgeModelKey,
    monitorModelKey,
    busy,
    error,
    desktop,
    selectedProvider,
    providerModels,
    visibleViewerModels,
    viewerModel,
    cachedModelCount,
    providerKinds: PROVIDER_KINDS,
    setProviderLabel,
    setApiKey,
    setBaseUrl,
    setViewerReasoning,
    setViewerTemperature,
    setModelSearch,
    setJudgeModelKey,
    setMonitorModelKey,
    setError,
    changeProviderKind,
    changeConnection,
    selectViewerModel,
    reloadInventory,
    connectProvider,
    prepareCachedModels,
    resetAdvancedOptions,
    buildAiConfiguration,
  };
}
