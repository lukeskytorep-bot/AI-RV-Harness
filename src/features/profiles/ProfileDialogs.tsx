import { useEffect, useState, type FormEvent } from "react";

import { FormDialog } from "../../components/FormDialog";
import type { getCopy } from "../../i18n";
import { modelRouteKey, preferredModelOrder, resolveRoleDefault, splitModelRouteKey } from "../../profileModelDefaults";
import { defaultTemperatureForModel, reasoningEffortForModel } from "../../profileViewerDefaults";
import type { ProviderConfig, ProviderModel, ReasoningEffort } from "../../providers/types";
import {
  factoryMonitorEditablePrompt,
  factoryViewerEditablePrompt,
  localizedMonitorEditablePrompt,
  localizedViewerEditablePrompt,
} from "../../resources/systemPrompts";
import type { AppRepository } from "../../storage/repository";
import type { InterfaceLanguage, Profile, ProfileAiConfigurationInput } from "../../types";
import { ProfileViewerControls } from "./ProfileViewerControls";

export interface CreateProfileDialogProps {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository;
  onCancel: () => void;
  onCreate: (name: string, humanName: string | undefined, note: string | undefined, aiConfiguration: ProfileAiConfigurationInput) => Promise<void>;
}

export function CreateProfileDialog({ copy, repository, onCancel, onCreate }: CreateProfileDialogProps) {
  const [aiName, setAiName] = useState("");
  const [humanName, setHumanName] = useState("");
  const [note, setNote] = useState("");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([repository.listProviderConfigs(), repository.listProviderModels()])
      .then(([nextProviders, nextModels]) => {
        if (cancelled) return;
        setProviders(nextProviders);
        setModels(nextModels);
        setProviderId(nextProviders[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [repository]);
  const provider = providers.find((item) => item.id === providerId) ?? null;
  const availableModels = preferredModelOrder(models.filter((model) => model.providerConfigId === providerId));
  const model = availableModels.find((item) => item.modelId === modelId) ?? null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !model || saving) return;
    setSaving(true); setError(null);
    try {
      await onCreate(aiName, humanName || undefined, note || undefined, {
        credentialId: provider.credentialId,
        credentialProvider: provider.provider,
        defaultViewerModelId: model.modelId,
        ...(defaultTemperatureForModel(model) !== undefined ? { defaultViewerTemperature: defaultTemperatureForModel(model) } : {}),
        defaultViewerSystemPrompt: factoryViewerEditablePrompt(copy.home === "Home" ? "en" : "pl"),
        defaultMonitorSystemPrompt: factoryMonitorEditablePrompt(copy.home === "Home" ? "en" : "pl"),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <FormDialog title={copy.createProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}>
    <div className="identity-name-grid"><label>{copy.aiIsBeName}<input autoFocus value={aiName} onChange={(event) => setAiName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div>
    <small className="form-hint">{copy.identityNamesLead}</small>
    <label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><label>{copy.profileCredential}<select value={providerId} onChange={(event) => { setProviderId(event.target.value); setModelId(""); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label>{copy.defaultViewerModel}<select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!provider}><option value="">{copy.selectModel}</option>{availableModels.map((item) => <option key={item.modelId} value={item.modelId}>{item.displayName}</option>)}</select></label></fieldset>
    {error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving || !provider || !model}>{saving ? copy.saving : copy.create}</button></div>
  </form></FormDialog>;
}

export interface EditProfileDialogProps {
  copy: ReturnType<typeof getCopy>;
  profile: Profile;
  providers: ProviderConfig[];
  models: ProviderModel[];
  onCancel: () => void;
  onSave: (name: string, humanName: string | undefined, note?: string, aiConfiguration?: ProfileAiConfigurationInput) => Promise<void>;
}

export function EditProfileDialog({ copy, profile, providers, models, onCancel, onSave }: EditProfileDialogProps) {
  const [name, setName] = useState(profile.name);
  const [humanName, setHumanName] = useState(profile.humanName ?? "");
  const [note, setNote] = useState(profile.note ?? "");
  const currentProvider = providers.find((provider) => provider.credentialId === profile.credentialId) ?? null;
  const [providerConfigId, setProviderConfigId] = useState(currentProvider?.id ?? "");
  const [viewerModelId, setViewerModelId] = useState(profile.defaultViewerModelId ?? "");
  const [reasoning, setReasoning] = useState<"" | ReasoningEffort>(profile.defaultViewerReasoningEffort ?? "");
  const [temperature, setTemperature] = useState(profile.defaultViewerTemperature === undefined ? "" : String(profile.defaultViewerTemperature));
  const interfaceLanguage: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  const [systemPrompt, setSystemPrompt] = useState(localizedViewerEditablePrompt(profile.defaultViewerSystemPrompt, interfaceLanguage));
  const [monitorModelKey, setMonitorModelKey] = useState(resolveRoleDefault(profile, "monitor", models));
  const [judgeModelKey, setJudgeModelKey] = useState(resolveRoleDefault(profile, "judge", models));
  const [aiTouched, setAiTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((item) => item.id === providerConfigId) ?? null;
  const viewerModels = preferredModelOrder(models.filter((model) => model.providerConfigId === providerConfigId));
  const roleModels = preferredModelOrder(models);
  const validViewerModelId = viewerModels.some((model) => model.modelId === viewerModelId) ? viewerModelId : "";
  const viewerModel = viewerModels.find((model) => model.modelId === validViewerModelId) ?? null;
  useEffect(() => {
    if (aiTouched) return;
    const nextProvider = providers.find((item) => item.credentialId === profile.credentialId) ?? null;
    const storedModel = models.find((model) => model.providerConfigId === nextProvider?.id && model.modelId === profile.defaultViewerModelId) ?? null;
    setProviderConfigId(nextProvider?.id ?? "");
    setViewerModelId(profile.defaultViewerModelId ?? "");
    setReasoning(reasoningEffortForModel(storedModel, profile.defaultViewerReasoningEffort) ?? "");
    const storedTemperature = storedModel?.capabilities.temperature.supported ? profile.defaultViewerTemperature ?? defaultTemperatureForModel(storedModel) : undefined;
    setTemperature(storedTemperature === undefined ? "" : String(storedTemperature));
    setSystemPrompt(localizedViewerEditablePrompt(profile.defaultViewerSystemPrompt, interfaceLanguage));
    setMonitorModelKey(resolveRoleDefault(profile, "monitor", models));
    setJudgeModelKey(resolveRoleDefault(profile, "judge", models));
  }, [aiTouched, interfaceLanguage, models, profile, providers]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (aiTouched && (!provider || !validViewerModelId)) { setError(copy.selectViewerBeforeSaving); return; }
    setSaving(true); setError(null);
    try {
      const aiConfiguration = aiTouched ? { ...buildProfileAiConfiguration(copy, provider, viewerModel, reasoning, temperature, systemPrompt, monitorModelKey, judgeModelKey), defaultMonitorSystemPrompt: localizedMonitorEditablePrompt(profile.defaultMonitorSystemPrompt, interfaceLanguage) } : undefined;
      await onSave(name, humanName || undefined, note, aiConfiguration);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const selectViewer = (modelId: string) => {
    const model = viewerModels.find((item) => item.modelId === modelId) ?? null;
    setViewerModelId(modelId);
    const sameStoredPair = provider?.credentialId === profile.credentialId && profile.defaultViewerModelId === modelId;
    setReasoning(sameStoredPair ? reasoningEffortForModel(model, profile.defaultViewerReasoningEffort) ?? "" : "");
    const nextTemperature = sameStoredPair && profile.defaultViewerTemperature !== undefined ? profile.defaultViewerTemperature : defaultTemperatureForModel(model);
    setTemperature(nextTemperature === undefined ? "" : String(nextTemperature));
    setAiTouched(true);
  };
  return <FormDialog title={copy.editProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}><div className="identity-name-grid"><label>{copy.aiIsBeName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div><small className="form-hint">{copy.identityNamesLead}</small><label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><p>{copy.aiDefaultsLead}</p>{providers.length ? <><label><span>{copy.profileCredential}</span><select value={providerConfigId} onChange={(event) => { setProviderConfigId(event.target.value); setViewerModelId(""); setReasoning(""); setTemperature(""); setAiTouched(true); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label><span>{copy.defaultViewerModel}</span><select value={validViewerModelId} onChange={(event) => selectViewer(event.target.value)} disabled={!provider}><option value="">{viewerModels.length ? copy.selectModel : copy.noCachedModels}</option>{viewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label><ProfileViewerControls copy={copy} model={viewerModel} reasoning={reasoning} temperature={temperature} systemPrompt={systemPrompt} onReasoning={(value) => { setReasoning(value); setAiTouched(true); }} onTemperature={(value) => { setTemperature(value); setAiTouched(true); }} onSystemPrompt={(value) => { setSystemPrompt(value); setAiTouched(true); }} /><label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><select value={judgeModelKey} onChange={(event) => { setJudgeModelKey(event.target.value); setAiTouched(true); }}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`edit-judge-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label><label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><select value={monitorModelKey} onChange={(event) => { setMonitorModelKey(event.target.value); setAiTouched(true); }}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`edit-monitor-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label></> : <small>{copy.configureProviderFirst}</small>}</fieldset>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving}>{saving ? copy.saving : copy.saveChanges}</button></div></form></FormDialog>;
}

export function buildProfileAiConfiguration(copy: ReturnType<typeof getCopy>, provider: ProviderConfig | null, viewerModel: ProviderModel | null, reasoning: "" | ReasoningEffort, temperatureInput: string, systemPrompt: string, monitorModelKey: string, judgeModelKey: string): ProfileAiConfigurationInput {
  if (!provider || !viewerModel || viewerModel.providerConfigId !== provider.id) throw new Error(copy.selectViewerBeforeSaving);
  const normalizedReasoning = reasoning ? reasoningEffortForModel(viewerModel, reasoning) : undefined;
  if (reasoning && !normalizedReasoning) throw new Error(copy.reasoningNotSupported);
  let temperature: number | undefined;
  if (viewerModel.capabilities.temperature.supported) {
    temperature = temperatureInput.trim() ? Number(temperatureInput) : defaultTemperatureForModel(viewerModel);
    const capability = viewerModel.capabilities.temperature;
    if (!Number.isFinite(temperature) || (capability.min !== undefined && temperature! < capability.min) || (capability.max !== undefined && temperature! > capability.max)) throw new Error(copy.temperatureOutOfRange);
  }
  const monitor = splitModelRouteKey(monitorModelKey);
  const judge = splitModelRouteKey(judgeModelKey);
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
