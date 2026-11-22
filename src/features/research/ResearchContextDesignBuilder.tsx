import { RESEARCH_CONTEXT_BLOCK_KEYS, type ResearchContextBlockKey, type ResearchContextConditionDesign } from "../../research/types";
import { changeContextAddition, changeContextEditorMode, changeContextReplacement, createContextEditorCondition, MAX_CONTEXT_DRAFT_CONDITIONS, toggleContextAddition, validateResearchContextDraft, type ResearchContextEditorCondition } from "../../research/contextDesignDraft";

const BLOCK_LABELS: Record<ResearchContextBlockKey, string> = {
  system_prompt: "System Prompt / Field Guide", viewer_notes: "Viewer Notes", viewer_identity: "Viewer Identity", base_vocabulary: "Base Vocabulary",
};
let nextDraftId = 0;
export const createDefaultResearchContextConditions = (): ResearchContextEditorCondition[] => [
  createContextEditorCondition({ id: `context-${++nextDraftId}`, label: "Standard", design: { version: 1, mode: "standard" } }),
  createContextEditorCondition({ id: `context-${++nextDraftId}`, label: "Tabula rasa", design: { version: 1, mode: "replace_all", content: "" } }),
];
const newCondition = (): ResearchContextEditorCondition => createContextEditorCondition({ id: `context-${++nextDraftId}`, label: `Condition ${nextDraftId}`, design: { version: 1, mode: "replace_all", content: "" } });

export function ResearchContextConditionsEditor({ conditions, onChange, disabled = false }: { conditions: ResearchContextEditorCondition[]; onChange: (next: ResearchContextEditorCondition[]) => void; disabled?: boolean }) {
  const errors = validateResearchContextDraft(conditions);
  const update = (id: string, change: (condition: ResearchContextEditorCondition) => ResearchContextEditorCondition) => onChange(conditions.map((condition) => condition.id === id ? change(condition) : condition));
  return <div className="research-form-section">
    <div className="research-section-head"><div><strong>Context conditions</strong><small>Standard · Replace All / Tabula Rasa · Add to Selected</small></div></div>
    <p><strong>Tabula Rasa</strong> removes extra Viewer context only. The RV protocol, model pretraining, and server-side instructions are not removed.</p>
    <div className="research-variants">{conditions.map((condition, index) => <div key={condition.id} className="research-form-section">
      <label>Condition {index + 1} · Label <input disabled={disabled} maxLength={120} value={condition.label} onChange={(event) => update(condition.id, (item) => ({ ...item, label: event.target.value }))} /></label>
      <label>Mode <select disabled={disabled} value={condition.design.mode} onChange={(event) => update(condition.id, (item) => changeContextEditorMode(item, event.target.value as ResearchContextConditionDesign["mode"]))}>
        <option value="standard">Standard</option><option value="replace_all">Replace All / Tabula Rasa</option><option value="add_to_selected">Add to Selected</option>
      </select></label>
      {condition.design.mode === "replace_all" && <label>Replacement text (empty = Tabula Rasa)<textarea disabled={disabled} rows={5} maxLength={120000} value={condition.design.content} onChange={(event) => update(condition.id, (item) => changeContextReplacement(item, event.target.value))} /></label>}
      {condition.design.mode === "add_to_selected" && RESEARCH_CONTEXT_BLOCK_KEYS.map((key) => {
        const additions = condition.design.mode === "add_to_selected" ? condition.design.additions : {};
        const checked = Object.prototype.hasOwnProperty.call(additions, key);
        return <div key={key}><label><input disabled={disabled} type="checkbox" checked={checked} onChange={(event) => update(condition.id, (item) => toggleContextAddition(item, key, event.target.checked))} />{BLOCK_LABELS[key]}</label>
          {checked && <textarea disabled={disabled} rows={3} maxLength={120000} aria-label={`${BLOCK_LABELS[key]} addition`} value={additions[key] ?? ""} onChange={(event) => update(condition.id, (item) => changeContextAddition(item, key, event.target.value))} />}</div>;
      })}
      <div><button type="button" className="secondary-button" disabled={disabled || conditions.length >= MAX_CONTEXT_DRAFT_CONDITIONS} onClick={() => onChange([...conditions, { ...structuredClone(condition), id: `context-${++nextDraftId}`, label: `${condition.label} (copy)` }])}>Duplicate</button> <button type="button" className="secondary-button" disabled={disabled || conditions.length <= 2} onClick={() => onChange(conditions.filter((item) => item.id !== condition.id))}>Remove</button></div>
    </div>)}</div>
    <button type="button" className="secondary-button" disabled={disabled || conditions.length >= MAX_CONTEXT_DRAFT_CONDITIONS} onClick={() => onChange([...conditions, newCondition()])}>Add condition</button>
    <p>{conditions.length} conditions · planned sessions = conditions × targets × repetitions.</p>
    {errors.length > 0 && <div className="provider-error" role="alert">{errors.map((error, i) => <div key={i}>{error}</div>)}</div>}
  </div>;
}
