import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] ?? '.');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

const adapters = read('src-tauri/src/providers/adapters.rs');
const builders = read('src-tauri/src/providers/request_builders.rs');
const validation = read('src-tauri/src/providers/validation.rs');
const reasoning = read('src-tauri/src/providers/reasoning.rs');
const contract = JSON.parse(read('src/providers/direct-compat-fixtures/direct-provider-contract-baseline.json'));
const mistralFixture = JSON.parse(read('src/providers/direct-compat-fixtures/mistral-nested-thinking-response.json'));

const expectedBases = {
  openai: 'https://api.openai.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  deepseek: 'https://api.deepseek.com',
  blackbox: 'https://api.blackbox.ai',
};
for (const [provider, base] of Object.entries(expectedBases)) {
  requireCheck(contract.providers[provider].baseUrlInHarness === base, `fixture base mismatch: ${provider}`);
  requireCheck(adapters.includes(`Some("${base}")`), `Harness base missing: ${provider} -> ${base}`);
}

requireCheck(
  builders.includes('matches!(request.provider, ProviderKind::Openrouter | ProviderKind::CustomOpenai)'),
  'manual sampling gate is no longer limited to OpenRouter/Custom OpenAI-compatible',
);
requireCheck(
  validation.includes('supported only for OpenRouter or Custom OpenAI-compatible requests'),
  'validation no longer characterizes the current additional-sampling gate',
);
requireCheck(builders.includes('ProviderKind::Openrouter | ProviderKind::Openai => "max_completion_tokens"'), 'OpenAI token field baseline changed');
requireCheck(builders.includes('ProviderKind::Zai | ProviderKind::Deepseek | ProviderKind::Mistral | ProviderKind::Blackbox => "max_tokens"'), 'direct token field baseline changed');

const parts = mistralFixture?.choices?.[0]?.message?.content;
requireCheck(Array.isArray(parts), 'Mistral nested-thinking fixture content must be an array');
requireCheck(parts[0]?.type === 'thinking' && Array.isArray(parts[0]?.thinking), 'Mistral fixture must retain nested thinking array');
requireCheck(parts[1]?.type === 'text' && parts[1]?.text === 'final', 'Mistral fixture final text changed');
// DIRECT-0 freezes the fixture and pre-change contract. Later stages may intentionally
// fix the parser, so this historical verifier must not require the characterized bug.
requireCheck(
  reasoning.includes('fn extract_embedded_reasoning'),
  'reasoning parser entry point missing; re-audit direct-provider characterization',
);

console.log('DIRECT-0 static evidence verification PASS');
console.log('No paid/live provider API calls were performed by this verifier.');
