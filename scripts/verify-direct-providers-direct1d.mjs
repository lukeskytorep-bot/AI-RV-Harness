import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function requireCheck(condition, message) { if (!condition) throw new Error(message); }

const providers = read("src-tauri/src/providers.rs");
const builders = read("src-tauri/src/providers/request_builders.rs");
const streaming = read("src-tauri/src/providers/streaming.rs");
const tests = read("src-tauri/src/providers/tests.rs");

requireCheck(providers.includes("let use_mistral_streaming = matches!(request.provider, ProviderKind::Mistral)"), "Mistral direct SSE dispatch gate missing");
requireCheck(providers.includes("enable_mistral_chat_streaming(&mut body)"), "Mistral SSE request builder not selected");
requireCheck(providers.includes("send_mistral_streaming_chat_request("), "Mistral SSE transport not dispatched");
requireCheck(builders.includes('object.insert("stream".into(), Value::Bool(true))'), "stream=true missing");
requireCheck(!builders.includes('object.insert("stream_options".into(), json!({ "include_usage": true }))'), "Mistral must not send OpenAI stream_options");
requireCheck(streaming.includes("StreamingFlavor::Mistral"), "Mistral streaming flavor missing");
requireCheck(streaming.includes("ingest_mistral_content"), "Mistral delta content reconstruction missing");
requireCheck(streaming.includes("Mistral thinking chunk must contain a thinking array"), "Mistral thinking shape validation missing");
requireCheck(streaming.includes("self.mistral_saw_thinking"), "Mistral thinking state missing");
requireCheck(streaming.includes('message.insert("content".into(), Value::Array(self.mistral_content.clone()))'), "Mistral replayable assistant content is not reconstructed");
requireCheck(streaming.includes('"provider streaming response ended before [DONE]"'), "Abrupt EOF fail-closed boundary missing");
requireCheck(streaming.includes("provider streaming idle timeout elapsed") && streaming.includes("provider first-event timeout elapsed"), "Streaming timeout guards missing");
requireCheck(tests.includes("direct1d_enables_mistral_sse_without_openai_stream_options_and_keeps_sampling_wire_fields"), "Mistral stream request regression missing");
requireCheck(tests.includes("direct1d_mistral_stream_reconstructs_thinking_final_usage_and_replay_content"), "Mistral thinking/final/usage regression missing");
requireCheck(tests.includes("direct1d_mistral_stream_accepts_done_without_usage"), "Mistral no-usage [DONE] regression missing");
requireCheck(tests.includes('assert!(json.get("stream_options").is_none())'), "Mistral request must assert absence of stream_options");
requireCheck(tests.includes("direct1d_mistral_stream_rejects_eof_without_done_after_reasoning"), "Mistral abrupt EOF regression missing");
requireCheck(tests.includes('assert_eq!(parsed.reasoning_source.as_deref(), Some("mistral_thinking"))'), "Mistral reasoning source regression missing");
requireCheck(tests.includes('assert_eq!(body.get("random_seed"), Some(&json!(42)))') && tests.includes('assert!(body.get("seed").is_none())'), "DIRECT-1C random_seed boundary not retained");

console.log("DIRECT-1D Mistral SSE static verification PASS");
