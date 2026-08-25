import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import { userTargetKind } from "./service";
import { BUNDLED_TELEPATHIC_TARGETS, seedBundledTelepathicTargets } from "./telepathicBundled";

describe("bundled telepathic starter targets", () => {
  it("contains the ten supplied people in stable numeric order", () => {
    expect(BUNDLED_TELEPATHIC_TARGETS).toHaveLength(10);
    expect(BUNDLED_TELEPATHIC_TARGETS.map((target) => target.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(BUNDLED_TELEPATHIC_TARGETS[0].title).toContain("Nikola Tesla");
    expect(BUNDLED_TELEPATHIC_TARGETS[9].title).toContain("Joseph Stalin");
  });

  it("creates editable user targets tagged as telepathic", async () => {
    const created: Array<Record<string, unknown>> = [];
    const repository = {
      listTargets: vi.fn(async () => []),
      createTarget: vi.fn(async (input: Record<string, unknown>) => { created.push(input); return input; }),
    } as unknown as Pick<AppRepository, "listTargets" | "createTarget">;
    expect(await seedBundledTelepathicTargets(repository)).toBe(10);
    expect(created.every((target) => target.collection === "user")).toBe(true);
    expect(created.every((target) => (target.sourceMetadata as Record<string, unknown>).targetKind === "telepathic")).toBe(true);
    expect(userTargetKind(created[0] as unknown as Parameters<typeof userTargetKind>[0])).toBe("telepathic");
  });
});
