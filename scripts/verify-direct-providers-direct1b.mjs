import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] ?? '.');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const exists = (relative) => fs.existsSync(path.join(root, relative));
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

const contract = read('src/providers/continuationContract.ts');
const mistral = read('src/providers/mistralContinuation.ts');
const sessionBridge = read('src/sessions/providerContinuation.ts');
const sessionTypes = read('src/sessions/types.ts');
const chatMemory = read('src/chat/continuationMemory.ts');
const chatEngine = read('src/chat/engine.ts');
const rustTypes = read('src-tauri/src/providers.rs');
const rustValidation = read('src-tauri/src/providers/validation.rs');
const rustBuilder = read('src-tauri/src/providers/request_builders.rs');
const rustParser = read('src-tauri/src/providers/response_parsers.rs');
const rustTests = read('src-tauri/src/providers/tests.rs');
const fixture = json('src/providers/continuation-fixtures/mistral-assistant-content.json');

requireCheck(fixture?.providerResponse?.choices?.[0]?.message?.content?.[0]?.type === 'thinking', 'Mistral replay fixture is missing thinking chunk');
requireCheck(fixture?.providerResponse?.choices?.[0]?.message?.content?.[1]?.text === 'final', 'Mistral replay fixture visible final changed');
requireCheck(JSON.stringify(fixture.continuationState.content) === JSON.stringify(fixture.nextRequest.messages[1].content), 'Mistral fixture must replay the exact captured assistant content array');

requireCheck(contract.includes('"mistral-native"'), 'TypeScript continuation contract lacks mistral-native transport');
requireCheck(contract.includes('format: "mistral-assistant-content"'), 'TypeScript continuation contract lacks Mistral state format');
requireCheck(mistral.includes('captureMistralContinuationState'), 'Mistral capture helper is missing');
requireCheck(mistral.includes('validateMistralReplayForRequest'), 'Mistral replay validator is missing');
requireCheck(sessionTypes.includes('transport: "mistral-native"'), 'Session snapshot does not freeze Mistral continuation route');
requireCheck(sessionBridge.includes('MISTRAL_ENDPOINT = "https://api.mistral.ai/v1"'), 'Session bridge does not bind the official Mistral endpoint');
requireCheck(sessionBridge.includes('captureMistralContinuationState'), 'Session bridge does not capture Mistral continuation state');
requireCheck(sessionBridge.includes('validateMistralReplayForRequest'), 'Session bridge does not hydrate/revalidate Mistral continuation state');
requireCheck(chatMemory.includes('entry.state.transport === "mistral-native"'), 'Conversation continuation memory does not replay Mistral state');
requireCheck(chatEngine.includes('["openrouter", "google", "mistral"]'), 'Conversation engine does not activate Mistral continuation persistence');
requireCheck(chatEngine.includes('captureMistralContinuationState'), 'Conversation engine does not capture Mistral continuation state');

requireCheck(rustTypes.includes('Mistral(MistralContinuationState)'), 'Rust continuation enum lacks Mistral state');
requireCheck(rustTypes.includes('struct MistralContinuationState'), 'Rust Mistral continuation struct is missing');
requireCheck(rustValidation.includes('ProviderContinuationState::Mistral(state)'), 'Rust replay validation lacks Mistral branch');
requireCheck(rustValidation.includes('Mistral continuation chunks do not match the bound assistant message content'), 'Rust replay validation does not bind visible content');
requireCheck(rustBuilder.includes('ProviderContinuationState::Mistral(state)'), 'Rust request builder does not replay Mistral content chunks');
requireCheck(rustParser.includes('let mistral_content = matches!(provider, ProviderKind::Mistral)'), 'Rust parser does not preserve complete Mistral assistant content');
requireCheck(rustTests.includes('direct1b_replays_complete_mistral_assistant_content_on_bound_message'), 'Rust DIRECT-1B replay regression test is missing');
requireCheck(rustTests.includes('direct1b_rejects_mistral_replay_when_visible_text_or_fingerprint_changes'), 'Rust DIRECT-1B fail-closed regression test is missing');

// DIRECT-0 correction: evidence-only files must no longer be part of the application source package.
requireCheck(!exists('docs/audits/direct-providers/AI_RV_HARNESS_DIRECT_0_REPORT_PL.md'), 'DIRECT-0 report should be external evidence, not application source');
requireCheck(!exists('scripts/verify-direct-providers-direct0.mjs'), 'DIRECT-0 evidence verifier should not remain in application source');
requireCheck(!exists('src/providers/direct-compat-fixtures/direct-provider-contract-baseline.json'), 'DIRECT-0 baseline fixture should not remain in application source');

// DIRECT-1B is replay only. Samplers and direct SSE remain for later substeps.
requireCheck(!rustBuilder.includes('ProviderKind::Mistral => "random_seed"'), 'DIRECT-1B must not add Mistral random_seed transport yet');
requireCheck(!rustBuilder.includes('ProviderKind::Mistral | ProviderKind::Openrouter | ProviderKind::CustomOpenai'), 'DIRECT-1B must not broaden sampling gates');

console.log('DIRECT-1B Mistral native replay static verification PASS');
console.log('DIRECT-0 evidence/source packaging correction PASS');
console.log('No paid/live provider API calls were performed by this verifier.');
