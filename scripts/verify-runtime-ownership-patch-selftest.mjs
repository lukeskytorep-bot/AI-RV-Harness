import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rvh-runtime-patch-"));
const verifier = path.resolve("scripts/verify-runtime-ownership-patch.mjs");
try {
  const cases = [
    ["valid pinned source", null, true],
    ["registry fallback", dir => {
      const file = path.join(dir, "src-tauri/Cargo.lock");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('name = "tauri-runtime-wry"', 'source = "registry+https://github.com/rust-lang/crates.io-index"\nname = "tauri-runtime-wry"'));
    }, false],
    ["patch removed", dir => {
      const file = path.join(dir, "src-tauri/Cargo.toml");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('[patch.crates-io]', '[patch.removed]'));
    }, false],
    ["runtime drift", dir => fs.appendFileSync(path.join(dir, "src-tauri/vendor/tauri-runtime-wry/src/lib.rs"), "\n// unreviewed source\n"), false],
    ["guard drift", dir => fs.appendFileSync(path.join(dir, "src-tauri/vendor/tauri-runtime-wry/src/main_thread_target.rs"), "\n// unreviewed guard\n"), false],
    ["missing guard", dir => fs.unlinkSync(path.join(dir, "src-tauri/vendor/tauri-runtime-wry/src/main_thread_target.rs")), false],
    ["extra vendored source", dir => fs.writeFileSync(path.join(dir, "src-tauri/vendor/tauri-runtime-wry/src/extra.rs"), ""), false],
  ];
  for (const [index, [name, mutate, shouldPass]] of cases.entries()) {
    const dir = path.join(root, String(index));
    fs.mkdirSync(path.join(dir, "src-tauri"), { recursive: true });
    for (const file of ["Cargo.toml", "Cargo.lock"]) fs.copyFileSync(path.join("src-tauri", file), path.join(dir, "src-tauri", file));
    fs.cpSync("src-tauri/vendor", path.join(dir, "src-tauri/vendor"), { recursive: true });
    mutate?.(dir);
    const result = spawnSync(process.execPath, [verifier], { cwd: dir, encoding: "utf8" });
    if ((result.status === 0) !== shouldPass) throw new Error(`Runtime verifier self-test failed: ${name}\n${result.stdout}\n${result.stderr}`);
  }
  console.log("Runtime patch verifier self-tests PASS: 7 cases, registry fallback and source/guard drift rejected.");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
