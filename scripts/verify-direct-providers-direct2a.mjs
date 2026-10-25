import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

// This verifier inspects source-code string literals, not network URLs.
function containsStringLiteral(source, value) {
  const expected = JSON.stringify(value);
  return Array.from(source.matchAll(/"(?:[^"\\]|\\.)*"/g), ([literal]) => literal)
    .some((literal) => literal === expected);
}


const adapters = read("src-tauri/src/providers/adapters.rs");
const tests = read("src-tauri/src/providers/tests.rs");
const service = read("src/providers/service.ts");
const settings = read("src/components/ProviderSettings.tsx");
const setup = read("src/features/profiles/useProfileSetupController.ts");
const firstRun = read("src/App.tsx");
const profileDialogs = read("src/features/profiles/ProfileDialogs.tsx");

requireCheck(adapters.includes('ProviderKind::Blackbox => return blackbox_base_url(custom)'), "Blackbox custom route is not wired into provider_base_url");
requireCheck(adapters.includes('unwrap_or("https://api.blackbox.ai")'), "Legacy Blackbox default was not preserved");
requireCheck(adapters.includes('host != "blackbox.ai" && !host.ends_with(".blackbox.ai")'), "Blackbox override host boundary missing");
requireCheck(adapters.includes('Blackbox base URL must be an origin without an API path'), "Blackbox origin-only boundary missing");
requireCheck(service.includes('input.provider !== "custom_openai" && input.provider !== "blackbox"'), "Frontend provider service does not limit base URL overrides to Blackbox/Custom");
requireCheck(settings.includes('provider === "custom_openai" || provider === "blackbox"'), "Provider Settings does not expose Blackbox route input");
requireCheck(containsStringLiteral(settings, "https://enterprise.blackbox.ai"), "Enterprise Blackbox route hint missing");
requireCheck(setup.includes('providerKind === "custom_openai" || providerKind === "blackbox"'), "Profile setup does not persist explicit Blackbox route");
requireCheck(setup.includes('setBaseUrl("")'), "Provider switch does not clear stale endpoint input");
requireCheck(firstRun.includes('setup.providerKind === "custom_openai" || setup.providerKind === "blackbox"'), "First-run setup does not expose Blackbox route input");
requireCheck(profileDialogs.includes('setup.providerKind === "custom_openai" || setup.providerKind === "blackbox"'), "Profile dialog does not expose Blackbox route input");
requireCheck(tests.includes('direct2a_blackbox_preserves_legacy_default_but_accepts_explicit_blackbox_routes'), "Blackbox route regression missing");
requireCheck(tests.includes('direct2a_blackbox_rejects_non_blackbox_or_path_bearing_overrides'), "Blackbox route rejection regression missing");
requireCheck(!adapters.includes('ProviderKind::Blackbox => Some("https://enterprise.blackbox.ai")'), "Blackbox endpoint was silently migrated to Enterprise");

console.log("DIRECT-2A Blackbox route identity static verification PASS");
