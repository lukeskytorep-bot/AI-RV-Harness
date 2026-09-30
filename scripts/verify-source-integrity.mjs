import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] ?? ".");
const failures = [];

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

const forbiddenFileName = (path) => path.includes(".openai-download-")
  || path.endsWith(".tsbuildinfo")
  || /(?:^|\/)[^/]+\.db(?:-shm|-wal)?$/.test(path)
  || path.endsWith(".log");

const forbiddenDirectory = (path) => path === "node_modules"
  || path.startsWith("node_modules/")
  || path === "dist"
  || path.startsWith("dist/")
  || path === "src-tauri/target"
  || path.startsWith("src-tauri/target/");

function packagePaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git") return [];
    const path = join(directory, entry.name);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (!entry.isDirectory()) return [rel];
    return forbiddenDirectory(rel) ? [rel] : [rel, ...packagePaths(path)];
  });
}

function sourcePaths() {
  if (!existsSync(join(root, ".git"))) return packagePaths(root);
  const result = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`cannot inspect tracked source paths: ${result.stderr.trim() || `git exited ${result.status}`}`);
    return [];
  }
  return result.stdout.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
}

for (const path of sourcePaths()) {
  if (forbiddenFileName(path)) failures.push(`forbidden generated or transfer file: ${path}`);
  if (forbiddenDirectory(path)) failures.push(`forbidden packaged directory: ${path}`);
}

function pathsBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "target", ".git"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? [path, ...pathsBelow(path)] : [path];
  });
}

for (const rustFile of filesBelow(join(root, "src-tauri", "src")).filter((path) => path.endsWith(".rs"))) {
  const source = readFileSync(rustFile, "utf8");
  for (const match of source.matchAll(/include_(?:bytes|str)!\(\s*"([^"]+)"\s*\)/g)) {
    const included = resolve(dirname(rustFile), match[1]);
    if (!existsSync(included)) failures.push(`${relative(root, rustFile)} -> ${match[1]}`);
  }
}

const escapedUnicodeNames = pathsBelow(root)
  .map((path) => relative(root, path))
  .filter((path) => /#U[0-9A-Fa-f]{4,6}/.test(path));
if (escapedUnicodeNames.length) {
  failures.push(...escapedUnicodeNames.map((path) => `escaped Unicode filename: ${path}`));
}

if (failures.length) {
  console.error(["Source integrity verification failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log("Source integrity verification passed: Rust includes, Unicode filenames and package hygiene are valid.");
