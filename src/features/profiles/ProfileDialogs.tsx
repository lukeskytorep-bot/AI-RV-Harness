import { profileSaveErrorMessage } from "../../application/viewerProfileSave";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { FormDialog } from "../../components/FormDialog";
import { ModelRouteSelect } from "../../components/ModelRouteSelect";
import { PROVIDER_LABELS } from "../../components/ProviderSettings";
import { getCopy } from "../../i18n";
import { preferredModelOrder, resolveRoleDefault } from "../../modelRoutes";
import { defaultTemperatureForModel, reasoningEffortForModel } from "../../profileViewerDefaults";
import type { CustomReasoningMode, ProviderConfig, ProviderKind, ProviderModel, ReasoningEffort } from "../../providers/types";
import { localizedMonitorEditablePrompt } from "../../resources/systemPrompts";
import type { AppRepository } from "../../storage/repository";
import type { CustomTemperatureMode, InterfaceLanguage, Profile, ProfileAiConfigurationInput } from "../../types";
import { buildProfileAiConfiguration, parseOpenRouterAdditionalSamplingInputs } from "./profileAiConfiguration";
import { ProfileViewerControls } from "./ProfileViewerControls";
import { NEW_PROFILE_PROVIDER_CHOICE, useProfileSetupController } from "./useProfileSetupController";

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const advancedToggleRef = useRef<HTMLButtonElement | null>(null);
  const advancedFirstRef = useRef<HTMLSelectElement | null>(null);
  const setup = useProfileSetupController({ copy, repository });
  const provider = setup.selectedProvider;
  const viewerModel = setup.viewerModel;
  const defaultTemperature = defaultTemperatureForModel(viewerModel);
  const advancedConfigured = Boolean(
    setup.viewerReasoning
    || setup.judgeModelKey
    || setup.monitorModelKey
    || setup.viewerSamplingEnabled
    || (setup.selectedProvider?.provider === "custom_openai"
      ? setup.viewerTemperatureMode !== "provider_default"
      : (viewerModel?.capabilities.temperature.supported && setup.viewerTemperature !== (defaultTemperature === undefined ? "" : String(defaultTemperature)))),
  );

  const toggleAdvanced = () => {
    if (advancedOpen) {
      setAdvancedOpen(false);
      window.setTimeout(() => advancedToggleRef.current?.focus(), 0);
      return;
    }
    setAdvancedOpen(true);
    window.setTimeout(() => advancedFirstRef.current?.focus(), 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !viewerModel || saving || setup.busy) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await onCreate(aiName, humanName || undefined, note || undefined, setup.buildAiConfiguration());
    } catch (cause) {
      setSubmitError(profileSaveErrorMessage(cause, copy === getCopy("pl") ? "pl" : "en"));
    } finally {
      setSaving(false);
    }
  };

  const addConnection = () => {
    setAdvancedOpen(true);
    setup.changeConnection(NEW_PROFILE_PROVIDER_CHOICE);
    window.setTimeout(() => advancedFirstRef.current?.focus(), 0);
  };

  return <FormDialog title={copy.createProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}>
    <div className="identity-name-grid"><label>{copy.aiIsBeName}<input autoFocus value={aiName} onChange={(event) => setAiName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div>
    <small className="form-hint">{copy.identityNamesLead}</small>
    <label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <fieldset className="profile-edit-ai profile-create-ai"><legend>{copy.profileAiDefaults}</legend>
      <label>{copy.profileCredential}<select value={provider?.id ?? ""} onChange={(event) => setup.changeConnection(event.target.value)} disabled={setup.busy}><option value="">{copy.selectProviderConnection}</option>{setup.providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label>
      <label>{copy.defaultViewerModel}<select value={setup.viewerModelId} onChange={(event) => setup.selectViewerModel(event.target.value)} disabled={!provider || setup.busy}><option value="">{setup.providerModels.length ? copy.selectModel : copy.noCachedModels}</option>{setup.providerModels.map((item) => <option key={item.modelId} value={item.modelId}>{item.favorite ? "★ " : item.recommended ? "✦ " : ""}{item.displayName}</option>)}</select></label>
      <div className="profile-create-advanced-toggle-row">
        <button ref={advancedToggleRef} type="button" className="secondary-button" aria-expanded={advancedOpen} aria-controls="profile-create-advanced" onClick={toggleAdvanced}>{advancedOpen ? copy.hideAdvancedOptions : copy.advancedOptions}</button>
        {!advancedOpen && <button type="button" className="secondary-button" onClick={addConnection}>{copy.addConnectionApiKey}</button>}
        {advancedConfigured && <span className="profile-advanced-status">{copy.advancedOptionsConfigured}</span>}
      </div>
      {advancedOpen && <section id="profile-create-advanced" className="profile-create-advanced" aria-label={copy.advancedOptions}>
        <p>{copy.advancedOptionsLead}</p>
        {!setup.desktop && <div className="runtime-warning">{copy.setupNeedsDesktop}</div>}
        <div className="profile-create-provider-management">
          <label>{copy.providerConnection}<select ref={advancedFirstRef} value={setup.connectionChoice} onChange={(event) => setup.changeConnection(event.target.value)} disabled={setup.busy}>{setup.providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}<option value={NEW_PROFILE_PROVIDER_CHOICE}>＋ {copy.newProviderConnection}</option></select></label>
          {(!setup.providers.length || setup.connectionChoice === NEW_PROFILE_PROVIDER_CHOICE) && <div className="setup-provider-grid profile-create-provider-grid">
            <label>{copy.provider}<select value={setup.providerKind} onChange={(event) => setup.changeProviderKind(event.target.value as ProviderKind)} disabled={setup.busy}>{setup.providerKinds.map((kind) => <option key={kind} value={kind}>{PROVIDER_LABELS[kind]}</option>)}</select></label>
            <label>{copy.providerLabel}<input value={setup.providerLabel} onChange={(event) => setup.setProviderLabel(event.target.value)} disabled={setup.busy} /></label>
            {(setup.providerKind === "custom_openai" || setup.providerKind === "blackbox") && <label className="wide">{copy.baseUrl}<input type="url" value={setup.baseUrl} onChange={(event) => setup.setBaseUrl(event.target.value)} disabled={setup.busy} placeholder={setup.providerKind === "blackbox" ? "https://enterprise.blackbox.ai" : "https://example.com/v1"} /></label>}
            <label className="wide">{copy.apiKey}<input type="password" autoComplete="off" value={setup.apiKey} onChange={(event) => setup.setApiKey(event.target.value)} disabled={setup.busy} /></label>
            {setup.providerKind === "blackbox" && setup.blackboxManualModelRequired && <label className="wide">{copy.blackboxManualModelId}<input value={setup.blackboxManualModelId} onChange={(event) => setup.setBlackboxManualModelId(event.target.value)} disabled={setup.busy} placeholder="provider/model-id" /><small>{copy.blackboxManualModelLead}</small></label>}
          </div>}
          {setup.selectedProvider?.provider === "blackbox" && setup.blackboxManualModelRequired && <label className="wide">{copy.blackboxManualModelId}<input value={setup.blackboxManualModelId} onChange={(event) => setup.setBlackboxManualModelId(event.target.value)} disabled={setup.busy} placeholder="provider/model-id" /><small>{copy.blackboxManualModelLead}</small></label>}
          <div className="profile-create-provider-actions"><button type="button" className="secondary-button" disabled={!setup.desktop || setup.busy || (setup.blackboxManualModelRequired && !setup.blackboxManualModelId.trim()) || (!setup.selectedProvider && (!setup.providerLabel.trim() || !setup.apiKey.trim() || (setup.providerKind === "custom_openai" && !setup.baseUrl.trim())))} onClick={() => void setup.connectProvider()}>{setup.busy ? copy.refreshing : setup.blackboxManualModelRequired ? copy.blackboxUseManualModel : copy.connectLoadModels}</button></div>
        </div>
        <ProfileViewerControls copy={copy} model={setup.viewerModel} providerKind={setup.selectedProvider?.provider} reasoning={setup.viewerReasoning} temperature={setup.viewerTemperature} temperatureMode={setup.viewerTemperatureMode} customReasoningMode={setup.viewerCustomReasoningMode} sampling={{ enabled: setup.viewerSamplingEnabled, topP: setup.viewerTopP, topK: setup.viewerTopK, seed: setup.viewerSeed }} systemPrompt={setup.viewerSystemPrompt} onReasoning={setup.setViewerReasoning} onTemperature={setup.setViewerTemperature} onTemperatureMode={setup.setViewerTemperatureMode} onCustomReasoningMode={setup.setViewerCustomReasoningMode} onSamplingEnabled={setup.setViewerSamplingEnabled} onSamplingTopP={setup.setViewerTopP} onSamplingTopK={setup.setViewerTopK} onSamplingSeed={setup.setViewerSeed} />
        <div className="optional-role-grid profile-create-role-grid">
          <label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><ModelRouteSelect role="judge" credentialId={setup.selectedProvider?.credentialId} providers={setup.providers} models={setup.models} value={setup.judgeModelKey} onChange={setup.setJudgeModelKey} emptyLabel={copy.skipForNow} /><small>{copy.judgeLead}</small></label>
          <label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><ModelRouteSelect role="monitor" credentialId={setup.selectedProvider?.credentialId} providers={setup.providers} models={setup.models} value={setup.monitorModelKey} onChange={setup.setMonitorModelKey} emptyLabel={copy.skipForNow} /><small>{copy.monitorGuard}</small></label>
        </div>
        {advancedConfigured && <div className="profile-create-advanced-reset"><button type="button" className="secondary-button" onClick={setup.resetAdvancedOptions}>{copy.resetAdvancedOptions}</button></div>}
      </section>}
    </fieldset>
    {(submitError || setup.error) && <div className="provider-error" role="alert">{submitError ?? setup.error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving || setup.busy}>{copy.cancel}</button><button className="primary-button" disabled={saving || setup.busy || !provider || !viewerModel}>{saving ? copy.saving : copy.create}</button></div>
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
  const [temperatureMode, setTemperatureMode] = useState<CustomTemperatureMode | "legacy">(profile.defaultViewerCustomTemperatureMode ?? "legacy");
  const [customReasoningMode, setCustomReasoningMode] = useState<CustomReasoningMode>(profile.defaultViewerCustomReasoningMode ?? "default");
  const [samplingEnabled, setSamplingEnabled] = useState(profile.defaultViewerOpenRouterSampling?.enabled ?? false);
  const [topP, setTopP] = useState(profile.defaultViewerOpenRouterSampling?.topP === undefined ? "" : String(profile.defaultViewerOpenRouterSampling.topP));
  const [topK, setTopK] = useState(profile.defaultViewerOpenRouterSampling?.topK === undefined ? "" : String(profile.defaultViewerOpenRouterSampling.topK));
  const [seed, setSeed] = useState(profile.defaultViewerOpenRouterSampling?.seed === undefined ? "" : String(profile.defaultViewerOpenRouterSampling.seed));
  const interfaceLanguage: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  const [systemPrompt, setSystemPrompt] = useState(profile.defaultViewerSystemPrompt ?? "");
  const [monitorModelKey, setMonitorModelKey] = useState(resolveRoleDefault(profile, "monitor", providers, models));
  const [judgeModelKey, setJudgeModelKey] = useState(resolveRoleDefault(profile, "judge", providers, models));
  const [aiTouched, setAiTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((item) => item.id === providerConfigId) ?? null;
  const viewerModels = preferredModelOrder(models.filter((model) => model.providerConfigId === providerConfigId));
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
    setTemperatureMode(nextProvider?.provider === "custom_openai" ? profile.defaultViewerCustomTemperatureMode ?? "legacy" : "legacy");
    setCustomReasoningMode(nextProvider?.provider === "custom_openai" ? profile.defaultViewerCustomReasoningMode ?? "default" : "default");
    setSamplingEnabled(profile.defaultViewerOpenRouterSampling?.enabled ?? false);
    setTopP(profile.defaultViewerOpenRouterSampling?.topP === undefined ? "" : String(profile.defaultViewerOpenRouterSampling.topP));
    setTopK(profile.defaultViewerOpenRouterSampling?.topK === undefined ? "" : String(profile.defaultViewerOpenRouterSampling.topK));
    setSeed(profile.defaultViewerOpenRouterSampling?.seed === undefined ? "" : String(profile.defaultViewerOpenRouterSampling.seed));
    setSystemPrompt(profile.defaultViewerSystemPrompt ?? "");
    setMonitorModelKey(resolveRoleDefault(profile, "monitor", providers, models));
    setJudgeModelKey(resolveRoleDefault(profile, "judge", providers, models));
  }, [aiTouched, interfaceLanguage, models, profile, providers]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (aiTouched && (!provider || !validViewerModelId)) { setError(copy.selectViewerBeforeSaving); return; }
    setSaving(true); setError(null);
    try {
      const aiConfiguration = aiTouched ? { ...buildProfileAiConfiguration(copy, provider, viewerModel, reasoning, temperature, systemPrompt, monitorModelKey, judgeModelKey, providers, models, (provider?.provider === "openrouter" || provider?.provider === "custom_openai" || provider?.provider === "mistral" || provider?.provider === "blackbox") ? parseOpenRouterAdditionalSamplingInputs(copy, samplingEnabled, topP, topK, seed) : undefined, provider?.provider === "custom_openai" ? temperatureMode : undefined, provider?.provider === "custom_openai" ? customReasoningMode : undefined), defaultMonitorSystemPrompt: localizedMonitorEditablePrompt(profile.defaultMonitorSystemPrompt, interfaceLanguage) } : undefined;
      await onSave(name, humanName || undefined, note, aiConfiguration);
    }
    catch (cause) { setError(profileSaveErrorMessage(cause, copy === getCopy("pl") ? "pl" : "en")); }
    finally { setSaving(false); }
  };
  const selectViewer = (modelId: string) => {
    const model = viewerModels.find((item) => item.modelId === modelId) ?? null;
    setViewerModelId(modelId);
    const sameStoredPair = provider?.credentialId === profile.credentialId && profile.defaultViewerModelId === modelId;
    setReasoning(sameStoredPair ? reasoningEffortForModel(model, profile.defaultViewerReasoningEffort) ?? "" : "");
    const nextTemperature = sameStoredPair && profile.defaultViewerTemperature !== undefined ? profile.defaultViewerTemperature : defaultTemperatureForModel(model);
    setTemperature(nextTemperature === undefined ? "" : String(nextTemperature));
    setTemperatureMode(provider?.provider === "custom_openai" ? (sameStoredPair ? profile.defaultViewerCustomTemperatureMode ?? "legacy" : "provider_default") : "legacy");
    setCustomReasoningMode(provider?.provider === "custom_openai" ? (sameStoredPair ? profile.defaultViewerCustomReasoningMode ?? "default" : "default") : "default");
    setAiTouched(true);
  };
  return <FormDialog title={copy.editProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}><div className="identity-name-grid"><label>{copy.aiIsBeName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div><small className="form-hint">{copy.identityNamesLead}</small><label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><p>{copy.aiDefaultsLead}</p>{providers.length ? <><label><span>{copy.profileCredential}</span><select value={providerConfigId} onChange={(event) => { setProviderConfigId(event.target.value); setViewerModelId(""); setReasoning(""); setTemperature(""); setTemperatureMode("legacy"); setCustomReasoningMode("default"); setJudgeModelKey(""); setMonitorModelKey(""); setAiTouched(true); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label><span>{copy.defaultViewerModel}</span><select value={validViewerModelId} onChange={(event) => selectViewer(event.target.value)} disabled={!provider}><option value="">{viewerModels.length ? copy.selectModel : copy.noCachedModels}</option>{viewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label><ProfileViewerControls copy={copy} model={viewerModel} providerKind={provider?.provider} reasoning={reasoning} temperature={temperature} temperatureMode={temperatureMode} customReasoningMode={customReasoningMode} sampling={{ enabled: samplingEnabled, topP, topK, seed }} systemPrompt={systemPrompt} onReasoning={(value) => { setReasoning(value); setAiTouched(true); }} onTemperature={(value) => { setTemperature(value); setAiTouched(true); }} onTemperatureMode={(value) => { setTemperatureMode(value); setAiTouched(true); }} onCustomReasoningMode={(value) => { setCustomReasoningMode(value); setAiTouched(true); }} onSamplingEnabled={(value) => { setSamplingEnabled(value); setAiTouched(true); }} onSamplingTopP={(value) => { setTopP(value); setAiTouched(true); }} onSamplingTopK={(value) => { setTopK(value); setAiTouched(true); }} onSamplingSeed={(value) => { setSeed(value); setAiTouched(true); }} /><label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><ModelRouteSelect role="judge" credentialId={provider?.credentialId} providers={providers} models={models} value={judgeModelKey} onChange={(next) => { setJudgeModelKey(next); setAiTouched(true); }} emptyLabel={copy.skipForNow} /></label><label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><ModelRouteSelect role="monitor" credentialId={provider?.credentialId} providers={providers} models={models} value={monitorModelKey} onChange={(next) => { setMonitorModelKey(next); setAiTouched(true); }} emptyLabel={copy.skipForNow} /></label></> : <small>{copy.configureProviderFirst}</small>}</fieldset>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving}>{saving ? copy.saving : copy.saveChanges}</button></div></form></FormDialog>;
}


export { buildProfileAiConfiguration } from "./profileAiConfiguration";
