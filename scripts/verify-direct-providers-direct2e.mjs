import fs from "node:fs";
function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

const providers = read("src-tauri/src/providers.rs");
const streaming = read("src-tauri/src/providers/streaming.rs");
const builders = read("src-tauri/src/providers/request_builders.rs");
const tests = read("src-tauri/src/providers/tests.rs");

requireCheck(providers.includes("let use_blackbox_streaming = matches!(request.provider, ProviderKind::Blackbox);"), "DIRECT-2E Blackbox streaming dispatch gate missing");
requireCheck(providers.includes("send_blackbox_streaming_chat_request("), "DIRECT-2E Blackbox streaming sender not wired");
requireCheck(streaming.includes("Blackbox,"), "DIRECT-2E dedicated Blackbox streaming flavor missing");
requireCheck(streaming.includes("StreamingFlavor::Blackbox => OpenRouterStreamAccumulator::blackbox()"), "DIRECT-2E Blackbox accumulator selection missing");
requireCheck(streaming.includes("send_streaming_chat_request(builder, request_id, secret, policy, on_stream, StreamingFlavor::Blackbox)"), "DIRECT-2E Blackbox sender does not reuse bounded SSE transport");
requireCheck(builders.includes('object.insert("stream".into(), Value::Bool(true));'), "DIRECT-2E shared stream=true request helper missing");
requireCheck(!providers.match(/use_blackbox_streaming[\s\S]{0,800}stream_options/), "DIRECT-2E must not synthesize stream_options for Blackbox");
requireCheck(tests.includes("direct2e_blackbox_stream_sends_stream_true_and_reconstructs_reasoning_usage_and_provider"), "DIRECT-2E primary Blackbox SSE regression missing");
requireCheck(tests.includes("direct2e_blackbox_stream_accepts_done_without_usage"), "DIRECT-2E no-usage Blackbox SSE regression missing");
requireCheck(tests.includes("direct2e_blackbox_stream_rejects_eof_without_done_after_output"), "DIRECT-2E EOF-before-DONE regression missing");
requireCheck(tests.includes("direct2e_blackbox_stream_surfaces_choice_error_before_output"), "DIRECT-2E Blackbox choice.error before-output regression missing");
requireCheck(tests.includes("direct2e_blackbox_stream_surfaces_choice_error_after_output"), "DIRECT-2E Blackbox choice.error after-output regression missing");
requireCheck(streaming.includes('choice.get("error").filter(|value| !value.is_null())'), "DIRECT-2E Blackbox nested choice.error handling missing");
requireCheck(streaming.includes('object.insert("error".to_string(), choice_error.clone())'), "DIRECT-2E Blackbox choice.error normalization missing");
for (const field of ['top_p', 'top_k', 'seed']) {
  requireCheck(tests.includes(`json.get(\"${field}\")`), `DIRECT-2E must preserve DIRECT-2D ${field} wire field in streaming request`);
}
requireCheck(tests.includes('assert!(json.get("provider").is_none()'), "DIRECT-2E must not synthesize Blackbox routing provider object");
requireCheck(tests.includes('assert!(json.get("stream_options").is_none()'), "DIRECT-2E regression must guard against undocumented stream_options");

console.log("DIRECT-2E Blackbox SSE static verification PASS");
console.log("No paid/live Blackbox API calls were performed by this verifier.");
