import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function aggregateHash(roots: string[]): string {
  const files = roots.flatMap((root) => {
    const absolute = path.join(process.cwd(), root);
    if (!fs.existsSync(absolute)) return [];
    if (fs.statSync(absolute).isFile()) return [absolute];
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const item = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(item) : [item];
    });
    return walk(absolute);
  }).sort((a, b) => {
    const left = path.relative(process.cwd(), a).split(path.sep).join("/");
    const right = path.relative(process.cwd(), b).split(path.sep).join("/");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    hash.update(relative); hash.update("\0"); hash.update(fs.readFileSync(file)); hash.update("\0");
  }
  return hash.digest("hex");
}

describe("VIEWER-LEARNING-2 boundaries", () => {
  it("orders Training post-Reveal work as Review -> Field Guide Update -> Viewer Notes Reflection", () => {
    const training = source("src/features/training/trainingExecution.ts");
    const review = training.indexOf("runAutomaticPostRevealReview({");
    const fieldGuide = training.indexOf("runFieldGuideUpdate({");
    const viewerNotes = training.indexOf("runViewerNoteReflection({");
    expect(review).toBeGreaterThan(0);
    expect(fieldGuide).toBeGreaterThan(review);
    expect(viewerNotes).toBeGreaterThan(fieldGuide);
  });

  it("never wires Field Guide Update into Research", () => {
    const research = source("src/research/engine.ts");
    expect(research).not.toContain("runFieldGuideUpdate");
    expect(research).not.toContain("fieldGuideUpdate");
  });

  it("keeps Viewer Notes production mechanics byte-identical to the accepted VIEWER-LEARNING-1 base", () => {
    expect(aggregateHash(["src/aiCenter/viewerNotes.ts", "src/aiCenter/baseVersion.ts"])).toBe("06d794dbde551af4ad48984f3019f1a91607a6282f5ffdffe9d6a390381787a6");
  });

  it.each([
    ["Research", ["src/research", "src/features/research"], "5ccc466e38b820af7d0afa861d228d68075cffc1dc4b1cc33ecd34293f90fce0"],
    ["Monitor", ["src/monitor", "src/features/monitor", "src/resources/systemPrompts.ts"], "87097f8e0db0e4b4da63a382bcb5f73656a50535a854c12d8c5c09c8e33e3f47"],
    ["Judge", ["src/judge", "src/features/judge"], "520459819dda5f6451accdcab803be5cf9190d58b345d975d8cb51a8f3ba9bb4"],
    ["protocols", ["src/protocols", "src/resources/protocolRegistry.ts", "src/resources/protocols"], "2a324ad15de07985c968622be28174daa6e74ce4edd1442c03e86c4109211263"],
    ["provider transport/retry", ["src/providers"], "178cbfae43e479c28623f7f4cc7c72d066ec9eb4c723785788da5ef808a8fb89"],
  ] as const)("keeps %s byte-identical to the accepted base", (_label, roots, expected) => {
    expect(aggregateHash([...roots])).toBe(expected);
  });
});
