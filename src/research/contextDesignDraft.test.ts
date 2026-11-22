import { describe, expect, it } from "vitest";
import { changeContextAddition, changeContextEditorMode, changeContextReplacement, createContextEditorCondition, exportResearchContextDraft, toggleContextAddition, validateResearchContextDraft } from "./contextDesignDraft";
import type { ResearchContextDraftCondition } from "./contextDesignDraft";

const standard: ResearchContextDraftCondition = { id: "a", label: "Control", design: { version: 1, mode: "standard" } };
const blank: ResearchContextDraftCondition = { id: "b", label: "Tabula rasa", design: { version: 1, mode: "replace_all", content: "" } };

describe("context design C2 draft validation", () => {
  it("accepts Standard and empty Replace All in one experiment", () => {
    expect(validateResearchContextDraft([standard, blank])).toEqual([]);
    expect(JSON.parse(exportResearchContextDraft([standard, blank])).conditions[1].design.content).toBe("");
  });
  it("keeps exact whitespace in replacement text", () => {
    const data = JSON.parse(exportResearchContextDraft([standard, { ...blank, design: { version: 1, mode: "replace_all", content: "  x\n" } }]));
    expect(data.conditions[1].design.content).toBe("  x\n");
  });
  it("refuses unknown blocks and empty Add selection", () => {
    expect(validateResearchContextDraft([standard, { ...blank, design: { version: 1, mode: "add_to_selected", additions: {} } }])).not.toEqual([]);
    expect(validateResearchContextDraft([standard, { ...blank, design: { version: 1, mode: "add_to_selected", additions: { bogus: "x" } as never } }])).not.toEqual([]);
  });
  it("accepts independent additions to four blocks and canonicalizes order", () => {
    const design = { version: 1 as const, mode: "add_to_selected" as const, additions: { viewer_notes: "notes", system_prompt: "system", base_vocabulary: "terms", viewer_identity: "identity" } };
    const data = JSON.parse(exportResearchContextDraft([standard, { ...blank, design }]));
    expect(Object.keys(data.conditions[1].design.additions)).toEqual(["system_prompt", "viewer_notes", "viewer_identity", "base_vocabulary"]);
  });
  it("requires at least two conditions, unique identifiers and nonempty labels", () => {
    expect(validateResearchContextDraft([standard])).not.toEqual([]);
    expect(validateResearchContextDraft([standard, { ...blank, id: "a" }])).not.toEqual([]);
    expect(validateResearchContextDraft([standard, { ...blank, label: " " }])).not.toEqual([]);
  });
});


describe("C2 editor retains inactive text without exporting it", () => {
  it("keeps replacement text across Replace → Standard → Replace and exports only active mode", () => {
    const start = createContextEditorCondition(blank);
    const entered = changeContextReplacement(start, "  exact replacement\n");
    const standardMode = changeContextEditorMode(entered, "standard");
    expect(JSON.parse(exportResearchContextDraft([standard, standardMode])).conditions[1].design).toEqual({ version: 1, mode: "standard" });
    const restored = changeContextEditorMode(standardMode, "replace_all");
    expect(restored.design).toEqual({ version: 1, mode: "replace_all", content: "  exact replacement\n" });
  });

  it("retains Add text across uncheck and recheck, exports selected fields only", () => {
    const start = changeContextEditorMode(createContextEditorCondition(blank), "add_to_selected");
    const entered = changeContextAddition(start, "viewer_notes", "saved notes");
    const checked = toggleContextAddition(entered, "viewer_notes", true);
    const unchecked = toggleContextAddition(checked, "viewer_notes", false);
    const exportable = changeContextAddition(unchecked, "system_prompt", "system");
    const data = JSON.parse(exportResearchContextDraft([standard, exportable]));
    expect(data.conditions[1].design.additions).toEqual({ system_prompt: "system" });
    const restored = toggleContextAddition(exportable, "viewer_notes", true);
    expect(restored.design.mode).toBe("add_to_selected");
    if (restored.design.mode === "add_to_selected") expect(restored.design.additions.viewer_notes).toBe("saved notes");
  });

  it("keeps separate replacement and addition drafts when switching modes", () => {
    const entered = changeContextReplacement(createContextEditorCondition(blank), "replace");
    const add = changeContextAddition(changeContextEditorMode(entered, "add_to_selected"), "system_prompt", "add");
    const returned = changeContextEditorMode(changeContextEditorMode(add, "standard"), "replace_all");
    expect(returned.design).toEqual({ version: 1, mode: "replace_all", content: "replace" });
    const returnedAdd = changeContextEditorMode(returned, "add_to_selected");
    if (returnedAdd.design.mode === "add_to_selected") expect(returnedAdd.design.additions.system_prompt).toBe("add");
  });
});
