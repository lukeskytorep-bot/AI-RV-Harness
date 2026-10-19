import { LockKeyhole } from "lucide-react";

import type { getCopy } from "../../i18n";
import { reasoningOptions } from "../../providers/modelReasoningRegistry";
import { reasoningCapabilityLead, reasoningOptionLabel } from "../../providers/reasoningPresentation";
import type { ProviderKind, ProviderModel, ReasoningEffort } from "../../providers/types";
import { OpenRouterSamplingControls, type OpenRouterSamplingUiState } from "./OpenRouterSamplingControls";
import {
  buildEffectiveViewerPrompt,
  factoryViewerFieldGuide,
  lockedViewerBaseVocabulary,
  lockedViewerIdentity,
  stripKnownLockedBaseVocabulary,
} from "../../resources/systemPrompts";
import type { CustomTemperatureMode, InterfaceLanguage } from "../../types";

export interface ProfileViewerControlsProps {
  copy: ReturnType<typeof getCopy>;
  model: ProviderModel | null;
  reasoning: "" | ReasoningEffort;
  temperature: string;
  temperatureMode?: CustomTemperatureMode | "legacy";
  systemPrompt: string;
  providerKind?: ProviderKind;
  sampling?: OpenRouterSamplingUiState;
  onSamplingEnabled?: (value: boolean) => void;
  onSamplingTopP?: (value: string) => void;
  onSamplingTopK?: (value: string) => void;
  onSamplingSeed?: (value: string) => void;
  onReasoning: (value: "" | ReasoningEffort) => void;
  onTemperature: (value: string) => void;
  onTemperatureMode?: (value: CustomTemperatureMode) => void;
}

export function ProfileViewerControls({ copy, model, reasoning, temperature, temperatureMode = "legacy", systemPrompt, providerKind, sampling, onSamplingEnabled, onSamplingTopP, onSamplingTopK, onSamplingSeed, onReasoning, onTemperature, onTemperatureMode }: ProfileViewerControlsProps) {
  const reasoningChoices = model ? reasoningOptions(model.capabilities.reasoning) : [];
  const temperatureCapability = model?.capabilities.temperature;
  const language: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  const legacyFieldGuide = systemPrompt.trim() ? stripKnownLockedBaseVocabulary(systemPrompt) : factoryViewerFieldGuide(language);
  return <div className="profile-viewer-controls">
    <label><span>{copy.viewerReasoningLevel}</span><select value={reasoning} onChange={(event) => onReasoning(event.target.value as "" | ReasoningEffort)} disabled={!model}><option value="">{copy.autoProviderDefault}</option>{reasoningChoices.map((option) => <option key={option.value} value={option.value}>{reasoningOptionLabel(copy, option)}</option>)}</select><small>{!model ? copy.selectModelFirst : reasoningCapabilityLead(copy, model)}</small></label>
    {providerKind === "custom_openai" && onTemperatureMode ? <label><span>{copy.viewerTemperature}</span><select value={temperatureMode} onChange={(event) => onTemperatureMode(event.target.value as CustomTemperatureMode)} disabled={!model}>{temperatureMode === "legacy" && <option value="legacy">{copy.temperatureLegacy}</option>}<option value="provider_default">{copy.temperatureProviderDefault}</option><option value="manual">{copy.temperatureManual}</option></select>{temperatureMode === "manual" && <input type="number" step="0.1" value={temperature} onChange={(event) => onTemperature(event.target.value)} placeholder="0.9" />}<small>{temperatureMode === "legacy" ? copy.temperatureLegacyLead : temperatureMode === "manual" ? copy.temperatureCustomManualLead : copy.temperatureProviderDefaultLead}</small></label> : <label><span>{copy.viewerTemperature}</span><input type="number" step="0.1" value={temperature} onChange={(event) => onTemperature(event.target.value)} disabled={!temperatureCapability?.supported} min={temperatureCapability?.min} max={temperatureCapability?.max} placeholder={temperatureCapability?.supported ? "0.9" : copy.notSupported} /><small>{temperatureCapability?.supported ? `${copy.temperatureDefaultLead}${temperatureCapability.min !== undefined || temperatureCapability.max !== undefined ? ` (${temperatureCapability.min ?? "−∞"}–${temperatureCapability.max ?? "+∞"})` : ""}` : copy.temperatureUnavailable}</small></label>}
    {(providerKind === "openrouter" || providerKind === "custom_openai") && sampling && onSamplingEnabled && onSamplingTopP && onSamplingTopK && onSamplingSeed && <OpenRouterSamplingControls copy={copy} model={model} providerKind={providerKind} {...sampling} onEnabled={onSamplingEnabled} onTopP={onSamplingTopP} onTopK={onSamplingTopK} onSeed={onSamplingSeed} />}
    <div className="profile-system-prompt-field viewer-field-guide-readonly"><span>{language === "pl" ? "Przewodnik Pola" : "Field Guide"}<small>{language === "pl" ? "tylko do odczytu w Profilu" : "read-only in Profile"}</small></span><pre>{legacyFieldGuide}</pre><small>{language === "pl" ? "Przewodnikiem Pola, jego historią i pojemnością zarządza ekran Nauka Viewera. Istniejąca treść Profilu jest zachowywana jako legacy baseline i nie jest tutaj edytowana." : "Field Guide content, history, and capacity are managed in Viewer Learning. Existing Profile content is preserved as a legacy baseline and is not edited here."}</small></div>
    <div className="viewer-locked-prompts">
      <div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{language === "pl" ? "Locked Core Identity" : "Locked Core Identity"}</strong><pre>{lockedViewerIdentity(language)}</pre></div></div>
      <div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{language === "pl" ? "Locked Base Vocabulary" : "Locked Base Vocabulary"}</strong><pre>{lockedViewerBaseVocabulary(language)}</pre></div></div>
      <details className="effective-prompt-preview"><summary>{language === "pl" ? "Pokaż cały skuteczny prompt Viewera" : "Show the complete effective Viewer prompt"}</summary><pre>{buildEffectiveViewerPrompt(language, legacyFieldGuide)}</pre></details>
    </div>
  </div>;
}
