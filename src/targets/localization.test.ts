import { describe, expect, it } from "vitest";
import type { TargetRecord } from "./types";
import { localizedTargetRecord, localizedTargetReveal, localizedTargetTitle } from "./localization";
import { getBundledTrainingLocalizationPl } from "./bundledLocalization";

const target: TargetRecord = {
  id: "factory_training_01_01",
  collection: "training",
  title: "Mountain",
  revealText: "English reveal",
  tags: [],
  sourceMetadata: { titlePl: "Góra", revealTextPl: "Polski reveal" },
  createdAt: "now",
  updatedAt: "now",
};

describe("Training Target localization", () => {
  it("selects the factory language without changing target identity", () => {
    expect(localizedTargetTitle(target, "pl")).toBe("Góra");
    expect(localizedTargetReveal(target, "pl")).toBe("Polski reveal");
    expect(localizedTargetRecord(target, "pl")).toMatchObject({ id: target.id, title: "Góra", revealText: "Polski reveal" });
  });

  it("falls back to canonical content when a translation is absent", () => {
    expect(localizedTargetTitle(target, "en")).toBe("Mountain");
    expect(localizedTargetReveal(target, "en")).toBe("English reveal");
  });
  it("uses the bundled Polish resource only when an immutable factory row has no persisted localization", () => {
    const legacyFactory: TargetRecord = {
      ...target,
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: "factory-training-targets-84" },
    };
    const bundled = getBundledTrainingLocalizationPl(legacyFactory.id);
    expect(localizedTargetTitle(legacyFactory, "pl")).toBe(bundled.titlePl);
    expect(localizedTargetReveal(legacyFactory, "pl")).toBe(bundled.revealTextPl);
    expect(localizedTargetReveal(legacyFactory, "en")).toBe("English reveal");
    expect(legacyFactory.sourceMetadata).toEqual({ origin: "bundled_factory_training_pack", packId: "factory-training-targets-84" });
  });

  it("uses the bundled Polish resource for newly inserted 94-pack factory rows", () => {
    const currentFactory: TargetRecord = {
      ...target,
      id: "factory_training_08_01",
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: "factory-training-targets-94" },
    };
    const bundled = getBundledTrainingLocalizationPl(currentFactory.id);
    expect(localizedTargetTitle(currentFactory, "pl")).toBe(bundled.titlePl);
    expect(localizedTargetReveal(currentFactory, "pl")).toBe(bundled.revealTextPl);
  });

  it("keeps persisted localization authoritative over a newer bundled resource", () => {
    const persisted: TargetRecord = {
      ...target,
      sourceMetadata: {
        origin: "bundled_factory_training_pack", packId: "factory-training-targets-84",
        titlePl: "Historyczna nazwa", revealTextPl: "Historyczny reveal",
      },
    };
    expect(localizedTargetTitle(persisted, "pl")).toBe("Historyczna nazwa");
    expect(localizedTargetReveal(persisted, "pl")).toBe("Historyczny reveal");
  });

});
