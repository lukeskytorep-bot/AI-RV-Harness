import fs from "node:fs";
function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

const settings = read("src/providers/openRouterSamplingSettings.ts");
const profileDefaults = read("src/profileViewerDefaults.ts");
const profileControls = read("src/features/profiles/ProfileViewerControls.tsx");
const samplingControls = read("src/features/profiles/OpenRouterSamplingControls.tsx");
const profileBuilder = read("src/features/profiles/profileAiConfiguration.ts");
const controller = read("src/features/profiles/useProfileSetupController.ts");
const dialogs = read("src/features/profiles/ProfileDialogs.tsx");
const research = read("src/research/samplingPolicy.ts");
const native = read("src/providers/native.ts");
const rustBuilder = read("src-tauri/src/providers/request_builders.rs");
const rustValidation = read("src-tauri/src/providers/validation.rs");
const rustTests = read("src-tauri/src/providers/tests.rs");
const transportTest = read("src/providers/direct2dBlackboxSampling.test.ts");
const core = read("src/i18n/core.ts");

requireCheck(settings.includes('provider === "blackbox"'), "DIRECT-2D profile sampling provider gate missing Blackbox");
requireCheck(profileDefaults.includes('model.provider === "blackbox"'), "DIRECT-2D profile defaults do not carry Blackbox sampling");
requireCheck(profileControls.includes('providerKind === "blackbox"'), "DIRECT-2D sampling controls are not exposed for Blackbox");
requireCheck(samplingControls.includes('const blackboxDirect = providerKind === "blackbox"'), "DIRECT-2D Blackbox UI evidence caveat branch missing");
requireCheck(samplingControls.includes('copy.samplingBlackboxRuntimeLead'), "DIRECT-2D Blackbox runtime caveat is not surfaced");
requireCheck(profileBuilder.includes('provider.provider === "blackbox"'), "DIRECT-2D profile builder path missing Blackbox");
requireCheck(controller.includes('selectedProvider?.provider === "blackbox"'), "DIRECT-2D Create Profile path missing Blackbox sampling");
requireCheck(dialogs.includes('provider?.provider === "blackbox"'), "DIRECT-2D Edit Profile path missing Blackbox sampling");
requireCheck(research.includes('model.provider === "blackbox"') && research.includes('provider !== "blackbox"'), "DIRECT-2D Research sampling path missing Blackbox");
for (const field of ["topP", "topK", "seed"]) {
  requireCheck(native.includes('input.config.provider === "blackbox"') && native.includes(`input.settings.effective.${field}`), `DIRECT-2D Blackbox IPC ${field} transport missing`);
}
requireCheck(rustValidation.includes('ProviderKind::Blackbox'), "DIRECT-2D Rust sampling validation does not allow Blackbox");
requireCheck(rustBuilder.includes('ProviderKind::Blackbox'), "DIRECT-2D request builder does not allow Blackbox sampling");
requireCheck(rustTests.includes('fn direct2d_emits_blackbox_sampling_with_native_wire_names_without_openrouter_routing()'), "DIRECT-2D final JSON Rust regression missing");
requireCheck(rustTests.includes('fn direct2d_blackbox_auto_omits_all_optional_sampling_fields()'), "DIRECT-2D Auto omission Rust regression missing");
requireCheck(transportTest.includes('provider: "blackbox"') && transportTest.includes('topP: 0.7') && transportTest.includes('topK: 100') && transportTest.includes('seed: 42'), "DIRECT-2D TS IPC regression missing sampling triplet");
requireCheck(core.match(/samplingBlackboxRuntimeLead:/g)?.length === 2, "DIRECT-2D Blackbox runtime caveat must exist in EN and PL");
requireCheck(!rustTests.match(/direct2d_emits_blackbox[\s\S]{0,1200}require_parameters/), "DIRECT-2D must not synthesize Blackbox require_parameters routing");
requireCheck(rustTests.includes('assert!(body.get("provider").is_none()'), "DIRECT-2D regression must guard against OpenRouter provider object leakage");

console.log("DIRECT-2D Blackbox sampling static verification PASS");
console.log("No paid/live Blackbox API calls were performed by this verifier.");
