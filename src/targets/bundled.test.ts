import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import { BUNDLED_TRAINING_TARGETS, ensureBundledTrainingTargets, FACTORY_TARGET_PACK_ID, TRAINING_CATEGORIES, validateFactoryTrainingPack } from "./bundled";

describe("bundled Training Targets", () => {
  it("ships the validated 84-target factory curriculum without legacy target identifiers", () => {
    expect(BUNDLED_TRAINING_TARGETS).toHaveLength(84);
    expect(BUNDLED_TRAINING_TARGETS.map((target) => target.targetId)).toEqual(Array.from({ length: 84 }, (_, index) => index + 1));
    const validation = validateFactoryTrainingPack();
    expect(validation.valid).toBe(true);
    for (const category of TRAINING_CATEGORIES) expect(validation.counts[category]).toBe(category === "mixed_targets" ? 24 : 10);
    for (const target of BUNDLED_TRAINING_TARGETS) {
      expect(target.title).not.toMatch(/^(?:Target|Training Target|TARGET_)/i);
      expect(target.revealText).not.toMatch(/Target ID|TRN \(Identifier\)|Target coordinates|Target Date and Time|Coordinates \(GPS\)|Date of the target|# Target 00|Training Target 0/i);
      expect(target.titlePl.trim()).not.toBe("");
      expect(target.revealTextPl.trim()).not.toBe("");
      expect(target.revealTextPl).not.toMatch(/^(?:#\s*Cel\s+\d|\*\*ID celu:)/im);
    }
  });

  it("seeds missing targets once and leaves existing targets untouched", async () => {
    const created: Array<Record<string, unknown>> = [];
    const repository = {
      listTargets: vi.fn(async () => [{ id: BUNDLED_TRAINING_TARGETS[0].id }]),
      createTarget: vi.fn(async (input: Record<string, unknown>) => { created.push(input); return input; }),
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget">;
    expect(await ensureBundledTrainingTargets(repository)).toBe(83);
    expect(created).toHaveLength(83);
    expect(created[0]?.id).toBe(BUNDLED_TRAINING_TARGETS[1].id);
    expect(created.at(-1)?.id).toBe(BUNDLED_TRAINING_TARGETS.at(-1)?.id);
    expect(created.every((target) => target.collection === "training")).toBe(true);
    expect(created.every((target) => {
      const metadata = target.sourceMetadata as Record<string, unknown>;
      return metadata.polishTranslationStatus === "accepted" && Array.isArray(metadata.languages) && metadata.languages.join(",") === "en,pl";
    })).toBe(true);
  });

  it("keeps an existing factory target byte-for-byte unchanged and only inserts missing targets", async () => {
    const first = BUNDLED_TRAINING_TARGETS[0];
    const existingFactory = {
      id: first.id, collection: "training" as const, title: "legacy EN", revealText: "legacy reveal", tags: ["factory-training"],
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: FACTORY_TARGET_PACK_ID, languages: ["en"], polishTranslationStatus: "not_supplied" },
      createdAt: "old", updatedAt: "old",
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
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget">;

    expect(await ensureBundledTrainingTargets(repository)).toBe(83);
    expect(state.get(first.id)).toEqual(before);
    expect(await ensureBundledTrainingTargets(repository)).toBe(0);
    expect(state.get(first.id)).toEqual(before);
  });
});
