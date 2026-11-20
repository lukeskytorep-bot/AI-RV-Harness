import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { matchCargoRuntimePackages, assertComplete, collectPackageNotices, inventoryManifest, loadSupplements, renderPackageNotice, sha256 } from "./third-party-notices-lib.mjs";

const corpus = fileURLToPath(new URL("../docs/third-party/notices", import.meta.url));
const dirs = [];
function directory() { const p = mkdtempSync(resolve(tmpdir(), "rvh-notices-")); dirs.push(p); return p; }
afterEach(() => { for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true }); });
const pkg = (path, overrides = {}) => ({ ecosystem: "Rust", name: "test", version: "1.0.0", license: "MIT", path, source: "https://crates.io/api/v1/crates/test/1.0.0/download", ...overrides });

describe("reviewed third-party notices", () => {
  const supplements = loadSupplements(corpus);
  it.each([...supplements.values()])("restores exact-version notices for $name@$version without network access", p => {
    const path = directory();
    writeFileSync(resolve(path, ".cargo_vcs_info.json"), JSON.stringify({ git: { sha1: p.upstreamCommit } }));
    const entry = collectPackageNotices(pkg(path, { name: p.name, version: p.version, license: p.declaredLicense }), supplements);
    expect(() => assertComplete([entry])).not.toThrow();
    expect(entry.texts).toHaveLength(p.files.length);
    for (const text of entry.texts) {
      expect(text.text.length).toBeGreaterThan(50);
      expect(text.origin).toBe("reviewed-supplement");
      expect(renderPackageNotice(entry)).toContain(text.sha256);
      expect(renderPackageNotice(entry)).toContain(text.sourceUrl);
    }
  });

  it("rejects a changed upstream commit and a changed license declaration", () => {
    const p = [...supplements.values()][0]; const path = directory();
    writeFileSync(resolve(path, ".cargo_vcs_info.json"), JSON.stringify({ git: { sha1: "f".repeat(40) } }));
    const info = pkg(path, { name: p.name, version: p.version, license: p.declaredLicense });
    expect(() => collectPackageNotices(info, supplements)).toThrow("does not match");
    writeFileSync(resolve(path, ".cargo_vcs_info.json"), JSON.stringify({ git: { sha1: p.upstreamCommit } }));
    expect(() => collectPackageNotices({ ...info, license: "ISC" }, supplements)).toThrow("does not match");
  });

  it("does not apply a supplement to a newer version or to npm", () => {
    const p = [...supplements.values()][0]; const path = directory();
    for (const overrides of [{ version: "999.0.0" }, { ecosystem: "npm" }]) {
      const entry = collectPackageNotices(pkg(path, { name: p.name, version: p.version, ...overrides }), supplements);
      expect(() => assertComplete([entry])).toThrow("Missing license texts");
    }
  });

  it("preserves original LICENSE, NOTICE and the vendored patch record", () => {
    const path = directory();
    for (const name of ["LICENSE", "NOTICE", "PATCH.md"]) writeFileSync(resolve(path, name), `original ${name}`);
    const entry = collectPackageNotices(pkg(path, { extra: ["PATCH.md"] }), supplements);
    expect(entry.texts.map(t => t.path)).toEqual(["LICENSE", "NOTICE", "PATCH.md"]);
    expect(renderPackageNotice(entry)).toContain("original PATCH.md");
    expect(() => assertComplete([entry])).not.toThrow();
  });

  it("accepts SPDX-named texts in LICENSES but rejects NOTICE-only and empty texts", () => {
    const path = directory(); mkdirSync(resolve(path, "LICENSES"));
    writeFileSync(resolve(path, "LICENSES/NOTICE.txt"), "Attribution alone");
    expect(() => assertComplete([collectPackageNotices(pkg(path), supplements)])).toThrow("Missing license texts");
    writeFileSync(resolve(path, "LICENSES/MIT.txt"), "");
    expect(() => assertComplete([collectPackageNotices(pkg(path), supplements)])).toThrow("Missing license texts");
    writeFileSync(resolve(path, "LICENSES/MIT.txt"), "MIT license text");
    expect(() => assertComplete([collectPackageNotices(pkg(path), supplements)])).not.toThrow();
  });

  it("rejects supplement checksum drift, duplicate identities and escaping paths", () => {
    const p = structuredClone([...supplements.values()][0]);
    for (const mutation of ["checksum", "path", "duplicate"]) {
      const path = directory(); const entry = structuredClone(p);
      for (const file of entry.files) writeFileSync(resolve(path, file.path), readFileSync(resolve(corpus, file.path)));
      if (mutation === "checksum") writeFileSync(resolve(path, entry.files[0].path), "altered");
      if (mutation === "path") entry.files[0].path = "../outside.txt";
      writeFileSync(resolve(path, "manifest.json"), JSON.stringify({ schemaVersion: 1, packages: mutation === "duplicate" ? [entry, entry] : [entry] }));
      expect(() => loadSupplements(path)).toThrow();
    }
  });

  it("retains MPL corresponding-source availability and deterministic manifests without local paths or full texts", () => {
    const path = directory(); writeFileSync(resolve(path, "LICENSE"), "MPL license");
    const entry = collectPackageNotices(pkg(path, { license: "MPL-2.0" }), supplements);
    expect(renderPackageNotice(entry)).toContain("MPL-2.0 source availability");
    expect(entry.sourceAvailability.url).toBe(entry.source);
    const manifest = inventoryManifest([entry], "x86_64-test", { "Cargo.lock": "frozen" });
    expect(JSON.stringify(manifest)).not.toContain(path);
    expect(manifest.packages[0].texts[0]).not.toHaveProperty("text");
    expect(manifest.packages[0].texts[0].sha256).toBe(sha256("MPL license"));
    expect(manifest).toEqual(inventoryManifest([entry], "x86_64-test", { "Cargo.lock": "frozen" }));
  });
});

describe("Cargo normal dependency inventory matching", () => {
  const root = {id:"root",name:"app",version:"1.0.0"};
  const dependency = {id:"registry+dep",name:"dep",version:"2.0.0"};
  const metadata = {packages:[root,dependency,{id:"unused",name:"unused",version:"9.0.0"}],resolve:{root:root.id}};
  it("normalizes ANSI and Windows CRLF without losing packages or accepting unused metadata", () => {
    expect(matchCargoRuntimePackages(metadata,"app v1.0.0 (D:\\a\\repo)\r\n\x1b[32mdep v2.0.0\x1b[0m (*)\r\n")).toEqual([dependency]);
  });
  it("accepts repeated labels and proc-macro annotations for the same unique package", () => {
    expect(matchCargoRuntimePackages(metadata,"app v1.0.0\ndep v2.0.0\ndep v2.0.0 (proc-macro) (*)\n")).toEqual([dependency]);
  });
  it("rejects missing root, unmatched dependencies, and same-name/version source ambiguity", () => {
    expect(()=>matchCargoRuntimePackages(metadata,"dep v2.0.0")).toThrow(/root/);
    expect(()=>matchCargoRuntimePackages(metadata,"app v1.0.0\nunknown v3.0.0")).toThrow(/0 candidates/);
    expect(()=>matchCargoRuntimePackages({...metadata,packages:[...metadata.packages,{...dependency,id:"other-source"}]},"app v1.0.0\ndep v2.0.0")).toThrow(/2 candidates/);
  });
});
