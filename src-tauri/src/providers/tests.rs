use super::*;
use super::adapters::{normalized_credential_endpoint, provider_family, validate_base_url, ProviderFamily, OPENROUTER_APP_REFERER, OPENROUTER_APP_TITLE};

#[test]
fn openrouter_app_attribution_uses_public_project_page() {
    assert_eq!(
        OPENROUTER_APP_REFERER,
        "https://lukeskytorep-bot.github.io/AI-RV-Harness/"
    );
    assert_eq!(OPENROUTER_APP_TITLE, "AI RV Harness");
}
use super::reasoning::split_tagged_reasoning;
use super::endpoint_capabilities::openrouter_model_endpoints_url;
use super::errors::safe_provider_error;
use super::request_builders::{build_anthropic_request, build_google_request, build_openai_compatible_request, enable_openrouter_streaming};
use super::response_parsers::{parse_anthropic_response, parse_google_response, parse_openai_compatible_response};
use super::streaming::{
    send_openrouter_streaming_chat_request, OpenRouterStreamAccumulator, ProviderStreamEvent, SseDecoder, SseFrame,
    MAX_ACCUMULATED_STREAM_DATA_BYTES, MAX_PENDING_SSE_EVENT_BYTES,
};
use super::transport::retry_after_value_ms_at;
use super::validation::{validate_chat_request, validate_continuation_bindings, validate_request_id};

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
        reasoning_transport_kind: None,
        reasoning_transport_value: None,
        temperature: None,
        max_output_tokens: None,
        custom_output_token_field: None,
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
    enable_openrouter_streaming(&mut body).unwrap();
    assert_eq!(body.get("stream"), Some(&json!(true)));
    assert!(body.get("stream_options").is_none());
    assert_eq!(body.get("model"), Some(&json!("qwen/qwen3-32b")));
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
    assert!(std::mem::size_of::<ProviderCallError>() <= 128);
    let mut error = ProviderCallError::new("timeout", "request timed out", "awaiting_headers");
    error.http_status = Some(504);
    error.provider_error_type = Some("upstream_timeout".into());
    error.provider_code = Some("gateway_timeout".into());
    error.retry_after_ms = Some(1_000);
    error.provider_request_id = Some("request-1".into());

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
        ProviderContinuationState::Google(_) | ProviderContinuationState::Anthropic(_) => {
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
fn blackbox_uses_the_documented_openai_compatible_routes() {
    let request = chat_request(ProviderKind::Blackbox, "blackboxai/openai/gpt-5");
    let base = provider_base_url(ProviderKind::Blackbox, Some("https://ignored.example/v1")).unwrap();
    assert_eq!(base, "https://api.blackbox.ai");
    let (url, body) = build_chat_request(&request, &base).unwrap();
    assert_eq!(url, "https://api.blackbox.ai/chat/completions");
    assert_eq!(body.get("model"), Some(&json!("blackboxai/openai/gpt-5")));
    assert_eq!(endpoint(&base, "models"), "https://api.blackbox.ai/models");
}

#[tokio::test]
async fn openrouter_requests_include_application_attribution_headers() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_simulator_request(&mut socket).await;
        let headers = request.to_ascii_lowercase();
        assert!(headers.contains("authorization: bearer simulator-secret"));
        assert!(headers.contains(&format!(
            "http-referer: {}",
            OPENROUTER_APP_REFERER.to_ascii_lowercase()
        )));
        assert!(headers.contains(&format!(
            "x-openrouter-title: {}",
            OPENROUTER_APP_TITLE.to_ascii_lowercase()
        )));
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
    assert_eq!(error.semantic_output_started, Some(true));
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
    assert_eq!(error.semantic_output_started, None);

    let mut after = OpenRouterStreamAccumulator::default();
    after.process_data_with_events(&json!({"choices":[{"delta":{"content":"partial"}}]}).to_string(), "secret", None).unwrap();
    let error = after.process_data_with_events(&error_event, "secret", Some("r")).unwrap_err();
    assert_eq!(error.semantic_output_started, Some(true));

    let same_event = json!({
        "error": {"type": "server", "code": "upstream_disconnect", "message": "gone"},
        "choices": [{"delta": {"content": "partial-in-error-frame"}, "finish_reason": "error"}]
    }).to_string();
    let mut same_frame = OpenRouterStreamAccumulator::default();
    let error = same_frame.process_data_with_events(&same_event, "secret", Some("r")).unwrap_err();
    assert_eq!(error.semantic_output_started, Some(true));
}

#[test]
fn malformed_stream_event_and_abrupt_eof_are_failures_and_keep_retry_boundary() {
    let mut before = OpenRouterStreamAccumulator::default();
    let error = before.process_data_with_events("{broken", "secret", None).unwrap_err();
    assert_eq!(error.semantic_output_started, None);

    let mut after = OpenRouterStreamAccumulator::default();
    after.process_data_with_events(&json!({"choices":[{"delta":{"content":"partial"}}]}).to_string(), "secret", None).unwrap();
    let error = after.finish(None).unwrap_err();
    assert_eq!(error.code.as_ref(), "response_body_read");
    assert_eq!(error.semantic_output_started, Some(true));
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
        let raw = format!("before {open}PRIVATE{close} VISIBLE");
        let events = accumulator.process_data_with_events(&json!({
            "choices": [{"delta": {"content": raw.clone()}, "finish_reason": "stop"}]
        }).to_string(), "secret", Some("privacy-tags")).unwrap();
        assert_eq!(streamed_visible_text(&events), "before  VISIBLE");
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
        "choices": [{"delta": {"content": "A<think>x</think>B<reason>y</reason>C"}, "finish_reason": null}]
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
    assert_eq!(error.semantic_output_started, Some(true));
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
    assert_eq!(error.semantic_output_started, None);
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
    assert_eq!(error.semantic_output_started, None);
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
