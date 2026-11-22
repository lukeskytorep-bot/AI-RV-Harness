import { describe, expect, it } from "vitest";
import { composeResearchContext, assertResearchContextDesign } from "./contextComposition";
import type { ResearchContextBaseBlock, ResearchContextBlockKey } from "./types";

const base = (): Record<ResearchContextBlockKey, ResearchContextBaseBlock> => ({
  system_prompt: { content: "Guide", source: "locked-field-guide", availability: "available", version: "3" },
  viewer_notes: { content: "Notes", source: "viewer-notes", availability: "available" },
  viewer_identity: { content: "Identity", source: "locked-identity", availability: "available" },
  base_vocabulary: { content: "Vocabulary", source: "locked-vocabulary", availability: "available" },
});

describe("context instructions composer C1 (not yet wired to runtime)", () => {
  it("standard preserves each original block and order", async () => {
    const result = await composeResearchContext({ version: 1, mode: "standard" }, base());
    expect(result.applicationMessages.map((m) => [m.origin, m.content])).toEqual([
      ["system_prompt", "Guide"], ["viewer_notes", "Notes"],
      ["viewer_identity", "Identity"], ["base_vocabulary", "Vocabulary"],
    ]);
  });

  it("tabula rasa produces zero extra messages and no default fallback", async () => {
    const result = await composeResearchContext({ version: 1, mode: "replace_all", content: "" }, base());
    expect(result.applicationMessages).toEqual([]);
    expect(Object.values(result.effectiveBlocks).every((b) => !b.enabled && b.content === "")).toBe(true);
    expect(result.baseBlocks.viewer_identity.content).toBe("Identity");
  });

  it("replace all emits only exact supplied content with whitespace intact", async () => {
    const text = "  My text\n\n";
    const result = await composeResearchContext({ version: 1, mode: "replace_all", content: text }, base());
    expect(result.applicationMessages.map((m) => [m.origin, m.content])).toEqual([["replace_all", text]]);
  });

  it("add to notes does not change identity, vocabulary or guide", async () => {
    const result = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_notes: "New" } }, base());
    expect(result.effectiveBlocks.viewer_notes.content).toBe("Notes\n\nNew");
    expect(result.effectiveBlocks.viewer_identity.content).toBe("Identity");
    expect(result.effectiveBlocks.base_vocabulary.content).toBe("Vocabulary");
    expect(result.effectiveBlocks.system_prompt.content).toBe("Guide");
  });

  it("allows four independent additions without duplication", async () => {
    const additions = { system_prompt: "A", viewer_notes: "B", viewer_identity: "C", base_vocabulary: "D" };
    const result = await composeResearchContext({ version: 1, mode: "add_to_selected", additions }, base());
    expect(result.applicationMessages.map((m) => m.content)).toEqual([
      "Guide\n\nA", "Notes\n\nB", "Identity\n\nC", "Vocabulary\n\nD",
    ]);
  });

  it("distinguishes same text placed in different blocks and remains stable for reordered addition object", async () => {
    const left = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_notes: "same" } }, base());
    const right = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_identity: "same" } }, base());
    expect(left.compositionSha256).not.toBe(right.compositionSha256);
    const both = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_notes: "A", viewer_identity: "B" } }, base());
    const reversed = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_identity: "B", viewer_notes: "A" } }, base());
    expect(both.compositionSha256).toBe(reversed.compositionSha256);
  });

  it("canonicalizes top-level property order in standard design", async () => {
    const first = await composeResearchContext({ version: 1, mode: "standard" }, base());
    const reordered = await composeResearchContext({ mode: "standard", version: 1 }, base());
    expect(first.compositionSha256).toBe(reordered.compositionSha256);
    expect(first.applicationMessages).toEqual(reordered.applicationMessages);
  });

  it("canonicalizes top-level property order in replace-all design, preserving exact text", async () => {
    const first = await composeResearchContext({ version: 1, mode: "replace_all", content: "  Example\n" }, base());
    const reordered = await composeResearchContext({ content: "  Example\n", mode: "replace_all", version: 1 }, base());
    expect(first.compositionSha256).toBe(reordered.compositionSha256);
    expect(first.applicationMessages).toEqual(reordered.applicationMessages);
  });

  it("canonicalizes top-level property order in add-to-selected design", async () => {
    const first = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_notes: "A", system_prompt: "B" } }, base());
    const reordered = await composeResearchContext({ additions: { system_prompt: "B", viewer_notes: "A" }, mode: "add_to_selected", version: 1 }, base());
    expect(first.compositionSha256).toBe(reordered.compositionSha256);
    expect(first.applicationMessages).toEqual(reordered.applicationMessages);
  });

  it("preserves unavailable notes explicitly; does not manufacture notes", async () => {
    const blocks = base();
    blocks.viewer_notes = { content: "", source: "absent", availability: "unavailable" };
    const blank = await composeResearchContext({ version: 1, mode: "standard" }, blocks);
    expect(blank.effectiveBlocks.viewer_notes.enabled).toBe(false);
    expect(blank.applicationMessages.some((m) => m.origin === "viewer_notes")).toBe(false);
    const withAddition = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { viewer_notes: "Explicit" } }, blocks);
    expect(withAddition.effectiveBlocks.viewer_notes.content).toBe("Explicit");
    expect(withAddition.baseBlocks.viewer_notes.availability).toBe("unavailable");
  });

  it("fails closed for missing base, hidden disabled data, invalid targets or empty addition", async () => {
    const blocks = base();
    delete (blocks as Partial<typeof blocks>).viewer_notes;
    await expect(composeResearchContext({ version: 1, mode: "standard" }, blocks)).rejects.toThrow("Missing research base block");
    const disabled = base();
    disabled.viewer_notes.availability = "disabled";
    await expect(composeResearchContext({ version: 1, mode: "standard" }, disabled)).rejects.toThrow("hidden base prompt");
    expect(() => assertResearchContextDesign({ version: 1, mode: "add_to_selected", additions: {} })).toThrow();
    expect(() => assertResearchContextDesign({ version: 1, mode: "add_to_selected", additions: { viewer_notes: "" } })).toThrow();
    expect(() => assertResearchContextDesign({ version: 1, mode: "add_to_selected", additions: { bogus: "X" } } as never)).toThrow();
  });

  it("does not trim meaningful text", async () => {
    const result = await composeResearchContext({ version: 1, mode: "add_to_selected", additions: { system_prompt: "\n " } }, base());
    expect(result.effectiveBlocks.system_prompt.content).toBe("Guide\n\n\n ");
  });
});
