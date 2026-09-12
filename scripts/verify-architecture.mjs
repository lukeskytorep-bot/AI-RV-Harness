#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const projectRoot = path.resolve(getArg("root", process.cwd()));
const configPath = path.resolve(projectRoot, getArg("config", "scripts/architecture-boundaries.json"));
const requestedRules = new Set((getArg("rules", "cycles,domain,features,storage,providers,components,rust") || "").split(",").filter(Boolean));
const toPosix = (value) => value.split(path.sep).join("/");
const rel = (value) => toPosix(path.relative(projectRoot, value));
const sourceRoot = path.join(projectRoot, "src");

if (!fs.existsSync(configPath)) {
  console.error(`[ARCH-CONFIG] Missing architecture config: ${rel(configPath)}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const allowlist = Array.isArray(config.allowlist) ? config.allowlist : [];
for (const entry of allowlist) {
  if (!entry.rule || !entry.importer || !entry.import || !entry.reason) {
    console.error("[ARCH-CONFIG] Every allowlist entry needs rule, importer, import and reason.");
    process.exit(1);
  }
  if (/[?*]/.test(entry.importer) || /[?*]/.test(entry.import)) {
    console.error(`[ARCH-CONFIG] Wildcards are forbidden in allowlist entries: ${JSON.stringify(entry)}`);
    process.exit(1);
  }
}
const usedAllowlist = new Set();
const allowKey = (rule, importer, imported) => `${rule}\0${importer}\0${imported}`;
const allowMap = new Map(allowlist.map((entry, index) => [allowKey(entry.rule, entry.importer, entry.import), { entry, index }]));
const isAllowed = (rule, importer, imported) => {
  const match = allowMap.get(allowKey(rule, importer, imported));
  if (!match) return false;
  usedAllowlist.add(match.index);
  return true;
};

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};
const isProdTs = (file) => /\.(?:ts|tsx)$/.test(file) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(file) && !file.endsWith(".d.ts");
const sourceFiles = walk(sourceRoot).filter(isProdTs);
const sourceSet = new Set(sourceFiles.map((file) => path.resolve(file)));

const stripQuery = (specifier) => specifier.split(/[?#]/, 1)[0];
const resolveRelative = (importer, specifier) => {
  const clean = stripQuery(specifier);
  if (!clean.startsWith(".")) return null;
  let base = path.resolve(path.dirname(importer), clean);
  const candidates = [];
  if (/\.(?:ts|tsx)$/.test(base)) candidates.push(base);
  else if (/\.js$/.test(base)) candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
  else candidates.push(`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};

const parseImports = (file) => {
  const text = fs.readFileSync(file, "utf8");
  const ast = parse(text, {
    sourceType: "module",
    plugins: ["typescript", ...(file.endsWith(".tsx") ? ["jsx"] : [])],
  });
  const imports = [];
  const add = (specifier, typeOnly, nodeKind) => {
    const resolved = resolveRelative(file, specifier);
    imports.push({ specifier, typeOnly, nodeKind, resolved });
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ImportDeclaration") {
      const typeOnly = node.importKind === "type" ||
        (node.specifiers.length > 0 && node.specifiers.every((item) => item.importKind === "type"));
      add(node.source.value, typeOnly, "import");
    } else if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) {
      const typeOnly = node.exportKind === "type" ||
        (node.specifiers?.length > 0 && node.specifiers.every((item) => item.exportKind === "type"));
      add(node.source.value, typeOnly, "export");
    } else if (node.type === "ImportExpression" && node.source?.type === "StringLiteral") {
      add(node.source.value, false, "dynamic-import");
    } else if (node.type === "CallExpression" && node.callee?.type === "Import" && node.arguments?.[0]?.type === "StringLiteral") {
      add(node.arguments[0].value, false, "dynamic-import");
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === "object" && typeof value.type === "string") visit(value);
    }
  };
  visit(ast.program);
  return { text, ast, imports };
};
const parsed = new Map(sourceFiles.map((file) => [path.resolve(file), parseImports(file)]));
const violations = [];
const addViolation = (rule, importer, imported, detail) => {
  if (isAllowed(rule, importer, imported)) return;
  violations.push({ rule, importer, imported, detail });
};

if (requestedRules.has("cycles")) {
  const graph = new Map(sourceFiles.map((file) => [path.resolve(file), []]));
  for (const [file, info] of parsed) {
    for (const item of info.imports) {
      if (item.typeOnly || !item.resolved || !sourceSet.has(path.resolve(item.resolved))) continue;
      const importer = rel(file);
      const imported = rel(item.resolved);
      if (isAllowed("runtime-cycle-edge", importer, imported)) continue;
      graph.get(file).push(path.resolve(item.resolved));
    }
  }
  const state = new Map();
  const stack = [];
  const seenCycles = new Set();
  const dfs = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!state.has(next)) dfs(next);
      else if (state.get(next) === 1) {
        const start = stack.indexOf(next);
        const cycle = [...stack.slice(start), next].map(rel);
        const body = cycle.slice(0, -1);
        const rotations = body.map((_, i) => [...body.slice(i), ...body.slice(0, i)].join(" -> "));
        const key = rotations.sort()[0];
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          violations.push({ rule: "runtime-cycle", importer: cycle[0], imported: cycle[1], detail: `Runtime import cycle: ${cycle.join(" -> ")}` });
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const file of graph.keys()) if (!state.has(file)) dfs(file);
}

if (requestedRules.has("domain")) {
  const providerInfrastructure = [
    "src/providers/native.ts",
    "src/providers/requestExecutor.ts",
    "src/providers/retry.ts",
    "src/providers/providerError.ts",
    "src/providers/service.ts",
  ];
  for (const [file, info] of parsed) {
    const importer = rel(file);
    if (!importer.startsWith("src/domain/")) continue;
    for (const item of info.imports) {
      const importedResolved = item.resolved ? rel(item.resolved) : null;
      const externalForbidden = item.specifier === "react" || item.specifier.startsWith("react/") || item.specifier.startsWith("@tauri-apps/");
      const internalForbidden = importedResolved && (
        importedResolved.startsWith("src/storage/") ||
        importedResolved.startsWith("src/features/") ||
        importedResolved.startsWith("src/components/") ||
        providerInfrastructure.includes(importedResolved)
      );
      if (externalForbidden || internalForbidden) {
        addViolation("domain-boundary", importer, item.specifier, `domain must stay independent of infrastructure/UI${importedResolved ? ` (resolved: ${importedResolved})` : ""}`);
      }
    }
  }
}

if (requestedRules.has("features")) {
  const featureSet = new Set(config.featureEntryPoints ?? []);
  for (const feature of featureSet) {
    const entry = path.join(sourceRoot, "features", feature, "index.ts");
    const entryTsx = path.join(sourceRoot, "features", feature, "index.tsx");
    if (!fs.existsSync(entry) && !fs.existsSync(entryTsx)) {
      violations.push({ rule: "feature-entrypoint", importer: `src/features/${feature}`, imported: "index.ts", detail: "Configured feature has no public entry point." });
    }
  }
  for (const [file, info] of parsed) {
    const importer = rel(file);
    const importerMatch = importer.match(/^src\/features\/([^/]+)\//);
    for (const item of info.imports) {
      if (!item.resolved) continue;
      const imported = rel(item.resolved);
      const match = imported.match(/^src\/features\/([^/]+)\/(.+)$/);
      if (!match) continue;
      const [, destFeature, tail] = match;
      if (!featureSet.has(destFeature)) continue;
      const sameFeature = importerMatch?.[1] === destFeature;
      if (!sameFeature && tail !== "index.ts" && tail !== "index.tsx") {
        addViolation("feature-private-import", importer, item.specifier, `External consumers must use src/features/${destFeature}/index.ts (resolved: ${imported})`);
      }
    }
  }
}

if (requestedRules.has("storage")) {
  for (const [file, info] of parsed) {
    const importer = rel(file);
    if (importer.startsWith("src/storage/")) continue;
    for (const item of info.imports) {
      const importedResolved = item.resolved ? rel(item.resolved) : null;
      const concrete = item.specifier === "@tauri-apps/plugin-sql" || (
        importedResolved && (
          importedResolved === "src/storage/browserRepository.ts" ||
          importedResolved === "src/storage/sqliteRepository.ts" ||
          importedResolved.startsWith("src/storage/browser/") ||
          importedResolved.startsWith("src/storage/sqlite/")
        )
      );
      if (concrete) {
        addViolation("storage-concrete-import", importer, item.specifier, `UI/application code must use the public repository boundary${importedResolved ? ` (resolved: ${importedResolved})` : ""}`);
      }
    }
  }
}

if (requestedRules.has("providers")) {
  const allowedOwners = new Set(["src/providers/native.ts", "src/providers/requestExecutor.ts"]);
  for (const [file, info] of parsed) {
    const importer = rel(file);
    if (allowedOwners.has(importer)) continue;
    if (info.text.includes("providerChatAttempt")) {
      addViolation("provider-attempt-boundary", importer, "providerChatAttempt", "The one-attempt provider transport may only be owned by src/providers/native.ts and src/providers/requestExecutor.ts.");
    }
  }
}

if (requestedRules.has("components")) {
  const components = config.canonicalComponents ?? [];
  for (const component of components) {
    const owner = path.join(sourceRoot, "components", `${component}.tsx`);
    if (!fs.existsSync(owner)) {
      violations.push({ rule: "shared-component-owner", importer: "src/components", imported: component, detail: `Canonical component is missing: src/components/${component}.tsx` });
      continue;
    }
    for (const [file, info] of parsed) {
      if (path.resolve(file) === path.resolve(owner)) continue;
      let declared = false;
      for (const topLevel of info.ast.program.body) {
        const statement = topLevel.type === "ExportNamedDeclaration" || topLevel.type === "ExportDefaultDeclaration"
          ? topLevel.declaration
          : topLevel;
        if ((statement?.type === "FunctionDeclaration" || statement?.type === "ClassDeclaration") && statement.id?.name === component) declared = true;
        if (statement?.type === "VariableDeclaration") {
          for (const item of statement.declarations) {
            if (item.id?.type === "Identifier" && item.id.name === component) declared = true;
          }
        }
      }
      if (declared) addViolation("shared-component-duplicate", rel(file), component, `Canonical ${component} must remain owned by src/components/${component}.tsx`);
    }
  }
}

if (requestedRules.has("rust")) {
  const rustRoot = path.join(projectRoot, "src-tauri", "src");
  const facade = path.join(rustRoot, "providers.rs");
  const modules = {
    adapters: ["provider_base_url", "normalized_credential_endpoint"],
    errors: ["provider_error_metadata"],
    reasoning: ["normalize_reasoning_response"],
    request_builders: ["build_openai_compatible_request", "build_google_request", "build_anthropic_request"],
    response_parsers: ["parse_openai_compatible_response", "parse_google_response", "parse_anthropic_response"],
    transport: ["send_chat_request", "HTTP_CLIENT"],
    validation: ["validate_chat_request", "validate_request_id"],
  };
  if (!fs.existsSync(facade)) {
    violations.push({ rule: "rust-provider-boundary", importer: "src-tauri/src/providers.rs", imported: "providers", detail: "Provider facade is missing." });
  } else {
    const facadeText = fs.readFileSync(facade, "utf8");
    for (const [moduleName, ownedSymbols] of Object.entries(modules)) {
      const moduleFile = path.join(rustRoot, "providers", `${moduleName}.rs`);
      if (!fs.existsSync(moduleFile)) {
        violations.push({ rule: "rust-provider-boundary", importer: "src-tauri/src/providers.rs", imported: `providers/${moduleName}.rs`, detail: `Expected Rust provider module is missing.` });
        continue;
      }
      if (!facadeText.includes(`mod ${moduleName};`)) {
        violations.push({ rule: "rust-provider-boundary", importer: "src-tauri/src/providers.rs", imported: `providers/${moduleName}.rs`, detail: `Facade must declare mod ${moduleName};` });
      }
      const moduleText = fs.readFileSync(moduleFile, "utf8");
      for (const symbol of ownedSymbols) {
        if (!moduleText.includes(symbol)) violations.push({ rule: "rust-provider-boundary", importer: `src-tauri/src/providers/${moduleName}.rs`, imported: symbol, detail: `Expected owner does not contain ${symbol}.` });
      }
    }
    for (const forbiddenSymbol of [
      "fn build_openai_compatible_request",
      "fn build_google_request",
      "fn build_anthropic_request",
      "fn parse_openai_compatible_response",
      "fn parse_google_response",
      "fn parse_anthropic_response",
      "fn normalize_reasoning_response",
      "fn send_chat_request",
      "static HTTP_CLIENT",
    ]) {
      if (facadeText.includes(forbiddenSymbol)) violations.push({ rule: "rust-provider-boundary", importer: "src-tauri/src/providers.rs", imported: forbiddenSymbol, detail: "providers.rs must stay a thin Tauri facade/DTO boundary." });
    }
    const testsFile = path.join(rustRoot, "providers", "tests.rs");
    if (!fs.existsSync(testsFile)) violations.push({ rule: "rust-provider-boundary", importer: "src-tauri/src/providers.rs", imported: "providers/tests.rs", detail: "Provider tests must remain in providers/tests.rs." });
    if (!facadeText.includes("#[cfg(test)]\nmod tests;")) violations.push({ rule: "rust-provider-boundary", importer: "src-tauri/src/providers.rs", imported: "mod tests", detail: "Provider facade must wire providers/tests.rs only under cfg(test)." });
  }
}

for (let index = 0; index < allowlist.length; index += 1) {
  if (!usedAllowlist.has(index)) {
    const entry = allowlist[index];
    violations.push({ rule: "unused-allowlist", importer: entry.importer, imported: entry.import, detail: `Allowlist entry for ${entry.rule} is not exercised and must be removed. Reason: ${entry.reason}` });
  }
}

if (violations.length) {
  console.error(`Architecture verification failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`\n[${violation.rule}] ${violation.importer}`);
    console.error(`  import/target: ${violation.imported}`);
    console.error(`  ${violation.detail}`);
  }
  process.exit(1);
}
console.log(`Architecture verification PASS: ${sourceFiles.length} production TS/TSX files; ${allowlist.length} allowlist entries; rules=${[...requestedRules].join(",")}.`);
