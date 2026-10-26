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
  it.each(["LF", "CRLF"] as const)("stays aligned across frontend and native manifests with %s line endings without sending a version user agent", (lineEndings) => {
    // Git checkouts may use CRLF on Windows. Exercise both forms on every OS.
    const normalizeCheckout = (source: string) => source.replace(/\r?\n/g, lineEndings === "CRLF" ? "\r\n" : "\n").replace(/\r\n/g, "\n");
    expect(APP_VERSION).toBe(packageJson.version);
    expect(packageLock.version).toBe(APP_VERSION);
    expect(packageLock.packages[""].version).toBe(APP_VERSION);
    expect(normalizeCheckout(cargoLock)).toContain(`name = "ai-rv-harness"\nversion = "${APP_VERSION}"`);
    expect(tauriConfig.version).toBe(APP_VERSION);
    expect(normalizeCheckout(cargoManifest)).toMatch(new RegExp(`^version = "${APP_VERSION.replaceAll(".", "\\.")}"$`, "m"));
    expect(nativeProviderTransport).not.toContain(".user_agent(");
    const confirmationCopy = storageSource.slice(storageSource.indexOf("async fn confirm_start_fresh("), storageSource.indexOf("    let handle = app.clone();", storageSource.indexOf("async fn confirm_start_fresh(")));
    expect(confirmationCopy).toContain('env!("CARGO_PKG_VERSION")');
    expect(confirmationCopy).not.toContain("v0.7.13");
  });
});
