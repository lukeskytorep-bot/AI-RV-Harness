import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const vendor = path.join(root, "src-tauri/vendor/tauri-runtime-wry");
const manifest = JSON.parse(fs.readFileSync(path.join(vendor, "PATCH.json"), "utf8"));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function requireCheck(condition, message) { if (!condition) throw new Error(message); }
const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
requireCheck(/\[patch\.crates-io\][\s\S]*?tauri-runtime-wry\s*=\s*\{\s*path\s*=\s*"vendor\/tauri-runtime-wry"\s*\}/.test(cargo), "Missing local runtime patch resolution");
const lock = fs.readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8").split("[[package]]").filter(block => /^\s*name = "tauri-runtime-wry"$/m.test(block));
requireCheck(lock.length === 1 && /^version = "2.11.4"$/m.test(lock[0]) && !/^source = /m.test(lock[0]), "Cargo.lock must resolve exactly the local runtime 2.11.4");
const allFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(path.join(dir, entry.name)) : [path.relative(vendor, path.join(dir, entry.name)).replaceAll("\\", "/")]);
requireCheck(JSON.stringify(allFiles(vendor).filter(name => !["PATCH.md", "PATCH.json"].includes(name)).sort()) === JSON.stringify(Object.keys(manifest.patchedFiles).sort()), "Unexpected or missing vendored runtime files");
for (const [name, expected] of Object.entries(manifest.patchedFiles)) {
  requireCheck(digest(fs.readFileSync(path.join(vendor, name))) === expected, `Runtime patch integrity mismatch: ${name}`);
}
requireCheck(manifest.upstream.crateSha256 === "4e6fac707727b7a2f48e4ded90976324267371073edbb415ffb73bb0458d203f", "Unexpected upstream crate identity");
if (process.argv.includes("--cargo")) {
  const result = spawnSync("cargo", ["tree", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--offline", "-i", "tauri-runtime-wry"], { encoding: "utf8" });
  requireCheck(result.status === 0, `Cargo runtime resolution check failed: ${result.stderr}`);
  requireCheck(result.stdout.replaceAll("\\", "/").includes(`tauri-runtime-wry v2.11.4 (${vendor.replaceAll("\\", "/")})`), "Cargo selected a different runtime source");
}
console.log("Runtime ownership patch PASS: pinned local 2.11.4, full source hashes, atomic weak handles, owner-only access/destruction.");
