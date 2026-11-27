import { assertResearchContextDesign } from "./contextComposition";
import { RESEARCH_CONTEXT_BLOCK_KEYS, type ResearchContextBlockKey, type ResearchContextConditionDesign } from "./types";

export interface ResearchContextDraftCondition {
  id: string;
  label: string;
  design: ResearchContextConditionDesign;
}

export const MAX_CONTEXT_DRAFT_CONDITIONS = 32;

/** Pure UI draft checks. These checks are NOT runtime Preflight or Experiment Lock. */
export function validateResearchContextDraft(conditions: readonly ResearchContextDraftCondition[]): string[] {
  const errors: string[] = [];
  if (conditions.length < 2 || conditions.length > MAX_CONTEXT_DRAFT_CONDITIONS) {
    errors.push(`Choose 2–${MAX_CONTEXT_DRAFT_CONDITIONS} conditions.`);
  }
  const identifiers = new Set<string>();
  for (const condition of conditions) {
    if (!condition.id || identifiers.has(condition.id)) errors.push("Condition identifiers must be unique and nonempty.");
    identifiers.add(condition.id);
    if (!condition.label.trim()) errors.push("Every condition requires a label.");
    if (condition.label.length > 120) errors.push("Condition labels may not exceed 120 characters.");
    try { assertResearchContextDesign(condition.design); }
    catch (error) { errors.push(`${condition.label || condition.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return errors;
}

/** Stable, explicitly ordered draft export. The content is never trimmed. */
export function exportResearchContextDraft(conditions: readonly ResearchContextDraftCondition[]): string {
  const errors = validateResearchContextDraft(conditions);
  if (errors.length) throw new Error(errors.join("\n"));
  return JSON.stringify({ version: 1, kind: "context_instructions_draft", conditions: conditions.map((condition) => ({
    id: condition.id,
    label: condition.label,
    design: serializeContextDesign(condition.design),
  })) }, null, 2);
}

function serializeContextDesign(design: ResearchContextConditionDesign): ResearchContextConditionDesign {
  if (design.mode === "standard") return { version: 1, mode: "standard" };
  if (design.mode === "replace_all") return { version: 1, mode: "replace_all", content: design.content };
  if (design.mode === "selected_only") {
    return { version: 1, mode: "selected_only", blocks: RESEARCH_CONTEXT_BLOCK_KEYS.filter((key) => design.blocks.includes(key)) };
  }
  const additions = design.additions;
  return { version: 1, mode: "add_to_selected", additions: Object.fromEntries(
    RESEARCH_CONTEXT_BLOCK_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(additions, key))
      .map((key) => [key, additions[key]]),
  ) };
}

/** C2 editor keeps inactive text in memory. Only the active design is exported. */
export interface ResearchContextEditorCondition extends ResearchContextDraftCondition {
  savedReplacement: string;
  savedAdditions: Partial<Record<ResearchContextBlockKey, string>>;
  selectedBlocks: ResearchContextBlockKey[];
  retainedBlocks: ResearchContextBlockKey[];
}

export function createContextEditorCondition(condition: ResearchContextDraftCondition): ResearchContextEditorCondition {
  const design = condition.design;
  return {
    ...condition,
    retainedBlocks: design.mode === "selected_only" ? [...design.blocks] : [],
    savedReplacement: design.mode === "replace_all" ? design.content : "",
    savedAdditions: design.mode === "add_to_selected" ? { ...design.additions } : {},
    selectedBlocks: design.mode === "add_to_selected" ? RESEARCH_CONTEXT_BLOCK_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(design.additions, key)) : ["system_prompt"],
  };
}

function activeAdditions(condition: ResearchContextEditorCondition): Partial<Record<ResearchContextBlockKey, string>> {
  return Object.fromEntries(condition.selectedBlocks.map((key) => [key, condition.savedAdditions[key] ?? ""]));
}

export function changeContextEditorMode(condition: ResearchContextEditorCondition, mode: ResearchContextConditionDesign["mode"]): ResearchContextEditorCondition {
  return {
    ...condition,
    design: mode === "standard" ? { version: 1, mode: "standard" }
      : mode === "replace_all" ? { version: 1, mode: "replace_all", content: condition.savedReplacement }
        : mode === "selected_only" ? { version: 1, mode, blocks: [...condition.retainedBlocks] }
          : { version: 1, mode: "add_to_selected", additions: activeAdditions(condition) },
  };
}

export function changeContextReplacement(condition: ResearchContextEditorCondition, content: string): ResearchContextEditorCondition {
  return { ...condition, savedReplacement: content, design: { version: 1, mode: "replace_all", content } };
}

export function changeContextAddition(condition: ResearchContextEditorCondition, key: ResearchContextBlockKey, content: string): ResearchContextEditorCondition {
  const next = { ...condition, savedAdditions: { ...condition.savedAdditions, [key]: content } };
  return { ...next, design: { version: 1, mode: "add_to_selected", additions: activeAdditions(next) } };
}

export function toggleContextAddition(condition: ResearchContextEditorCondition, key: ResearchContextBlockKey, checked: boolean): ResearchContextEditorCondition {
  const selectedBlocks = checked
    ? RESEARCH_CONTEXT_BLOCK_KEYS.filter((candidate) => candidate === key || condition.selectedBlocks.includes(candidate))
    : condition.selectedBlocks.filter((candidate) => candidate !== key);
  const next = { ...condition, selectedBlocks };
  return { ...next, design: { version: 1, mode: "add_to_selected", additions: activeAdditions(next) } };
}

export function toggleRetainedContextBlock(condition: ResearchContextEditorCondition, key: ResearchContextBlockKey, checked: boolean): ResearchContextEditorCondition {
  const retainedBlocks = RESEARCH_CONTEXT_BLOCK_KEYS.filter((candidate) =>
    candidate === key ? checked : condition.retainedBlocks.includes(candidate));
  return { ...condition, retainedBlocks, design: { version: 1, mode: "selected_only", blocks: retainedBlocks } };
}
