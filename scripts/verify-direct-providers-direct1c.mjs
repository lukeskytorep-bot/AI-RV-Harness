import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

const native = read("src/providers/native.ts");
const settings = read("src/providers/openRouterSamplingSettings.ts");
const profileDefaults = read("src/profileViewerDefaults.ts");
const profileControls = read("src/features/profiles/ProfileViewerControls.tsx");
const samplingControls = read("src/features/profiles/OpenRouterSamplingControls.tsx");
const profileBuilder = read("src/features/profiles/profileAiConfiguration.ts");
const samplingPolicy = read("src/research/samplingPolicy.ts");
const rustBuilder = read("src-tauri/src/providers/request_builders.rs");
const rustValidation = read("src-tauri/src/providers/validation.rs");
const rustTests = read("src-tauri/src/providers/tests.rs");
const tsTransportTest = read("src/providers/direct1cMistralSampling.test.ts");

requireCheck(settings.includes('provider === "openrouter" || provider === "custom_openai" || provider === "mistral"'), "Mistral profile sampling provider gate missing");
requireCheck(profileDefaults.includes('model.provider === "openrouter" || model.provider === "custom_openai" || model.provider === "mistral"'), "Mistral profile defaults do not carry sampling");
requireCheck(profileControls.includes('providerKind === "openrouter" || providerKind === "custom_openai" || providerKind === "mistral"'), "Mistral sampling controls not exposed");
requireCheck(samplingControls.includes('const mistralDirect = providerKind === "mistral"'), "Mistral sampling UI caveat branch missing");
requireCheck(profileBuilder.includes('provider.provider === "openrouter" || provider.provider === "custom_openai" || provider.provider === "mistral"'), "Mistral profile builder sampling path missing");
requireCheck(samplingPolicy.includes('model.provider === "custom_openai" || model.provider === "mistral"'), "Research Mistral sampling capability path missing");
requireCheck(samplingPolicy.includes('provider !== "openrouter" && provider !== "custom_openai" && provider !== "mistral"'), "Research Mistral stored sampling path missing");
for (const field of ["topP", "topK", "seed"]) {
  requireCheck(native.includes(`input.config.provider === "mistral") && input.settings.effective.${field}`) || native.includes(`input.config.provider === "custom_openai" || input.config.provider === "mistral") && input.settings.effective.${field}`), `Mistral IPC ${field} transport missing`);
}
requireCheck(rustValidation.includes('ProviderKind::CustomOpenai | super::ProviderKind::Mistral'), "Rust sampling validation does not allow Mistral");
requireCheck(rustBuilder.includes('ProviderKind::CustomOpenai | ProviderKind::Mistral'), "Rust request builder does not allow Mistral sampling");
requireCheck(rustBuilder.includes('ProviderKind::Mistral) { "random_seed" } else { "seed" }'), "Mistral seed -> random_seed translation missing");
requireCheck(rustTests.includes('fn direct1c_emits_mistral_sampling_with_random_seed_wire_name()'), "Rust final JSON regression missing");
requireCheck(rustTests.includes('assert!(body.get("seed").is_none()'), "Rust regression does not guard against seed leakage");
requireCheck(tsTransportTest.includes('provider: "mistral"'), "TS IPC regression missing Mistral provider");
requireCheck(tsTransportTest.includes('topP: 0.7') && tsTransportTest.includes('topK: 100') && tsTransportTest.includes('seed: 42'), "TS IPC regression missing sampling triplet");
requireCheck(!rustBuilder.match(/ProviderKind::Mistral[^\n]{0,250}body\.insert\("seed"/), "Mistral appears to emit raw seed wire name");
requireCheck(!rustBuilder.includes('ProviderKind::Mistral | ProviderKind::Openrouter') || !rustBuilder.includes('require_parameters'), "Mistral must not share OpenRouter routing contract");

console.log("DIRECT-1C Mistral sampling static verification PASS");
