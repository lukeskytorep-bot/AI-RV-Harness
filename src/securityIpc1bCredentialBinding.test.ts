import { describe, expect, it } from "vitest";
import buildScript from "../src-tauri/build.rs?raw";
import permissions from "../src-tauri/permissions/main-window.toml?raw";
import nativeProviders from "../src-tauri/src/providers.rs?raw";
import nativeSecrets from "../src-tauri/src/secrets.rs?raw";
import providerNative from "./providers/native.ts?raw";
import providerService from "./providers/service.ts?raw";
import providerSettings from "./components/ProviderSettings.tsx?raw";

function quotedList(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start + marker.length);
  const end = tail.indexOf("]");
  expect(end).toBeGreaterThanOrEqual(0);
  return [...tail.slice(0, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("SECURITY-IPC-1B credential routing boundary", () => {
  it("stores a versioned provider + endpoint binding with the secret in native secure storage", () => {
    expect(nativeSecrets).toContain("CREDENTIAL_BINDING_VERSION");
    expect(nativeSecrets).toContain("credential_id");
    expect(nativeSecrets).toContain("secret");
    expect(nativeSecrets).toContain("provider_kind");
    expect(nativeSecrets).toContain("normalized_endpoint");
    expect(nativeSecrets).toContain("CREDENTIAL_RECORD_PREFIX");
    expect(nativeSecrets).toContain("LegacySecret");
  });

  it("does not authorize provider routing from provider_configs SQLite", () => {
    const nativeBoundary = `${nativeSecrets}\n${nativeProviders}`;
    expect(nativeBoundary).not.toContain("provider_configs");
    expect(nativeProviders).toContain("get_credential_for_binding");
    expect(nativeProviders).toContain("normalized_credential_endpoint");
  });

  it("binds both new credentials and explicit rebinds to the selected provider route", () => {
    expect(providerNative).toContain('invoke("store_credential", { credentialId, secret, provider, baseUrl })');
    expect(providerNative).toContain('invoke("rebind_credential", { credentialId, secret, provider, baseUrl })');
    expect(providerService).toContain("storeCredentialSecret(credentialId, apiKey, input.provider");
    expect(providerService).toContain("rebindProviderCredential");
    expect(providerSettings).toContain("RebindCredentialDialog");
    expect(providerSettings).toContain("config.baseUrl");
  });

  it("keeps both credential commands inside the explicit main-window ACL", () => {
    const appCommands = quotedList(buildScript, "const APP_COMMANDS: &[&str] = &[");
    const allowed = quotedList(permissions, "commands.allow = [");
    expect(appCommands).toContain("store_credential");
    expect(appCommands).toContain("rebind_credential");
    expect(allowed).toContain("store_credential");
    expect(allowed).toContain("rebind_credential");
  });
});
