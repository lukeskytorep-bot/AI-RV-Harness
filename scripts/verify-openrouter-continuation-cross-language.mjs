import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rvh-openrouter-continuation-"));
const rustOut = path.join(temp, "rust-stream.json");
const tsOut = path.join(temp, "ts-restored.json");
const rustReplayOut = path.join(temp, "rust-replay.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

try {
  if (!fs.existsSync(vitest)) {
    throw new Error("Vitest is not installed. Run npm ci before this verification gate.");
  }
  run(cargo, [
    "test", "--manifest-path", "src-tauri/Cargo.toml",
    "openrouter_cross_language_bridge_emit_from_rust_stream",
    "--", "--ignored", "--nocapture",
  ], { AI_RV_BRIDGE_RUST_OUT: rustOut });

  run(process.execPath, [vitest, "run", "src/providers/openrouterCrossLanguageBridge.test.ts"], {
    AI_RV_BRIDGE_RUST_OUT: rustOut,
    AI_RV_BRIDGE_TS_OUT: tsOut,
  });

  run(cargo, [
    "test", "--manifest-path", "src-tauri/Cargo.toml",
    "openrouter_cross_language_bridge_replays_ts_restored_state_in_rust_request_builder",
    "--", "--ignored", "--nocapture",
  ], {
    AI_RV_BRIDGE_TS_OUT: tsOut,
    AI_RV_BRIDGE_RUST_REPLAY_OUT: rustReplayOut,
  });

  const rustStream = JSON.parse(fs.readFileSync(rustOut, "utf8"));
  const restored = JSON.parse(fs.readFileSync(tsOut, "utf8"));
  const replay = JSON.parse(fs.readFileSync(rustReplayOut, "utf8"));
  const replayedDetails = replay?.messages?.[0]?.reasoning_details;
  if (JSON.stringify(replayedDetails) !== JSON.stringify(restored?.state?.reasoningDetails)) {
    throw new Error("Cross-language replay reasoning_details differ from the TS-restored continuation state.");
  }
  if (JSON.stringify(restored?.state?.reasoningDetails) !== JSON.stringify(rustStream?.reasoningDetails)) {
    throw new Error("TS persistence/restore changed the Rust parser reasoning_details result.");
  }
  console.log("OpenRouter continuation cross-language verification passed: Rust SSE -> TS capture/persistence -> Rust replay.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
