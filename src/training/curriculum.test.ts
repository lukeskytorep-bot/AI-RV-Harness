import { describe, expect, it } from "vitest";
import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { TRAINING_CATEGORIES, type TrainingCategory } from "../targets/bundled";
import {
  baselineTrainingViewerCallsPerSession,
  buildFactoryCurriculum,
  buildTrainingAvailability,
  FACTORY_PLANNER_VERSION,
  FACTORY_ROUND_SIZE,
  maxFullTrainingRounds,
  limitingFactoryCategory,
  planFactoryTrainingRun,
  selectPartialTrainingTargets,
} from "./curriculum";

function target(id: string, collection: "training" | "user", category?: string): TargetRecord {
  return { id, collection, title: id, tags: [], sourceMetadata: category ? { category } : {}, createdAt: "now", updatedAt: "now" };
}

function usage(targetId: string, profileId: string): TargetUsageRecord {
  return { id: `usage-${profileId}-${targetId}`, targetId, profileId, usedAt: "now" };
}

function factoryTargets(perCategory = 10): TargetRecord[] {
  return TRAINING_CATEGORIES.flatMap((category) => Array.from({ length: perCategory }, (_, index) => target(`${category}-${index + 1}`, "training", category)));
}

function categoryOf(id: string): TrainingCategory {
  const found = TRAINING_CATEGORIES.find((category) => id.startsWith(`${category}-`));
  if (!found) throw new Error(`Unknown test category: ${id}`);
  return found;
}

function sequenceRandom(): () => number {
  let value = 0;
  return () => value++;
}

describe("legacy Full Training compatibility", () => {
  it("keeps the historical 84 target curriculum available for old runs", () => {
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

describe("Stage 3 Full Training round planner", () => {
  it("plans one round as exactly eight targets with all eight categories", () => {
    const plan = planFactoryTrainingRun({ targets: factoryTargets(), usage: [], profileId: "p1", roundCount: 1, repeatPolicy: "avoid_profile", randomWord: sequenceRandom() });
    expect(plan.plannerVersion).toBe(FACTORY_PLANNER_VERSION);
    expect(plan.roundSize).toBe(FACTORY_ROUND_SIZE);
    expect(plan.targetIds).toHaveLength(8);
    expect(new Set(plan.targetIds.map(categoryOf))).toEqual(new Set(TRAINING_CATEGORIES));
  });

  it("plans ten rounds as 80 unique targets with one target from every category in every round", () => {
    const plan = planFactoryTrainingRun({ targets: factoryTargets(), usage: [], profileId: "p1", roundCount: 10, repeatPolicy: "allow", randomWord: sequenceRandom() });
    expect(plan.targetIds).toHaveLength(80);
    expect(new Set(plan.targetIds).size).toBe(80);
    expect(plan.rounds).toHaveLength(10);
    for (const round of plan.rounds) {
      expect(round).toHaveLength(8);
      expect(new Set(round.map(categoryOf))).toEqual(new Set(TRAINING_CATEGORIES));
    }
  });

  it("can produce a different category order between rounds", () => {
    const plan = planFactoryTrainingRun({ targets: factoryTargets(), usage: [], profileId: "p1", roundCount: 2, repeatPolicy: "allow", randomWord: sequenceRandom() });
    expect(plan.rounds[0].map(categoryOf)).not.toEqual(plan.rounds[1].map(categoryOf));
  });

  it("avoid_profile removes only targets used by the selected Profile", () => {
    const targets = factoryTargets();
    const mountain1 = targets.find((item) => item.id === "mountains-1")!;
    const mountain2 = targets.find((item) => item.id === "mountains-2")!;
    const allUsage = [usage(mountain1.id, "p1"), usage(mountain2.id, "p2")];
    const availability = buildTrainingAvailability(targets, allUsage, "p1", "avoid_profile");
    expect(availability.categories.mountains).toMatchObject({ total: 10, remaining: 9, available: 9 });
    const plan = planFactoryTrainingRun({ targets, usage: allUsage, profileId: "p1", roundCount: 1, repeatPolicy: "avoid_profile", randomWord: sequenceRandom() });
    expect(plan.targetIds).not.toContain(mountain1.id);
  });

  it("allow restores historically used targets to the available pool", () => {
    const targets = factoryTargets();
    const allUsage = targets.filter((item) => item.sourceMetadata.category === "mountains").map((item) => usage(item.id, "p1"));
    const avoided = buildTrainingAvailability(targets, allUsage, "p1", "avoid_profile");
    const allowed = buildTrainingAvailability(targets, allUsage, "p1", "allow");
    expect(avoided.categories.mountains.available).toBe(0);
    expect(allowed.categories.mountains.available).toBe(10);
    expect(maxFullTrainingRounds(allowed)).toBe(10);
  });

  it("limits the maximum rounds by the smallest remaining category and fails closed when exhausted", () => {
    const targets = factoryTargets();
    const usedMountains = targets.filter((item) => item.sourceMetadata.category === "mountains").slice(0, 8).map((item) => usage(item.id, "p1"));
    const availability = buildTrainingAvailability(targets, usedMountains, "p1", "avoid_profile");
    expect(maxFullTrainingRounds(availability)).toBe(2);
    expect(() => planFactoryTrainingRun({ targets, usage: usedMountains, profileId: "p1", roundCount: 3, repeatPolicy: "avoid_profile", randomWord: sequenceRandom() })).toThrow("mountains: requested 3 rounds, available 2");
  });

  it("reports the actual smallest pool as the limiting category", () => {
    const targets = factoryTargets();
    const usageRecords = [
      ...targets.filter((item) => item.sourceMetadata.category === "mountains").slice(0, 5).map((item) => usage(item.id, "p1")),
      ...targets.filter((item) => item.sourceMetadata.category === "structures").slice(0, 8).map((item) => usage(item.id, "p1")),
    ];
    const availability = buildTrainingAvailability(targets, usageRecords, "p1", "avoid_profile");
    expect(availability.categories.mountains.available).toBe(5);
    expect(availability.categories.structures.available).toBe(2);
    expect(limitingFactoryCategory(availability)).toBe("structures");
    expect(maxFullTrainingRounds(availability)).toBe(2);
    expect(() => planFactoryTrainingRun({ targets, usage: usageRecords, profileId: "p1", roundCount: 6, repeatPolicy: "avoid_profile", randomWord: sequenceRandom() })).toThrow("structures: requested 6 rounds, available 2");
  });

  it("reports an exhausted category when the dynamic maximum is zero", () => {
    const targets = factoryTargets();
    const usageRecords = targets.filter((item) => item.sourceMetadata.category === "structures").map((item) => usage(item.id, "p1"));
    const availability = buildTrainingAvailability(targets, usageRecords, "p1", "avoid_profile");
    expect(limitingFactoryCategory(availability)).toBe("structures");
    expect(maxFullTrainingRounds(availability)).toBe(0);
    expect(() => planFactoryTrainingRun({ targets, usage: usageRecords, profileId: "p1", roundCount: 1, repeatPolicy: "avoid_profile", randomWord: sequenceRandom() })).toThrow("structures: requested 1 rounds, available 0");
  });

  it("never includes My Targets in Full Training", () => {
    const targets = [...factoryTargets(), target("my-target", "user", "mountains")];
    const plan = planFactoryTrainingRun({ targets, usage: [], profileId: "p1", roundCount: 1, repeatPolicy: "allow", randomWord: sequenceRandom() });
    expect(plan.targetIds).not.toContain("my-target");
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
    const selected = selectPartialTrainingTargets(targets, { mountains: 1 }, 2, { randomWord: sequenceRandom() });
    expect(selected).toHaveLength(3);
    expect(selected.filter((item) => item.collection === "training")).toHaveLength(1);
    expect(selected.filter((item) => item.collection === "user").map((item) => item.id).sort()).toEqual(["user-with-old-category", "user-without-category"]);
  });

  it("applies avoid_profile to factory and My Targets without using another Profile's history", () => {
    const targets = [target("factory-a", "training", "mountains"), target("factory-b", "training", "mountains"), target("mine", "user")];
    const selected = selectPartialTrainingTargets(targets, { mountains: 1 }, 1, {
      usage: [usage("factory-a", "p1"), usage("mine", "p2")],
      profileId: "p1",
      repeatPolicy: "avoid_profile",
      randomWord: sequenceRandom(),
    });
    expect(selected.map((item) => item.id).sort()).toEqual(["factory-b", "mine"]);
  });

  it("rejects a requested My Targets count larger than the available catalogue", () => {
    expect(() => selectPartialTrainingTargets([target("mine", "user")], {}, 2)).toThrow("my_targets: requested 2, available 1");
  });
});

describe("Training preflight call contract", () => {
  it("uses the actual baseline pipeline instead of assuming four Viewer calls for the whole Training session", () => {
    expect(baselineTrainingViewerCallsPerSession(false)).toBe(6);
    expect(baselineTrainingViewerCallsPerSession(true)).toBe(7);
  });
});
