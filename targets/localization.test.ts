import { describe, expect, it } from "vitest";
import type { TargetRecord } from "./types";
import { localizedTargetRecord, localizedTargetReveal, localizedTargetTitle } from "./localization";

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
});
