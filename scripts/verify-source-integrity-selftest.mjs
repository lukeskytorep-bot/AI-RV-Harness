import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const verifier = resolve(dirname(fileURLToPath(import.meta.url)), "verify-source-integrity.mjs");

function fixture(relativePath) {
  const root = mkdtempSync(join(tmpdir(), "rvh-source-integrity-"));
  mkdirSync(join(root, "src-tauri", "src"), { recursive: true });
  writeFileSync(join(root, "src-tauri", "src", "lib.rs"), "pub fn fixture() {}\n");
  if (relativePath) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "fixture\n");
  }
  return root;
}

function verify(name, relativePath, expectedSuccess) {
  const root = fixture(relativePath);
  try {
    const result = spawnSync(process.execPath, [verifier, root], { encoding: "utf8" });
    if ((result.status === 0) !== expectedSuccess) {
      throw new Error(`${name} failed. status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

verify("clean source", null, true);
verify("OpenAI transfer residue", "src/file.md.openai-download-deadbeef", false);
verify("TypeScript build info", "tsconfig.app.tsbuildinfo", false);
verify("packaged dist", "dist/app.js", false);
verify("packaged node_modules", "node_modules/pkg/index.js", false);
verify("packaged Rust target", "src-tauri/target/debug/app", false);
verify("SQLite database", "data/app.db", false);
verify("SQLite WAL", "data/app.db-wal", false);
verify("SQLite SHM", "data/app.db-shm", false);
verify("log file", "debug/app.log", false);

const checkout = fixture(null);
try {
  let result = spawnSync("git", ["init", "-q", checkout], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git fixture init failed: ${result.stderr}`);
  result = spawnSync("git", ["-C", checkout, "add", "src-tauri/src/lib.rs"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git fixture add failed: ${result.stderr}`);
  mkdirSync(join(checkout, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(checkout, "node_modules", "pkg", "index.js"), "fixture\n");
  result = spawnSync(process.execPath, [verifier, checkout], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`untracked checkout dependencies must be allowed. stderr=${result.stderr}`);
} finally {
  rmSync(checkout, { recursive: true, force: true });
}

console.log("Source integrity verifier self-tests PASS: transfer residue, build outputs, databases and logs are rejected.");
