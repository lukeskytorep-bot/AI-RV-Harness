import { useState } from "react";
import { RESEARCH_CONTEXT_BLOCK_KEYS, type ResearchContextBlockKey, type ResearchContextConditionDesign } from "../../research/types";
import { changeContextAddition, changeContextEditorMode, changeContextReplacement, createContextEditorCondition, exportResearchContextDraft, MAX_CONTEXT_DRAFT_CONDITIONS, toggleContextAddition, validateResearchContextDraft, type ResearchContextDraftCondition, type ResearchContextEditorCondition } from "../../research/contextDesignDraft";

const BLOCK_LABELS: Record<ResearchContextBlockKey, string> = {
  system_prompt: "System Prompt", viewer_notes: "Viewer Notes", viewer_identity: "Viewer Identity", base_vocabulary: "Base Vocabulary",
};

let nextDraftId = 0;
const newCondition = (mode: ResearchContextConditionDesign["mode"] = "replace_all"): ResearchContextEditorCondition => createContextEditorCondition({
  id: `draft-${++nextDraftId}`, label: `Condition ${nextDraftId}`,
  design: mode === "standard" ? { version: 1, mode: "standard" }
    : mode === "add_to_selected" ? { version: 1, mode: "add_to_selected", additions: { system_prompt: "" } }
      : { version: 1, mode: "replace_all", content: "" },
});

/** C2-only editor: draft export, not a runnable or lockable Research experiment. */
export function ResearchContextDesignBuilder({ onBack }: { onBack: () => void }) {
  const [conditions, setConditions] = useState<ResearchContextEditorCondition[]>(() => [newCondition("standard"), newCondition()]);
  const [feedback, setFeedback] = useState("");
  const errors = validateResearchContextDraft(conditions);
  const update = (id: string, change: (condition: ResearchContextEditorCondition) => ResearchContextEditorCondition) => {
    setConditions((previous) => previous.map((condition) => condition.id === id ? change(condition) : condition));
    setFeedback("");
  };
  const exportDraft = () => {
    try {
      const content = exportResearchContextDraft(conditions);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "research-context-design-draft.json"; link.click();
      URL.revokeObjectURL(url);
      setFeedback("Draft exported locally. It is not a locked or executable experiment.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="research-config-builder">
    <div className="research-builder-toolbar"><button className="secondary-button" onClick={onBack}>← Research</button>
      <div><strong>Context &amp; Instructions</strong><small>C2 design editor · runtime integration pending (C3)</small></div></div>
    <section className="panel research-form-panel">
      <h3>Context conditions</h3>
      <p>Design Standard, Replace All / Tabula Rasa, and Add to Selected conditions in one study. This editor saves a draft only; it cannot lock or run sessions until C3 is complete.</p>
      <p><strong>Tabula Rasa:</strong> removes extra Viewer context, not the RV protocol, model pretraining, or server-side instructions.</p>
      <div className="research-variants">{conditions.map((condition, index) => <div key={condition.id} className="research-form-section">
        <label>Condition {index + 1} · Label <input maxLength={120} value={condition.label} onChange={(event) => update(condition.id, (item) => ({ ...item, label: event.target.value }))} /></label>
        <label>Mode <select value={condition.design.mode} onChange={(event) => update(condition.id, (item) => changeContextEditorMode(item, event.target.value as ResearchContextConditionDesign["mode"]))}>
          <option value="standard">Standard</option><option value="replace_all">Replace All / Tabula Rasa</option><option value="add_to_selected">Add to Selected</option>
        </select></label>
        {condition.design.mode === "replace_all" && <label>Replacement text (empty = Tabula Rasa)
          <textarea rows={5} maxLength={120000} value={condition.design.content} onChange={(event) => update(condition.id, (item) => changeContextReplacement(item, event.target.value))} />
        </label>}
        {condition.design.mode === "add_to_selected" && RESEARCH_CONTEXT_BLOCK_KEYS.map((key) => {
          const additions = condition.design.mode === "add_to_selected" ? condition.design.additions : {};
          const checked = Object.prototype.hasOwnProperty.call(additions, key);
          return <div key={key}><label><input type="checkbox" checked={checked} onChange={(event) => update(condition.id, (item) => {
            return toggleContextAddition(item, key, event.target.checked);
          })} />{BLOCK_LABELS[key]}</label>
          {checked && <textarea rows={3} maxLength={120000} aria-label={`${BLOCK_LABELS[key]} addition`} value={additions[key] ?? ""} onChange={(event) => update(condition.id, (item) => changeContextAddition(item, key, event.target.value))} />}
          </div>;
        })}
        <div><button className="secondary-button" disabled={conditions.length >= MAX_CONTEXT_DRAFT_CONDITIONS} onClick={() => { setConditions((old) => [...old, { ...structuredClone(condition), id: `draft-${++nextDraftId}`, label: `${condition.label} (copy)` }]); setFeedback(""); }}>Duplicate</button> <button className="secondary-button" disabled={conditions.length <= 2} onClick={() => { setConditions((old) => old.filter((item) => item.id !== condition.id)); setFeedback(""); }}>Remove</button></div>
      </div>)}</div>
      <button className="secondary-button" disabled={conditions.length >= MAX_CONTEXT_DRAFT_CONDITIONS} onClick={() => { setConditions((old) => [...old, newCondition()]); setFeedback(""); }}>Add condition</button>
      <p>{conditions.length} conditions · {conditions.length} × targets × repetitions = planned sessions (targets and repetitions configured after C3).</p>
      {errors.length > 0 && <div className="provider-error" role="alert">{errors.map((error, i) => <div key={i}>{error}</div>)}</div>}
      {feedback && <p role="status">{feedback}</p>}
      <div className="research-builder-actions"><button className="secondary-button" disabled={errors.length > 0} onClick={exportDraft}>Export design draft JSON</button><button className="primary-button" disabled title="Experiment Lock is intentionally unavailable until the C3 runtime and Resume integration are audited">Experiment Lock (C3)</button></div>
    </section>
  </div>;
}
