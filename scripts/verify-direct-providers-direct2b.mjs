import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

const providers = read("src-tauri/src/providers.rs");
const tests = read("src-tauri/src/providers/tests.rs");
const adapters = read("src-tauri/src/providers/adapters.rs");

requireCheck(providers.includes("fn model_discovery_url(provider: ProviderKind, base: &str)"), "DIRECT-2B normalized discovery boundary helper missing");
requireCheck(providers.includes('normalized != "https://api.blackbox.ai"'), "Blackbox discovery boundary must be based on normalized effective endpoint");
requireCheck(providers.includes("Blackbox model discovery is not enabled for this Blackbox route"), "Blackbox route discovery error missing");
requireCheck(providers.includes("current chat API contract does not establish GET /models"), "Blackbox discovery evidence boundary missing");
requireCheck(providers.includes("not evidence that the configured chat route or credential is invalid"), "Blackbox discovery/chat distinction missing");

const discoveryStart = providers.indexOf("pub async fn provider_discover_models");
const discoveryEnd = providers.indexOf("pub async fn provider_discover_model_endpoints", discoveryStart);
const discoveryBody = providers.slice(discoveryStart, discoveryEnd);
const urlResolve = discoveryBody.indexOf("model_discovery_url(");
const credentialRead = discoveryBody.indexOf("secrets::get_credential_for_binding(");
requireCheck(urlResolve >= 0 && credentialRead >= 0 && urlResolve < credentialRead, "Blackbox discovery contract must be resolved before credential access");

requireCheck(tests.includes("direct2b_blackbox_discovery_preserves_legacy_route_but_blocks_unconfirmed_routes"), "DIRECT-2B Blackbox discovery regression missing");
requireCheck(tests.includes('Some("https://api.blackbox.ai")'), "Explicit legacy Blackbox route regression missing");
requireCheck(tests.includes('Some("https://api.blackbox.ai/")'), "Trailing-slash legacy Blackbox route regression missing");
requireCheck(tests.includes('Some("   ")'), "Whitespace Blackbox route regression missing");
requireCheck(tests.includes("https://enterprise.blackbox.ai"), "Enterprise Blackbox route regression missing");
requireCheck(tests.includes("https://example-org.blackbox.ai"), "Organization Blackbox route regression missing");
requireCheck(tests.includes('"https://api.blackbox.ai/models"'), "Legacy Blackbox discovery compatibility assertion missing");
requireCheck(tests.includes("direct2b_discovery_boundary_does_not_change_other_provider_model_urls"), "Other-provider discovery regression missing");
requireCheck(adapters.includes('unwrap_or("https://api.blackbox.ai")'), "DIRECT-2B must not silently migrate the legacy Blackbox base URL");

console.log("DIRECT-2B Blackbox discovery boundary static verification PASS");
