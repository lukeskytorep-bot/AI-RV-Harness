import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import cargoManifest from "../src-tauri/Cargo.toml?raw";
import tauriConfig from "../src-tauri/tauri.conf.json";
import nativeProviderTransport from "../src-tauri/src/providers/transport.rs?raw";
import { APP_VERSION } from "./version";

describe("application version", () => {
  it("stays aligned across frontend and native manifests without sending a version user agent", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(tauriConfig.version).toBe(APP_VERSION);
    expect(cargoManifest).toMatch(new RegExp(`^version = "${APP_VERSION.replaceAll(".", "\\.")}"$`, "m"));
    expect(nativeProviderTransport).not.toContain(".user_agent(");
  });
});
