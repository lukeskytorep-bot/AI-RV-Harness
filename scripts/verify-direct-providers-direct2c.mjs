import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

const service = read("src/providers/service.ts");
const controller = read("src/features/profiles/useProfileSetupController.ts");
const dialogs = read("src/features/profiles/ProfileDialogs.tsx");
const app = read("src/App.tsx");
const core = read("src/i18n/core.ts");

requireCheck(service.includes('return endpoint !== "https://api.blackbox.ai";'), "DIRECT-2C must preserve the legacy discovery route boundary");
requireCheck(service.includes('source: "manual_model_id"'), "DIRECT-2C manual records must be evidence-labeled");
requireCheck(service.includes('discoveryVerified: false'), "DIRECT-2C must not claim discovery verification");
requireCheck(service.includes('capabilitiesVerified: false'), "DIRECT-2C must not claim capability verification");
requireCheck(service.includes('supportsStreaming: false'), "DIRECT-2C must keep streaming disabled for manual Blackbox models");
requireCheck(service.includes('supportedParameters: []'), "DIRECT-2C must not invent sampler/reasoning capabilities");
requireCheck(service.includes('await hasCredentialSecret(config.credentialId)'), "DIRECT-2C must require the bound credential to exist");
requireCheck(controller.includes('registerManualBlackboxModel(repository, provider, blackboxManualModelId)'), "DIRECT-2C controller must use the shared manual registration service");
requireCheck(controller.includes('await refreshProviderModels(repository, provider);'), "DIRECT-2C must preserve normal discovery for supported routes");
requireCheck(dialogs.includes('copy.blackboxManualModelId') && app.includes('copy.blackboxManualModelId'), "DIRECT-2C must expose manual model entry in Create Profile and First Run");
requireCheck(core.match(/blackboxManualModelId:/g)?.length === 2, "DIRECT-2C labels must exist in EN and PL");
requireCheck(!service.includes('supportsStreaming: true'), "DIRECT-2C service must not mark manual Blackbox models streaming-capable");

console.log("DIRECT-2C Blackbox manual model verification PASS");
