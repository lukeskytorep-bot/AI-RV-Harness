import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import packageLock from "../package-lock.json";
import cargoLock from "../src-tauri/Cargo.lock?raw";
import storageSource from "../src-tauri/src/storage.rs?raw";
import cargoManifest from "../src-tauri/Cargo.toml?raw";
import tauriConfig from "../src-tauri/tauri.conf.json";
import nativeProviderTransport from "../src-tauri/src/providers/transport.rs?raw";
import { APP_VERSION } from "./version";

describe("application version", () => {
  it("stays aligned across frontend and native manifests without sending a version user agent", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(packageLock.version).toBe(APP_VERSION);
    expect(packageLock.packages[""].version).toBe(APP_VERSION);
    expect(cargoLock).toContain(`name = "ai-rv-harness"\nversion = "${APP_VERSION}"`);
    expect(tauriConfig.version).toBe(APP_VERSION);
    expect(cargoManifest).toMatch(new RegExp(`^version = "${APP_VERSION.replaceAll(".", "\\.")}"$`, "m"));
    expect(nativeProviderTransport).not.toContain(".user_agent(");
    const confirmationCopy = storageSource.slice(storageSource.indexOf("async fn confirm_start_fresh("), storageSource.indexOf("    let handle = app.clone();", storageSource.indexOf("async fn confirm_start_fresh(")));
    expect(confirmationCopy).toContain('env!("CARGO_PKG_VERSION")');
    expect(confirmationCopy).not.toContain("v0.7.13");
  });
});
