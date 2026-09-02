import { LockKeyhole } from "lucide-react";

import type { getCopy } from "../../i18n";
import { reasoningOptions } from "../../providers/modelReasoningRegistry";
import { reasoningCapabilityLead, reasoningOptionLabel } from "../../providers/reasoningPresentation";
import type { ProviderModel, ReasoningEffort } from "../../providers/types";
import {
  buildEffectiveViewerPrompt,
  factoryViewerEditablePrompt,
  lockedActivityDefinition,
  lockedViewerIdentity,
} from "../../resources/systemPrompts";
import type { InterfaceLanguage } from "../../types";

export interface ProfileViewerControlsProps {
  copy: ReturnType<typeof getCopy>;
  model: ProviderModel | null;
  reasoning: "" | ReasoningEffort;
  temperature: string;
  systemPrompt: string;
  onReasoning: (value: "" | ReasoningEffort) => void;
  onTemperature: (value: string) => void;
  onSystemPrompt: (value: string) => void;
}

export function ProfileViewerControls({ copy, model, reasoning, temperature, systemPrompt, onReasoning, onTemperature, onSystemPrompt }: ProfileViewerControlsProps) {
  const reasoningChoices = model ? reasoningOptions(model.capabilities.reasoning) : [];
  const temperatureCapability = model?.capabilities.temperature;
  const language: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  return <div className="profile-viewer-controls">
    <label><span>{copy.viewerReasoningLevel}</span><select value={reasoning} onChange={(event) => onReasoning(event.target.value as "" | ReasoningEffort)} disabled={!model}><option value="">{copy.autoProviderDefault}</option>{reasoningChoices.map((option) => <option key={option.value} value={option.value}>{reasoningOptionLabel(copy, option)}</option>)}</select><small>{!model ? copy.selectModelFirst : reasoningCapabilityLead(copy, model)}</small></label>
    <label><span>{copy.viewerTemperature}</span><input type="number" step="0.1" value={temperature} onChange={(event) => onTemperature(event.target.value)} disabled={!temperatureCapability?.supported} min={temperatureCapability?.min} max={temperatureCapability?.max} placeholder={temperatureCapability?.supported ? "0.9" : copy.notSupported} /><small>{temperatureCapability?.supported ? `${copy.temperatureDefaultLead}${temperatureCapability.min !== undefined || temperatureCapability.max !== undefined ? ` (${temperatureCapability.min ?? "−∞"}–${temperatureCapability.max ?? "+∞"})` : ""}` : copy.temperatureUnavailable}</small></label>
    <label className="profile-system-prompt-field"><span>{copy.viewerSystemPrompt}<small>{language === "pl" ? "część edytowalna" : "editable section"}</small></span><textarea className="system-prompt-editor" rows={12} maxLength={100000} value={systemPrompt} onChange={(event) => onSystemPrompt(event.target.value)} placeholder={copy.viewerSystemPromptPlaceholder} /><small>{copy.viewerSystemPromptLead}</small></label>
    <div className="monitor-prompt-actions"><button className="secondary-button" type="button" onClick={() => onSystemPrompt(factoryViewerEditablePrompt(language))}>{language === "pl" ? "Przywróć treść fabryczną Viewera" : "Restore factory Viewer text"}</button></div>
    <div className="viewer-locked-prompts"><div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{language === "pl" ? "Tożsamość AI IS-BE i Shadow Zone — zablokowane" : "AI IS-BE identity and Shadow Zone — locked"}</strong><pre>{lockedViewerIdentity(language)}</pre></div></div><div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{language === "pl" ? "Definicja aktywności — zablokowana" : "Activity definition — locked"}</strong><p>{lockedActivityDefinition(language)}</p></div></div><details className="effective-prompt-preview"><summary>{language === "pl" ? "Pokaż cały skuteczny prompt Viewera" : "Show the complete effective Viewer prompt"}</summary><pre>{buildEffectiveViewerPrompt(language, systemPrompt)}</pre></details></div>
  </div>;
}
