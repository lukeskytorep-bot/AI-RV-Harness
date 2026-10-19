use super::*;
use super::adapters::{normalized_credential_endpoint, provider_family, validate_base_url, ProviderFamily};

#[test]
fn openrouter_requests_omit_application_identity_and_keep_authentication() {
    let request = authenticated(
        client().unwrap().post("https://openrouter.ai/api/v1/chat/completions"),
        ProviderKind::Openrouter,
        "simulator-secret",
    ).build().unwrap();
    assert_eq!(request.headers().get("authorization").unwrap().to_str().unwrap(), "Bearer simulator-secret");
    for header in ["http-referer", "referer", "x-title", "x-openrouter-title", "user-agent"] {
        assert!(request.headers().get(header).is_none(), "unexpected identifying header: {header}");
    }
}
use super::reasoning::split_tagged_reasoning;
use super::endpoint_capabilities::openrouter_model_endpoints_url;
use super::errors::safe_provider_error;
use super::request_builders::{build_anthropic_request, build_google_request, build_openai_compatible_request, enable_chat_streaming, enable_mistral_chat_streaming};
use super::response_parsers::{parse_anthropic_response, parse_google_response, parse_openai_compatible_response};
use super::streaming::{
    send_custom_openai_streaming_chat_request, send_mistral_streaming_chat_request, send_openrouter_streaming_chat_request, OpenRouterStreamAccumulator, ProviderStreamEvent, SseDecoder, SseFrame,
    MAX_ACCUMULATED_STREAM_DATA_BYTES, MAX_PENDING_SSE_EVENT_BYTES,
};
use super::transport::retry_after_value_ms_at;
use super::validation::{validate_chat_request, validate_continuation_bindings, validate_openrouter_reasoning_detail, validate_request_id};

use std::time::{Duration, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::{TcpListener, TcpStream}};

async fn read_simulator_request(socket: &mut TcpStream) -> String {
    let mut request = Vec::new();
    loop {
        let mut chunk = [0u8; 2048];
        let read = socket.read(&mut chunk).await.unwrap();
        if read == 0 { break; }
        request.extend_from_slice(&chunk[..read]);
        if let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&request[..header_end + 4]);
            let content_length = headers.lines()
                .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(str::trim).and_then(|value| value.parse::<usize>().ok()))
                .unwrap_or(0);
            if request.len() >= header_end + 4 + content_length { break; }
        }
    }
    String::from_utf8(request).unwrap()
}

fn chat_request(provider: ProviderKind, model_id: &str) -> ProviderChatRequest {
    ProviderChatRequest {
        workflow_ownership: None,
        provider,
        credential_id: "credential".to_string(),
        provider_config_id: "provider-config".to_string(),
        base_url: None,
        request_id: None,
        model_id: model_id.to_string(),
        messages: vec![ProviderMessage {
            role: "user".to_string(),
            content: "test".to_string(),
            images: vec![],
            continuation_state: None,
        }],
        reasoning_effort: None,
        reasoning_max_tokens: None,
        reasoning_transport_kind: None,
        reasoning_transport_value: None,
        temperature: None,
        top_p: None,
        top_k: None,
        seed: None,
        max_output_tokens: None,
        custom_output_token_field: None,
        custom_streaming_enabled: false,
        timeout_ms: None,
        timeout_policy: None,
        provider_routing: None,
        detailed_diagnostics: false,
    }
}


#[test]
fn enables_openrouter_sse_and_usage_frames_without_changing_other_request_fields() {
    let request = chat_request(ProviderKind::Openrouter, "qwen/qwen3-32b");
    let (_, mut body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    enable_chat_streaming(&mut body).unwrap();
    assert_eq!(body.get("stream"), Some(&json!(true)));
    assert!(body.get("stream_options").is_none());
    assert_eq!(body.get("model"), Some(&json!("qwen/qwen3-32b")));
}


#[test]
fn direct1d_enables_mistral_sse_without_openai_stream_options_and_keeps_sampling_wire_fields() {
    let mut request = chat_request(ProviderKind::Mistral, "mistral-medium-3-5");
    request.top_p = Some(0.4);
    request.top_k = Some(20);
    request.seed = Some(42);
    let (_, mut body) = build_openai_compatible_request(&request, "https://api.mistral.ai/v1");
    enable_mistral_chat_streaming(&mut body).unwrap();
    assert_eq!(body.get("stream"), Some(&json!(true)));
    assert!(body.get("stream_options").is_none());
    assert_eq!(body.get("top_p"), Some(&json!(0.4)));
    assert_eq!(body.get("top_k"), Some(&json!(20)));
    assert_eq!(body.get("random_seed"), Some(&json!(42)));
    assert!(body.get("seed").is_none());
}

#[test]
fn provider_families_keep_special_wire_formats_isolated() {
    assert_eq!(provider_family(ProviderKind::Google), ProviderFamily::Google);
    assert_eq!(provider_family(ProviderKind::Anthropic), ProviderFamily::Anthropic);
    for provider in [
        ProviderKind::Openrouter,
        ProviderKind::Openai,
        ProviderKind::Zai,
        ProviderKind::Deepseek,
        ProviderKind::Mistral,
        ProviderKind::Blackbox,
        ProviderKind::CustomOpenai,
    ] {
        assert_eq!(provider_family(provider), ProviderFamily::OpenaiCompatible);
    }
}

#[test]
fn rejects_remote_plain_http_custom_endpoint() {
    assert!(validate_base_url("http://example.com/v1").is_err());
    assert!(validate_base_url("http://127.0.0.1:8080/v1").is_ok());
    assert!(validate_base_url("https://example.com/v1").is_ok());
}

#[test]
fn credential_binding_uses_canonical_provider_and_endpoint_identity() {
    assert_eq!(ProviderKind::parse_binding_kind("openrouter").unwrap().binding_kind(), "openrouter");
    assert!(ProviderKind::parse_binding_kind("unknown-provider").is_err());
    assert_eq!(
        normalized_credential_endpoint("HTTPS://EXAMPLE.COM:443/v1///").unwrap(),
        "https://example.com/v1",
    );
}

#[test]
fn exposes_the_same_normalized_endpoint_used_by_credential_binding() {
    assert_eq!(
        provider_binding_endpoint("openrouter".to_string(), None).unwrap(),
        "https://openrouter.ai/api/v1",
    );
    assert_eq!(
        provider_binding_endpoint("custom_openai".to_string(), Some("HTTPS://EXAMPLE.COM:443/v1///".to_string())).unwrap(),
        "https://example.com/v1",
    );
}

#[test]
fn provider_errors_redact_secret() {
    let error = safe_provider_error(reqwest::StatusCode::UNAUTHORIZED, "bad sk-secret", "sk-secret", None);
    assert!(!error.contains("sk-secret"));
}

#[test]
fn provider_call_error_stays_compact_and_serializes_compatibly() {
    assert!(std::mem::size_of::<ProviderCallError>() < 128);
    let mut error = ProviderCallError::new("timeout", "request timed out", "awaiting_headers");
    error.metadata.http_status = Some(504);
    error.metadata.provider_error_type = Some("upstream_timeout".into());
    error.metadata.provider_code = Some("gateway_timeout".into());
    error.metadata.retry_after_ms = Some(1_000);
    error.metadata.provider_request_id = Some("request-1".into());

    assert_eq!(serde_json::to_value(error).unwrap(), json!({
        "code": "timeout",
        "message": "request timed out",
        "phase": "awaiting_headers",
        "httpStatus": 504,
        "providerErrorType": "upstream_timeout",
        "providerCode": "gateway_timeout",
        "retryAfterMs": 1_000,
        "providerRequestId": "request-1"
    }));
}

#[test]
fn debug_payload_redacts_secret_and_binary_data() {
    let mut value = json!({
        "authorization": "Bearer sk-secret",
        "prompt": "do not echo sk-secret",
        "reasoning_details": [{ "type": "reasoning.encrypted", "data": "opaque-private-state" }],
        "googleVisiblePart": { "text": "visible answer", "thoughtSignature": "private-google-signature" },
        "googleThoughtPart": { "text": "private hidden thought", "thought": true, "thoughtSignature": "private-thought-signature" },
        "anthropicThinking": { "type": "thinking", "thinking": "private anthropic thinking", "signature": "private-anthropic-signature" },
        "anthropicRedacted": { "type": "redacted_thinking", "data": "private-redacted-thinking" },
        "inlineData": { "data": "A".repeat(300) }
    });
    scrub_debug_value(&mut value, "sk-secret", None);
    let wire = value.to_string();
    assert!(!wire.contains("sk-secret"));
    assert!(!wire.contains("opaque-private-state"));
    assert!(!wire.contains("private-google-signature"));
    assert!(!wire.contains("private-thought-signature"));
    assert!(!wire.contains("private hidden thought"));
    assert!(!wire.contains("private anthropic thinking"));
    assert!(!wire.contains("private-anthropic-signature"));
    assert!(!wire.contains("private-redacted-thinking"));
    assert!(wire.contains("visible answer"));
    assert!(wire.contains("CONTINUATION STATE REDACTED"));
    assert!(wire.contains("BINARY REDACTED"));
}

#[test]
fn validates_provider_cancellation_ids() {
    assert!(validate_request_id("8f3127e0-844a-4f27-aada-6f14641e67e1").is_ok());
    assert!(validate_request_id("../../escape").is_err());
}

#[test]
fn maps_output_token_limit_by_transport_contract() {
    for provider in [ProviderKind::Openrouter, ProviderKind::Openai] {
        let mut request = chat_request(provider, "model");
        request.max_output_tokens = Some(1234);
        let (_, body) = build_openai_compatible_request(&request, "https://example.test/v1");
        assert_eq!(body.get("max_completion_tokens"), Some(&json!(1234)));
        assert!(body.get("max_tokens").is_none());
    }

    for provider in [
        ProviderKind::Zai,
        ProviderKind::Deepseek,
        ProviderKind::Mistral,
        ProviderKind::Blackbox,
    ] {
        let mut request = chat_request(provider, "model");
        request.max_output_tokens = Some(2345);
        let (_, body) = build_openai_compatible_request(&request, "https://example.test/v1");
        assert_eq!(body.get("max_tokens"), Some(&json!(2345)));
        assert!(body.get("max_completion_tokens").is_none());
    }

    let mut custom_default = chat_request(ProviderKind::CustomOpenai, "model");
    custom_default.max_output_tokens = Some(2345);
    let (_, body) = build_openai_compatible_request(&custom_default, "https://example.test/v1");
    assert_eq!(body.get("max_tokens"), Some(&json!(2345)));
    assert!(body.get("max_completion_tokens").is_none());

    let mut custom_override = chat_request(ProviderKind::CustomOpenai, "model");
    custom_override.max_output_tokens = Some(3456);
    custom_override.custom_output_token_field = Some(CustomOpenAiOutputTokenField::MaxCompletionTokens);
    let (_, body) = build_openai_compatible_request(&custom_override, "https://example.test/v1");
    assert_eq!(body.get("max_completion_tokens"), Some(&json!(3456)));
    assert!(body.get("max_tokens").is_none());

    let mut invalid_builtin_override = chat_request(ProviderKind::Openai, "model");
    invalid_builtin_override.custom_output_token_field = Some(CustomOpenAiOutputTokenField::MaxTokens);
    assert!(validate_chat_request(&invalid_builtin_override).is_err());

    let mut google = chat_request(ProviderKind::Google, "gemini-test");
    google.max_output_tokens = Some(3456);
    let (_, body) = build_google_request(&google, "https://generativelanguage.googleapis.com/v1beta").unwrap();
    assert_eq!(body.pointer("/generationConfig/maxOutputTokens"), Some(&json!(3456)));
    assert!(body.get("max_tokens").is_none());
    assert!(body.get("max_completion_tokens").is_none());

    let mut anthropic = chat_request(ProviderKind::Anthropic, "claude-test");
    anthropic.max_output_tokens = Some(4567);
    let (_, body) = build_anthropic_request(&anthropic, "https://api.anthropic.com/v1");
    assert_eq!(body.get("max_tokens"), Some(&json!(4567)));
    assert!(body.get("max_completion_tokens").is_none());
}

#[test]
fn custom_controls_emit_manual_sampling_temperature_and_reasoning_off_together() {
    let mut request = chat_request(ProviderKind::CustomOpenai, "custom-model");
    request.temperature = Some(0.7);
    request.top_p = Some(0.9);
    request.top_k = Some(40);
    request.seed = Some(42);
    request.reasoning_transport_kind = Some("enabled_boolean".to_string());
    request.reasoning_transport_value = Some("false".to_string());
    request.max_output_tokens = Some(32_768);
    let (_, body) = build_openai_compatible_request(&request, "https://example.test/v1");
    assert_eq!(body.get("temperature"), Some(&json!(0.7)));
    assert_eq!(body.get("top_p"), Some(&json!(0.9)));
    assert_eq!(body.get("top_k"), Some(&json!(40)));
    assert_eq!(body.get("seed"), Some(&json!(42)));
    assert_eq!(body.pointer("/reasoning/enabled"), Some(&json!(false)));
    assert!(body.get("reasoning_effort").is_none());
    assert_eq!(body.get("max_tokens"), Some(&json!(32_768)));
    assert!(body.get("provider").is_none());
}

#[test]
fn custom_controls_emit_reasoning_on_without_openrouter_routing() {
    let mut request = chat_request(ProviderKind::CustomOpenai, "custom-model");
    request.reasoning_transport_kind = Some("enabled_boolean".to_string());
    request.reasoning_transport_value = Some("true".to_string());
    let (_, body) = build_openai_compatible_request(&request, "https://example.test/v1");
    assert_eq!(body.pointer("/reasoning/enabled"), Some(&json!(true)));
    assert!(body.get("reasoning_effort").is_none());
    assert!(body.get("provider").is_none());
}

#[test]
fn parses_retry_after_seconds_and_current_http_date_with_a_bounded_wait() {
    let now = UNIX_EPOCH + Duration::from_secs(784_111_767);
    assert_eq!(retry_after_value_ms_at("Sun, 06 Nov 1994 08:49:37 GMT", now), Some(10_000));
    assert_eq!(retry_after_value_ms_at("4", now), Some(4_000));
    assert_eq!(retry_after_value_ms_at("0", now), Some(0));
    assert_eq!(retry_after_value_ms_at("120", now), Some(30_000));
    assert_eq!(retry_after_value_ms_at("Sun, 06 Nov 1994 08:49:37 GMT", now - Duration::from_secs(120)), Some(30_000));
    assert_eq!(retry_after_value_ms_at("Sun, 06 Nov 1994 08:49:37 GMT", now + Duration::from_secs(11)), Some(0));
    assert_eq!(retry_after_value_ms_at("Sun, 06 Nov 1994 08:49:60 GMT", now + Duration::from_secs(32)), Some(1_000));
    assert_eq!(retry_after_value_ms_at("Sun, 06 Nov 94 08:49:37 GMT", now), None);

    // Obsolete HTTP-date wire forms are intentionally unsupported here. A
    // provider sending one falls back to the normal bounded jitter/backoff.
    assert_eq!(retry_after_value_ms_at("Sunday, 06-Nov-94 08:49:37 GMT", now), None);
    assert_eq!(retry_after_value_ms_at("Sun Nov  6 08:49:37 1994", now), None);
    assert_eq!(retry_after_value_ms_at("not-a-date", now), None);
}

#[test]
fn emits_openrouter_boolean_reasoning_for_two_state_models() {
    let mut request = chat_request(ProviderKind::Openrouter, "google/gemma-4-31b-it");
    request.reasoning_effort = Some("high".to_string());
    request.reasoning_transport_kind = Some("enabled_boolean".to_string());
    request.reasoning_transport_value = Some("true".to_string());
    let (_, body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    assert_eq!(body.pointer("/reasoning/enabled"), Some(&json!(true)));
    assert!(body.pointer("/reasoning/effort").is_none());
}

#[test]
fn emits_openrouter_exact_reasoning_max_tokens_without_effort() {
    let mut request = chat_request(ProviderKind::Openrouter, "z-ai/glm-5.3-flash-20260826");
    request.reasoning_max_tokens = Some(10_000);
    let (_, body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    assert_eq!(body.get("reasoning"), Some(&json!({ "max_tokens": 10_000 })));
}

#[test]
fn rejects_exact_reasoning_max_tokens_outside_openrouter() {
    let mut request = chat_request(ProviderKind::Openai, "gpt-test");
    request.reasoning_max_tokens = Some(10_000);
    assert!(validate_chat_request(&request).is_err());
}

#[test]
fn emits_google_registry_transport_instead_of_the_ui_value() {
    let mut request = chat_request(ProviderKind::Google, "gemma-4-31b-it");
    request.reasoning_effort = Some("none".to_string());
    request.reasoning_transport_kind = Some("thinking_level".to_string());
    request.reasoning_transport_value = Some("minimal".to_string());
    let (_, body) = build_google_request(&request, "https://generativelanguage.googleapis.com/v1beta").unwrap();
    assert_eq!(body.pointer("/generationConfig/thinkingConfig/thinkingLevel"), Some(&json!("minimal")));
}

#[test]
fn preserves_standard_openrouter_effort_payloads() {
    let mut request = chat_request(ProviderKind::Openrouter, "z-ai/glm-5.2");
    request.reasoning_effort = Some("xhigh".to_string());
    request.reasoning_transport_kind = Some("effort".to_string());
    request.reasoning_transport_value = Some("xhigh".to_string());
    let (_, body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    assert_eq!(body.pointer("/reasoning/effort"), Some(&json!("xhigh")));
}


#[test]
fn provider_message_deserializes_camel_case_continuation_state() {
    let message: ProviderMessage = serde_json::from_value(json!({
        "role": "assistant",
        "content": "visible",
        "continuationState": {
            "schemaVersion": 1,
            "transport": "openrouter",
            "format": "openrouter-reasoning-details",
            "replayFingerprint": {
                "transport": "openrouter",
                "normalizedEndpoint": "https://openrouter.ai/api/v1",
                "providerConfigId": "provider-config",
                "credentialId": "credential",
                "requestedModelId": "model",
                "actualModelId": "provider-specific-model",
                "stateFormat": "openrouter-reasoning-details",
                "stateFormatVersion": 1
            },
            "reasoningDetails": [{
                "type": "reasoning.text",
                "text": "hidden",
                "id": "r1",
                "format": "openai-responses-v1"
            }]
        }
    })).unwrap();
    let state = message.continuation_state.expect("continuation state");
    match state {
        ProviderContinuationState::OpenRouter(state) => {
            assert_eq!(state.replay_fingerprint.actual_model_id.as_deref(), Some("provider-specific-model"));
        }
        ProviderContinuationState::Google(_) | ProviderContinuationState::Anthropic(_) | ProviderContinuationState::Mistral(_) => {
            panic!("expected OpenRouter continuation state")
        }
    }
}

#[test]
fn replays_openrouter_reasoning_details_only_on_the_bound_assistant_message() {
    let mut request = chat_request(ProviderKind::Openrouter, "openai/gpt-test");
    request.messages = vec![
        ProviderMessage {
            role: "user".to_string(),
            content: "Question".to_string(),
            images: vec![],
            continuation_state: None,
        },
        ProviderMessage {
            role: "assistant".to_string(),
            content: "Answer".to_string(),
            images: vec![],
            continuation_state: Some(ProviderContinuationState::OpenRouter(OpenRouterContinuationState {
                schema_version: 1,
                transport: "openrouter".to_string(),
                format: "openrouter-reasoning-details".to_string(),
                replay_fingerprint: ProviderReplayFingerprint {
                    transport: "openrouter".to_string(),
                    normalized_endpoint: "https://openrouter.ai/api/v1".to_string(),
                    provider_config_id: "provider-config".to_string(),
                    credential_id: "credential".to_string(),
                    requested_model_id: "openai/gpt-test".to_string(),
                    actual_model_id: None,
                    state_format: "openrouter-reasoning-details".to_string(),
                    state_format_version: 1,
                },
                reasoning_details: vec![
                    json!({"type":"reasoning.summary","summary":"summary","id":"r1","format":"openai-responses-v1","index":0}),
                    json!({"type":"reasoning.encrypted","data":"opaque","id":"r2","format":"openai-responses-v1","index":1}),
                ],
            })),
        },
    ];
    validate_continuation_bindings(&request, "https://openrouter.ai/api/v1").unwrap();
    let (_, body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    assert!(body.pointer("/messages/0/reasoning_details").is_none());
    assert_eq!(body.pointer("/messages/1/reasoning_details/0/type"), Some(&json!("reasoning.summary")));
    assert_eq!(body.pointer("/messages/1/reasoning_details/1/data"), Some(&json!("opaque")));
}

#[test]
fn replays_openrouter_optional_metadata_without_inventing_id_or_format() {
    let mut request = chat_request(ProviderKind::Openrouter, "z-ai/glm-5.3-flash-20260826");
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "answer".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::OpenRouter(OpenRouterContinuationState {
            schema_version: 1,
            transport: "openrouter".to_string(),
            format: "openrouter-reasoning-details".to_string(),
            replay_fingerprint: ProviderReplayFingerprint {
                transport: "openrouter".to_string(),
                normalized_endpoint: "https://openrouter.ai/api/v1".to_string(),
                provider_config_id: "provider-config".to_string(),
                credential_id: "credential".to_string(),
                requested_model_id: "z-ai/glm-5.3-flash-20260826".to_string(),
                actual_model_id: None,
                state_format: "openrouter-reasoning-details".to_string(),
                state_format_version: 1,
            },
            reasoning_details: vec![
                json!({"type":"reasoning.summary","summary":"summary"}),
                json!({"type":"reasoning.text","signature":"sig-only"}),
            ],
        })),
    }];
    validate_continuation_bindings(&request, "https://openrouter.ai/api/v1").unwrap();
    let (_, body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    let details = body.pointer("/messages/0/reasoning_details").and_then(Value::as_array).unwrap();
    assert_eq!(details[0], json!({"type":"reasoning.summary","summary":"summary"}));
    assert_eq!(details[1], json!({"type":"reasoning.text","signature":"sig-only"}));
}

#[test]
fn replays_explicit_empty_openrouter_reasoning_details_as_an_explicit_empty_array() {
    let mut request = chat_request(ProviderKind::Openrouter, "openai/gpt-test");
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "Answer".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::OpenRouter(OpenRouterContinuationState {
            schema_version: 1,
            transport: "openrouter".to_string(),
            format: "openrouter-reasoning-details".to_string(),
            replay_fingerprint: ProviderReplayFingerprint {
                transport: "openrouter".to_string(),
                normalized_endpoint: "https://openrouter.ai/api/v1".to_string(),
                provider_config_id: "provider-config".to_string(),
                credential_id: "credential".to_string(),
                requested_model_id: "openai/gpt-test".to_string(),
                actual_model_id: None,
                state_format: "openrouter-reasoning-details".to_string(),
                state_format_version: 1,
            },
            reasoning_details: vec![],
        })),
    }];
    validate_chat_request(&request).unwrap();
    validate_continuation_bindings(&request, "https://openrouter.ai/api/v1").unwrap();
    let (_, body) = build_openai_compatible_request(&request, "https://openrouter.ai/api/v1");
    assert_eq!(body.pointer("/messages/0/reasoning_details"), Some(&json!([])));
}

#[test]
fn replays_google_thought_signature_on_the_exact_model_part() {
    let signature = "R0VNSU5JXzNfVEhPVUdIVF9TSUdOQVRVUkU=";
    let mut request = chat_request(ProviderKind::Google, "gemini-3.8-flash");
    request.messages = vec![
        ProviderMessage {
            role: "user".to_string(),
            content: "Fixture question.".to_string(),
            images: vec![],
            continuation_state: None,
        },
        ProviderMessage {
            role: "assistant".to_string(),
            content: "Visible fixture answer.".to_string(),
            images: vec![],
            continuation_state: Some(ProviderContinuationState::Google(GoogleContinuationState {
                schema_version: 1,
                transport: "google-native".to_string(),
                format: "google-thought-parts".to_string(),
                replay_fingerprint: ProviderReplayFingerprint {
                    transport: "google-native".to_string(),
                    normalized_endpoint: "https://generativelanguage.googleapis.com/v1beta".to_string(),
                    provider_config_id: "provider-config".to_string(),
                    credential_id: "credential".to_string(),
                    requested_model_id: "gemini-3.8-flash".to_string(),
                    actual_model_id: None,
                    state_format: "google-thought-parts".to_string(),
                    state_format_version: 1,
                },
                parts: vec![GoogleThoughtPart {
                    text: "Visible fixture answer.".to_string(),
                    thought: None,
                    thought_signature: Some(signature.to_string()),
                }],
            })),
        },
        ProviderMessage {
            role: "user".to_string(),
            content: "Fixture follow-up.".to_string(),
            images: vec![],
            continuation_state: None,
        },
    ];
    validate_continuation_bindings(&request, "https://generativelanguage.googleapis.com/v1beta").unwrap();
    let (_, body) = build_google_request(&request, "https://generativelanguage.googleapis.com/v1beta").unwrap();
    assert_eq!(body.pointer("/contents/1/role"), Some(&json!("model")));
    assert_eq!(body.pointer("/contents/1/parts/0/text"), Some(&json!("Visible fixture answer.")));
    assert_eq!(body.pointer("/contents/1/parts/0/thoughtSignature"), Some(&json!(signature)));
}

#[test]
fn replays_anthropic_thinking_blocks_before_the_exact_visible_text() {
    let mut request = chat_request(ProviderKind::Anthropic, "claude-sonnet-5");
    request.messages = vec![
        ProviderMessage {
            role: "user".to_string(),
            content: "Fixture question.".to_string(),
            images: vec![],
            continuation_state: None,
        },
        ProviderMessage {
            role: "assistant".to_string(),
            content: "Visible fixture answer.".to_string(),
            images: vec![],
            continuation_state: Some(ProviderContinuationState::Anthropic(AnthropicContinuationState {
                schema_version: 1,
                transport: "anthropic-native".to_string(),
                format: "anthropic-thinking-blocks".to_string(),
                replay_fingerprint: ProviderReplayFingerprint {
                    transport: "anthropic-native".to_string(),
                    normalized_endpoint: "https://api.anthropic.com/v1".to_string(),
                    provider_config_id: "provider-config".to_string(),
                    credential_id: "credential".to_string(),
                    requested_model_id: "claude-sonnet-5".to_string(),
                    actual_model_id: None,
                    state_format: "anthropic-thinking-blocks".to_string(),
                    state_format_version: 1,
                },
                blocks: vec![
                    json!({"type":"thinking","thinking":"Anonymized thinking summary.","signature":"fixture-anthropic-signature-001"}),
                    json!({"type":"redacted_thinking","data":"RklYVFVSRV9SRURBQ1RFRF9USElOS0lORw=="}),
                ],
            })),
        },
        ProviderMessage {
            role: "user".to_string(),
            content: "Fixture follow-up.".to_string(),
            images: vec![],
            continuation_state: None,
        },
    ];
    validate_chat_request(&request).unwrap();
    validate_continuation_bindings(&request, "https://api.anthropic.com/v1").unwrap();
    let (_, body) = build_anthropic_request(&request, "https://api.anthropic.com/v1");
    assert_eq!(body.pointer("/messages/1/content/0/type"), Some(&json!("thinking")));
    assert_eq!(body.pointer("/messages/1/content/0/signature"), Some(&json!("fixture-anthropic-signature-001")));
    assert_eq!(body.pointer("/messages/1/content/1/type"), Some(&json!("redacted_thinking")));
    assert_eq!(body.pointer("/messages/1/content/1/data"), Some(&json!("RklYVFVSRV9SRURBQ1RFRF9USElOS0lORw==")));
    assert_eq!(body.pointer("/messages/1/content/2/type"), Some(&json!("text")));
    assert_eq!(body.pointer("/messages/1/content/2/text"), Some(&json!("Visible fixture answer.")));
}

#[test]
fn rejects_anthropic_continuation_state_when_fingerprint_changes() {
    let mut request = chat_request(ProviderKind::Anthropic, "claude-sonnet-5");
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "Visible fixture answer.".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::Anthropic(AnthropicContinuationState {
            schema_version: 1,
            transport: "anthropic-native".to_string(),
            format: "anthropic-thinking-blocks".to_string(),
            replay_fingerprint: ProviderReplayFingerprint {
                transport: "anthropic-native".to_string(),
                normalized_endpoint: "https://api.anthropic.com/v1".to_string(),
                provider_config_id: "provider-config".to_string(),
                credential_id: "other".to_string(),
                requested_model_id: "claude-sonnet-5".to_string(),
                actual_model_id: None,
                state_format: "anthropic-thinking-blocks".to_string(),
                state_format_version: 1,
            },
            blocks: vec![json!({"type":"thinking","thinking":"summary","signature":"sig"})],
        })),
    }];
    assert!(validate_continuation_bindings(&request, "https://api.anthropic.com/v1").is_err());
}

#[test]
fn rejects_google_continuation_state_when_bound_message_or_fingerprint_changes() {
    let mut request = chat_request(ProviderKind::Google, "gemini-3.8-flash");
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "Different visible text.".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::Google(GoogleContinuationState {
            schema_version: 1,
            transport: "google-native".to_string(),
            format: "google-thought-parts".to_string(),
            replay_fingerprint: ProviderReplayFingerprint {
                transport: "google-native".to_string(),
                normalized_endpoint: "https://generativelanguage.googleapis.com/v1beta".to_string(),
                provider_config_id: "provider-config".to_string(),
                credential_id: "credential".to_string(),
                requested_model_id: "gemini-3.8-flash".to_string(),
                actual_model_id: None,
                state_format: "google-thought-parts".to_string(),
                state_format_version: 1,
            },
            parts: vec![GoogleThoughtPart {
                text: "Visible fixture answer.".to_string(),
                thought: None,
                thought_signature: Some("R0VNSU5JXzNfVEhPVUdIVF9TSUdOQVRVUkU=".to_string()),
            }],
        })),
    }];
    assert!(validate_continuation_bindings(&request, "https://generativelanguage.googleapis.com/v1beta").is_err());
    request.messages[0].content = "Visible fixture answer.".to_string();
    if let Some(ProviderContinuationState::Google(state)) = request.messages[0].continuation_state.as_mut() {
        state.replay_fingerprint.credential_id = "other".to_string();
    }
    assert!(validate_continuation_bindings(&request, "https://generativelanguage.googleapis.com/v1beta").is_err());
}

#[test]
fn rejects_openrouter_continuation_state_when_fingerprint_changes() {
    let mut request = chat_request(ProviderKind::Openrouter, "model-a");
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "Answer".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::OpenRouter(OpenRouterContinuationState {
            schema_version: 1,
            transport: "openrouter".to_string(),
            format: "openrouter-reasoning-details".to_string(),
            replay_fingerprint: ProviderReplayFingerprint {
                transport: "openrouter".to_string(),
                normalized_endpoint: "https://openrouter.ai/api/v1".to_string(),
                provider_config_id: "other-config".to_string(),
                credential_id: "credential".to_string(),
                requested_model_id: "model-a".to_string(),
                actual_model_id: None,
                state_format: "openrouter-reasoning-details".to_string(),
                state_format_version: 1,
            },
            reasoning_details: vec![json!({"type":"reasoning.text","text":"hidden","id":"r1","format":"openai-responses-v1"})],
        })),
    }];
    assert!(validate_continuation_bindings(&request, "https://openrouter.ai/api/v1").is_err());
}

#[test]
fn rust_validation_keeps_the_64_logical_block_limit_for_openrouter() {
    let mut request = chat_request(ProviderKind::Openrouter, "model-a");
    let reasoning_details = (0..65)
        .map(|index| json!({
            "type": "reasoning.encrypted",
            "data": "RklYVFVSRQ==",
            "id": format!("opaque-{index}"),
            "format": "openai-responses-v1",
            "index": index,
        }))
        .collect::<Vec<_>>();
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "Answer".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::OpenRouter(OpenRouterContinuationState {
            schema_version: 1,
            transport: "openrouter".to_string(),
            format: "openrouter-reasoning-details".to_string(),
            replay_fingerprint: ProviderReplayFingerprint {
                transport: "openrouter".to_string(),
                normalized_endpoint: "https://openrouter.ai/api/v1".to_string(),
                provider_config_id: "provider-config".to_string(),
                credential_id: "credential".to_string(),
                requested_model_id: "model-a".to_string(),
                actual_model_id: None,
                state_format: "openrouter-reasoning-details".to_string(),
                state_format_version: 1,
            },
            reasoning_details,
        })),
    }];
    validate_chat_request(&request).unwrap();
    let error = validate_continuation_bindings(&request, "https://openrouter.ai/api/v1").unwrap_err();
    assert!(error.contains("block count"));
}

#[test]
fn parses_openai_compatible_text_part_arrays() {
    let parsed = parse_openai_compatible_response(json!({
        "model": "array-model",
        "choices": [{
            "message": { "content": [
                { "type": "text", "text": "first " },
                { "type": "output_text", "text": "second" }
            ]},
            "finish_reason": "stop"
        }],
        "usage": {}
    }), None).unwrap();
    assert_eq!(parsed.content, "first second");
    assert!(parsed.reasoning_content.is_none());
}

#[test]
fn preserves_plain_content_without_inventing_reasoning() {
    let parsed = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "content": "ordinary final response" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(parsed.content, "ordinary final response");
    assert!(parsed.reasoning_content.is_none());
    assert!(parsed.reasoning_source.is_none());
}

#[test]
fn separates_openrouter_reasoning_from_final_content() {
    let parsed = parse_openai_compatible_response(json!({
        "model": "reasoning-model",
        "choices": [{
            "message": {
                "reasoning": "Long private reasoning that must not reach the Viewer.",
                "content": "Ask the Viewer to describe the northern edge in three sentences.",
                "reasoning_details": [{ "type": "reasoning.text", "text": "detail" }]
            },
            "finish_reason": "stop"
        }],
        "usage": { "completion_tokens_details": { "reasoning_tokens": 1200 } }
    }), None).unwrap();
    assert_eq!(parsed.content, "Ask the Viewer to describe the northern edge in three sentences.");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("Long private reasoning that must not reach the Viewer."));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("openai_reasoning"));
    assert_eq!(parsed.reasoning_details.as_ref().map(Vec::len), Some(1));
    assert_eq!(parsed.usage.reasoning_tokens, Some(1200));
}

#[test]
fn preserves_non_stream_openrouter_reasoning_details_presence_for_empty_and_nonempty_arrays() {
    let explicit_empty = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "reasoning_details": [], "content": "Final answer" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(explicit_empty.reasoning_details, Some(vec![]));

    let missing = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "content": "Final answer" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert!(missing.reasoning_details.is_none());

    let explicit_null = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "reasoning_details": null, "content": "Final answer" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert!(explicit_null.reasoning_details.is_none());

    for invalid in [json!({}), json!("invalid"), json!(7), json!(true)] {
        let error = parse_openai_compatible_response(json!({
            "choices": [{ "message": { "reasoning_details": invalid, "content": "Final answer" }, "finish_reason": "stop" }]
        }), None).unwrap_err();
        assert_eq!(error, "provider response reasoning_details must be an array or null when present");
    }
}

#[test]
fn openrouter_compatibility_v2_fixture_matches_native_validation_and_non_stream_parser() {
    let fixture: Value = serde_json::from_str(include_str!("../../../src/providers/continuation-fixtures/openrouter-compatibility-v2.json")).unwrap();
    for entry in fixture.get("accepted").and_then(Value::as_array).unwrap() {
        let name = entry.get("name").and_then(Value::as_str).unwrap();
        let detail = entry.get("detail").unwrap();
        assert!(validate_openrouter_reasoning_detail(detail, 0).is_ok(), "{name}");
        let parsed = parse_chat_response(ProviderKind::Openrouter, json!({
            "choices": [{ "message": { "reasoning_details": [detail.clone()], "content": "Final answer" }, "finish_reason": "stop" }]
        }), None).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(parsed.reasoning_details, Some(vec![detail.clone()]), "{name}");
    }
    for entry in fixture.get("rejected").and_then(Value::as_array).unwrap() {
        let name = entry.get("name").and_then(Value::as_str).unwrap();
        let detail = entry.get("detail").unwrap();
        let reason = entry.get("reason").and_then(Value::as_str).unwrap();
        let error = validate_openrouter_reasoning_detail(detail, 0).unwrap_err();
        assert!(error.contains(reason), "{name}: {error}");
        // Response parsing must preserve a completed answer and its opaque continuation candidate.
        // Replay readiness is decided later by the capture/replay contract so an invalid
        // continuation cannot erase an already completed/provider-billed response.
        let parsed = parse_chat_response(ProviderKind::Openrouter, json!({
            "choices": [{ "message": { "reasoning_details": [detail.clone()], "content": "Final answer" }, "finish_reason": "stop" }],
            "usage": { "prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6 }
        }), None).unwrap_or_else(|error| panic!("{name}: parser lost completed response: {error}"));
        assert_eq!(parsed.content, "Final answer", "{name}");
        assert_eq!(parsed.reasoning_details, Some(vec![detail.clone()]), "{name}");
        assert_eq!(parsed.usage.total_tokens, Some(6), "{name}");
    }
}

#[test]
fn openrouter_non_stream_validation_does_not_change_other_openai_compatible_providers() {
    let parsed = parse_chat_response(ProviderKind::Blackbox, json!({
        "choices": [{
            "message": {
                "reasoning_details": [{ "type": "reasoning.text", "text": "detail", "future": "kept" }],
                "content": "Final answer"
            },
            "finish_reason": "stop"
        }]
    }), None).unwrap();
    assert_eq!(parsed.content, "Final answer");
    assert_eq!(parsed.reasoning_details.as_ref().map(Vec::len), Some(1));
}

#[test]
fn non_stream_openrouter_preserves_two_full_blocks_without_merging() {
    let details = vec![
        json!({"type":"reasoning.text","text":"first"}),
        json!({"type":"reasoning.text","text":"second"}),
    ];
    let parsed = parse_chat_response(ProviderKind::Openrouter, json!({
        "choices": [{ "message": { "reasoning_details": details.clone(), "content": "Final answer" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(parsed.reasoning_details, Some(details));
}

#[test]
fn supports_reasoning_content_alias_and_reasoning_details_fallback() {
    let alias = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "reasoning_content": "DeepSeek reasoning", "content": "Final answer" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(alias.reasoning_content.as_deref(), Some("DeepSeek reasoning"));
    assert_eq!(alias.reasoning_source.as_deref(), Some("openai_reasoning_content"));

    let details = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "reasoning_details": [{ "text": "Detailed reasoning" }], "content": "Final answer" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(details.reasoning_content.as_deref(), Some("Detailed reasoning"));
    assert_eq!(details.reasoning_source.as_deref(), Some("openai_reasoning_details"));
}

#[test]
fn supports_ollama_style_thinking_field() {
    let parsed = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "thinking": "hidden thought", "content": "visible final" }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(parsed.content, "visible final");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("hidden thought"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("openai_thinking"));
}

#[test]
fn separates_typed_reasoning_parts_inside_content_arrays() {
    let parsed = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "content": [
            { "type": "reasoning", "text": "hidden reasoning" },
            { "type": "output_text", "text": "visible final" }
        ] }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(parsed.content, "visible final");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("hidden reasoning"));
}

#[test]
fn reports_reasoning_only_length_completion_as_incomplete() {
    let error = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "reasoning_content": "unfinished reasoning", "content": "" }, "finish_reason": "length" }]
    }), None).unwrap_err();
    assert!(error.contains("reasoning without a final assistant response"));
    assert!(error.contains("finish-reason=length"));
}

#[test]
fn separates_closed_reasoning_tags_and_rejects_unclosed_reasoning_only_output() {
    let parsed = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "content": "<think>hidden chain</think>Final instruction with two sentences. Keep both." }, "finish_reason": "stop" }]
    }), None).unwrap();
    assert_eq!(parsed.content, "Final instruction with two sentences. Keep both.");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("hidden chain"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("tagged_content"));

    let error = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "content": "<|begin_of_thought|>unfinished" }, "finish_reason": "length" }]
    }), None).unwrap_err();
    assert!(error.contains("reasoning without a final assistant response"));
}

#[test]
fn recognizes_supported_reasoning_tag_pairs_without_semantic_guessing() {
    for value in [
        "<think>x</think>final",
        "<thinking>x</thinking>final",
        "<reason>x</reason>final",
        "<reasoning>x</reasoning>final",
        "<thought>x</thought>final",
        "<|begin_of_thought|>x<|end_of_thought|>final",
    ] {
        let split = split_tagged_reasoning(value).unwrap();
        assert_eq!(split.content, "final");
        assert_eq!(split.reasoning, "x");
        assert!(!split.incomplete);
    }
    assert!(split_tagged_reasoning("Wait, this is a normal final response.").is_none());
}

#[test]
fn separates_google_thought_parts_from_visible_parts() {
    let parsed = parse_google_response(json!({
        "modelVersion": "gemini-reasoning",
        "candidates": [{
            "content": { "parts": [
                { "thought": true, "text": "internal analysis" },
                { "text": "visible answer" }
            ]},
            "finishReason": "STOP"
        }],
        "usageMetadata": { "thoughtsTokenCount": 42 }
    }), None).unwrap();
    assert_eq!(parsed.content, "visible answer");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("internal analysis"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("google_thought_parts"));
    assert_eq!(parsed.usage.reasoning_tokens, Some(42));
}

#[test]
fn captures_visible_google_text_part_when_it_carries_a_thought_signature() {
    let signature = "R0VNSU5JXzNfVEhPVUdIVF9TSUdOQVRVUkU=";
    let parsed = parse_google_response(json!({
        "modelVersion": "gemini-3.8-flash",
        "candidates": [{
            "content": { "role": "model", "parts": [
                { "text": "Visible fixture answer.", "thoughtSignature": signature }
            ]},
            "finishReason": "STOP"
        }],
        "usageMetadata": { "thoughtsTokenCount": 258 }
    }), None).unwrap();
    assert_eq!(parsed.content, "Visible fixture answer.");
    assert!(parsed.reasoning_content.is_none());
    assert_eq!(parsed.reasoning_details.as_ref().map(Vec::len), Some(1));
    assert_eq!(parsed.reasoning_details.as_ref().unwrap()[0].get("thoughtSignature"), Some(&json!(signature)));
}

#[test]
fn separates_anthropic_thinking_and_preserves_redacted_details() {
    let parsed = parse_anthropic_response(json!({
        "model": "claude-reasoning",
        "content": [
            { "type": "thinking", "thinking": "internal analysis", "signature": "sig" },
            { "type": "redacted_thinking", "data": "opaque" },
            { "type": "text", "text": "visible answer" }
        ],
        "stop_reason": "end_turn",
        "usage": {}
    }), None).unwrap();
    assert_eq!(parsed.content, "visible answer");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("internal analysis"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("anthropic_thinking"));
    assert_eq!(parsed.reasoning_details.as_ref().map(Vec::len), Some(2));
    assert_eq!(parsed.reasoning_details.as_ref().unwrap()[1].get("data"), Some(&json!("opaque")));
}

#[test]
fn preserves_anthropic_signed_visible_text_without_tagged_content_rewrite() {
    let parsed = parse_anthropic_response(json!({
        "model": "claude-reasoning",
        "content": [
            { "type": "thinking", "thinking": "internal analysis", "signature": "sig" },
            { "type": "text", "text": "Literal <think>example</think> stays visible." }
        ],
        "stop_reason": "end_turn",
        "usage": {}
    }), None).unwrap();
    assert_eq!(parsed.content, "Literal <think>example</think> stays visible.");
}

#[test]
fn rejects_anthropic_signed_text_blocks_with_unapproved_fields() {
    let error = parse_anthropic_response(json!({
        "model": "claude-reasoning",
        "content": [
            { "type": "thinking", "thinking": "internal analysis", "signature": "sig" },
            { "type": "text", "text": "answer", "future_field": "nope" }
        ],
        "stop_reason": "end_turn",
        "usage": {}
    }), None).unwrap_err();
    assert!(error.contains("unsupported Anthropic continuation block layout"));
}

#[test]
fn rejects_anthropic_thinking_layouts_that_cannot_be_replayed_exactly() {
    let error = parse_anthropic_response(json!({
        "model": "claude-reasoning",
        "content": [
            { "type": "thinking", "thinking": "internal analysis", "signature": "sig" },
            { "type": "text", "text": "first" },
            { "type": "text", "text": "second" }
        ],
        "stop_reason": "end_turn",
        "usage": {}
    }), None).unwrap_err();
    assert!(error.contains("unsupported Anthropic continuation block layout"));
}

#[test]
fn reports_empty_and_blocked_responses_distinctly() {
    let empty = parse_openai_compatible_response(json!({
        "choices": [{ "message": { "content": "" }, "finish_reason": "stop" }]
    }), None).unwrap_err();
    assert!(empty.contains("empty assistant response"));
    assert!(empty.contains("finish-reason=stop"));

    let blocked = parse_google_response(json!({
        "promptFeedback": { "blockReason": "SAFETY" },
        "candidates": []
    }), None).unwrap_err();
    assert!(blocked.contains("blocked"));
    assert!(blocked.contains("SAFETY"));
}

#[test]
fn exposes_structured_provider_errors_without_dumping_the_payload() {
    let error = parse_openai_compatible_response(json!({
        "error": { "code": 503, "type": "upstream_unavailable", "message": "try again" },
        "unrelated": "must not appear"
    }), None).unwrap_err();
    assert!(error.contains("code=503"));
    assert!(error.contains("upstream_unavailable"));
    assert!(!error.contains("must not appear"));
}

#[test]
fn direct2a_blackbox_preserves_legacy_default_but_accepts_explicit_blackbox_routes() {
    let request = chat_request(ProviderKind::Blackbox, "blackboxai/openai/gpt-5");

    let legacy = provider_base_url(ProviderKind::Blackbox, None).unwrap();
    assert_eq!(legacy, "https://api.blackbox.ai");
    let (legacy_url, legacy_body) = build_chat_request(&request, &legacy).unwrap();
    assert_eq!(legacy_url, "https://api.blackbox.ai/chat/completions");
    assert_eq!(legacy_body.get("model"), Some(&json!("blackboxai/openai/gpt-5")));

    let enterprise = provider_base_url(ProviderKind::Blackbox, Some("https://enterprise.blackbox.ai/")).unwrap();
    assert_eq!(enterprise, "https://enterprise.blackbox.ai");
    let (enterprise_url, _) = build_chat_request(&request, &enterprise).unwrap();
    assert_eq!(enterprise_url, "https://enterprise.blackbox.ai/chat/completions");

    let organization = provider_base_url(ProviderKind::Blackbox, Some("https://example-org.blackbox.ai")).unwrap();
    assert_eq!(organization, "https://example-org.blackbox.ai");
}

#[test]
fn direct2a_blackbox_rejects_non_blackbox_or_path_bearing_overrides() {
    assert!(provider_base_url(ProviderKind::Blackbox, Some("https://evil.example")).is_err());
    assert!(provider_base_url(ProviderKind::Blackbox, Some("https://enterprise.blackbox.ai/v1")).is_err());
    assert!(provider_base_url(ProviderKind::Blackbox, Some("https://enterprise.blackbox.ai?x=1")).is_err());
}

#[test]
fn direct2b_blackbox_discovery_preserves_legacy_route_but_blocks_unconfirmed_routes() {
    for explicit in [None, Some(""), Some("   "), Some("https://api.blackbox.ai"), Some("https://api.blackbox.ai/")] {
        let base = provider_base_url(ProviderKind::Blackbox, explicit).unwrap();
        assert_eq!(
            model_discovery_url(ProviderKind::Blackbox, &base).unwrap(),
            "https://api.blackbox.ai/models"
        );
    }

    for explicit in [
        "https://enterprise.blackbox.ai",
        "https://example-org.blackbox.ai",
    ] {
        let base = provider_base_url(ProviderKind::Blackbox, Some(explicit)).unwrap();
        let error = model_discovery_url(ProviderKind::Blackbox, &base).unwrap_err();
        assert!(error.contains("does not establish GET /models"));
        assert!(error.contains("not evidence that the configured chat route or credential is invalid"));
    }
}

#[test]
fn direct2b_discovery_boundary_does_not_change_other_provider_model_urls() {
    let mistral = provider_base_url(ProviderKind::Mistral, None).unwrap();
    assert_eq!(
        model_discovery_url(ProviderKind::Mistral, &mistral).unwrap(),
        "https://api.mistral.ai/v1/models"
    );
    let google = provider_base_url(ProviderKind::Google, None).unwrap();
    assert_eq!(
        model_discovery_url(ProviderKind::Google, &google).unwrap(),
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
    );
}

#[tokio::test]
async fn openrouter_wire_requests_omit_application_attribution_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_simulator_request(&mut socket).await;
        let headers = request.to_ascii_lowercase();
        assert!(headers.contains("authorization: bearer simulator-secret"));
        for header in ["http-referer:", "referer:", "x-title:", "x-openrouter-title:", "user-agent:"] {
            assert!(!headers.lines().any(|line| line.starts_with(header)), "unexpected identifying header: {header}");
        }
        let body = r#"{"data":[]}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        socket.write_all(response.as_bytes()).await.unwrap();
    });

    let response = authenticated(
        client().unwrap().get(format!("http://{address}/models")),
        ProviderKind::Openrouter,
        "simulator-secret",
    )
    .send()
    .await
    .unwrap();
    assert!(response.status().is_success());
    server.await.unwrap();
}

#[tokio::test]
async fn custom_openai_sampling_reaches_the_local_http_simulator_without_openrouter_routing() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_simulator_request(&mut socket).await;
        assert!(request.lines().next().unwrap_or_default().contains("/chat/completions"));
        let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
        let json: Value = serde_json::from_str(body).unwrap();
        assert_eq!(json.get("model"), Some(&json!("custom-model")));
        assert_eq!(json.get("top_p"), Some(&json!(0.04)));
        assert_eq!(json.get("top_k"), Some(&json!(0)));
        assert_eq!(json.get("seed"), Some(&json!(42)));
        assert!(json.get("provider").is_none());
        let response_body = r#"{"model":"custom-model","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response_body.len(), response_body);
        socket.write_all(response.as_bytes()).await.unwrap();
    });

    let base = format!("http://{address}");
    let mut request = chat_request(ProviderKind::CustomOpenai, "custom-model");
    request.top_p = Some(0.04);
    request.top_k = Some(0);
    request.seed = Some(42);
    validate_chat_request(&request).unwrap();
    let (url, body) = build_chat_request(&request, &base).unwrap();
    assert!(body.get("provider").is_none());
    let response = authenticated(client().unwrap().post(url).json(&body), ProviderKind::CustomOpenai, "simulator-secret")
        .send().await.unwrap();
    let (payload, request_id) = json_response(response, "simulator-secret").await.unwrap();
    let parsed = parse_chat_response(ProviderKind::CustomOpenai, payload, request_id).unwrap();
    assert_eq!(parsed.content, "ok");
    server.await.unwrap();
}

#[tokio::test]
async fn openai_compatible_contract_passes_against_a_local_simulator() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        for expected_path in ["/models", "/chat/completions"] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_simulator_request(&mut socket).await;
            assert!(request.lines().next().unwrap_or_default().contains(expected_path));
            assert!(request.to_ascii_lowercase().contains("authorization: bearer simulator-secret"));
            let body = if expected_path == "/models" {
                r#"{"data":[{"id":"simulator-model"}]}"#
            } else {
                assert!(request.contains("\"model\":\"simulator-model\""));
                r#"{"model":"simulator-model-actual","choices":[{"message":{"content":"simulated response"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}"#
            };
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });

    let base = format!("http://{address}");
    let models = authenticated(client().unwrap().get(endpoint(&base, "models")), ProviderKind::Blackbox, "simulator-secret")
        .send().await.unwrap();
    let (models, _) = json_response(models, "simulator-secret").await.unwrap();
    assert_eq!(models.pointer("/data/0/id"), Some(&json!("simulator-model")));

    let request = chat_request(ProviderKind::Blackbox, "simulator-model");
    let (url, body) = build_chat_request(&request, &base).unwrap();
    let response = authenticated(client().unwrap().post(url).json(&body), ProviderKind::Blackbox, "simulator-secret")
        .send().await.unwrap();
    let (payload, request_id) = json_response(response, "simulator-secret").await.unwrap();
    let parsed = parse_chat_response(ProviderKind::Blackbox, payload, request_id).unwrap();
    assert_eq!(parsed.content, "simulated response");
    assert_eq!(parsed.actual_model.as_deref(), Some("simulator-model-actual"));
    assert_eq!(parsed.usage.total_tokens, Some(5));
    server.await.unwrap();
}


#[test]
fn builds_encoded_openrouter_model_endpoint_discovery_url() {
    assert_eq!(
        openrouter_model_endpoints_url("https://openrouter.ai/api/v1", "qwen/qwen3-32b").unwrap(),
        "https://openrouter.ai/api/v1/models/qwen/qwen3-32b/endpoints",
    );
    assert_eq!(
        openrouter_model_endpoints_url("https://openrouter.ai/api/v1", "qwen/qwen3-32b:free").unwrap(),
        "https://openrouter.ai/api/v1/models/qwen/qwen3-32b:free/endpoints",
    );
    assert!(openrouter_model_endpoints_url("https://openrouter.ai/api/v1", "invalid-model").is_err());
    assert!(openrouter_model_endpoints_url("https://openrouter.ai/api/v1", "a/b/c").is_err());
}

#[test]
fn emits_openrouter_capacity_routing_without_changing_other_provider_bodies() {
    let mut openrouter = chat_request(ProviderKind::Openrouter, "qwen/qwen3-32b");
    openrouter.provider_routing = Some(OpenRouterProviderRouting {
        order: vec!["siliconflow".to_string()],
        only: vec!["siliconflow".to_string()],
        ignore: vec!["deepinfra".to_string()],
        allow_fallbacks: Some(true),
        require_parameters: None,
    });
    let (_, body) = build_openai_compatible_request(&openrouter, "https://openrouter.ai/api/v1");
    assert_eq!(body.pointer("/provider/order/0"), Some(&json!("siliconflow")));
    assert_eq!(body.pointer("/provider/only/0"), Some(&json!("siliconflow")));
    assert_eq!(body.pointer("/provider/ignore/0"), Some(&json!("deepinfra")));
    assert_eq!(body.pointer("/provider/allow_fallbacks"), Some(&json!(true)));

    let mut openai = chat_request(ProviderKind::Openai, "gpt-test");
    openai.provider_routing = openrouter.provider_routing.clone();
    let (_, body) = build_openai_compatible_request(&openai, "https://api.openai.com/v1");
    assert!(body.get("provider").is_none());
}

#[test]
fn emits_openrouter_and_custom_manual_sampling_without_leaking_to_other_providers() {
    let mut openrouter = chat_request(ProviderKind::Openrouter, "sampling/model");
    openrouter.top_p = Some(0.04);
    openrouter.top_k = Some(0);
    openrouter.seed = Some(42);
    openrouter.provider_routing = Some(OpenRouterProviderRouting {
        order: vec![],
        only: vec!["provider-a/fp8".to_string()],
        ignore: vec![],
        allow_fallbacks: Some(true),
        require_parameters: Some(true),
    });
    validate_chat_request(&openrouter).unwrap();
    let (_, body) = build_openai_compatible_request(&openrouter, "https://openrouter.ai/api/v1");
    assert_eq!(body.get("top_p"), Some(&json!(0.04)));
    assert_eq!(body.get("top_k"), Some(&json!(0)));
    assert_eq!(body.get("seed"), Some(&json!(42)));
    assert_eq!(body.pointer("/provider/require_parameters"), Some(&json!(true)));
    assert_eq!(body.pointer("/provider/only/0"), Some(&json!("provider-a/fp8")));

    let mut custom = chat_request(ProviderKind::CustomOpenai, "custom-model");
    custom.top_p = Some(0.04);
    custom.top_k = Some(0);
    custom.seed = Some(42);
    validate_chat_request(&custom).unwrap();
    let (_, custom_body) = build_openai_compatible_request(&custom, "https://example.test/v1");
    assert_eq!(custom_body.get("top_p"), Some(&json!(0.04)));
    assert_eq!(custom_body.get("top_k"), Some(&json!(0)));
    assert_eq!(custom_body.get("seed"), Some(&json!(42)));
    assert!(custom_body.get("provider").is_none());

    let custom_auto = chat_request(ProviderKind::CustomOpenai, "custom-model");
    let (_, custom_auto_body) = build_openai_compatible_request(&custom_auto, "https://example.test/v1");
    assert!(custom_auto_body.get("top_p").is_none());
    assert!(custom_auto_body.get("top_k").is_none());
    assert!(custom_auto_body.get("seed").is_none());

    let mut custom_top_k = chat_request(ProviderKind::CustomOpenai, "custom-model");
    custom_top_k.top_k = Some(100);
    validate_chat_request(&custom_top_k).unwrap();
    let (_, custom_top_k_body) = build_openai_compatible_request(&custom_top_k, "https://example.test/v1");
    assert_eq!(custom_top_k_body.get("top_k"), Some(&json!(100)));
    assert!(custom_top_k_body.get("top_p").is_none());
    assert!(custom_top_k_body.get("seed").is_none());

    let mut custom_seed = chat_request(ProviderKind::CustomOpenai, "custom-model");
    custom_seed.seed = Some(42);
    validate_chat_request(&custom_seed).unwrap();
    let (_, custom_seed_body) = build_openai_compatible_request(&custom_seed, "https://example.test/v1");
    assert_eq!(custom_seed_body.get("seed"), Some(&json!(42)));
    assert!(custom_seed_body.get("top_p").is_none());
    assert!(custom_seed_body.get("top_k").is_none());

    let mut custom_with_or_routing = chat_request(ProviderKind::CustomOpenai, "custom-model");
    custom_with_or_routing.seed = Some(42);
    custom_with_or_routing.provider_routing = Some(OpenRouterProviderRouting {
        order: vec![], only: vec![], ignore: vec![], allow_fallbacks: None, require_parameters: Some(true),
    });
    assert!(validate_chat_request(&custom_with_or_routing).unwrap_err().contains("OpenRouter-only"));

    let mut openai = chat_request(ProviderKind::Openai, "gpt-test");
    openai.top_p = Some(0.5);
    assert!(validate_chat_request(&openai).unwrap_err().contains("OpenRouter, Custom OpenAI-compatible, or Mistral direct"));
    let (_, body) = build_openai_compatible_request(&openai, "https://api.openai.com/v1");
    assert!(body.get("top_p").is_none());
    assert!(body.get("top_k").is_none());
    assert!(body.get("seed").is_none());
}

#[test]
fn direct0_characterizes_direct_provider_sampling_gate_without_enabling_it() {
    for provider in [
        ProviderKind::Openai,
        ProviderKind::Zai,
        ProviderKind::Deepseek,
        ProviderKind::Blackbox,
    ] {
        let mut request = chat_request(provider, "direct-0-model");
        request.top_p = Some(0.5);
        request.top_k = Some(100);
        request.seed = Some(42);

        let error = validate_chat_request(&request).unwrap_err();
        assert!(error.contains("OpenRouter, Custom OpenAI-compatible, or Mistral direct"));

        // Characterization only: even if a caller bypassed validation, the current
        // generic builder does not leak the extra sampling fields to direct routes.
        let base = provider_base_url(provider, None).unwrap();
        let (_, body) = build_openai_compatible_request(&request, &base);
        assert!(body.get("top_p").is_none(), "{provider:?} unexpectedly emitted top_p");
        assert!(body.get("top_k").is_none(), "{provider:?} unexpectedly emitted top_k");
        assert!(body.get("seed").is_none(), "{provider:?} unexpectedly emitted seed");
    }
}

#[test]
fn direct1c_emits_mistral_sampling_with_random_seed_wire_name() {
    let mut request = chat_request(ProviderKind::Mistral, "mistral-medium-3-5");
    request.top_p = Some(0.7);
    request.top_k = Some(100);
    request.seed = Some(42);

    validate_chat_request(&request).unwrap();
    let (_, body) = build_openai_compatible_request(&request, "https://api.mistral.ai/v1");
    assert_eq!(body.get("top_p"), Some(&json!(0.7)));
    assert_eq!(body.get("top_k"), Some(&json!(100)));
    assert_eq!(body.get("random_seed"), Some(&json!(42)));
    assert!(body.get("seed").is_none(), "Mistral must not receive the Harness/OpenRouter seed wire name");
    assert!(body.get("provider").is_none(), "OpenRouter routing must never leak into Mistral direct");
}

#[test]
fn direct1c_mistral_auto_omits_all_optional_sampling_fields() {
    let request = chat_request(ProviderKind::Mistral, "mistral-medium-3-5");
    validate_chat_request(&request).unwrap();
    let (_, body) = build_openai_compatible_request(&request, "https://api.mistral.ai/v1");
    assert!(body.get("top_p").is_none());
    assert!(body.get("top_k").is_none());
    assert!(body.get("random_seed").is_none());
    assert!(body.get("seed").is_none());
}

#[test]
fn direct1a_extracts_mistral_nested_thinking_from_fixture_without_leaking_it_into_final() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../src/providers/direct-compat-fixtures/mistral-nested-thinking-response.json"
    ))
    .expect("DIRECT-1A Mistral nested-thinking fixture must be valid JSON");

    let parsed = parse_chat_response(ProviderKind::Mistral, fixture, None).unwrap();
    assert_eq!(parsed.content, "final");
    assert_eq!(parsed.finish_reason.as_deref(), Some("stop"));
    assert_eq!(parsed.reasoning_content.as_deref(), Some("reasoning"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("mistral_thinking"));
}

#[test]
fn direct1a_extracts_multiple_nested_mistral_thinking_text_items_in_order() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../src/providers/direct-compat-fixtures/mistral-nested-thinking-multi-response.json"
    ))
    .expect("DIRECT-1A multi-part Mistral fixture must be valid JSON");
    let parsed = parse_chat_response(ProviderKind::Mistral, fixture, None).unwrap();

    assert_eq!(parsed.reasoning_content.as_deref(), Some("first second"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("mistral_thinking"));
    assert_eq!(parsed.content, "visible thinking word stays final");
}

#[test]
fn validates_openrouter_sampling_transport_ranges() {
    let manual_sampling_routing = || OpenRouterProviderRouting {
        order: vec![],
        only: vec!["provider-a/fp8".to_string()],
        ignore: vec![],
        allow_fallbacks: Some(true),
        require_parameters: Some(true),
    };

    let mut request = chat_request(ProviderKind::Openrouter, "sampling/model");
    request.top_p = Some(1.01);
    request.provider_routing = Some(manual_sampling_routing());
    assert!(validate_chat_request(&request).unwrap_err().contains("top_p"));

    let mut request = chat_request(ProviderKind::Openrouter, "sampling/model");
    request.top_k = Some(9_007_199_254_740_992);
    request.provider_routing = Some(manual_sampling_routing());
    assert!(validate_chat_request(&request).unwrap_err().contains("top_k"));

    let mut request = chat_request(ProviderKind::Openrouter, "sampling/model");
    request.seed = Some(9_007_199_254_740_992);
    request.provider_routing = Some(manual_sampling_routing());
    assert!(validate_chat_request(&request).unwrap_err().contains("seed"));
}

#[test]
fn parses_selected_openrouter_provider_metadata_when_present() {
    let parsed = parse_openai_compatible_response(json!({
        "model": "qwen/qwen3-32b",
        "choices": [{ "message": { "content": "ok" }, "finish_reason": "stop" }],
        "usage": { "prompt_tokens": 10, "completion_tokens": 2 },
        "openrouter_metadata": {
            "endpoints": {
                "available": [
                    { "provider": "DeepInfra", "selected": false },
                    { "provider": "SiliconFlow", "selected": true }
                ]
            }
        }
    }), None).unwrap();
    assert_eq!(parsed.actual_provider.as_deref(), Some("SiliconFlow"));
}

#[test]
fn parses_openrouter_stream_provider_from_top_level_fallback() {
    let parsed = parse_openai_compatible_response(json!({
        "model": "qwen/qwen3-32b",
        "provider": "SiliconFlow",
        "choices": [{ "message": { "content": "ok" }, "finish_reason": "stop" }],
        "usage": { "prompt_tokens": 10, "completion_tokens": 2 }
    }), None).unwrap();
    assert_eq!(parsed.actual_provider.as_deref(), Some("SiliconFlow"));
}

// S1 — PROVIDER-STREAMING-CORE-1
fn stream_reasoning_detail(id: &str, text: &str, index: u64) -> Value {
    json!({
        "type": "reasoning.text",
        "text": text,
        "signature": null,
        "id": id,
        "format": "anthropic-claude-v1",
        "index": index,
    })
}

fn openrouter_stream_canonicalization_fixture() -> Value {
    serde_json::from_str(include_str!("../../../src/providers/continuation-fixtures/openrouter-stream-canonicalization.json"))
        .expect("shared OpenRouter stream fixture must be valid JSON")
}

fn finish_accumulator(mut accumulator: OpenRouterStreamAccumulator) -> super::streaming::StreamingChatResult {
    accumulator
        .process_data_with_events(
            &json!({"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}).to_string(),
            "secret",
            None,
        )
        .unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", None).unwrap();
    accumulator.finish(None).unwrap()
}

#[test]
fn stream_accumulator_canonicalizes_confirmed_summary_fragmentation_and_preserves_opaque_blocks() {
    let fixture = openrouter_stream_canonicalization_fixture();
    let deltas = fixture.get("summaryDeltas").and_then(Value::as_array).unwrap();
    let expected = fixture.get("summaryExpected").and_then(Value::as_array).unwrap();
    let mut accumulator = OpenRouterStreamAccumulator::default();
    for detail in deltas {
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [detail]}, "finish_reason": null}]
        }).to_string(), "secret", None).unwrap();
    }
    let result = finish_accumulator(accumulator);
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details"), Some(&Value::Array(expected.clone())));
    assert_eq!(result.continuation_diagnostics.received_reasoning_detail_items, 4);
    assert_eq!(result.continuation_diagnostics.logical_reasoning_blocks, 2);
    assert!(result.continuation_diagnostics.reasoning_details_present);
}

#[test]
fn stream_accumulator_merges_contiguous_text_and_late_signature_but_respects_distinct_ids() {
    let fixture = openrouter_stream_canonicalization_fixture();
    let mut accumulator = OpenRouterStreamAccumulator::default();
    for detail in fixture.get("textDeltas").and_then(Value::as_array).unwrap() {
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [detail]}, "finish_reason": null}]
        }).to_string(), "secret", None).unwrap();
    }
    let result = finish_accumulator(accumulator);
    assert_eq!(
        result.payload.pointer("/choices/0/message/reasoning_details"),
        fixture.get("textExpected")
    );

    let mut distinct = OpenRouterStreamAccumulator::default();
    for detail in fixture.get("distinctSameType").and_then(Value::as_array).unwrap() {
        distinct.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [detail]}, "finish_reason": null}]
        }).to_string(), "secret", None).unwrap();
    }
    let distinct_result = finish_accumulator(distinct);
    assert_eq!(
        distinct_result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).map(Vec::len),
        Some(2)
    );

    let mut signature_only = OpenRouterStreamAccumulator::default();
    signature_only.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "text": "thinking", "signature": null,
            "id": "rt_signature", "format": "anthropic-claude-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    signature_only.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "signature": "late-signature",
            "id": "rt_signature", "format": "anthropic-claude-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let signature_result = finish_accumulator(signature_only);
    assert_eq!(
        signature_result.payload.pointer("/choices/0/message/reasoning_details/0"),
        Some(&json!({
            "type": "reasoning.text", "text": "thinking", "signature": "late-signature",
            "id": "rt_signature", "format": "anthropic-claude-v1", "index": 0
        }))
    );

    let mut ambiguous_signature = OpenRouterStreamAccumulator::default();
    ambiguous_signature.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "text": "thinking", "signature": null,
            "id": "rt_a", "format": "anthropic-claude-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    ambiguous_signature.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "signature": "wrong-block",
            "id": "rt_b", "format": "anthropic-claude-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let ambiguous_result = finish_accumulator(ambiguous_signature);
    assert_eq!(
        ambiguous_result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).map(Vec::len),
        Some(2)
    );

    let mut missing_then_concrete_id = OpenRouterStreamAccumulator::default();
    missing_then_concrete_id.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "text": "A", "format": "openai-responses-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    missing_then_concrete_id.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "text": "B", "id": "rt_late",
            "format": "openai-responses-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let missing_then_concrete_result = finish_accumulator(missing_then_concrete_id);
    assert_eq!(
        missing_then_concrete_result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).map(Vec::len),
        Some(2)
    );
    assert!(missing_then_concrete_result.payload.pointer("/choices/0/message/reasoning_details/0/id").is_none());
    assert_eq!(missing_then_concrete_result.payload.pointer("/choices/0/message/reasoning_details/1/id"), Some(&json!("rt_late")));

    let mut concrete_then_missing_id = OpenRouterStreamAccumulator::default();
    concrete_then_missing_id.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "text": "A", "id": "rt_first",
            "format": "openai-responses-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    concrete_then_missing_id.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.text", "text": "B", "format": "openai-responses-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let concrete_then_missing_result = finish_accumulator(concrete_then_missing_id);
    assert_eq!(
        concrete_then_missing_result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).map(Vec::len),
        Some(2)
    );

    let mut repeated = OpenRouterStreamAccumulator::default();
    for _ in 0..2 {
        repeated.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [{
                "type": "reasoning.summary", "summary": "same", "id": null,
                "format": "openai-responses-v1", "index": 0
            }]}}]
        }).to_string(), "secret", None).unwrap();
    }
    let repeated_result = finish_accumulator(repeated);
    assert_eq!(
        repeated_result.payload.pointer("/choices/0/message/reasoning_details/0/summary"),
        Some(&json!("samesame"))
    );
}

#[test]
fn stream_accumulator_preserves_missing_empty_and_nonempty_reasoning_details_semantics() {
    let empty_only = {
        let mut accumulator = OpenRouterStreamAccumulator::default();
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": []}, "finish_reason": null}]
        }).to_string(), "secret", None).unwrap();
        finish_accumulator(accumulator)
    };
    assert_eq!(empty_only.payload.pointer("/choices/0/message/reasoning_details"), Some(&json!([])));
    assert!(empty_only.continuation_diagnostics.reasoning_details_present);

    let missing = finish_accumulator(OpenRouterStreamAccumulator::default());
    assert!(missing.payload.pointer("/choices/0/message/reasoning_details").is_none());
    assert!(!missing.continuation_diagnostics.reasoning_details_present);

    let detail = stream_reasoning_detail("r1", "fragment", 0);
    for order in ["empty_then_block", "block_then_empty", "block_then_missing"] {
        let mut accumulator = OpenRouterStreamAccumulator::default();
        if order == "empty_then_block" {
            accumulator.process_data_with_events(&json!({"choices":[{"delta":{"reasoning_details":[]}}]}).to_string(), "secret", None).unwrap();
        }
        accumulator.process_data_with_events(&json!({"choices":[{"delta":{"reasoning_details":[detail.clone()]}}]}).to_string(), "secret", None).unwrap();
        if order == "block_then_empty" {
            accumulator.process_data_with_events(&json!({"choices":[{"delta":{"reasoning_details":[]}}]}).to_string(), "secret", None).unwrap();
        } else if order == "block_then_missing" {
            accumulator.process_data_with_events(&json!({"choices":[{"delta":{"content":""}}]}).to_string(), "secret", None).unwrap();
        }
        let result = finish_accumulator(accumulator);
        assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0"), Some(&detail), "{order}");
    }
}

#[test]
fn stream_accumulator_treats_null_as_absent_and_invalid_non_null_as_semantic_fail_closed() {
    let explicit_null = {
        let mut accumulator = OpenRouterStreamAccumulator::default();
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": null}}]
        }).to_string(), "secret", None).unwrap();
        finish_accumulator(accumulator)
    };
    assert!(explicit_null.payload.pointer("/choices/0/message/reasoning_details").is_none());
    assert!(!explicit_null.continuation_diagnostics.reasoning_details_present);

    for invalid in [json!({"unexpected": true}), json!("invalid"), json!(7), json!(true)] {
        let mut accumulator = OpenRouterStreamAccumulator::default();
        let error = accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": invalid}}]
        }).to_string(), "secret", None).unwrap_err();
        assert_eq!(error.code.as_ref(), "invalid_provider_json");
        assert_eq!(error.metadata.semantic_output_started, Some(true));
    }

    let mut after_valid = OpenRouterStreamAccumulator::default();
    after_valid.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [stream_reasoning_detail("r1", "ok", 0)]}}]
    }).to_string(), "secret", None).unwrap();
    let error = after_valid.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": {"unexpected": true}}}]
    }).to_string(), "secret", None).unwrap_err();
    assert_eq!(error.code.as_ref(), "invalid_provider_json");
    assert_eq!(error.metadata.semantic_output_started, Some(true));
}

#[test]
fn stream_accumulator_collapses_many_confirmed_deltas_before_block_limit_validation() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    for index in 0..1000 {
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [{
                "type": "reasoning.summary",
                "summary": format!("s{index}"),
                "id": null,
                "format": "openai-responses-v1",
                "index": 0
            }]}}]
        }).to_string(), "secret", None).unwrap();
    }
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.encrypted",
            "data": "RklYVFVSRQ==",
            "id": "opaque",
            "format": "openai-responses-v1",
            "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let result = finish_accumulator(accumulator);
    assert_eq!(result.continuation_diagnostics.received_reasoning_detail_items, 1001);
    assert_eq!(result.continuation_diagnostics.logical_reasoning_blocks, 2);
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/summary").and_then(Value::as_str).map(str::len), Some(3890));
}

#[test]
fn stream_accumulator_preserves_type_boundaries_when_summary_and_encrypted_share_index_zero() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    for detail in [
        json!({"type":"reasoning.summary","summary":"first","index":0}),
        json!({"type":"reasoning.encrypted","data":"opaque","index":0}),
        json!({"type":"reasoning.summary","summary":"second","index":0}),
    ] {
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [detail]}, "finish_reason": null}]
        }).to_string(), "secret", None).unwrap();
    }
    let result = finish_accumulator(accumulator);
    let details = result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).unwrap();
    assert_eq!(details.len(), 3);
    assert_eq!(details[0].get("summary"), Some(&json!("first")));
    assert_eq!(details[1].get("data"), Some(&json!("opaque")));
    assert_eq!(details[2].get("summary"), Some(&json!("second")));
}

#[test]
fn stream_accumulator_merges_signature_only_delta_with_null_text_into_compatible_text_block() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type":"reasoning.text","text":"thinking","id":"rt","format":"anthropic-claude-v1","index":0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type":"reasoning.text","text":null,"signature":"sig","id":"rt","format":"anthropic-claude-v1","index":0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let result = finish_accumulator(accumulator);
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/text"), Some(&json!("thinking")));
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/signature"), Some(&json!("sig")));
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).map(Vec::len), Some(1));
}


#[test]
fn stream_accumulator_preserves_late_signature_after_visible_content_without_duplicate_ui_content() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let reasoning_events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type":"reasoning.text","text":"thinking","id":"rt-late-after-content","format":"anthropic-claude-v1","index":0
        }]}, "finish_reason": null}]
    }).to_string(), "secret", None).unwrap();
    assert!(reasoning_events.is_empty());

    let content_events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content":"Visible answer"}, "finish_reason": null}]
    }).to_string(), "secret", None).unwrap();
    assert_eq!(content_events.len(), 1);
    assert!(matches!(&content_events[0], ProviderStreamEvent::ContentDelta { content } if content == "Visible answer"));

    let signature_events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type":"reasoning.text","text":null,"signature":"late-signature-after-content",
            "id":"rt-late-after-content","format":"anthropic-claude-v1","index":0
        }]}, "finish_reason": null}]
    }).to_string(), "secret", None).unwrap();
    assert!(signature_events.is_empty(), "late continuation metadata must not duplicate visible UI content");

    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {}, "finish_reason":"stop"}]
    }).to_string(), "secret", None).unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", None).unwrap();
    let result = accumulator.finish(None).unwrap();
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/text"), Some(&json!("thinking")));
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/signature"), Some(&json!("late-signature-after-content")));
    assert_eq!(result.payload.pointer("/choices/0/message/content"), Some(&json!("Visible answer")));
}

#[test]
fn stream_metadata_only_reasoning_fragment_survives_transport_but_remains_fail_closed_for_replay() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type":"reasoning.text","id":"rt-metadata-only","format":"anthropic-claude-v1","index":0
        }]}, "finish_reason": null}]
    }).to_string(), "secret", None).unwrap();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content":"Visible answer"}, "finish_reason":"stop"}],
        "usage": {"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}
    }).to_string(), "secret", None).unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", None).unwrap();
    let streamed = accumulator.finish(None).unwrap();
    let parsed = parse_chat_response(ProviderKind::Openrouter, streamed.payload, None).unwrap();
    assert_eq!(parsed.content, "Visible answer");
    let detail = parsed.reasoning_details.as_ref().and_then(|items| items.first()).unwrap();
    let replay_error = validate_openrouter_reasoning_detail(detail, 0).unwrap_err();
    assert!(replay_error.contains("missing_replay_data"));
    assert_eq!(parsed.usage.total_tokens, Some(4));
}

#[test]
fn stream_accumulator_does_not_merge_independent_opaque_blocks_even_when_stream_index_repeats() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    for index in 0..65 {
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"reasoning_details": [{
                "type": "reasoning.encrypted",
                "data": format!("opaque-{index}"),
                "id": format!("e{index}"),
                "format": "openai-responses-v1",
                "index": 0
            }]}}]
        }).to_string(), "secret", None).unwrap();
    }
    let result = finish_accumulator(accumulator);
    assert_eq!(result.continuation_diagnostics.logical_reasoning_blocks, 65);
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details").and_then(Value::as_array).map(Vec::len), Some(65));
}

#[test]
fn sse_decoder_handles_chunk_boundaries_multiline_events_and_split_utf8() {
    let mut decoder = SseDecoder::default();
    let wire = "data: {\"choices\":[{\"delta\":{\"content\":\"Zażółć\"}}]}\n\ndata: first\ndata: second\n\n: OPENROUTER PROCESSING\n\n".as_bytes();
    let split = wire.iter().position(|byte| *byte >= 0x80).unwrap() + 1;
    let mut frames = Vec::new();
    frames.extend(decoder.push(&wire[..split]).unwrap());
    frames.extend(decoder.push(&wire[split..split + 3]).unwrap());
    frames.extend(decoder.push(&wire[split + 3..]).unwrap());
    assert_eq!(frames.len(), 3);
    assert!(matches!(&frames[0], SseFrame::Data(value) if value.contains("Zażółć")));
    assert_eq!(frames[1], SseFrame::Data("first\nsecond".to_string()));
    assert_eq!(frames[2], SseFrame::Comment);
}

fn canonical_reasoning_from_sse_chunks(wire: &[u8], chunk_lengths: &[usize]) -> (Value, u64) {
    let mut decoder = SseDecoder::default();
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let mut offset = 0usize;
    for requested in chunk_lengths {
        if offset >= wire.len() { break; }
        let end = offset.saturating_add(*requested).min(wire.len());
        for frame in decoder.push(&wire[offset..end]).unwrap() {
            if let SseFrame::Data(data) = frame {
                accumulator.process_data_with_events(&data, "secret", None).unwrap();
            }
        }
        offset = end;
    }
    if offset < wire.len() {
        for frame in decoder.push(&wire[offset..]).unwrap() {
            if let SseFrame::Data(data) = frame {
                accumulator.process_data_with_events(&data, "secret", None).unwrap();
            }
        }
    }
    for frame in decoder.finish().unwrap() {
        if let SseFrame::Data(data) = frame {
            accumulator.process_data_with_events(&data, "secret", None).unwrap();
        }
    }
    let result = accumulator.finish(None).unwrap();
    (
        result.payload.pointer("/choices/0/message/reasoning_details").cloned().unwrap_or(Value::Null),
        result.continuation_diagnostics.raw_sse_events,
    )
}

#[test]
fn canonicalization_is_independent_of_network_chunking_json_boundaries_and_split_utf8() {
    let fixture = openrouter_stream_canonicalization_fixture();
    let deltas = fixture.get("summaryDeltas").and_then(Value::as_array).unwrap();
    let mut events = Vec::new();
    for (index, detail) in deltas.iter().enumerate() {
        let content = if index == 0 { "Zażółć" } else { "" };
        events.push(format!(
            "data: {}\n\n",
            json!({"choices":[{"delta":{"content":content,"reasoning_details":[detail]},"finish_reason":null}]})
        ));
    }
    events.push(format!(
        "data: {}\n\n",
        json!({"choices":[{"delta":{"content":""},"finish_reason":"stop"}]})
    ));
    events.push(format!("data: {}\n\n", json!({"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}})));
    events.push("data: [DONE]\n\n".to_string());
    let wire = events.concat().into_bytes();
    let utf8_start = wire.windows("ż".len()).position(|window| window == "ż".as_bytes()).unwrap();
    let split_inside_utf8 = utf8_start + 1;

    let whole = canonical_reasoning_from_sse_chunks(&wire, &[wire.len()]);
    let bytewise = canonical_reasoning_from_sse_chunks(&wire, &vec![1; wire.len()]);
    let utf8_split = canonical_reasoning_from_sse_chunks(&wire, &[split_inside_utf8, 1, 7, 3, 11]);
    let json_split = canonical_reasoning_from_sse_chunks(&wire, &[13, 5, 2, 17, 1, 29]);

    assert_eq!(whole.0, Value::Array(fixture.get("summaryExpected").and_then(Value::as_array).unwrap().clone()));
    assert_eq!(whole, bytewise);
    assert_eq!(whole, utf8_split);
    assert_eq!(whole, json_split);
}

#[test]
fn partial_failed_stream_state_is_not_inherited_by_a_fresh_accumulator() {
    let mut interrupted = OpenRouterStreamAccumulator::default();
    interrupted.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.summary", "summary": "partial", "id": null,
            "format": "openai-responses-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let failure = interrupted.finish(None).unwrap_err();
    assert_eq!(failure.code.as_ref(), "response_body_read");
    assert_eq!(failure.metadata.semantic_output_started, Some(true));

    let mut fresh = OpenRouterStreamAccumulator::default();
    fresh.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [{
            "type": "reasoning.summary", "summary": "fresh", "id": null,
            "format": "openai-responses-v1", "index": 0
        }]}}]
    }).to_string(), "secret", None).unwrap();
    let result = finish_accumulator(fresh);
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/summary"), Some(&json!("fresh")));
    assert_eq!(result.continuation_diagnostics.received_reasoning_detail_items, 1);
    assert_eq!(result.continuation_diagnostics.logical_reasoning_blocks, 1);
}

#[test]
fn sse_decoder_rejects_oversized_unterminated_event() {
    let mut decoder = SseDecoder::default();
    let oversized = vec![b'x'; MAX_PENDING_SSE_EVENT_BYTES + 1];
    let error = decoder.push(&oversized).unwrap_err();
    assert_eq!(error.code.as_ref(), "response_body_too_large");
    assert!(error.message.contains("maximum buffered event size"));
}

#[test]
fn stream_accumulator_bounds_total_data_and_preserves_semantic_retry_boundary() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let detail_text = "r".repeat(512 * 1024);
    let mut saw_limit = None;
    for index in 0..64u64 {
        let event = json!({
            "choices": [{
                "delta": {
                    "reasoning_details": [stream_reasoning_detail(&format!("r{index}"), &detail_text, index)]
                },
                "finish_reason": null
            }]
        }).to_string();
        match accumulator.process_data_with_events(&event, "secret", Some("stream-limit")) {
            Ok(_) => {}
            Err(error) => {
                saw_limit = Some(error);
                break;
            }
        }
    }
    let error = saw_limit.expect("stream accumulation must be bounded");
    assert_eq!(error.code.as_ref(), "response_body_too_large");
    assert_eq!(error.metadata.semantic_output_started, Some(true));
    const { assert!(MAX_ACCUMULATED_STREAM_DATA_BYTES >= 8 * 1024 * 1024) };
}

#[test]
fn stream_accumulator_accepts_large_but_bounded_valid_output() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let content = "x".repeat(512 * 1024);
    for _ in 0..4 {
        accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"content": content.clone()}, "finish_reason": null}]
        }).to_string(), "secret", None).unwrap();
    }
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": ""}, "finish_reason": "stop"}],
        "usage": {"completion_tokens": 10}
    }).to_string(), "secret", None).unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", None).unwrap();
    let result = accumulator.finish(None).unwrap();
    assert_eq!(result.payload.pointer("/choices/0/message/content").and_then(Value::as_str).map(str::len), Some(2 * 1024 * 1024));
}

#[test]
fn stream_accumulator_preserves_reasoning_details_usage_and_terminal_state() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({
        "id": "gen-1",
        "model": "model-actual",
        "provider": "SiliconFlow",
        "choices": [{"delta": {"reasoning": "think ", "reasoning_details": [stream_reasoning_detail("r1", "a", 0)]}, "finish_reason": null}]
    }).to_string(), "secret", Some("header-id")).unwrap();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning": "more", "reasoning_details": [stream_reasoning_detail("r2", "b", 1)], "content": "answer"}, "finish_reason": "stop"}]
    }).to_string(), "secret", Some("header-id")).unwrap();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": ""}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 7, "total_tokens": 17}
    }).to_string(), "secret", Some("header-id")).unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", Some("header-id")).unwrap();
    let result = accumulator.finish(Some("header-id".to_string())).unwrap();
    assert!(result.semantic_output_started);
    assert_eq!(result.payload.pointer("/choices/0/message/content"), Some(&json!("answer")));
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning"), Some(&json!("think more")));
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/id"), Some(&json!("r1")));
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/1/id"), Some(&json!("r2")));
    assert_eq!(result.payload.pointer("/usage/total_tokens"), Some(&json!(17)));
    assert_eq!(result.payload.get("provider"), Some(&json!("SiliconFlow")));
}

#[test]
fn metadata_only_stream_frames_do_not_cross_first_semantic_chunk_boundary() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({
        "id": "gen-1",
        "model": "model",
        "choices": [{"delta": {"role": "assistant", "content": ""}, "finish_reason": null}]
    }).to_string(), "secret", None).unwrap();
    assert!(!accumulator.semantic_output_started);
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"reasoning_details": [stream_reasoning_detail("r1", "thinking", 0)]}, "finish_reason": null}]
    }).to_string(), "secret", None).unwrap();
    assert!(accumulator.semantic_output_started);
}

#[test]
fn midstream_error_records_whether_semantic_output_already_started() {
    let error_event = json!({"error": {"type": "server", "code": "upstream_disconnect", "message": "gone"}, "choices": [{"delta": {}, "finish_reason": "error"}]}).to_string();
    let mut before = OpenRouterStreamAccumulator::default();
    let error = before.process_data_with_events(&error_event, "secret", Some("r")).unwrap_err();
    assert_eq!(error.metadata.semantic_output_started, None);

    let mut after = OpenRouterStreamAccumulator::default();
    after.process_data_with_events(&json!({"choices":[{"delta":{"content":"partial"}}]}).to_string(), "secret", None).unwrap();
    let error = after.process_data_with_events(&error_event, "secret", Some("r")).unwrap_err();
    assert_eq!(error.metadata.semantic_output_started, Some(true));

    let same_event = json!({
        "error": {"type": "server", "code": "upstream_disconnect", "message": "gone"},
        "choices": [{"delta": {"content": "partial-in-error-frame"}, "finish_reason": "error"}]
    }).to_string();
    let mut same_frame = OpenRouterStreamAccumulator::default();
    let error = same_frame.process_data_with_events(&same_event, "secret", Some("r")).unwrap_err();
    assert_eq!(error.metadata.semantic_output_started, Some(true));
}

#[test]
fn malformed_stream_event_and_abrupt_eof_are_failures_and_keep_retry_boundary() {
    let mut before = OpenRouterStreamAccumulator::default();
    let error = before.process_data_with_events("{broken", "secret", None).unwrap_err();
    assert_eq!(error.metadata.semantic_output_started, None);

    let mut after = OpenRouterStreamAccumulator::default();
    after.process_data_with_events(&json!({"choices":[{"delta":{"content":"partial"}}]}).to_string(), "secret", None).unwrap();
    let error = after.finish(None).unwrap_err();
    assert_eq!(error.code.as_ref(), "response_body_read");
    assert_eq!(error.metadata.semantic_output_started, Some(true));
}

#[test]
fn stream_tool_delta_is_semantic_even_before_visible_text() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call-1"}]}}]
    }).to_string(), "secret", None).unwrap();
    assert!(accumulator.semantic_output_started);
}

fn short_stream_policy(first_ms: u64, idle_ms: u64, emergency_ms: u64) -> ProviderTimeoutPolicy {
    ProviderTimeoutPolicy {
        timeout_class: "interactive".to_string(),
        first_event_timeout_ms: first_ms,
        idle_timeout_ms: idle_ms,
        absolute_emergency_timeout_ms: emergency_ms,
        non_streaming_timeout_ms: first_ms,
    }
}

async fn read_stream_request(socket: &mut TcpStream) {
    let mut request = Vec::new();
    loop {
        let mut chunk = [0u8; 1024];
        let count = socket.read(&mut chunk).await.unwrap();
        if count == 0 { break; }
        request.extend_from_slice(&chunk[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") { break; }
    }
}

async fn start_sse_server(steps: Vec<(u64, &'static str)>) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_stream_request(&mut socket).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Generation-Id: gen-header-1\r\nConnection: close\r\n\r\n").await.unwrap();
        for (delay_ms, text) in steps {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            if socket.write_all(text.as_bytes()).await.is_err() { break; }
            let _ = socket.flush().await;
        }
    });
    (format!("http://{address}/chat/completions"), handle)
}


fn streamed_visible_text(events: &[ProviderStreamEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            ProviderStreamEvent::ContentDelta { content } => Some(content.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

#[test]
fn s2_stream_accumulator_emits_visible_deltas_without_exposing_continuation_payloads() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {
            "content": "visible",
            "reasoning": "private-reasoning",
            "reasoning_details": [{"type":"reasoning.text","text":"secret-state"}]
        }, "finish_reason": null}]
    }).to_string(), "secret", Some("s2-test")).unwrap();
    assert!(matches!(&events[0], ProviderStreamEvent::ContentDelta { content } if content == "visible"));
    assert_eq!(events.len(), 1);
    let done = accumulator.process_data_with_events("[DONE]", "secret", Some("s2-test")).unwrap();
    assert!(matches!(&done[0], ProviderStreamEvent::Finished { .. }));
    let result = accumulator.finish(Some("s2-test".to_string())).unwrap();
    assert_eq!(result.payload.pointer("/choices/0/message/reasoning_details/0/text"), Some(&json!("secret-state")));
}


#[test]
fn s2_live_filter_hides_tagged_reasoning_without_changing_raw_accumulation() {
    let cases = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<reason>", "</reason>"),
        ("<reasoning>", "</reasoning>"),
        ("<thought>", "</thought>"),
        ("<|begin_of_thought|>", "<|end_of_thought|>"),
    ];

    for (open, close) in cases {
        let mut accumulator = OpenRouterStreamAccumulator::default();
        let raw = format!("{open}PRIVATE{close} VISIBLE");
        let events = accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"content": raw.clone()}, "finish_reason": "stop"}]
        }).to_string(), "secret", Some("privacy-tags")).unwrap();
        assert_eq!(streamed_visible_text(&events), " VISIBLE");
        accumulator.process_data_with_events("[DONE]", "secret", Some("privacy-tags")).unwrap();
        let result = accumulator.finish(Some("privacy-tags".to_string())).unwrap();
        assert_eq!(result.payload.pointer("/choices/0/message/content").and_then(Value::as_str), Some(raw.as_str()));
    }
}

#[test]
fn s2_live_filter_holds_split_reasoning_tags_until_visibility_is_known() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let first = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": "<thi"}, "finish_reason": null}]
    }).to_string(), "secret", Some("privacy-split-open")).unwrap();
    assert!(streamed_visible_text(&first).is_empty());
    let second = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": "nk>secret</think>Visible"}, "finish_reason": "stop"}]
    }).to_string(), "secret", Some("privacy-split-open")).unwrap();
    assert_eq!(streamed_visible_text(&second), "Visible");

    let mut closing = OpenRouterStreamAccumulator::default();
    let first = closing.process_data_with_events(&json!({
        "choices": [{"delta": {"content": "<think>secret</thi"}, "finish_reason": null}]
    }).to_string(), "secret", Some("privacy-split-close")).unwrap();
    assert!(streamed_visible_text(&first).is_empty());
    let second = closing.process_data_with_events(&json!({
        "choices": [{"delta": {"content": "nk>Visible"}, "finish_reason": "stop"}]
    }).to_string(), "secret", Some("privacy-split-close")).unwrap();
    assert_eq!(streamed_visible_text(&second), "Visible");
}

#[test]
fn s2_live_filter_handles_multiple_reasoning_blocks_and_plain_text() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": "<think>x</think><reason>y</reason>ABC"}, "finish_reason": null}]
    }).to_string(), "secret", Some("privacy-multiple")).unwrap();
    assert_eq!(streamed_visible_text(&events), "ABC");
    let plain = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": " normal visible text"}, "finish_reason": "stop"}]
    }).to_string(), "secret", Some("privacy-multiple")).unwrap();
    assert_eq!(streamed_visible_text(&plain), " normal visible text");
}

#[test]
fn s2_live_filter_suppresses_typed_reasoning_parts_but_keeps_visible_parts() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": [
            {"type": "reasoning", "text": "hidden reasoning"},
            {"type": "output_text", "text": "visible final"}
        ]}, "finish_reason": "stop"}]
    }).to_string(), "secret", Some("privacy-typed")).unwrap();
    assert_eq!(streamed_visible_text(&events), "visible final");
}

#[test]
fn s2_live_filter_never_flushes_incomplete_reasoning_to_ui() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let events = accumulator.process_data_with_events(&json!({
        "choices": [{"delta": {"content": "<think>private reasoning only"}, "finish_reason": "length"}]
    }).to_string(), "secret", Some("privacy-incomplete")).unwrap();
    assert!(streamed_visible_text(&events).is_empty());
    let done = accumulator.process_data_with_events("[DONE]", "secret", Some("privacy-incomplete")).unwrap();
    assert!(streamed_visible_text(&done).is_empty());
    assert!(matches!(done.last(), Some(ProviderStreamEvent::Finished { .. })));
}


#[tokio::test]
async fn direct1d_mistral_stream_reconstructs_thinking_final_usage_and_replay_content() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_simulator_request(&mut socket).await;
        let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
        let json: Value = serde_json::from_str(body).unwrap();
        assert_eq!(json.get("stream"), Some(&json!(true)));
        assert!(json.get("stream_options").is_none());
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Request-Id: mistral-stream-1\r\nConnection: close\r\n\r\n").await.unwrap();
        socket.write_all(b": keepalive\n\n").await.unwrap();
        socket.write_all(b"data: {\"id\":\"mistral-gen\",\"model\":\"mistral-medium-3-5\",\"choices\":[{\"delta\":{\"content\":[{\"type\":\"thinking\",\"thinking\":[{\"type\":\"text\",\"text\":\"reason \"}]}]},\"finish_reason\":null}]}\n\n").await.unwrap();
        socket.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"thinking\",\"thinking\":[{\"type\":\"text\",\"text\":\"more\"}]},{\"type\":\"text\",\"text\":\"final \"}]},\"finish_reason\":null}]}\n\n").await.unwrap();
        socket.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}\n\n").await.unwrap();
        socket.write_all(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":5,\"total_tokens\":12}}\n\n").await.unwrap();
        socket.write_all(b"data: [DONE]\n\n").await.unwrap();
    });

    let base = format!("http://{address}");
    let request = chat_request(ProviderKind::Mistral, "mistral-medium-3-5");
    let (url, mut body) = build_chat_request(&request, &base).unwrap();
    enable_mistral_chat_streaming(&mut body).unwrap();
    let result = send_mistral_streaming_chat_request(
        authenticated(client().unwrap().post(url).json(&body), ProviderKind::Mistral, "simulator-secret"),
        None,
        "simulator-secret",
        &short_stream_policy(500, 500, 2_000),
        None,
    ).await.unwrap();
    assert_eq!(result.payload.pointer("/choices/0/message/content/0/type"), Some(&json!("thinking")));
    assert_eq!(result.payload.pointer("/choices/0/message/content/0/thinking/0/text"), Some(&json!("reason more")));
    assert_eq!(result.payload.pointer("/choices/0/message/content/1/text"), Some(&json!("final answer")));
    let parsed = parse_chat_response(ProviderKind::Mistral, result.payload, result.request_id).unwrap();
    assert_eq!(parsed.content, "final answer");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("reason more"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("mistral_thinking"));
    assert_eq!(parsed.usage.total_tokens, Some(12));
    assert_eq!(parsed.provider_request_id.as_deref(), Some("mistral-stream-1"));
    assert_eq!(parsed.reasoning_details.as_ref().and_then(|parts| parts.first()).and_then(|part| part.get("type")), Some(&json!("thinking")));
    server.await.unwrap();
}

#[tokio::test]
async fn direct1d_mistral_stream_accepts_done_without_usage() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_simulator_request(&mut socket).await;
        let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
        let json: Value = serde_json::from_str(body).unwrap();
        assert_eq!(json.get("stream"), Some(&json!(true)));
        assert!(json.get("stream_options").is_none());
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Request-Id: mistral-stream-no-usage\r\nConnection: close\r\n\r\n").await.unwrap();
        socket.write_all(b"data: {\"id\":\"mistral-gen-no-usage\",\"model\":\"mistral-medium-3-5\",\"choices\":[{\"delta\":{\"content\":\"final without usage\"},\"finish_reason\":\"stop\"}]}\n\n").await.unwrap();
        socket.write_all(b"data: [DONE]\n\n").await.unwrap();
    });

    let base = format!("http://{address}");
    let request = chat_request(ProviderKind::Mistral, "mistral-medium-3-5");
    let (url, mut body) = build_chat_request(&request, &base).unwrap();
    enable_mistral_chat_streaming(&mut body).unwrap();
    let result = send_mistral_streaming_chat_request(
        authenticated(client().unwrap().post(url).json(&body), ProviderKind::Mistral, "simulator-secret"),
        None,
        "simulator-secret",
        &short_stream_policy(500, 500, 2_000),
        None,
    ).await.unwrap();
    let parsed = parse_chat_response(ProviderKind::Mistral, result.payload, result.request_id).unwrap();
    assert_eq!(parsed.content, "final without usage");
    assert_eq!(parsed.usage.total_tokens, None);
    assert_eq!(parsed.provider_request_id.as_deref(), Some("mistral-stream-no-usage"));
    server.await.unwrap();
}

#[tokio::test]
async fn direct1d_mistral_stream_rejects_eof_without_done_after_reasoning() {
    let (url, server) = start_sse_server(vec![(10, "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"thinking\",\"thinking\":[{\"type\":\"text\",\"text\":\"partial\"}]}]},\"finish_reason\":null}]}\n\n")]).await;
    let error = send_mistral_streaming_chat_request(
        reqwest::Client::new().post(url), None, "secret", &short_stream_policy(500, 500, 2_000), None,
    ).await.unwrap_err();
    assert_eq!(error.code.as_ref(), "response_body_read");
    assert_eq!(error.metadata.semantic_output_started, Some(true));
    server.await.unwrap();
}

#[tokio::test]
async fn custom_openai_streaming_sends_stream_true_and_accepts_reasoning_usage_and_done() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_simulator_request(&mut socket).await;
        let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
        let json: Value = serde_json::from_str(body).unwrap();
        assert_eq!(json.get("stream"), Some(&json!(true)));
        assert_eq!(json.get("model"), Some(&json!("custom-model")));
        assert!(json.get("provider").is_none());
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Request-Id: custom-stream-1\r\nConnection: close\r\n\r\n").await.unwrap();
        socket.write_all(b": keepalive\n\n").await.unwrap();
        socket.write_all(b"data: {\"id\":\"gen-custom\",\"model\":\"custom-model-runtime\",\"choices\":[{\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\"private\"},\"finish_reason\":null}]}\n\n").await.unwrap();
        socket.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"visible final\"},\"finish_reason\":\"stop\"}]}\n\n").await.unwrap();
        socket.write_all(b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n").await.unwrap();
        socket.write_all(b"data: [DONE]\n\n").await.unwrap();
    });
    let base = format!("http://{address}");
    let request = chat_request(ProviderKind::CustomOpenai, "custom-model");
    let (url, mut body) = build_chat_request(&request, &base).unwrap();
    enable_chat_streaming(&mut body).unwrap();
    let result = send_custom_openai_streaming_chat_request(
        authenticated(client().unwrap().post(url).json(&body), ProviderKind::CustomOpenai, "simulator-secret"),
        None,
        "simulator-secret",
        &short_stream_policy(500, 500, 2_000),
        None,
    ).await.unwrap();
    let parsed = parse_chat_response(ProviderKind::CustomOpenai, result.payload, result.request_id).unwrap();
    assert_eq!(parsed.content, "visible final");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("private"));
    assert_eq!(parsed.finish_reason.as_deref(), Some("stop"));
    assert_eq!(parsed.actual_model.as_deref(), Some("custom-model-runtime"));
    assert_eq!(parsed.usage.total_tokens, Some(5));
    assert_eq!(parsed.provider_request_id.as_deref(), Some("custom-stream-1"));
    server.await.unwrap();
}

#[tokio::test]
async fn custom_openai_streaming_rejects_eof_without_done_after_partial_output() {
    let (url, server) = start_sse_server(vec![(10, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n")]).await;
    let error = send_custom_openai_streaming_chat_request(
        reqwest::Client::new().post(url), None, "secret", &short_stream_policy(500, 500, 2_000), None,
    ).await.unwrap_err();
    assert_eq!(error.code.as_ref(), "response_body_read");
    assert_eq!(error.metadata.semantic_output_started, Some(true));
    server.await.unwrap();
}

#[tokio::test]
async fn stream_activity_resets_idle_timeout_without_a_whole_request_cap() {
    let (url, server) = start_sse_server(vec![
        (50, ": OPENROUTER PROCESSING\n\n"),
        (100, "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n"),
        (100, "data: {\"choices\":[{\"delta\":{\"content\":\" world\"},\"finish_reason\":\"stop\"}]}\n\n"),
        (100, "data: {\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":2}}\n\n"),
        (100, "data: [DONE]\n\n"),
    ]).await;
    let http = reqwest::Client::new();
    let result = send_openrouter_streaming_chat_request(
        http.post(url),
        None,
        "secret",
        &short_stream_policy(150, 250, 1_500),
        None,
    ).await.unwrap();
    assert_eq!(result.payload.pointer("/choices/0/message/content"), Some(&json!("hello world")));
    assert_eq!(result.payload.pointer("/usage/total_tokens"), Some(&json!(2)));
    assert_eq!(result.request_id.as_deref(), Some("gen-header-1"));
    server.await.unwrap();
}

async fn start_sse_byte_server(steps: Vec<(u64, Vec<u8>)>) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_stream_request(&mut socket).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").await.unwrap();
        for (delay_ms, bytes) in steps {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            if socket.write_all(&bytes).await.is_err() { break; }
            let _ = socket.flush().await;
        }
    });
    (format!("http://{address}/chat/completions"), handle)
}

#[tokio::test]
async fn oversized_pending_event_after_semantic_output_closes_retry_boundary() {
    let semantic = b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n".to_vec();
    let oversized = vec![b'x'; MAX_PENDING_SSE_EVENT_BYTES + 1];
    let (url, server) = start_sse_byte_server(vec![(10, semantic), (10, oversized)]).await;
    let http = reqwest::Client::new();
    let error = send_openrouter_streaming_chat_request(
        http.post(url),
        None,
        "secret",
        &short_stream_policy(500, 500, 2_000),
        None,
    ).await.unwrap_err();
    assert_eq!(error.code.as_ref(), "response_body_too_large");
    assert_eq!(error.metadata.semantic_output_started, Some(true));
    server.await.unwrap();
}

#[tokio::test]
async fn emergency_ceiling_remains_bounded_even_when_keepalives_continue() {
    let (url, server) = start_sse_server(vec![
        (50, ": OPENROUTER PROCESSING\n\n"),
        (100, ": OPENROUTER PROCESSING\n\n"),
        (100, ": OPENROUTER PROCESSING\n\n"),
        (100, ": OPENROUTER PROCESSING\n\n"),
        (100, "data: [DONE]\n\n"),
    ]).await;
    let http = reqwest::Client::new();
    let error = send_openrouter_streaming_chat_request(
        http.post(url),
        None,
        "secret",
        &short_stream_policy(200, 250, 400),
        None,
    ).await.unwrap_err();
    assert_eq!(error.code.as_ref(), "timeout");
    assert!(error.message.contains("emergency"));
    assert_eq!(error.metadata.semantic_output_started, None);
    server.await.unwrap();
}

#[tokio::test]
async fn genuinely_idle_stream_times_out_without_creating_semantic_output() {
    let (url, server) = start_sse_server(vec![
        (50, ": OPENROUTER PROCESSING\n\n"),
        (450, "data: [DONE]\n\n"),
    ]).await;
    let http = reqwest::Client::new();
    let error = send_openrouter_streaming_chat_request(
        http.post(url),
        None,
        "secret",
        &short_stream_policy(300, 150, 1_000),
        None,
    ).await.unwrap_err();
    assert_eq!(error.code.as_ref(), "timeout");
    assert_eq!(error.metadata.semantic_output_started, None);
    server.await.unwrap();
}

#[tokio::test]
async fn user_cancellation_aborts_an_active_stream() {
    let (url, server) = start_sse_server(vec![
        (50, ": OPENROUTER PROCESSING\n\n"),
        (1_000, "data: [DONE]\n\n"),
    ]).await;
    let http = reqwest::Client::new();
    let task = tokio::spawn(async move {
        send_openrouter_streaming_chat_request(
            http.post(url),
            Some("stream-cancel-1"),
            "secret",
            &short_stream_policy(300, 1_200, 2_000),
            None,
        ).await
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(super::transport::cancel_request("stream-cancel-1".to_string()).unwrap());
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.code.as_ref(), "cancelled");
    server.await.unwrap();
}

#[test]
#[ignore = "orchestrated by verify:openrouter-continuation-bridge"]
fn openrouter_cross_language_bridge_emit_from_rust_stream() {
    let output_path = std::env::var("AI_RV_BRIDGE_RUST_OUT").expect("AI_RV_BRIDGE_RUST_OUT is required");
    let fixture: Value = serde_json::from_str(include_str!("../../../src/providers/continuation-fixtures/openrouter-compatibility-v2.json")).unwrap();
    let bridge = fixture.get("bridge").unwrap();
    let mut accumulator = OpenRouterStreamAccumulator::default();
    for event in bridge.get("sseDataEvents").and_then(Value::as_array).unwrap() {
        accumulator
            .process_data_with_events(&serde_json::to_string(event).unwrap(), "secret", Some("bridge-request"))
            .unwrap();
    }
    accumulator.process_data_with_events("[DONE]", "secret", Some("bridge-request")).unwrap();
    let streamed = accumulator.finish(Some("bridge-request".to_string())).unwrap();
    let parsed = parse_chat_response(ProviderKind::Openrouter, streamed.payload, streamed.request_id).unwrap();
    let reasoning_details = parsed.reasoning_details.expect("bridge response must carry reasoning_details");
    assert_eq!(
        Value::Array(reasoning_details.clone()),
        bridge.get("expectedReasoningDetails").cloned().unwrap()
    );
    let invalid_payload = bridge.get("invalidProviderResponse").cloned().expect("bridge invalidProviderResponse fixture is required");
    let invalid = parse_chat_response(ProviderKind::Openrouter, invalid_payload, Some("bridge-invalid-request".to_string()))
        .expect("completed OpenRouter response must survive invalid continuation metadata");
    let output = json!({
        "content": parsed.content,
        "reasoningDetails": reasoning_details,
        "modelId": bridge.get("modelId").unwrap(),
        "normalizedEndpoint": bridge.get("normalizedEndpoint").unwrap(),
        "providerConfigId": bridge.get("providerConfigId").unwrap(),
        "credentialId": bridge.get("credentialId").unwrap(),
        "invalidResponse": {
            "content": invalid.content,
            "reasoningContent": invalid.reasoning_content,
            "reasoningDetails": invalid.reasoning_details,
            "reasoningSource": invalid.reasoning_source,
            "finishReason": invalid.finish_reason,
            "actualModel": invalid.actual_model,
            "usage": {
                "inputTokens": invalid.usage.input_tokens,
                "outputTokens": invalid.usage.output_tokens,
                "reasoningTokens": invalid.usage.reasoning_tokens,
                "totalTokens": invalid.usage.total_tokens,
                "costUsd": invalid.usage.cost_usd
            },
            "providerRequestId": invalid.provider_request_id,
            "actualProvider": invalid.actual_provider
        }
    });
    std::fs::write(output_path, serde_json::to_vec_pretty(&output).unwrap()).unwrap();
}

#[test]
#[ignore = "orchestrated by verify:openrouter-continuation-bridge"]
fn openrouter_cross_language_bridge_replays_ts_restored_state_in_rust_request_builder() {
    let input_path = std::env::var("AI_RV_BRIDGE_TS_OUT").expect("AI_RV_BRIDGE_TS_OUT is required");
    let output_path = std::env::var("AI_RV_BRIDGE_RUST_REPLAY_OUT").expect("AI_RV_BRIDGE_RUST_REPLAY_OUT is required");
    let input: Value = serde_json::from_slice(&std::fs::read(input_path).unwrap()).unwrap();
    let state: ProviderContinuationState = serde_json::from_value(input.get("state").cloned().unwrap()).unwrap();
    let expected_details = input.pointer("/state/reasoningDetails").cloned().unwrap();
    let model_id = input.get("modelId").and_then(Value::as_str).unwrap();
    let endpoint = input.get("normalizedEndpoint").and_then(Value::as_str).unwrap();

    let mut request = chat_request(ProviderKind::Openrouter, model_id);
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "Visible answer.".to_string(),
        images: vec![],
        continuation_state: Some(state),
    }];
    validate_continuation_bindings(&request, endpoint).unwrap();
    let (_, body) = build_openai_compatible_request(&request, endpoint);
    let replayed = body.pointer("/messages/0/reasoning_details").cloned().unwrap();
    assert_eq!(replayed, expected_details);
    std::fs::write(output_path, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
}

// R1: transport completion and semantic validation remain independent.
async fn r1_body_fixture(body: &str, extra_length: usize) -> Result<(Value, Option<String>), ProviderCallError> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let wire = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nX-Request-Id: r1-header\r\nConnection: close\r\n\r\n{}", body.len() + extra_length, body);
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_simulator_request(&mut socket).await;
        socket.write_all(wire.as_bytes()).await.unwrap();
        socket.shutdown().await.unwrap();
    });
    let result = super::transport::send_chat_request(reqwest::Client::new().post(format!("http://{address}")), None, "test-secret").await;
    server.await.unwrap();
    result
}

#[tokio::test]
async fn r1_full_body_reasoning_only_rejection_keeps_safe_finished_evidence() {
    let body = json!({"id":"gen-r1","choices":[{"message":{"content":"","reasoning":"PRIVATE_REASONING"},"finish_reason":"stop"}],"usage":{"completion_tokens":20,"completion_tokens_details":{"reasoning_tokens":19},"total_tokens":25}});
    let (payload, id) = r1_body_fixture(&body.to_string(), 0).await.unwrap();
    let proof = super::response_evidence::finished(Some(&payload), id.as_deref(), "body_read");
    let failure = parse_finished_chat_response(ProviderKind::Openrouter, &payload, id, false, proof).unwrap_err();
    let wire = serde_json::to_value(&failure).unwrap();
    assert_eq!(wire["responseEvidence"]["transportOutcome"], "response_finished");
    assert_eq!(wire["responseEvidence"]["boundary"], "body_read");
    assert_eq!(wire["responseEvidence"]["finishReason"], "stop");
    assert_eq!(wire["responseEvidence"]["generationId"], "gen-r1");
    assert_eq!(wire["responseEvidence"]["usage"]["reasoningTokens"], 19);
    assert!(wire["responseEvidence"]["usage"]["costUsd"].is_null());
    assert!(!serde_json::to_string(&wire).unwrap().contains("PRIVATE_REASONING"));
}

#[tokio::test]
async fn r1_complete_invalid_json_is_finished_but_broken_body_is_not() {
    let failure = r1_body_fixture("not valid json", 0).await.unwrap_err();
    assert_eq!(failure.code.as_ref(), "invalid_provider_json");
    assert!(failure.metadata.response_evidence.is_some());
    let failure = r1_body_fixture("{", 100).await.unwrap_err();
    assert!(failure.metadata.response_evidence.is_none());
}

#[test]
fn r1_full_rejected_structure_and_empty_content_keep_proof() {
    for payload in [json!({"choices":[]}), json!({"choices":[{"message":{"content":""},"finish_reason":"stop"}]})] {
        let proof = super::response_evidence::finished(Some(&payload), None, "body_read");
        let failure = parse_finished_chat_response(ProviderKind::Openrouter, &payload, None, false, proof).unwrap_err();
        assert!(failure.metadata.response_evidence.is_some());
    }
}

#[test]
fn r1_done_reasoning_only_is_rejected_with_proof_and_final_content_stays_accepted() {
    for content in ["", "The actual final response"] {
        let mut accumulator = OpenRouterStreamAccumulator::default();
        accumulator.process_data_with_events(&json!({"id":"gen-r1","choices":[{"delta":{"reasoning":"PRIVATE","content":content},"finish_reason":"stop"}],"usage":{"total_tokens":25}}).to_string(), "secret", Some("header")).unwrap();
        accumulator.process_data_with_events("[DONE]", "secret", Some("header")).unwrap();
        let streamed = accumulator.finish(Some("header".into())).unwrap();
        let result = parse_finished_chat_response(ProviderKind::Openrouter, &streamed.payload, streamed.request_id, streamed.semantic_output_started, streamed.response_evidence);
        let proof = if content.is_empty() { result.unwrap_err().metadata.response_evidence.unwrap() } else { let response = result.unwrap(); assert_eq!(response.content, content); response.response_evidence.unwrap() };
        let wire = serde_json::to_value(proof).unwrap();assert_eq!(wire["boundary"], "sse_done");assert_eq!(wire["usage"]["totalTokens"], 25);assert!(!wire.to_string().contains("PRIVATE"));
    }
}

#[test]
fn r1_stop_finish_reason_without_done_is_not_completion_proof() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({"choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}]}).to_string(), "secret", Some("header")).unwrap();
    assert!(accumulator.finish(Some("header".into())).unwrap_err().metadata.response_evidence.is_none());
}

#[test]
fn r1_malformed_stream_frame_never_creates_completion_proof() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    assert!(accumulator.process_data_with_events("{malformed", "secret", Some("header")).unwrap_err().metadata.response_evidence.is_none());
    assert!(accumulator.finish(Some("header".into())).unwrap_err().metadata.response_evidence.is_none());
}

#[tokio::test]
async fn r1_pre_dispatch_cancel_keeps_completion_unknown() {
    super::transport::cancel_request("r1-pre-cancel".into()).unwrap();
    let error = super::transport::run_cancellable_chat_request(Some("r1-pre-cancel"), "reading_body", async { Ok::<(), ProviderCallError>(()) }).await.unwrap_err();
    assert_eq!(error.phase.as_ref(), "before_dispatch");assert!(error.metadata.response_evidence.is_none());
}

#[test]
fn r1_boxed_metadata_preserves_flat_ipc_including_all_completion_evidence() {
    let payload = json!({"id":"gen-flat","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":2},"total_tokens":12,"cost":0.03}});
    let mut error = ProviderCallError::new("unknown", "rejected output", "validating_response");
    error.metadata.http_status = Some(200);
    error.metadata.provider_error_type = Some("invalid_output".into());
    error.metadata.provider_code = Some("rejected".into());
    error.metadata.retry_after_ms = Some(1_000);
    error.metadata.provider_request_id = Some("request-flat".into());
    error.metadata.semantic_output_started = Some(true);
    error.metadata.response_evidence = Some(super::response_evidence::finished(Some(&payload), Some("request-flat"), "sse_done"));
    let cloned = error.clone();
    assert_eq!(serde_json::to_value(cloned).unwrap(), json!({
        "code":"unknown", "message":"rejected output", "phase":"validating_response",
        "httpStatus":200, "providerErrorType":"invalid_output", "providerCode":"rejected",
        "retryAfterMs":1000, "providerRequestId":"request-flat", "semanticOutputStarted":true,
        "responseEvidence":{
            "version":1,"transportOutcome":"response_finished","boundary":"sse_done",
            "finishReason":"stop","providerRequestId":"request-flat","generationId":"gen-flat",
            "usage":{"inputTokens":5,"outputTokens":7,"reasoningTokens":2,"totalTokens":12,"costUsd":0.03}
        }
    }));
}

#[test]
fn t2_json_literals_and_unicode_survive_native_reasoning_normalization() {
    for text in [
        r#"{"decision":"UPDATE","notes":"Do not print <think> markers.","changeSummary":"Clean output"}"#,
        r#"{"decision":"UPDATE","notes":"Literal <think>example</think> stays.","changeSummary":"Żółć 🌍 \"quote\" \\escape"}"#,
        "Plain text with literal <reason>example</reason> remains.",
    ] {
        assert!(split_tagged_reasoning(text).is_none());
        let payload = json!({"choices":[{"message":{"content":text,"reasoning":"PRIVATE"},"finish_reason":"stop"}]});
        let proof = super::response_evidence::finished(Some(&payload), Some("t2-header"), "body_read");
        let parsed = parse_finished_chat_response(ProviderKind::Openrouter, &payload, Some("t2-header".to_string()), false, proof).unwrap();
        assert_eq!(parsed.content, text);
        assert_eq!(parsed.reasoning_content.as_deref(), Some("PRIVATE"));
        let candidate = parsed.final_candidate.unwrap();
        assert_eq!(candidate.content.as_deref(), Some(text));
        assert_eq!(candidate.native_validation, "accepted");
        assert!(!candidate.envelope_removed);
        use sha2::{Digest, Sha256};
        assert_eq!(candidate.content_sha256, format!("{:x}", Sha256::digest(text.as_bytes())));
        assert!(!serde_json::to_string(&candidate).unwrap().contains("PRIVATE"));
    }
}

#[test]
fn t2_candidate_survives_native_rejection_and_is_bounded_without_truncation() {
    let text = r#"{"notes":"literal <think> and </think> are data"}"#;
    let payload = json!({"choices":[{"message":{"content":text,"reasoning":"PRIVATE","reasoning_details":"invalid"},"finish_reason":"stop"}]});
    let proof = super::response_evidence::finished(Some(&payload), Some("t2-rejected"), "body_read");
    let failure = parse_finished_chat_response(ProviderKind::Openrouter, &payload, Some("t2-rejected".to_string()), false, proof).unwrap_err();
    let wire = serde_json::to_value(&failure).unwrap();
    assert_eq!(wire["finalCandidate"]["content"], text);
    assert_eq!(wire["finalCandidate"]["nativeValidation"], "rejected");
    assert_eq!(wire["providerRequestId"], "t2-rejected");
    assert!(!wire.to_string().contains("PRIVATE"));
    assert!(std::mem::size_of::<ProviderCallError>() < 128);
    let huge = "x".repeat(2_000_001);
    let payload = json!({"choices":[{"message":{"content":huge}}]});
    let candidate = super::response_parsers::capture_final_candidate(ProviderKind::Openrouter, &payload).unwrap();
    assert!(candidate.content.is_none());
    assert!(candidate.omitted_for_size);
    assert_eq!(candidate.byte_length, 2_000_001);
}

#[test]
fn t2_prefix_envelopes_exclude_private_reasoning_from_candidates() {
    for raw in [" \n<think>PRIVATE</think>{\"notes\":\"literal <think>\"}", "<THINK>PRIVATE</THINK><reason>PRIVATE2</reason>{\"notes\":\"literal <think>\"}"] {
        let payload = json!({"choices":[{"message":{"content":raw}}]});
        let candidate = super::response_parsers::capture_final_candidate(ProviderKind::Openrouter, &payload).unwrap();
        assert_eq!(candidate.content.as_deref(), Some("{\"notes\":\"literal <think>\"}"));
        assert!(candidate.envelope_removed);
        assert!(!serde_json::to_string(&candidate).unwrap().contains("PRIVATE"));
    }
    let payload = json!({"choices":[{"message":{"content":"<think>PRIVATE unclosed"}}]});
    let candidate = super::response_parsers::capture_final_candidate(ProviderKind::Openrouter, &payload).unwrap();
    assert_eq!(candidate.content.as_deref(), Some(""));
}

#[test]
fn t2_stream_and_final_parser_agree_at_every_unicode_chunk_boundary() {
    for (raw, expected) in [
        ("{\"notes\":\"Żółć 🌍 <think>literal</think>\"}", "{\"notes\":\"Żółć 🌍 <think>literal</think>\"}"),
        ("<think>PRIVATE</think>{\"notes\":\"Żółć <think> literal\"}", "{\"notes\":\"Żółć <think> literal\"}"),
        ("<think>PRIVATE</think><reason>PRIVATE2</reason>Plain <think>literal</think>", "Plain <think>literal</think>"),
    ] {
        for boundary in raw.char_indices().map(|(i, _)| i).chain(std::iter::once(raw.len())) {
            let mut accumulator = OpenRouterStreamAccumulator::default();
            let mut visible = String::new();
            for (chunk, finish) in [(&raw[..boundary], Value::Null), (&raw[boundary..], json!("stop"))] {
                let events = accumulator.process_data_with_events(&json!({"choices":[{"delta":{"content":chunk},"finish_reason":finish}]}).to_string(), "test-secret", Some("t2-stream")).unwrap();
                visible.push_str(&streamed_visible_text(&events));
            }
            let events = accumulator.process_data_with_events("[DONE]", "test-secret", Some("t2-stream")).unwrap();
            visible.push_str(&streamed_visible_text(&events));
            let result = accumulator.finish(Some("t2-stream".to_string())).unwrap();
            let parsed = parse_finished_chat_response(ProviderKind::Openrouter, &result.payload, result.request_id, result.semantic_output_started, result.response_evidence).unwrap();
            assert_eq!(visible, expected, "boundary {boundary}");
            assert_eq!(parsed.content, expected);
            assert_eq!(parsed.final_candidate.unwrap().content.as_deref(), Some(expected));
        }
    }
}

#[test]
fn t2_explicit_reasoning_fields_never_become_final_candidates() {
    let text = "{\"notes\":\"literal <think>\"}";
    let payload = json!({"choices":[{"message":{"content":[{"type":"reasoning","text":"PRIVATE_A"},{"thinking":"PRIVATE_B"},{"reasoning":"PRIVATE_C"},{"type":"output_text","text":text}],"reasoning":"PRIVATE_D"}}]});
    let candidate = super::response_parsers::capture_final_candidate(ProviderKind::Openrouter, &payload).unwrap();
    assert_eq!(candidate.content.as_deref(), Some(text));
    assert!(!serde_json::to_string(&candidate).unwrap().contains("PRIVATE"));
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({"choices":[{"delta":{"content":payload.pointer("/choices/0/message/content").unwrap().clone()},"finish_reason":"stop"}]}).to_string(), "secret", Some("t2-typed")).unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", Some("t2-typed")).unwrap();
    let streamed = accumulator.finish(Some("t2-typed".to_string())).unwrap();
    let parsed = parse_finished_chat_response(ProviderKind::Openrouter, &streamed.payload, streamed.request_id, streamed.semantic_output_started, streamed.response_evidence).unwrap();
    assert_eq!(parsed.content, text);
    assert!(!serde_json::to_string(&parsed.final_candidate).unwrap().contains("PRIVATE"));
}

#[test]
fn t2_google_and_signed_anthropic_candidates_exclude_separate_thought_channels() {
    let text = r#"{"notes":"literal <think>example</think>"}"#;
    for (provider, payload) in [
        (ProviderKind::Google, json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"PRIVATE"},{"text":text}]},"finishReason":"STOP"}]})),
        (ProviderKind::Anthropic, json!({"content":[{"type":"thinking","thinking":"PRIVATE","signature":"opaque"},{"type":"text","text":text}],"stop_reason":"end_turn"})),
    ] {
        let proof = super::response_evidence::finished(Some(&payload), Some("t2-provider"), "body_read");
        let parsed = parse_finished_chat_response(provider, &payload, Some("t2-provider".to_string()), false, proof).unwrap();
        assert_eq!(parsed.content, text);
        let candidate = parsed.final_candidate.unwrap();
        assert_eq!(candidate.content.as_deref(), Some(text));
        assert!(!serde_json::to_string(&candidate).unwrap().contains("PRIVATE"));
    }
}

#[test]
fn t2_stream_preserves_metadata_usage_and_finish_reasons_across_frames() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    accumulator.process_data_with_events(&json!({
        "id": "t2-response", "model": "test-model", "provider": "test-provider",
        "openrouter_metadata": {"route": "test-route"},
        "choices": [{"delta": {"content": "final"}, "finish_reason": "stop", "native_finish_reason": "end_turn"}]
    }).to_string(), "secret", Some("t2-request")).unwrap();
    accumulator.process_data_with_events(&json!({
        "choices": [], "usage": {"completion_tokens": 7}
    }).to_string(), "secret", Some("t2-request")).unwrap();
    accumulator.process_data_with_events("[DONE]", "secret", Some("t2-request")).unwrap();
    let result = accumulator.finish(Some("t2-request".to_string())).unwrap();
    assert_eq!(result.request_id.as_deref(), Some("t2-request"));
    assert_eq!(result.payload["id"], "t2-response");
    assert_eq!(result.payload["model"], "test-model");
    assert_eq!(result.payload["provider"], "test-provider");
    assert_eq!(result.payload["openrouter_metadata"]["route"], "test-route");
    assert_eq!(result.payload["usage"]["completion_tokens"], 7);
    assert_eq!(result.payload["choices"][0]["message"]["content"], "final");
    assert_eq!(result.payload["choices"][0]["finish_reason"], "stop");
    assert_eq!(result.payload["choices"][0]["native_finish_reason"], "end_turn");
    assert!(result.semantic_output_started);
}

#[test]
fn t2_error_frame_with_typed_reasoning_closes_retry_boundary() {
    let mut accumulator = OpenRouterStreamAccumulator::default();
    let error = accumulator.process_data_with_events(&json!({
        "error": {"type": "server", "code": "upstream_disconnect", "message": "gone"},
        "choices": [{"delta": {"content": [{"type": "reasoning", "text": "private"}]}}]
    }).to_string(), "secret", Some("t2-request")).unwrap_err();
    assert_eq!(error.metadata.semantic_output_started, Some(true));
    assert_eq!(error.metadata.provider_request_id.as_deref(), Some("t2-request"));
}

#[tokio::test]
async fn native_window_destruction_aborts_bound_transport_without_js_callback() {
    use crate::{workflow_heartbeat as heartbeat, workflow_ownership::{execute, Request}};
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    sqlx::raw_sql("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT); CREATE TABLE profiles(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO profiles VALUES('p',NULL);").execute(&pool).await.unwrap();
    let token: heartbeat::Token = serde_json::from_value(execute(&pool, Request::Acquire { profile_id: "p".into(), owner: "transport-owner".into() }).await.unwrap()).unwrap();
    let window = "native-transport-window";
    let id = "native-window-bound-request";
    heartbeat::start(pool, token.clone(), window.into(), None).unwrap();
    let binding = serde_json::from_value(json!({"profileId":"p","owner":token.owner,"version":token.version,"entities":[{"kind":"profile","id":"p"}]})).unwrap();
    let guard = heartbeat::bind(&binding, window, id).await.unwrap();
    let (ready, started) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        super::transport::run_cancellable_chat_request(Some(id), "reading_body", async {
            ready.send(()).unwrap();
            std::future::pending::<Result<(), ProviderCallError>>().await
        }).await
    });
    started.await.unwrap();
    heartbeat::window_destroyed(window);
    let error = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap().unwrap_err();
    assert_eq!(error.code.as_ref(), "cancelled");
    assert!(guard.failure().unwrap().contains("window closed"));
}


#[test]
fn direct1b_mistral_parser_preserves_complete_assistant_content_for_replay() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../src/providers/continuation-fixtures/mistral-assistant-content.json"
    ))
    .expect("DIRECT-1B Mistral continuation fixture must be valid JSON");
    let payload = fixture.get("providerResponse").cloned().expect("providerResponse");
    let expected_content = fixture.pointer("/continuationState/content").and_then(Value::as_array).cloned().unwrap();
    let parsed = super::response_parsers::parse_chat_response(ProviderKind::Mistral, payload, None).unwrap();
    assert_eq!(parsed.content, "final");
    assert_eq!(parsed.reasoning_content.as_deref(), Some("reasoning"));
    assert_eq!(parsed.reasoning_source.as_deref(), Some("mistral_thinking"));
    assert_eq!(parsed.reasoning_details, Some(expected_content));
}

#[test]
fn direct1b_replays_complete_mistral_assistant_content_on_bound_message() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../src/providers/continuation-fixtures/mistral-assistant-content.json"
    ))
    .expect("DIRECT-1B Mistral continuation fixture must be valid JSON");
    let content = fixture.pointer("/continuationState/content").and_then(Value::as_array).cloned().unwrap();
    let mut request = chat_request(ProviderKind::Mistral, "mistral-large-latest");
    request.messages = vec![
        ProviderMessage {
            role: "user".to_string(),
            content: "first".to_string(),
            images: vec![],
            continuation_state: None,
        },
        ProviderMessage {
            role: "assistant".to_string(),
            content: "final".to_string(),
            images: vec![],
            continuation_state: Some(ProviderContinuationState::Mistral(MistralContinuationState {
                schema_version: 1,
                transport: "mistral-native".to_string(),
                format: "mistral-assistant-content".to_string(),
                replay_fingerprint: ProviderReplayFingerprint {
                    transport: "mistral-native".to_string(),
                    normalized_endpoint: "https://api.mistral.ai/v1".to_string(),
                    provider_config_id: "provider-config".to_string(),
                    credential_id: "credential".to_string(),
                    requested_model_id: "mistral-large-latest".to_string(),
                    actual_model_id: None,
                    state_format: "mistral-assistant-content".to_string(),
                    state_format_version: 1,
                },
                content: content.clone(),
            })),
        },
        ProviderMessage {
            role: "user".to_string(),
            content: "continue".to_string(),
            images: vec![],
            continuation_state: None,
        },
    ];
    validate_chat_request(&request).unwrap();
    validate_continuation_bindings(&request, "https://api.mistral.ai/v1").unwrap();
    let (_, body) = build_openai_compatible_request(&request, "https://api.mistral.ai/v1");
    assert_eq!(body.pointer("/messages/1/content"), Some(&Value::Array(content)));
    assert_eq!(body.pointer("/messages/1/role"), Some(&json!("assistant")));
}

#[test]
fn direct1b_rejects_mistral_replay_when_visible_text_or_fingerprint_changes() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../src/providers/continuation-fixtures/mistral-assistant-content.json"
    ))
    .expect("DIRECT-1B Mistral continuation fixture must be valid JSON");
    let content = fixture.pointer("/continuationState/content").and_then(Value::as_array).cloned().unwrap();
    let state = MistralContinuationState {
        schema_version: 1,
        transport: "mistral-native".to_string(),
        format: "mistral-assistant-content".to_string(),
        replay_fingerprint: ProviderReplayFingerprint {
            transport: "mistral-native".to_string(),
            normalized_endpoint: "https://api.mistral.ai/v1".to_string(),
            provider_config_id: "provider-config".to_string(),
            credential_id: "credential".to_string(),
            requested_model_id: "mistral-large-latest".to_string(),
            actual_model_id: None,
            state_format: "mistral-assistant-content".to_string(),
            state_format_version: 1,
        },
        content,
    };
    let mut request = chat_request(ProviderKind::Mistral, "mistral-large-latest");
    request.messages = vec![ProviderMessage {
        role: "assistant".to_string(),
        content: "changed".to_string(),
        images: vec![],
        continuation_state: Some(ProviderContinuationState::Mistral(state.clone())),
    }];
    assert!(validate_continuation_bindings(&request, "https://api.mistral.ai/v1").unwrap_err().contains("do not match"));

    request.messages[0].content = "final".to_string();
    if let Some(ProviderContinuationState::Mistral(state)) = request.messages[0].continuation_state.as_mut() {
        state.replay_fingerprint.credential_id = "other".to_string();
    }
    assert!(validate_continuation_bindings(&request, "https://api.mistral.ai/v1").unwrap_err().contains("fingerprint"));
}
