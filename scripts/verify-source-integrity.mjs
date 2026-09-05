import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const failures = [];

for (const compilerArtifact of ["tsconfig.app.tsbuildinfo", "tsconfig.node.tsbuildinfo"]) {
  if (existsSync(join(root, compilerArtifact))) failures.push(`compiler artifact must not be packaged: ${compilerArtifact}`);
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

for (const rustFile of filesBelow(join(root, "src-tauri", "src")).filter((path) => path.endsWith(".rs"))) {
  const source = readFileSync(rustFile, "utf8");
  for (const match of source.matchAll(/include_(?:bytes|str)!\(\s*"([^"]+)"\s*\)/g)) {
    const included = resolve(dirname(rustFile), match[1]);
    if (!existsSync(included)) failures.push(`${relative(root, rustFile)} -> ${match[1]}`);
  }
}

const escapedUnicodeNames = filesBelow(join(root, "src-tauri", "resources"))
  .map((path) => relative(root, path))
  .filter((path) => /#U[0-9A-Fa-f]{4,6}/.test(path));
if (escapedUnicodeNames.length) {
  failures.push(...escapedUnicodeNames.map((path) => `escaped Unicode filename: ${path}`));
}

if (failures.length) {
  console.error(["Source integrity verification failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log("Source integrity verification passed: every Rust include path exists and filenames contain no escaped Unicode markers.");
