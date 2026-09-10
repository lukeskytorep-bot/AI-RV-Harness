use super::*;
use super::adapters::{provider_family, validate_base_url, ProviderFamily, OPENROUTER_APP_REFERER, OPENROUTER_APP_TITLE};
use super::reasoning::split_tagged_reasoning;
use super::errors::safe_provider_error;
use super::request_builders::{build_google_request, build_openai_compatible_request};
use super::response_parsers::{parse_anthropic_response, parse_google_response, parse_openai_compatible_response};
use super::validation::validate_request_id;

use serde_json::json;
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
        base_url: None,
        request_id: None,
        model_id: model_id.to_string(),
        messages: vec![ProviderMessage {
            role: "user".to_string(),
            content: "test".to_string(),
            images: vec![],
        }],
        reasoning_effort: None,
        reasoning_transport_kind: None,
        reasoning_transport_value: None,
        temperature: None,
        max_output_tokens: None,
        timeout_ms: None,
        detailed_diagnostics: false,
    }
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
        "inlineData": { "data": "A".repeat(300) }
    });
    scrub_debug_value(&mut value, "sk-secret", None);
    let wire = value.to_string();
    assert!(!wire.contains("sk-secret"));
    assert!(wire.contains("BINARY REDACTED"));
}

#[test]
fn validates_provider_cancellation_ids() {
    assert!(validate_request_id("8f3127e0-844a-4f27-aada-6f14641e67e1").is_ok());
    assert!(validate_request_id("../../escape").is_err());
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
    assert!(parsed.reasoning_details.as_ref().unwrap()[1].get("data").is_none());
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
