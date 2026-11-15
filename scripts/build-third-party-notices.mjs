// Generate notices for the desktop bundle from the installed, locked dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const missing = [];
const namePattern = /^(?:licen[cs]es?|copying|copyright|notice|unlicense|third[-_ ]party)(?:$|[.\-_ ])/i;
function add({ name, version, license, path, source, licenseFile, ecosystem, extra = [] }) {
  const files = readdirSync(path, { withFileTypes: true })
    .flatMap(item => namePattern.test(item.name) ? item.isFile() ? [item.name] : item.isDirectory()
      ? readdirSync(resolve(path, item.name), { withFileTypes: true }).filter(p => p.isFile()).map(p => item.name + "/" + p.name)
      : [] : []);
  const texts = [...new Set([...files, ...extra, ...(licenseFile && existsSync(resolve(path, licenseFile)) ? [licenseFile] : [])])].sort();
  if (!texts.some(file => /^(?:licen[cs]es?|copying|unlicense)(?:$|[.\-_ /])/i.test(basename(file)) || file === licenseFile)) missing.push(ecosystem + ": " + name + "@" + version);
  entries.push([ecosystem + ": " + name + "@" + version, "Declared license: " + (license || "See supplied notices / verify upstream"), "Source: " + source,
    ...texts.map(file => "--- " + file + " ---\n" + read(resolve(path, file)))].join("\n\n"));
}
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
const parts = [
  "AI RV Harness — Third-party notices\nTarget: " + target,
  "Inventory: installed production npm packages and Cargo normal dependency tree for this target. This inventory can include unused packages; it does not cover additional system libraries copied by OS packagers.",
  "--- Project LICENSE ---\n" + read(resolve(root, "LICENSE")),
  "--- Project content license ---\n" + read(resolve(root, "CONTENT_LICENSE_CC_BY_4.0.md")),
  ...(missing.length ? ["Packages without a license text in the installed package; review applicable upstream notices before release:\n" + missing.sort().join("\n")] : []),
  ...entries.sort()
];
mkdirSync(resolve(root, "dist"), { recursive: true });
writeFileSync(resolve(root, "dist/THIRD_PARTY_NOTICES.txt"), parts.join("\n\n============================================================\n\n") + "\n");
console.log("Third-party notices: " + entries.length + " entries for " + target + ".");
if (missing.length) console.warn("Upstream license texts to review before public release:\n" + missing.join("\n"));
