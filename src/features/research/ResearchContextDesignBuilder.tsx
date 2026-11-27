import { getCopy } from "../../i18n";
import { RESEARCH_CONTEXT_BLOCK_KEYS, type ResearchContextBlockKey, type ResearchContextConditionDesign } from "../../research/types";
import { changeContextAddition, changeContextEditorMode, changeContextReplacement, createContextEditorCondition, MAX_CONTEXT_DRAFT_CONDITIONS, toggleContextAddition, toggleRetainedContextBlock, validateResearchContextDraft, type ResearchContextEditorCondition } from "../../research/contextDesignDraft";

type Copy = ReturnType<typeof getCopy>;
export function contextBlockLabel(copy: Copy, key: ResearchContextBlockKey | "replace_all"): string {
  return { system_prompt: copy.contextSystem, viewer_notes: copy.contextNotes, viewer_identity: copy.contextIdentity, base_vocabulary: copy.contextVocabulary, replace_all: copy.contextReplace }[key];
}
export function contextModeLabel(copy: Copy, mode: ResearchContextConditionDesign["mode"]): string {
  return { standard: copy.contextStandard, replace_all: copy.contextReplace, add_to_selected: copy.contextAdd, selected_only: copy.contextSelectedOnly }[mode];
}
export function localizeContextDraftError(copy: Copy, error: string): string {
  if (copy.home === "Home") return error;
  const exact: Record<string, string> = {
    [`Choose 2–${MAX_CONTEXT_DRAFT_CONDITIONS} conditions.`]: `Wybierz od 2 do ${MAX_CONTEXT_DRAFT_CONDITIONS} warunków.`,
    "Condition identifiers must be unique and nonempty.": "Identyfikatory warunków muszą być niepuste i unikatowe.",
    "Every condition requires a label.": "Każdy warunek wymaga etykiety.",
    "Condition labels may not exceed 120 characters.": "Etykiety warunków mogą mieć najwyżej 120 znaków.",
  };
  if (exact[error]) return exact[error];
  const suffixes: Record<string, string> = {
    "Unsupported context design version.": "Nieobsługiwana wersja projektu kontekstu.",
    "Replace-all context must be text within the size limit.": "Tekst zastępujący musi mieścić się w limicie długości.",
    "Unsupported context design mode or additions.": "Nieobsługiwany tryb kontekstu lub dodatki.",
    "Select distinct, known context blocks.": "Wybierz znane bloki kontekstu bez powtórzeń.",
    "Add-to-selected requires at least one target block.": "Wybierz co najmniej jeden blok do uzupełnienia.",
  };
  for (const [suffix, translation] of Object.entries(suffixes)) {
    if (error.endsWith(`: ${suffix}`)) return error.slice(0, -suffix.length) + translation;
  }
  const addition = /^(.*): Context addition to (system_prompt|viewer_notes|viewer_identity|base_vocabulary) must be nonempty text within the size limit\.$/.exec(error);
  if (addition) return `${addition[1]}: Dodatek (${contextBlockLabel(copy, addition[2] as ResearchContextBlockKey)}) musi być niepustym tekstem w limicie długości.`;
  const unknown = /^(.*): Unknown context block: (.*)$/.exec(error);
  if (unknown) return `${unknown[1]}: Nieznany blok kontekstu: ${unknown[2]}`;
  return error;
}
let nextDraftId = 0;
export const createDefaultResearchContextConditions = (copy: Copy = getCopy("en")): ResearchContextEditorCondition[] => [
  createContextEditorCondition({ id: `context-${++nextDraftId}`, label: copy.contextStandard, design: { version: 1, mode: "standard" } }),
  createContextEditorCondition({ id: `context-${++nextDraftId}`, label: copy.contextEmpty, design: { version: 1, mode: "replace_all", content: "" } }),
];
const newCondition = (copy: Copy): ResearchContextEditorCondition => createContextEditorCondition({ id: `context-${++nextDraftId}`, label: `${copy.condition} ${nextDraftId}`, design: { version: 1, mode: "replace_all", content: "" } });

export function ResearchContextConditionsEditor({ conditions, onChange, copy = getCopy("en"), disabled = false }: { conditions: ResearchContextEditorCondition[]; onChange: (next: ResearchContextEditorCondition[]) => void; disabled?: boolean; copy?: Copy }) {
  const errors = validateResearchContextDraft(conditions).map((error) => localizeContextDraftError(copy, error));
  const update = (id: string, change: (condition: ResearchContextEditorCondition) => ResearchContextEditorCondition) => onChange(conditions.map((condition) => condition.id === id ? change(condition) : condition));
  return <div className="research-form-section">
    <div className="research-section-head"><div><strong>{copy.contextConditions}</strong><small>{copy.contextModes}</small></div></div>
    <p>{copy.contextTabulaLead}</p>
    <div className="research-variants">{conditions.map((condition, index) => <div key={condition.id} className="research-form-section">
      <label>{copy.condition} {index + 1} · {copy.contextLabel} <input disabled={disabled} maxLength={120} value={condition.label} onChange={(event) => update(condition.id, (item) => ({ ...item, label: event.target.value }))} /></label>
      <label>{copy.contextMode} <select disabled={disabled} value={condition.design.mode} onChange={(event) => update(condition.id, (item) => changeContextEditorMode(item, event.target.value as ResearchContextConditionDesign["mode"]))}>
        <option value="standard">{copy.contextStandard}</option><option value="replace_all">{copy.contextReplace} / {copy.contextEmpty}</option><option value="selected_only">{copy.contextSelectedOnly}</option><option value="add_to_selected">{copy.contextAdd}</option>
      </select></label>
      {condition.design.mode === "replace_all" && <label>{copy.contextReplacement}<textarea disabled={disabled} rows={5} maxLength={120000} value={condition.design.content} onChange={(event) => update(condition.id, (item) => changeContextReplacement(item, event.target.value))} /></label>}
      {condition.design.mode === "selected_only" && <div>
        <small>{copy.contextSelectedOnlyHelp}</small>
        {RESEARCH_CONTEXT_BLOCK_KEYS.map((key) => <label key={key}>
          <input disabled={disabled} type="checkbox" checked={condition.retainedBlocks.includes(key)} onChange={(event) => update(condition.id, (item) => toggleRetainedContextBlock(item, key, event.target.checked))} />
          {contextBlockLabel(copy, key)}
        </label>)}
      </div>}
      {condition.design.mode === "add_to_selected" && RESEARCH_CONTEXT_BLOCK_KEYS.map((key) => {
        const additions = condition.design.mode === "add_to_selected" ? condition.design.additions : {};
        const checked = Object.prototype.hasOwnProperty.call(additions, key);
        return <div key={key}><label><input disabled={disabled} type="checkbox" checked={checked} onChange={(event) => update(condition.id, (item) => toggleContextAddition(item, key, event.target.checked))} />{contextBlockLabel(copy, key)}</label>
          {checked && <textarea disabled={disabled} rows={3} maxLength={120000} aria-label={`${contextBlockLabel(copy, key)} ${copy.contextAddition}`} value={additions[key] ?? ""} onChange={(event) => update(condition.id, (item) => changeContextAddition(item, key, event.target.value))} />}</div>;
      })}
      <div><button type="button" className="secondary-button" disabled={disabled || conditions.length >= MAX_CONTEXT_DRAFT_CONDITIONS} onClick={() => onChange([...conditions, { ...structuredClone(condition), id: `context-${++nextDraftId}`, label: `${condition.label} (${copy.contextCopy})` }])}>{copy.contextDuplicate}</button> <button type="button" className="secondary-button" disabled={disabled || conditions.length <= 2} onClick={() => onChange(conditions.filter((item) => item.id !== condition.id))}>{copy.contextRemove}</button></div>
    </div>)}</div>
    <button type="button" className="secondary-button" disabled={disabled || conditions.length >= MAX_CONTEXT_DRAFT_CONDITIONS} onClick={() => onChange([...conditions, newCondition(copy)])}>{copy.addVariant}</button>
    <p>{conditions.length} {copy.contextCountLead}</p>
    {errors.length > 0 && <div className="provider-error" role="alert">{errors.map((error, i) => <div key={i}>{error}</div>)}</div>}
  </div>;
}
