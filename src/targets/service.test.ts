import { describe, expect, it, vi } from "vitest";
import { buildAutomaticTargetReveal, createUserTarget, targetHasSupportedReveal } from "./service";

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
});
