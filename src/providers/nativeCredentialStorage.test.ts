import { describe, expect, it } from "vitest";
import cargoManifest from "../../src-tauri/Cargo.toml?raw";
import nativeSecrets from "../../src-tauri/src/secrets.rs?raw";
import nativeProviders from "../../src-tauri/src/providers.rs?raw";

describe("native credential storage configuration", () => {
  it("enables an explicit native keyring backend for every desktop platform", () => {
    expect(cargoManifest).toMatch(/cfg\(target_os = "windows"\)[\s\S]*?windows-native/);
    expect(cargoManifest).toMatch(/cfg\(target_os = "macos"\)[\s\S]*?apple-native/);
    expect(cargoManifest).toMatch(/cfg\(target_os = "linux"\)[\s\S]*?linux-native/);
  });

  it("verifies the complete bound credential record through a fresh operating-system keyring entry", () => {
    expect(nativeSecrets).toMatch(/set_password\(&encoded\)/);
    expect(nativeSecrets).toMatch(/let verified = entry_for\(credential_id\)\?[\s\S]*?get_password\(\)/);
    expect(nativeSecrets).toMatch(/secure storage verification failed/);
    expect(nativeSecrets).toContain("provider_kind");
    expect(nativeSecrets).toContain("normalized_endpoint");
    expect(nativeSecrets).toContain("CREDENTIAL_BINDING_VERSION");
  });

  it("requires provider calls to resolve secrets through the protected binding", () => {
    expect(nativeProviders).toContain("get_credential_for_binding");
    expect(nativeProviders).not.toMatch(/provider_discover_models[\s\S]{0,500}get_credential\(&request\.credential_id\)/);
    expect(nativeProviders).not.toMatch(/provider_chat[\s\S]{0,500}get_credential\(&request\.credential_id\)/);
  });
});
