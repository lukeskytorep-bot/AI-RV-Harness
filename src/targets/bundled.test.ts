import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import { BUNDLED_TRAINING_TARGETS, ensureBundledTrainingTargets } from "./bundled";

describe("bundled Training Targets", () => {
  it("ships exactly ten targets with clean sequential Target IDs", () => {
    expect(BUNDLED_TRAINING_TARGETS).toHaveLength(10);
    expect(BUNDLED_TRAINING_TARGETS.map((target) => target.targetId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const target of BUNDLED_TRAINING_TARGETS) {
      expect(target.revealText).toContain(`Target ID:** ${target.targetId}`);
      expect(target.revealText).not.toMatch(/Target coordinates|fr874|# Target 00/i);
    }
  });

  it("seeds missing targets once and leaves existing targets untouched", async () => {
    const created: Array<Record<string, unknown>> = [];
    const repository = {
      listTargets: vi.fn(async () => [{ id: "training_1" }]),
      createTarget: vi.fn(async (input: Record<string, unknown>) => { created.push(input); return input; }),
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget">;
    expect(await ensureBundledTrainingTargets(repository)).toBe(9);
    expect(created).toHaveLength(9);
    expect(created[0]?.id).toBe("training_2");
    expect(created.at(-1)?.id).toBe("training_10");
    expect(created.every((target) => target.collection === "training")).toBe(true);
  });
});
