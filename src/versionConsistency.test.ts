import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import cargoManifest from "../src-tauri/Cargo.toml?raw";
import tauriConfig from "../src-tauri/tauri.conf.json";
import nativeProviders from "../src-tauri/src/providers.rs?raw";
import { APP_VERSION } from "./version";

describe("application version", () => {
  it("stays aligned across the frontend, Tauri bundle and native provider user agent", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(tauriConfig.version).toBe(APP_VERSION);
    expect(cargoManifest).toMatch(new RegExp(`^version = "${APP_VERSION.replaceAll(".", "\\.")}"$`, "m"));
    expect(nativeProviders).toContain('env!("CARGO_PKG_VERSION")');
  });
});
