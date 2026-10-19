import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] ?? '.');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

const reasoning = read('src-tauri/src/providers/reasoning.rs');
const parsers = read('src-tauri/src/providers/response_parsers.rs');
const tests = read('src-tauri/src/providers/tests.rs');
const builders = read('src-tauri/src/providers/request_builders.rs');
const validation = read('src-tauri/src/providers/validation.rs');
const single = json('src/providers/direct-compat-fixtures/mistral-nested-thinking-response.json');
const multi = json('src/providers/direct-compat-fixtures/mistral-nested-thinking-multi-response.json');

const singleParts = single?.choices?.[0]?.message?.content;
requireCheck(Array.isArray(singleParts), 'single Mistral fixture must contain content parts');
requireCheck(Array.isArray(singleParts[0]?.thinking), 'single Mistral fixture must contain nested thinking array');
requireCheck(singleParts[0].thinking[0]?.text === 'reasoning', 'single Mistral fixture reasoning changed');
requireCheck(singleParts[1]?.text === 'final', 'single Mistral fixture final changed');

const multiParts = multi?.choices?.[0]?.message?.content;
requireCheck(Array.isArray(multiParts?.[0]?.thinking) && multiParts[0].thinking.length === 2, 'multi Mistral fixture must retain ordered nested thinking items');
requireCheck(multiParts[1]?.text === 'visible thinking word stays final', 'multi Mistral visible final changed');

requireCheck(
  reasoning.includes('let thinking = extract_reasoning_text(part.get("thinking"));'),
  'DIRECT-1A nested Mistral thinking extraction is missing',
);
requireCheck(
  parsers.includes('Some("mistral_thinking".to_string())'),
  'DIRECT-1A Mistral reasoning source marker is missing',
);
requireCheck(
  tests.includes('direct1a_extracts_mistral_nested_thinking_from_fixture_without_leaking_it_into_final'),
  'DIRECT-1A primary Rust regression test is missing',
);
requireCheck(
  tests.includes('direct1a_extracts_multiple_nested_mistral_thinking_text_items_in_order'),
  'DIRECT-1A ordered nested-thinking Rust regression test is missing',
);

// This verifier is phase-local: later DIRECT-1 substeps may intentionally broaden
// Mistral transport. DIRECT-1A only freezes parser/fixture invariants.

console.log('DIRECT-1A Mistral parser static verification PASS');
console.log('No paid/live provider API calls were performed by this verifier.');
