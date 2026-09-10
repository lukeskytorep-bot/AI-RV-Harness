import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");
const indexPath = path.join(distDir, "index.html");

if (!fs.existsSync(assetsDir) || !fs.existsSync(indexPath)) {
  console.error("[bundle] dist output is missing; run the production Vite build first.");
  process.exit(1);
}

const assetRows = fs.readdirSync(assetsDir)
  .filter((name) => /\.(?:js|css)$/.test(name))
  .map((name) => {
    const filePath = path.join(assetsDir, name);
    const buffer = fs.readFileSync(filePath);
    return {
      name,
      bytes: buffer.length,
      gzipBytes: zlib.gzipSync(buffer, { level: 9 }).length,
    };
  })
  .sort((a, b) => b.bytes - a.bytes);

const indexHtml = fs.readFileSync(indexPath, "utf8");
const entryMatch = indexHtml.match(/<script[^>]+src=["']\/assets\/([^"']+\.js)["']/);
const entry = entryMatch ? assetRows.find((row) => row.name === entryMatch[1]) : undefined;
const modulePreloadNames = [...indexHtml.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']\/assets\/([^"']+\.js)["']/g)]
  .map((match) => match[1]);
const initialJavaScript = [...new Set([entry?.name, ...modulePreloadNames].filter(Boolean))]
  .map((name) => assetRows.find((row) => row.name === name))
  .filter(Boolean);
const initialJavaScriptBytes = initialJavaScript.reduce((total, row) => total + row.bytes, 0);
const initialJavaScriptGzipBytes = initialJavaScript.reduce((total, row) => total + row.gzipBytes, 0);

const runtimeSourceRows = [];
const srcRoot = path.join(root, "src");
const skipDirectory = (relative) => relative.startsWith("resources/training-targets-source/");
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(srcRoot, fullPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (!skipDirectory(`${relative}/`)) walk(fullPath);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(?:test|spec)\.tsx?$/.test(entry.name)) continue;
    runtimeSourceRows.push({ name: relative, bytes: fs.statSync(fullPath).size });
  }
};
walk(srcRoot);
runtimeSourceRows.sort((a, b) => b.bytes - a.bytes);

const kib = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;
console.log("\n[bundle] PERF-UI production bundle report");
if (entry) console.log(`[bundle] entry: ${entry.name} | ${kib(entry.bytes)} | gzip ${kib(entry.gzipBytes)}`);
console.log(`[bundle] initial JavaScript: ${initialJavaScript.length} assets | ${kib(initialJavaScriptBytes)} | gzip ${kib(initialJavaScriptGzipBytes)}`);
for (const row of initialJavaScript) {
  console.log(`  [initial] ${row.name.padEnd(38)} ${kib(row.bytes).padStart(12)} | gzip ${kib(row.gzipBytes).padStart(12)}`);
}
console.log(`[bundle] JS/CSS chunks: ${assetRows.length}`);
console.log("[bundle] largest emitted assets:");
for (const row of assetRows.slice(0, 12)) {
  console.log(`  ${row.name.padEnd(42)} ${kib(row.bytes).padStart(12)} | gzip ${kib(row.gzipBytes).padStart(12)}`);
}
console.log("[bundle] largest runtime TypeScript modules by source bytes:");
for (const row of runtimeSourceRows.slice(0, 12)) {
  console.log(`  ${row.name.padEnd(52)} ${kib(row.bytes).padStart(12)}`);
}

const report = {
  entry: entry ?? null,
  initialJavaScript: {
    bytes: initialJavaScriptBytes,
    gzipBytes: initialJavaScriptGzipBytes,
    assets: initialJavaScript,
  },
  assets: assetRows,
  largestRuntimeSourceModules: runtimeSourceRows.slice(0, 25),
};
fs.writeFileSync(path.join(distDir, "bundle-report.json"), `${JSON.stringify(report, null, 2)}\n`);
