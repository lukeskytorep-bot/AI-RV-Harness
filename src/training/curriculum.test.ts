import { describe, expect, it } from "vitest";
import type { TargetRecord } from "../targets/types";
import { selectPartialTrainingTargets } from "./curriculum";

function target(id: string, collection: "training" | "user", category?: string): TargetRecord {
  return { id, collection, title: id, tags: [], sourceMetadata: category ? { category } : {}, createdAt: "now", updatedAt: "now" };
}

describe("partial Training target selection", () => {
  it("selects factory categories separately and adds an independent My Targets count", () => {
    const targets = [
      target("factory-a", "training", "mountain_structure_contrast"),
      target("factory-b", "training", "mountain_structure_contrast"),
      target("user-with-old-category", "user", "mountain_structure_contrast"),
      target("user-without-category", "user"),
    ];

    const selected = selectPartialTrainingTargets(targets, { mountain_structure_contrast: 1 }, 2);

    expect(selected).toHaveLength(3);
    expect(selected.filter((item) => item.collection === "training")).toHaveLength(1);
    expect(selected.filter((item) => item.collection === "user").map((item) => item.id).sort()).toEqual(["user-with-old-category", "user-without-category"]);
  });

  it("rejects a requested My Targets count larger than the available catalogue", () => {
    expect(() => selectPartialTrainingTargets([target("mine", "user")], {}, 2)).toThrow("my_targets: requested 2, available 1");
  });
});
