import { describe, expect, it } from "vitest";
import type { TargetRecord } from "../targets/types";
import { sampleResearchTargetIds } from "./targetSelection";

const targets = ["a", "b", "c", "d"].map((id) => ({ id, collection: "training", title: id, tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" }) satisfies TargetRecord);

describe("Research target selection", () => {
  it("draws a unique fixed-size sample without mutating the catalog", () => {
    const original = targets.map((target) => target.id);
    const selected = sampleResearchTargetIds(targets, 3, () => 0);
    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
    expect(targets.map((target) => target.id)).toEqual(original);
  });

  it("caps the requested count to the available pool", () => {
    expect(sampleResearchTargetIds(targets, 100, () => 0)).toHaveLength(4);
  });
});
