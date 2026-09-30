import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import { BUNDLED_TRAINING_TARGETS, ensureBundledTrainingTargets, FACTORY_TARGET_PACK_ID, TRAINING_CATEGORIES, validateFactoryTrainingPack } from "./bundled";

function legacyIds(): string[] {
  return [
    ...Array.from({ length: 10 }, (_, index) => `factory_training_01_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `factory_training_02_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `factory_training_03_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `factory_training_04_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `factory_training_05_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 10 }, (_, index) => `factory_training_06_${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 24 }, (_, index) => `factory_training_07_${String(index + 1).padStart(2, "0")}`),
  ];
}

describe("bundled Training Targets", () => {
  it("ships the validated 94-target factory pack with eight categories while preserving all 84 legacy IDs", () => {
    expect(BUNDLED_TRAINING_TARGETS).toHaveLength(94);
    expect(BUNDLED_TRAINING_TARGETS.map((target) => target.targetId)).toEqual(Array.from({ length: 94 }, (_, index) => index + 1));
    expect(BUNDLED_TRAINING_TARGETS.slice(0, 84).map((target) => target.id)).toEqual(legacyIds());
    expect(BUNDLED_TRAINING_TARGETS.slice(84).map((target) => target.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `factory_training_08_${String(index + 1).padStart(2, "0")}`),
    );
    const validation = validateFactoryTrainingPack();
    expect(validation.valid).toBe(true);
    expect(TRAINING_CATEGORIES).toHaveLength(8);
    for (const category of TRAINING_CATEGORIES) expect(validation.counts[category]).toBe(category === "mixed_targets" ? 24 : 10);
    for (const target of BUNDLED_TRAINING_TARGETS) {
      expect(target.title).not.toMatch(/^(?:Target|Training Target|TARGET_)/i);
      expect(target.revealText).not.toMatch(/Target ID|TRN \(Identifier\)|Target coordinates|Target Date and Time|Coordinates \(GPS\)|Date of the target|# Target 00|Training Target 0/i);
      expect(target.titlePl.trim()).not.toBe("");
      expect(target.revealTextPl.trim()).not.toBe("");
      expect(target.revealTextPl).not.toMatch(/^(?:#\s*Cel\s+\d|\*\*ID celu:)/im);
    }
  });

  it("splits the ten legacy contrast targets by factual subject rather than odd/even position", () => {
    const categories = Object.fromEntries(BUNDLED_TRAINING_TARGETS.slice(0, 10).map((target) => [target.id, target.category]));
    expect(categories).toEqual({
      factory_training_01_01: "mountains",
      factory_training_01_02: "mountains",
      factory_training_01_03: "mountains",
      factory_training_01_04: "structures",
      factory_training_01_05: "mountains",
      factory_training_01_06: "structures",
      factory_training_01_07: "mountains",
      factory_training_01_08: "structures",
      factory_training_01_09: "structures",
      factory_training_01_10: "structures",
    });
  });

  it("provides explicit location metadata for all ten newly added targets", () => {
    const added = BUNDLED_TRAINING_TARGETS.slice(84);
    expect(added).toHaveLength(10);
    expect(added.every((target) => Boolean(target.locationMetadata?.label) && Boolean(target.locationMetadata?.country))).toBe(true);
    expect(added[0]?.locationMetadata?.coordinates).toEqual({ latitude: 44.939978, longitude: 6.291256 });
  });

  it("keeps the reviewed Milenci height in both language assets", () => {
    const target = BUNDLED_TRAINING_TARGETS.find((item) => item.id === "factory_training_08_05");
    expect(target?.revealText).toContain("Milenci (The Lovers), reaching 81.4 m");
    expect(target?.revealTextPl).toContain("Milenci (Kochankowie), osiągający 81,4 m");
  });

  it("fails pack validation when a newly added target loses required location metadata", () => {
    const broken = BUNDLED_TRAINING_TARGETS.map((target) => target.id === "factory_training_08_01"
      ? { ...target, locationMetadata: undefined }
      : target);
    const validation = validateFactoryTrainingPack(broken);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("location metadata: factory_training_08_01");
  });

  it("seeds only missing rows and leaves existing semantic target content untouched", async () => {
    const first = BUNDLED_TRAINING_TARGETS[0];
    const existingFactory = {
      id: first.id,
      collection: "training" as const,
      title: "legacy EN",
      revealText: "legacy reveal",
      tags: ["factory-training", "mountain_structure_contrast", "mountain"],
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: "factory-training-targets-84", category: first.category, categoryOrder: first.categoryOrder, subtype: first.subtype },
      contentHash: "legacy-content-hash",
      createdAt: "old",
      updatedAt: "old",
    };
    const before = structuredClone(existingFactory);
    const state = new Map([[existingFactory.id, existingFactory as any]]);
    const repository = {
      listTargets: vi.fn(async () => [...state.values()]),
      createTarget: vi.fn(async (input: Record<string, unknown>) => {
        const created = { ...input, tags: input.tags ?? [], sourceMetadata: input.sourceMetadata ?? {}, createdAt: "new", updatedAt: "new" };
        state.set(String(input.id), created);
        return created;
      }),
      syncFactoryTrainingTargetClassification: vi.fn(async (id: string, sourceMetadata: Record<string, unknown>) => {
        const current = state.get(id);
        if (!current) throw new Error("missing");
        state.set(id, { ...current, sourceMetadata });
      }),
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget" | "syncFactoryTrainingTargetClassification">;

    expect(await ensureBundledTrainingTargets(repository)).toBe(93);
    expect(repository.syncFactoryTrainingTargetClassification).not.toHaveBeenCalled();
    expect(state.get(first.id)).toEqual(before);
    expect(await ensureBundledTrainingTargets(repository)).toBe(0);
    expect(state.get(first.id)).toEqual(before);
  });

  it("performs an idempotent classification-only sync for an upgraded legacy contrast target", async () => {
    const target = BUNDLED_TRAINING_TARGETS.find((item) => item.id === "factory_training_01_06");
    if (!target) throw new Error("missing legacy classification fixture");
    const existingFactory = {
      id: target.id,
      collection: "training" as const,
      title: "historical title",
      revealText: "historical reveal",
      tags: ["factory-training", "mountain_structure_contrast", "structure"],
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: "factory-training-targets-84", category: "mountain_structure_contrast", subtype: "structure" },
      contentHash: "historical-hash",
      createdAt: "old",
      updatedAt: "old",
    };
    const state = new Map([[existingFactory.id, existingFactory as any]]);
    const syncClassification = vi.fn(async (id: string, sourceMetadata: Record<string, unknown>) => {
      const current = state.get(id);
      if (!current) throw new Error("missing");
      state.set(id, { ...current, sourceMetadata });
    });
    const repository = {
      listTargets: vi.fn(async () => [...state.values()]),
      createTarget: vi.fn(async (input: Record<string, unknown>) => {
        const created = { ...input, tags: input.tags ?? [], sourceMetadata: input.sourceMetadata ?? {}, createdAt: "new", updatedAt: "new" };
        state.set(String(input.id), created);
        return created;
      }),
      syncFactoryTrainingTargetClassification: syncClassification,
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget" | "syncFactoryTrainingTargetClassification">;

    expect(await ensureBundledTrainingTargets(repository)).toBe(93);
    expect(syncClassification).toHaveBeenCalledTimes(1);
    const upgraded = state.get(target.id);
    expect(upgraded).toMatchObject({
      title: "historical title",
      revealText: "historical reveal",
      contentHash: "historical-hash",
      createdAt: "old",
      updatedAt: "old",
    });
    expect(upgraded.sourceMetadata).toMatchObject({
      packId: "factory-training-targets-84",
      category: "structures",
      categoryOrder: 2,
      subtype: "structure",
    });
    syncClassification.mockClear();
    expect(await ensureBundledTrainingTargets(repository)).toBe(0);
    expect(syncClassification).not.toHaveBeenCalled();
  });

  it("uses the new pack identity for newly inserted rows", async () => {
    const created: Array<Record<string, unknown>> = [];
    const repository = {
      listTargets: vi.fn(async () => []),
      createTarget: vi.fn(async (input: Record<string, unknown>) => { created.push(input); return input; }),
      syncFactoryTrainingTargetClassification: vi.fn(async () => undefined),
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget" | "syncFactoryTrainingTargetClassification">;
    expect(await ensureBundledTrainingTargets(repository)).toBe(94);
    expect(created).toHaveLength(94);
    expect(created.every((target) => (target.sourceMetadata as Record<string, unknown>).packId === FACTORY_TARGET_PACK_ID)).toBe(true);
  });
});
