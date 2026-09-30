#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const verifier = path.resolve(process.cwd(), "scripts", "verify-architecture.mjs");
const roots = [];
const makeFixture = (files, config = { allowlist: [], featureEntryPoints: [], canonicalComponents: [] }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvh-arch-selftest-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "architecture-boundaries.json"), JSON.stringify(config, null, 2));
  return root;
};
const run = (root, rules) => spawnSync(process.execPath, [verifier, `--root=${root}`, `--rules=${rules}`], { encoding: "utf8" });
const requireResult = (name, result, expectedStatus, expectedText, stream = expectedStatus === 0 ? "stdout" : "stderr") => {
  if (result.status !== expectedStatus || !result[stream].includes(expectedText)) {
    throw new Error(`${name} failed. status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
};

try {
  {
    const root = makeFixture({
      "src/a.ts": 'import { b } from "./b"; export const a = b + 1;',
      "src/b.ts": 'import { a } from "./a"; export const b = a + 1;',
    });
    requireResult("cycle", run(root, "cycles"), 1, "Runtime import cycle: src/a.ts -> src/b.ts -> src/a.ts");
  }
  {
    const root = makeFixture({
      "src/domain/model.ts": 'import type { Repo } from "../storage/repository"; export type Model = Repo;',
      "src/storage/repository.ts": "export interface Repo { id: string }",
    });
    requireResult("domain-storage", run(root, "domain"), 1, "[domain-boundary] src/domain/model.ts");
  }
  {
    const root = makeFixture({
      "src/features/a/index.ts": 'import { secret } from "../b/private"; export const value = secret;',
      "src/features/b/index.ts": 'export { secret } from "./private";',
      "src/features/b/private.ts": "export const secret = 1;",
    }, { allowlist: [], featureEntryPoints: ["a", "b"], canonicalComponents: [] });
    requireResult("feature-private", run(root, "features"), 1, "[feature-private-import] src/features/a/index.ts");
  }
  {
    const root = makeFixture({ "src/domain/model.ts": "export interface Model { id: string }" }, {
      allowlist: [{ rule: "domain-boundary", importer: "src/domain/model.ts", import: "../storage/repository", reason: "fixture exception" }],
      featureEntryPoints: [], canonicalComponents: [],
    });
    requireResult("unused-allowlist", run(root, "domain"), 1, "[unused-allowlist] src/domain/model.ts");
  }
  {
    const root = makeFixture({
      "src/features/a/index.ts": 'import { value } from "../b"; export const doubled = value * 2;',
      "src/features/b/index.ts": "export const value = 2;",
    }, { allowlist: [], featureEntryPoints: ["a", "b"], canonicalComponents: [] });
    requireResult("public-entrypoint", run(root, "features"), 0, "Architecture verification PASS");
  }
  console.log("Architecture verifier self-tests PASS: cycle, domain->storage, feature-private, unused allowlist, public entry point.");
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
