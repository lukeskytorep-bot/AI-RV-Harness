import { stripVTControlCharacters } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const noticeName = /^(?:licen[cs]es?|copying|copyright|notice|unlicense|third[-_ ]party)(?:$|[.\-_ ])/i;
const licenseName = /^(?:licen[cs]es?|copying|unlicense)(?:$|[.\-_ /])/i;
const packageKey = p => `${p.ecosystem}: ${p.name}@${p.version}`;

function inside(root, name) {
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw new Error(`Notice path escapes its directory: ${name}`);
  return path;
}

export function loadSupplements(directory) {
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.packages)) throw new Error("Unsupported notice supplements manifest");
  const supplements = new Map();
  for (const p of manifest.packages) {
    const key = packageKey(p);
    if (supplements.has(key) || p.ecosystem !== "Rust" || !/^[a-f0-9]{40}$/.test(p.upstreamCommit) || !p.files?.length) throw new Error(`Invalid notice supplement: ${key}`);
    const files = p.files.map(file => {
      if (!["license", "notice"].includes(file.kind) || !file.sourceUrl?.startsWith("https://")) throw new Error(`Invalid supplement provenance: ${key}`);
      const bytes = readFileSync(inside(directory, file.path));
      if (sha256(bytes) !== file.sha256 || !bytes.toString("utf8").trim()) throw new Error(`Notice supplement checksum/content mismatch: ${file.path}`);
      return { ...file, text: bytes.toString("utf8").trimEnd(), origin: "reviewed-supplement" };
    });
    supplements.set(key, { ...p, files });
  }
  return supplements;
}

export function collectPackageNotices({ name, version, license, path, source, licenseFile, ecosystem, extra = [] }, supplements) {
  const key = packageKey({ name, version, ecosystem });
  const files = readdirSync(path, { withFileTypes: true })
    .flatMap(item => noticeName.test(item.name) ? item.isFile() ? [item.name] : item.isDirectory()
      ? readdirSync(resolve(path, item.name), { withFileTypes: true }).filter(p => p.isFile()).map(p => item.name + "/" + p.name)
      : [] : []);
  const names = [...new Set([...files, ...extra, ...(licenseFile && existsSync(inside(path, licenseFile)) ? [licenseFile] : [])])].sort();
  const licenseIds = (license || "").match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g)?.filter(id => !["OR", "AND", "WITH"].includes(id)) || [];
  const texts = names.map(file => {
    const bytes = readFileSync(inside(path, file));
    return { path: file, sha256: sha256(bytes), text: bytes.toString("utf8").trimEnd(), origin: "package", sourceUrl: source,
      kind: licenseName.test(basename(file)) || file === licenseFile || (licenseName.test(file) && licenseIds.some(id => basename(file) === id || basename(file).startsWith(id + "."))) ? "license" : "notice" };
  });
  const supplement = supplements.get(key);
  if (supplement) {
    const vcs = JSON.parse(readFileSync(resolve(path, ".cargo_vcs_info.json"), "utf8"));
    if (license !== supplement.declaredLicense || vcs.git?.sha1 !== supplement.upstreamCommit) throw new Error(`Notice supplement does not match the locked upstream source: ${key}`);
    texts.push(...supplement.files);
  }
  return { id: key, ecosystem, name, version, declaredLicense: license || "See supplied notices / verify upstream", source,
    ...(supplement ? { supplementNote: supplement.note, upstreamCommit: supplement.upstreamCommit } : {}),
    ...(/\bMPL-2\.0\b/.test(license || "") ? { sourceAvailability: { license: "MPL-2.0", url: source } } : {}), texts };
}

export function assertComplete(entries) {
  const missing = entries.filter(p => !p.texts.some(file => file.kind === "license" && file.text.trim()));
  if (missing.length) throw new Error("Missing license texts; review the exact upstream versions before bundling:\n" + missing.map(p => p.id).sort().join("\n"));
}

export function renderPackageNotice(p) {
  return [p.id, "Declared license: " + p.declaredLicense, "Source: " + p.source,
    ...(p.supplementNote ? ["Supplement review: " + p.supplementNote] : []),
    ...(p.sourceAvailability ? ["MPL-2.0 source availability: the corresponding source for this exact package version is available at " + p.sourceAvailability.url + ". This source archive is separate from the binary installer."] : []),
    ...p.texts.map(file => `--- ${file.path} ---\nSource: ${file.sourceUrl}\nSHA-256: ${file.sha256}\n\n${file.text}`)].join("\n\n");
}

export function inventoryManifest(entries, target, lockfiles) {
  return { schemaVersion: 1, target, lockfiles, packages: [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(p => ({ ...p, texts: p.texts.map(({ text: _text, ...metadata }) => metadata) })) };
}

/** Match every rendered normal dependency to one metadata package, fail closed. */
export function matchCargoRuntimePackages(metadata, output) {
  const root = metadata.packages.find(p => p.id === metadata.resolve?.root);
  if (!root) throw new Error("Cargo inventory root package is missing.");
  const selected = new Map();
  const lines = new Set(stripVTControlCharacters(output).split(/\r?\n/)
    .map(line => line.trim().replace(/ \(\*\)$/, "")).filter(Boolean));
  for (const line of lines) {
    const matches = metadata.packages.filter(p => {
      const key = p.name + " v" + p.version;
      return line === key || line.startsWith(key + " (");
    });
    if (matches.length !== 1) throw new Error(`Cargo dependency inventory could not be matched unambiguously: ${line} (${matches.length} candidates).`);
    selected.set(matches[0].id, matches[0]);
  }
  if (!selected.has(root.id)) throw new Error("Cargo inventory tree is missing its root package.");
  return metadata.packages.filter(p => p.id !== root.id && selected.has(p.id));
}
