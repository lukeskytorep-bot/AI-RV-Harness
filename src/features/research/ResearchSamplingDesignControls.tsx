import type { getCopy } from "../../i18n";
import type { GenerationSettings } from "../../providers/types";
import {
  researchSamplingConditionValues,
  researchSamplingConfigurationCount,
  researchSamplingSessionCount,
  samplingConditionLabel,
  validateResearchSamplingDesign,
} from "../../research/samplingDesign";
import type { ResearchSamplingDesign, ResearchSamplingParameter } from "../../research/types";

export interface ResearchSamplingAxisForm {
  mode: "fixed" | "varied";
  fixed: string;
  values: string[];
}

export interface ResearchSamplingFormState {
  topP: ResearchSamplingAxisForm;
  topK: ResearchSamplingAxisForm;
  seed: ResearchSamplingAxisForm;
}

export function researchSamplingFormFromRequested(requested: GenerationSettings): ResearchSamplingFormState {
  const text = (value: number | undefined) => value === undefined ? "" : String(value);
  return {
    topP: { mode: "fixed", fixed: text(requested.topP), values: [text(requested.topP), ""] },
    topK: { mode: "fixed", fixed: text(requested.topK), values: [text(requested.topK), ""] },
    seed: { mode: "fixed", fixed: text(requested.seed), values: [text(requested.seed), ""] },
  };
}

export function buildResearchSamplingDesignFromForm(form: ResearchSamplingFormState): ResearchSamplingDesign {
  const axis = (parameter: ResearchSamplingParameter, state: ResearchSamplingAxisForm) => {
    if (state.mode === "fixed") {
      const value = parseSamplingField(parameter, state.fixed, true);
      return value === undefined ? { mode: "fixed" as const } : { mode: "fixed" as const, value };
    }
    return { mode: "varied" as const, values: state.values.map((value) => parseSamplingField(parameter, value, false)!) };
  };
  return validateResearchSamplingDesign({ version: 1, topP: axis("topP", form.topP), topK: axis("topK", form.topK), seed: axis("seed", form.seed) });
}

export function ResearchSamplingDesignControls({ copy, form, onChange, targetCount, repetitions, viewerCallsPerSession, judgeCount }: {
  copy: ReturnType<typeof getCopy>;
  form: ResearchSamplingFormState;
  onChange: (form: ResearchSamplingFormState) => void;
  targetCount: number;
  repetitions: number;
  viewerCallsPerSession: number;
  judgeCount: number;
}) {
  let design: ResearchSamplingDesign | null = null;
  let error = "";
  try { design = buildResearchSamplingDesignFromForm(form); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const configurations = design ? researchSamplingConfigurationCount(design) : null;
  let sessions: number | null = null;
  if (design && targetCount > 0) {
    try { sessions = researchSamplingSessionCount(design, targetCount, repetitions); } catch (cause) { error ||= cause instanceof Error ? cause.message : String(cause); }
  }
  const shownError = error.includes("at least one varied axis") ? copy.samplingChooseComparedAxis : error;
  const preview = design ? researchSamplingConditionValues(design).slice(0, 12) : [];
  const setAxis = (parameter: ResearchSamplingParameter, next: ResearchSamplingAxisForm) => onChange({ ...form, [parameter]: next });
  const rows: Array<[ResearchSamplingParameter, string]> = [["topP", "top_p"], ["topK", "top_k"], ["seed", "seed"]];
  return <div className="research-form-section research-sampling-design" data-testid="research-sampling-design">
    <div className="research-section-head"><div><strong>{copy.samplingConfigurations}</strong><small>{copy.samplingConfigurationsLead}</small></div>{configurations !== null && <span className="status-chip ready">{configurations} {copy.samplingConfigurationsCount}</span>}</div>
    <div className="research-sampling-axis-list">{rows.map(([parameter, label]) => {
      const state = form[parameter];
      return <div className="research-sampling-axis" key={parameter} data-parameter={parameter}>
        <div className="research-sampling-axis-head"><strong>{label}</strong><select aria-label={`${label} mode`} value={state.mode} onChange={(event) => setAxis(parameter, { ...state, mode: event.target.value as "fixed" | "varied" })}><option value="fixed">{copy.samplingFixed}</option><option value="varied">{copy.samplingCompared}</option></select></div>
        {state.mode === "fixed" ? <label className="research-sampling-fixed"><span>{state.fixed.trim() ? copy.samplingFixed : copy.autoProviderDefault}</span><input inputMode={parameter === "topP" ? "decimal" : "numeric"} value={state.fixed} onChange={(event) => setAxis(parameter, { ...state, fixed: event.target.value })} placeholder={copy.autoProviderDefault} /></label> : <div className="research-sampling-values">{state.values.map((value, index) => <div key={index}><input aria-label={`${label} value ${index + 1}`} inputMode={parameter === "topP" ? "decimal" : "numeric"} value={value} onChange={(event) => setAxis(parameter, { ...state, values: state.values.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder={`${label} ${index + 1}`} /><button type="button" className="icon-button danger" aria-label={`${copy.samplingRemoveValue} ${label} ${index + 1}`} disabled={state.values.length <= 2} onClick={() => setAxis(parameter, { ...state, values: state.values.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>)}<button type="button" className="secondary-button" onClick={() => setAxis(parameter, { ...state, values: [...state.values, ""] })}>{copy.samplingAddValue}</button></div>}
      </div>;
    })}</div>
    <small>{copy.samplingDecimalLead}</small>
    {shownError && <div className="provider-error" data-testid="sampling-design-error">{shownError}</div>}
    {design && <div className="research-sampling-preview"><div className="research-lock-controls"><span><small>{copy.samplingConfigurationsCount}</small><strong>{configurations}</strong></span><span><small>{copy.samplingSessionsCount}</small><strong>{sessions ?? "—"}</strong></span><span><small>{copy.viewerCalls}</small><strong>{sessions === null ? "—" : sessions * viewerCallsPerSession}</strong></span><span><small>{copy.judgeCalls}</small><strong>{sessions === null ? "—" : sessions * judgeCount}</strong></span></div><strong>{copy.samplingPreview}</strong><div className="condition-pills research-sampling-preview-pills">{preview.map((values, index) => <span key={index}>{samplingConditionLabel(values)}</span>)}</div>{configurations !== null && configurations > preview.length && <small>+{configurations - preview.length} {copy.samplingMoreConfigurations}</small>}</div>}
  </div>;
}

function parseSamplingField(parameter: ResearchSamplingParameter, raw: string, allowAuto: boolean): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (allowAuto) return undefined;
    throw new Error(`${wire(parameter)} compared values cannot be empty.`);
  }
  const normalized = parameter === "topP" && trimmed.includes(",") && !trimmed.includes(".") ? trimmed.replace(",", ".") : trimmed;
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`${wire(parameter)} must be a finite number.`);
  return value;
}

function wire(parameter: ResearchSamplingParameter): string { return parameter === "topP" ? "top_p" : parameter === "topK" ? "top_k" : "seed"; }
