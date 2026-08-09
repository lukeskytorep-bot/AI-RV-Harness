import { describe, expect, it } from "vitest";
import cargoManifest from "../../src-tauri/Cargo.toml?raw";
import nativeSecrets from "../../src-tauri/src/secrets.rs?raw";

describe("native credential storage configuration", () => {
  it("enables an explicit native keyring backend for every desktop platform", () => {
    expect(cargoManifest).toMatch(/cfg\(target_os = "windows"\)[\s\S]*?windows-native/);
    expect(cargoManifest).toMatch(/cfg\(target_os = "macos"\)[\s\S]*?apple-native/);
    expect(cargoManifest).toMatch(/cfg\(target_os = "linux"\)[\s\S]*?linux-native/);
  });

  it("verifies a stored secret through a fresh operating-system keyring entry", () => {
    expect(nativeSecrets).toMatch(/set_password\(&secret\)/);
    expect(nativeSecrets).toMatch(/let verified = entry_for\(credential_id\)\?[\s\S]*?get_password\(\)/);
    expect(nativeSecrets).toMatch(/secure storage verification failed/);
  });
});
