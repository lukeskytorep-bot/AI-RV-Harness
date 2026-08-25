import { describe, expect, it, vi } from "vitest";
import { buildAutomaticTargetReveal, createUserTarget, targetHasSupportedReveal, targetIsEligibleForProtocol, updateUserTarget, userTargetKind } from "./service";

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
});
