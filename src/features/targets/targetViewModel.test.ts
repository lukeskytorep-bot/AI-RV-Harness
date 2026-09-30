import { describe, expect, it } from "vitest";

import type { TargetRecord, TargetUsageRecord } from "../../targets/types";
import { collectLockedTargetIds, groupTargets } from "./targetViewModel";

function target(id: string, collection: TargetRecord["collection"], targetKind?: "general" | "telepathic"): TargetRecord {
  return {
    id,
    collection,
    title: id,
    revealText: `Reveal ${id}`,
    tags: [],
    sourceMetadata: targetKind ? { targetKind } : {},
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
  };
}

describe("target view model", () => {
  it("keeps Training, general user and telepathic user targets in separate groups", () => {
    const groups = groupTargets([
      target("training-1", "training"),
      target("general-1", "user", "general"),
      target("telepathic-1", "user", "telepathic"),
    ]);

    expect(groups.training.map(({ id }) => id)).toEqual(["training-1"]);
    expect(groups.general.map(({ id }) => id)).toEqual(["general-1"]);
    expect(groups.telepathic.map(({ id }) => id)).toEqual(["telepathic-1"]);
  });

  it("locks the union of session-used and research-assigned targets without duplicates", () => {
    const usage = [
      { id: "usage-1", targetId: "target-a", usedAt: "now" },
      { id: "usage-2", targetId: "target-b", usedAt: "now" },
    ] satisfies TargetUsageRecord[];

    expect([...collectLockedTargetIds(usage, ["target-b", "target-c"])]).toEqual([
      "target-a",
      "target-b",
      "target-c",
    ]);
  });
});
