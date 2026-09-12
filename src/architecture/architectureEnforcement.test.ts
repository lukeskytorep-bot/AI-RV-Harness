/// <reference types="node" />
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const verifier = path.resolve(process.cwd(), "scripts", "verify-architecture.mjs");
const tempRoots: string[] = [];

function fixture(files: Record<string, string>, config: Record<string, unknown> = { allowlist: [], featureEntryPoints: [], canonicalComponents: [] }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvh-architecture-"));
  tempRoots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "architecture-boundaries.json"), JSON.stringify(config, null, 2), "utf8");
  return root;
}

function run(root: string, rules: string) {
  return spawnSync(process.execPath, [verifier, `--root=${root}`, `--rules=${rules}`], { encoding: "utf8" });
}

afterEach(() => {
  while (tempRoots.length) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

describe("Etap 8 architecture enforcement negative tests", () => {
  it("reports the full path of an artificial runtime import cycle", () => {
    const root = fixture({
      "src/a.ts": 'import { b } from "./b"; export const a = b + 1;',
      "src/b.ts": 'import { a } from "./a"; export const b = a + 1;',
    });
    const result = run(root, "cycles");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Runtime import cycle: src/a.ts -> src/b.ts -> src/a.ts");
  });

  it("rejects a domain to storage dependency even when it is type-only", () => {
    const root = fixture({
      "src/domain/model.ts": 'import type { Repo } from "../storage/repository"; export type Model = Repo;',
      "src/storage/repository.ts": "export interface Repo { id: string }",
    });
    const result = run(root, "domain");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[domain-boundary] src/domain/model.ts");
    expect(result.stderr).toContain('../storage/repository');
  });

  it("rejects an import into another feature's private file", () => {
    const root = fixture({
      "src/features/a/index.ts": 'import { secret } from "../b/private"; export const value = secret;',
      "src/features/b/index.ts": 'export { secret } from "./private";',
      "src/features/b/private.ts": "export const secret = 1;",
    }, { allowlist: [], featureEntryPoints: ["a", "b"], canonicalComponents: [] });
    const result = run(root, "features");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[feature-private-import] src/features/a/index.ts");
    expect(result.stderr).toContain("../b/private");
  });

  it("rejects an unused exact allowlist entry", () => {
    const root = fixture({ "src/domain/model.ts": "export interface Model { id: string }" }, {
      allowlist: [{ rule: "domain-boundary", importer: "src/domain/model.ts", import: "../storage/repository", reason: "fixture exception" }],
      featureEntryPoints: [],
      canonicalComponents: [],
    });
    const result = run(root, "domain");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[unused-allowlist] src/domain/model.ts");
  });

  it("accepts a cross-feature import through the public entry point", () => {
    const root = fixture({
      "src/features/a/index.ts": 'import { value } from "../b"; export const doubled = value * 2;',
      "src/features/b/index.ts": "export const value = 2;",
    }, { allowlist: [], featureEntryPoints: ["a", "b"], canonicalComponents: [] });
    const result = run(root, "features");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Architecture verification PASS");
  });
});
