import { describe, expect, it, vi } from "vitest";
import { buildAutomaticTargetReveal, createUserTarget, resolveAutomaticTargetRevealForResume, targetHasSupportedReveal, targetIsEligibleForProtocol, updateUserTarget, userTargetKind } from "./service";

describe("target service", () => {
  it("normalizes a private target and records a content hash", async () => {
    const createTarget = vi.fn(async (input) => ({ ...input, tags: input.tags ?? [], sourceMetadata: input.sourceMetadata ?? {}, createdAt: "now", updatedAt: "now" }));
    const target = await createUserTarget({ createTarget }, { title: "  Bridge  ", revealText: "  Red suspension bridge  ", tags: ["urban", "urban"] });
    expect(target.title).toBe("Bridge");
    expect(target.tags).toEqual(["urban"]);
    expect(target.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts an image-only private target and carries its image only into Reveal", async () => {
    const artifact = { artifactId: "artifact_a", path: "/managed/targets/a.png", originalFileName: "a.png", mimeType: "image/png", size: 12, sha256: "a".repeat(64) };
    const createTarget = vi.fn(async (input) => ({ ...input, tags: input.tags ?? [], sourceMetadata: input.sourceMetadata ?? {}, createdAt: "now", updatedAt: "now" }));
    const target = await createUserTarget({ createTarget }, { title: "Image target", revealArtifacts: [artifact] });
    expect(targetHasSupportedReveal(target)).toBe(true);
    const reveal = await buildAutomaticTargetReveal(target);
    expect(reveal.text).toBeUndefined();
    expect(reveal.artifactManifest).toEqual([artifact]);
    expect(reveal.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("updates an unused private target while retaining its existing Reveal images", async () => {
    const artifact = { artifactId: "artifact_a", path: "/managed/targets/a.png", originalFileName: "a.png", mimeType: "image/png", size: 12, sha256: "a".repeat(64) };
    const target = { id: "target_a", collection: "user" as const, title: "Old", revealArtifacts: [artifact], tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" };
    const updateTarget = vi.fn(async (_id, input) => ({ ...target, ...input, revealArtifacts: target.revealArtifacts }));
    const updated = await updateUserTarget({ updateTarget }, target, { title: " New title ", tags: [" test ", "test"] });
    expect(updateTarget).toHaveBeenCalledWith("target_a", expect.objectContaining({ title: "New title", tags: ["test"] }));
    expect(updated.revealArtifacts).toEqual([artifact]);
    expect(updated.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects edits to bundled Training Targets", async () => {
    const target = { id: "training_1", collection: "training" as const, title: "Training", revealText: "Reveal", tags: [], sourceMetadata: {}, createdAt: "now", updatedAt: "now" };
    await expect(updateUserTarget({ updateTarget: vi.fn() }, target, { title: "Changed", revealText: "Reveal" })).rejects.toThrow(/read-only/);
  });

  it("freezes the localized reveal selected for a new automatic session", async () => {
    const target = {
      id: "factory_training_01_01", collection: "training" as const, title: "English", revealText: "English reveal", tags: [],
      sourceMetadata: { titleEn: "English", titlePl: "Polski", revealTextEn: "English reveal", revealTextPl: "Polski reveal", languages: ["en", "pl"], polishTranslationStatus: "accepted" },
      createdAt: "now", updatedAt: "now",
    };
    const plReveal = await buildAutomaticTargetReveal(target, "pl");
    const enReveal = await buildAutomaticTargetReveal(target, "en");
    expect(plReveal.text).toBe("Polski reveal");
    expect(enReveal.text).toBe("English reveal");
    expect(plReveal.hash).not.toBe(enReveal.hash);
  });

  it("keeps general and telepathic user targets in separate protocol pools", async () => {
    const createTarget = vi.fn(async (input) => ({ ...input, tags: input.tags ?? [], sourceMetadata: input.sourceMetadata ?? {}, createdAt: "now", updatedAt: "now" }));
    const general = await createUserTarget({ createTarget }, { title: "Bridge", revealText: "A bridge" });
    const telepathic = await createUserTarget({ createTarget }, { title: "Person", revealText: "A person", targetKind: "telepathic" });
    expect(userTargetKind(general)).toBe("general");
    expect(userTargetKind(telepathic)).toBe("telepathic");
    expect(targetIsEligibleForProtocol(general, "rcp")).toBe(true);
    expect(targetIsEligibleForProtocol(general, "telepathic")).toBe(false);
    expect(targetIsEligibleForProtocol(telepathic, "telepathic")).toBe(true);
    expect(targetIsEligibleForProtocol(telepathic, "lite")).toBe(false);
  });
  it("resumes a legacy factory session with the canonical Reveal when the new bundled localization changes the current hash", async () => {
    const target = {
      id: "factory_training_01_01", collection: "training" as const, title: "English", revealText: "English reveal", tags: [],
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: "factory-training-targets-84" },
      createdAt: "now", updatedAt: "now",
    };
    const legacy = await buildAutomaticTargetReveal({ ...target, sourceMetadata: {} }, "pl");
    const current = await buildAutomaticTargetReveal(target, "pl");
    expect(current.hash).not.toBe(legacy.hash);

    const compatible = await resolveAutomaticTargetRevealForResume(target, "pl", legacy.hash);
    expect(compatible?.hash).toBe(legacy.hash);
    expect(compatible?.text).toBe("English reveal");
  });

  it("keeps Resume fail-closed when neither current nor legacy factory Reveal hash matches", async () => {
    const target = {
      id: "factory_training_01_01", collection: "training" as const, title: "English", revealText: "English reveal", tags: [],
      sourceMetadata: { origin: "bundled_factory_training_pack", packId: "factory-training-targets-84" },
      createdAt: "now", updatedAt: "now",
    };
    expect(await resolveAutomaticTargetRevealForResume(target, "pl", "f".repeat(64))).toBeUndefined();
  });

});
