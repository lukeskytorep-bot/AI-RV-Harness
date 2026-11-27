import { describe, expect, it } from "vitest";
import { composeResearchContext } from "./contextComposition";
import { assertResearchContextSessionEvidence, researchContextProviderMessages, researchContextSessionEvidence } from "./contextRuntime";

const baseline = {
  system_prompt: { content: "FIELD", source: "field", availability: "available" as const },
  viewer_notes: { content: "NOTES", source: "notes", availability: "available" as const },
  viewer_identity: { content: "IDENTITY", source: "identity", availability: "available" as const },
  base_vocabulary: { content: "VOCAB", source: "vocab", availability: "available" as const },
};

describe("Research Context runtime evidence", () => {
  it("uses only retained blocks byte for byte and validates saved Resume evidence", async () => {
    const blocks = { ...baseline, system_prompt: { ...baseline.system_prompt, content: "  FIELD\n" } };
    const design = { version: 1, mode: "selected_only", blocks: ["viewer_notes", "system_prompt"] } as const;
    const composition = await composeResearchContext({ ...design, blocks: [...design.blocks] }, blocks);
    expect(researchContextProviderMessages(composition)).toEqual([
      { role: "system", content: "  FIELD\n" }, { role: "system", content: "NOTES" },
    ]);
    const evidence = structuredClone(researchContextSessionEvidence(composition));
    expect(() => assertResearchContextSessionEvidence(composition, evidence)).not.toThrow();
    const changed = await composeResearchContext({ version: 1, mode: "selected_only", blocks: ["viewer_notes"] }, blocks);
    expect(() => assertResearchContextSessionEvidence(changed, evidence)).toThrow(/Resume refused/);
  });

  it("supports empty selection and rejects invalid or unavailable blocks", async () => {
    const empty = await composeResearchContext({ version: 1, mode: "selected_only", blocks: [] }, baseline);
    expect(researchContextProviderMessages(empty)).toEqual([]);
    await expect(composeResearchContext({ version: 1, mode: "selected_only", blocks: ["viewer_notes", "viewer_notes"] }, baseline)).rejects.toThrow(/distinct/);
    await expect(composeResearchContext({ version: 1, mode: "selected_only", blocks: ["viewer_notes"] }, {
      ...baseline, viewer_notes: { content: "", availability: "disabled", source: "off" },
    })).rejects.toThrow(/viewer_notes is unavailable/);
  });

  it("emits no additional Viewer messages for Tabula rasa", async () => {
    const composition = await composeResearchContext({ version: 1, mode: "replace_all", content: "" }, baseline);
    expect(researchContextProviderMessages(composition)).toEqual([]);
    expect(researchContextSessionEvidence(composition).applicationMessages).toEqual([]);
  });

  it("preserves exact Replace All whitespace in provider messages and session evidence", async () => {
    const content = "  line one\nline two  ";
    const composition = await composeResearchContext({ version: 1, mode: "replace_all", content }, baseline);
    expect(researchContextProviderMessages(composition)).toEqual([{ role: "system", content }]);
    const evidence = researchContextSessionEvidence(composition);
    expect(evidence.applicationMessages[0].content).toBe(content);
    expect(() => assertResearchContextSessionEvidence(composition, evidence)).not.toThrow();
  });

  it("refuses Resume when message order, origin, hash or exact text drifts", async () => {
    const composition = await composeResearchContext({ version: 1, mode: "standard" }, baseline);
    const evidence = researchContextSessionEvidence(composition);
    evidence.applicationMessages[0] = { ...evidence.applicationMessages[0], content: `${evidence.applicationMessages[0].content} ` };
    expect(() => assertResearchContextSessionEvidence(composition, evidence)).toThrow(/context-message drift/);
  });
});
