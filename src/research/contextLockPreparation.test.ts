import { describe, expect, it } from "vitest";
import { assertPreparedContextResearchDraft, prepareContextResearchDraft } from "./contextLockPreparation";
import type { ResearchContextDraftCondition } from "./contextDesignDraft";
import type { ResearchContextBaseBlock, ResearchContextBlockKey } from "./types";

const baseline = (): Record<ResearchContextBlockKey, ResearchContextBaseBlock> => ({
  system_prompt: { content: "Guide", source: "guide", availability: "available" },
  viewer_notes: { content: "Notes", source: "notes", availability: "available", version: "2" },
  viewer_identity: { content: "Identity", source: "identity", availability: "available" },
  base_vocabulary: { content: "Vocabulary", source: "vocabulary", availability: "available" },
});
const conditions: ResearchContextDraftCondition[] = [
  { id: "control", label: "Standard", design: { version: 1, mode: "standard" } },
  { id: "blank", label: "Tabula rasa", design: { version: 1, mode: "replace_all", content: "" } },
  { id: "add", label: "Add Notes", design: { version: 1, mode: "add_to_selected", additions: { viewer_notes: "Extra" } } },
];

describe("C2 offline context preparation (runtime remains disabled)", () => {
  it("freezes a single shared baseline and preserves tabula rasa and exact Add placement", async () => {
    const snapshot = await prepareContextResearchDraft(conditions, baseline());
    expect(snapshot.conditions[1].composition.applicationMessages).toEqual([]);
    expect(snapshot.conditions[2].composition.effectiveBlocks.viewer_notes.content).toBe("Notes\n\nExtra");
    expect(snapshot.conditions[2].composition.effectiveBlocks.viewer_identity.content).toBe("Identity");
    await expect(assertPreparedContextResearchDraft(snapshot)).resolves.toBeUndefined();
  });
  it("remains stable when the baseline object property order changes", async () => {
    const original = baseline();
    const reversed = Object.fromEntries(Object.entries(original).reverse()) as typeof original;
    const a = await prepareContextResearchDraft(conditions, original);
    const b = await prepareContextResearchDraft(conditions, reversed);
    expect(a.preparationSha256).toBe(b.preparationSha256);
  });
  it("does not reread live changes in the supplied baseline", async () => {
    const source = baseline();
    const snapshot = await prepareContextResearchDraft(conditions, source);
    source.viewer_notes.content = "CHANGED";
    expect(snapshot.baseBlocks.viewer_notes.content).toBe("Notes");
    await expect(assertPreparedContextResearchDraft(snapshot)).resolves.toBeUndefined();
  });
  it("rejects tampered effective messages even with the original composition hash", async () => {
    const snapshot = await prepareContextResearchDraft(conditions, baseline());
    snapshot.conditions[0].composition.applicationMessages[0].content = "Injected";
    await expect(assertPreparedContextResearchDraft(snapshot)).rejects.toThrow("Frozen context composition changed");
  });
  it("rejects baseline, design and label drift", async () => {
    const a = await prepareContextResearchDraft(conditions, baseline());
    a.baseBlocks.viewer_identity.content = "other";
    await expect(assertPreparedContextResearchDraft(a)).rejects.toThrow();
    const b = await prepareContextResearchDraft(conditions, baseline());
    b.conditions[1].label = "Changed";
    await expect(assertPreparedContextResearchDraft(b)).rejects.toThrow("fingerprint changed");
    const c = await prepareContextResearchDraft(conditions, baseline());
    c.conditions[2].composition.design = { version: 1, mode: "standard" };
    await expect(assertPreparedContextResearchDraft(c)).rejects.toThrow();
  });
  it("fails closed on missing baseline or invalid empty addition", async () => {
    const missing = baseline();
    delete (missing as Partial<typeof missing>).viewer_notes;
    await expect(prepareContextResearchDraft(conditions, missing)).rejects.toThrow("Missing baseline block");
    await expect(prepareContextResearchDraft([
      conditions[0], { id: "bad", label: "Bad", design: { version: 1, mode: "add_to_selected", additions: { viewer_notes: "" } } },
    ], baseline())).rejects.toThrow("nonempty text");
  });
  it("accepts semantically identical frozen JSON with different object key order", async () => {
    const snapshot = await prepareContextResearchDraft(conditions, baseline());
    const composition = snapshot.conditions[2].composition;
    composition.baseBlocks.viewer_notes = Object.fromEntries(
      Object.entries(composition.baseBlocks.viewer_notes).reverse(),
    ) as typeof composition.baseBlocks.viewer_notes;
    composition.applicationMessages = composition.applicationMessages.map((message) => Object.fromEntries(
      Object.entries(message).reverse(),
    ) as typeof message);
    await expect(assertPreparedContextResearchDraft(snapshot)).resolves.toBeUndefined();
  });
  it("captures condition designs before asynchronous preparation begins", async () => {
    const mutable = structuredClone(conditions);
    const promise = prepareContextResearchDraft(mutable, baseline());
    mutable[2].label = "MUTATED";
    mutable[2].design = { version: 1, mode: "standard" };
    const snapshot = await promise;
    expect(snapshot.conditions[2].label).toBe("Add Notes");
    expect(snapshot.conditions[2].composition.design).toEqual({
      version: 1,
      mode: "add_to_selected",
      additions: { viewer_notes: "Extra" },
    });
    expect(snapshot.conditions[2].composition.effectiveBlocks.viewer_notes.content).toBe("Notes\n\nExtra");
  });
  it("does not confuse same text placed in different logical blocks", async () => {
    const items: ResearchContextDraftCondition[] = [
      { id: "notes", label: "Notes", design: { version: 1, mode: "add_to_selected", additions: { viewer_notes: "same" } } },
      { id: "identity", label: "Identity", design: { version: 1, mode: "add_to_selected", additions: { viewer_identity: "same" } } },
    ];
    const snapshot = await prepareContextResearchDraft(items, baseline());
    expect(snapshot.conditions[0].composition.compositionSha256).not.toBe(snapshot.conditions[1].composition.compositionSha256);
  });
});
