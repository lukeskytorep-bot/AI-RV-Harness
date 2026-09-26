import { describe, expect, it } from "vitest";
import type { TargetRecord } from "../targets/types";
import { buildFactoryCurriculum, selectPartialTrainingTargets } from "./curriculum";

function target(id: string, collection: "training" | "user", category?: string): TargetRecord {
  return { id, collection, title: id, tags: [], sourceMetadata: category ? { category } : {}, createdAt: "now", updatedAt: "now" };
}


describe("Stage 2 Full Training compatibility", () => {
  it("keeps the historical 84 target IDs and excludes the ten Stage 2 additions until Stage 3", () => {
    const expected: string[] = [];
    let mixedOrder = 1;
    for (let specialistGroup = 1; specialistGroup <= 6; specialistGroup += 1) {
      for (const half of [0, 1]) {
        for (let offset = 1; offset <= 5; offset += 1) {
          const categoryOrder = (half * 5) + offset;
          expected.push(`factory_training_${String(specialistGroup).padStart(2, "0")}_${String(categoryOrder).padStart(2, "0")}`);
        }
        expected.push(`factory_training_07_${String(mixedOrder).padStart(2, "0")}`);
        expected.push(`factory_training_07_${String(mixedOrder + 1).padStart(2, "0")}`);
        mixedOrder += 2;
      }
    }
    const actual = buildFactoryCurriculum().map((item) => item.targetId);
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(84);
    expect(new Set(actual).size).toBe(84);
    expect(actual.some((id) => id.startsWith("factory_training_08_"))).toBe(false);
  });
});

describe("partial Training target selection", () => {
  it("selects factory categories separately and adds an independent My Targets count", () => {
    const targets = [
      target("factory-a", "training", "mountains"),
      target("factory-b", "training", "mountains"),
      target("user-with-old-category", "user", "mountains"),
      target("user-without-category", "user"),
    ];

    const selected = selectPartialTrainingTargets(targets, { mountains: 1 }, 2);

    expect(selected).toHaveLength(3);
    expect(selected.filter((item) => item.collection === "training")).toHaveLength(1);
    expect(selected.filter((item) => item.collection === "user").map((item) => item.id).sort()).toEqual(["user-with-old-category", "user-without-category"]);
  });

  it("rejects a requested My Targets count larger than the available catalogue", () => {
    expect(() => selectPartialTrainingTargets([target("mine", "user")], {}, 2)).toThrow("my_targets: requested 2, available 1");
  });
});
