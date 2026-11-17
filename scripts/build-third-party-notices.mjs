// Generate notices for the desktop bundle from the installed, locked dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertComplete, collectPackageNotices, inventoryManifest, loadSupplements, renderPackageNotice, sha256 } from "./third-party-notices-lib.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(path, "utf8").trimEnd();
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const cargoArgs = ["--manifest-path", "src-tauri/Cargo.toml", "--locked"];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || /^host: (\S+)$/m.exec(run("rustc", ["-vV"]))?.[1];
if (!target) throw new Error("Could not determine the desktop target for the license inventory.");
const cargo = JSON.parse(run("cargo", ["metadata", ...cargoArgs, "--format-version", "1", "--filter-platform", target]));
const tree = new Set(run("cargo", ["tree", ...cargoArgs, "--target", target, "--edges", "normal", "--prefix", "none", "--format", "{p}"])
  .split(/\r?\n/).map(line => line.trim().replace(/ \(\*\)$/, "")).filter(Boolean));
const rootCrate = cargo.packages.find(p => p.id === cargo.resolve.root);
const key = p => p.name + " v" + p.version;
const runtime = cargo.packages.filter(p => p.id !== rootCrate.id && [...tree].some(line => line === key(p) || line.startsWith(key(p) + " (")));
if (new Set(runtime.map(key)).size + 1 !== tree.size || runtime.length !== new Set(runtime.map(key)).size) {
  throw new Error("Cargo dependency inventory could not be matched unambiguously.");
}

const entries = [];
const supplements = loadSupplements(resolve(root, "docs/third-party/notices"));
const add = p => entries.push(collectPackageNotices(p, supplements));
const lock = JSON.parse(read(resolve(root, "package-lock.json")));
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  if (!existsSync(resolve(root, path, "package.json"))) {
    if (info.optional) continue;
    throw new Error("Missing production npm dependency; run npm ci: " + path);
  }
  const pkg = JSON.parse(read(resolve(root, path, "package.json")));
  if (pkg.version !== info.version) throw new Error("Installed version does not match lockfile: " + path);
  add({ ...pkg, ecosystem: "npm", path: resolve(root, path), source: "https://www.npmjs.com/package/" + pkg.name + "/v/" + pkg.version });
}
for (const p of runtime) {
  const vendored = !p.source && p.name === "tauri-runtime-wry";
  if (!vendored && !p.source?.startsWith("registry+")) throw new Error("Review source and licensing for " + p.id);
  add({ ...p, ecosystem: "Rust", path: dirname(p.manifest_path), licenseFile: p.license_file,
    source: vendored ? "https://github.com/tauri-apps/tauri/tree/ca90b46b2e2cbbc981dae1b809f4af4343fe0558/crates/tauri-runtime-wry (modified; see PATCH.md)"
      : "https://crates.io/api/v1/crates/" + p.name + "/" + p.version + "/download",
    extra: vendored ? ["PATCH.md"] : [] });
}
assertComplete(entries);
const manifest = inventoryManifest(entries, target, Object.fromEntries(["package-lock.json", "src-tauri/Cargo.lock"]
  .map(file => [file, sha256(readFileSync(resolve(root, file)))])));
const parts = [
  "AI RV Harness — Third-party notices\nTarget: " + target,
  "Inventory: installed production npm packages and Cargo normal dependency tree for this target. This inventory can include unused packages; it does not cover additional system libraries copied by OS packagers.",
  "--- Project LICENSE ---\n" + read(resolve(root, "LICENSE")),
  "--- Project content license ---\n" + read(resolve(root, "CONTENT_LICENSE_CC_BY_4.0.md")),
  "MPL-2.0 corresponding sources: exact-version source archive URLs are listed with each MPL-covered package below. These notices cover the dependency inventory only; system libraries added by OS packagers require a separate review.",
  ...entries.map(renderPackageNotice).sort()
];
const notices = parts.join("\n\n============================================================\n\n") + "\n";
manifest.projectVersion = JSON.parse(read(resolve(root, "package.json"))).version;
manifest.noticesSha256 = sha256(notices);
manifest.coverage = "Locked application dependencies only; additional components copied by OS packagers require separate inspection.";
mkdirSync(resolve(root, "dist"), { recursive: true });
writeFileSync(resolve(root, "dist/THIRD_PARTY_NOTICES.txt"), notices);
writeFileSync(resolve(root, "dist/THIRD_PARTY_NOTICES.inventory.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Third-party notices: " + entries.length + " entries for " + target + ".");
