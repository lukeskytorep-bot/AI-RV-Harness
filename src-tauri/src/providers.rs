use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

use crate::secrets;

mod adapters;
mod endpoint_capabilities;
mod errors;
mod reasoning;
mod request_builders;
mod response_parsers;
mod streaming;
mod transport;
mod validation;

use adapters::{authenticated, endpoint, normalized_credential_endpoint, provider_base_url};
use endpoint_capabilities::discover_openrouter_model_endpoints;
use errors::provider_error_metadata;
use request_builders::{build_chat_request, enable_openrouter_streaming};
use response_parsers::parse_chat_response;
use streaming::{send_openrouter_streaming_chat_request, ProviderStreamEvent};
use transport::{cancel_request, client, json_response, send_chat_request};
use validation::validate_chat_request;


#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ProviderKind {
    Openrouter,
    Google,
    Openai,
    Anthropic,
    Zai,
    Deepseek,
    Mistral,
    Blackbox,
    CustomOpenai,
}

impl ProviderKind {
    fn parse_binding_kind(value: &str) -> Result<Self, String> {
        match value.trim() {
            "openrouter" => Ok(Self::Openrouter),
            "google" => Ok(Self::Google),
            "openai" => Ok(Self::Openai),
            "anthropic" => Ok(Self::Anthropic),
            "zai" => Ok(Self::Zai),
            "deepseek" => Ok(Self::Deepseek),
            "mistral" => Ok(Self::Mistral),
            "blackbox" => Ok(Self::Blackbox),
            "custom_openai" => Ok(Self::CustomOpenai),
            _ => Err("unsupported provider kind".to_string()),
        }
    }

    fn binding_kind(self) -> &'static str {
        match self {
            Self::Openrouter => "openrouter",
            Self::Google => "google",
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Zai => "zai",
            Self::Deepseek => "deepseek",
            Self::Mistral => "mistral",
            Self::Blackbox => "blackbox",
            Self::CustomOpenai => "custom_openai",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequest {
    provider: ProviderKind,
    credential_id: String,
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEndpointRequest {
    provider: ProviderKind,
    credential_id: String,
    base_url: Option<String>,
    model_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenRouterProviderRouting {
    #[serde(default)]
    order: Vec<String>,
    #[serde(default)]
    only: Vec<String>,
    #[serde(default)]
    ignore: Vec<String>,
    allow_fallbacks: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderTimeoutPolicy {
    timeout_class: String,
    first_event_timeout_ms: u64,
    idle_timeout_ms: u64,
    absolute_emergency_timeout_ms: u64,
    non_streaming_timeout_ms: u64,
}

impl ProviderTimeoutPolicy {
    fn from_legacy(timeout_ms: u64) -> Self {
        Self {
            timeout_class: "interactive".to_string(),
            first_event_timeout_ms: timeout_ms,
            idle_timeout_ms: timeout_ms,
            absolute_emergency_timeout_ms: (timeout_ms.saturating_mul(8)).clamp(15 * 60_000, 2 * 60 * 60_000),
            non_streaming_timeout_ms: timeout_ms,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderChatRequest {
    provider: ProviderKind,
    credential_id: String,
    provider_config_id: String,
    base_url: Option<String>,
    request_id: Option<String>,
    model_id: String,
    messages: Vec<ProviderMessage>,
    reasoning_effort: Option<String>,
    reasoning_transport_kind: Option<String>,
    reasoning_transport_value: Option<String>,
    temperature: Option<f64>,
    max_output_tokens: Option<u32>,
    timeout_ms: Option<u64>,
    #[serde(default)]
    timeout_policy: Option<ProviderTimeoutPolicy>,
    #[serde(default)]
    provider_routing: Option<OpenRouterProviderRouting>,
    #[serde(default)]
    detailed_diagnostics: bool,
}


#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderMessage {
    role: String,
    content: String,
    #[serde(default)]
    images: Vec<ProviderImage>,
    #[serde(default)]
    continuation_state: Option<ProviderContinuationState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
enum ProviderContinuationState {
    OpenRouter(OpenRouterContinuationState),
    Google(GoogleContinuationState),
    Anthropic(AnthropicContinuationState),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenRouterContinuationState {
    schema_version: u8,
    transport: String,
    format: String,
    replay_fingerprint: ProviderReplayFingerprint,
    reasoning_details: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoogleContinuationState {
    schema_version: u8,
    transport: String,
    format: String,
    replay_fingerprint: ProviderReplayFingerprint,
    parts: Vec<GoogleThoughtPart>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnthropicContinuationState {
    schema_version: u8,
    transport: String,
    format: String,
    replay_fingerprint: ProviderReplayFingerprint,
    blocks: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderReplayFingerprint {
    transport: String,
    normalized_endpoint: String,
    provider_config_id: String,
    credential_id: String,
    requested_model_id: String,
    #[serde(default)]
    actual_model_id: Option<String>,
    state_format: String,
    state_format_version: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoogleThoughtPart {
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thought: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thought_signature: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderImage {
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Default, Serialize)]
struct ProviderUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    total_tokens: Option<u64>,
    cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ProviderChatResponse {
    content: String,
    reasoning_content: Option<String>,
    reasoning_details: Option<Vec<Value>>,
    reasoning_source: Option<String>,
    finish_reason: Option<String>,
    actual_model: Option<String>,
    usage: ProviderUsage,
    provider_request_id: Option<String>,
    actual_provider: Option<String>,
    debug_payload: Option<ProviderDebugPayload>,
}

#[derive(Debug, Serialize)]
struct ProviderDebugPayload {
    endpoint: String,
    request: Option<Value>,
    response: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCallError {
    code: Box<str>,
    message: Box<str>,
    phase: Box<str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_error_type: Option<Box<str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_code: Option<Box<str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_request_id: Option<Box<str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    semantic_output_started: Option<bool>,
}

impl ProviderCallError {
    fn new(code: &str, message: impl Into<String>, phase: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into().into_boxed_str(),
            phase: phase.into(),
            http_status: None,
            provider_error_type: None,
            provider_code: None,
            retry_after_ms: None,
            provider_request_id: None,
            semantic_output_started: None,
        }
    }

    fn configuration(message: impl Into<String>) -> Self {
        Self::new("configuration", message, "before_dispatch")
    }
}

fn scrub_debug_value(value: &mut Value, secret: &str, parent_key: Option<&str>) {
    match value {
        Value::Object(map) => {
            let google_thought_part = map.get("thought").and_then(Value::as_bool) == Some(true);
            let anthropic_thinking_block = map.get("type").and_then(Value::as_str) == Some("thinking");
            let anthropic_redacted_block = map.get("type").and_then(Value::as_str) == Some("redacted_thinking");
            for (key, child) in map.iter_mut() {
                let lower = key.to_ascii_lowercase().replace(['-', '_'], "");
                if matches!(lower.as_str(), "authorization" | "apikey" | "xapikey" | "xgoogapikey") {
                    *child = Value::String("[REDACTED]".to_string());
                } else if lower == "reasoningdetails"
                    || lower == "thoughtsignature"
                    || (google_thought_part && lower == "text")
                    || (anthropic_thinking_block && matches!(lower.as_str(), "thinking" | "signature"))
                    || (anthropic_redacted_block && lower == "data")
                {
                    *child = Value::String("[CONTINUATION STATE REDACTED]".to_string());
                } else {
                    scrub_debug_value(child, secret, Some(key));
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                scrub_debug_value(child, secret, parent_key);
            }
        }
        Value::String(text) => {
            if !secret.is_empty() && text.contains(secret) {
                *text = text.replace(secret, "[REDACTED]");
            }
            let key = parent_key.unwrap_or_default().to_ascii_lowercase();
            let is_inline_binary = (key == "data" && text.len() > 256)
                || text.starts_with("data:image/");
            if is_inline_binary {
                *text = format!("[BINARY REDACTED: {} chars]", text.len());
            } else if text.len() > 100_000 {
                text.truncate(100_000);
                text.push_str("…[DEBUG VIEW TRUNCATED]");
            }
        }
        _ => {}
    }
}


fn binding_endpoint(provider: ProviderKind, base_url: Option<&str>) -> Result<String, String> {
    let base = provider_base_url(provider, base_url)?;
    normalized_credential_endpoint(&base)
}

#[tauri::command]
pub fn store_credential(
    credential_id: String,
    secret: String,
    provider: String,
    base_url: Option<String>,
) -> Result<(), String> {
    let provider = ProviderKind::parse_binding_kind(&provider)?;
    let endpoint = binding_endpoint(provider, base_url.as_deref())?;
    secrets::store_new_bound_credential(
        &credential_id,
        &secret,
        provider.binding_kind(),
        &endpoint,
    )
}

#[tauri::command]
pub fn rebind_credential(
    credential_id: String,
    secret: String,
    provider: String,
    base_url: Option<String>,
) -> Result<(), String> {
    let provider = ProviderKind::parse_binding_kind(&provider)?;
    let endpoint = binding_endpoint(provider, base_url.as_deref())?;
    secrets::rebind_bound_credential(
        &credential_id,
        &secret,
        provider.binding_kind(),
        &endpoint,
    )
}

#[tauri::command]
pub fn provider_binding_endpoint(provider: String, base_url: Option<String>) -> Result<String, String> {
    let provider = ProviderKind::parse_binding_kind(&provider)?;
    binding_endpoint(provider, base_url.as_deref())
}

#[tauri::command]
pub async fn provider_discover_models(request: ProviderRequest) -> Result<Value, String> {
    let base = provider_base_url(request.provider, request.base_url.as_deref())?;
    let binding = normalized_credential_endpoint(&base)?;
    let secret = secrets::get_credential_for_binding(
        &request.credential_id,
        request.provider.binding_kind(),
        &binding,
    )?;
    let url = if matches!(request.provider, ProviderKind::Google) {
        format!("{}?pageSize=1000", endpoint(&base, "models"))
    } else {
        endpoint(&base, "models")
    };
    let response = authenticated(client()?.get(url), request.provider, &secret)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let (payload, _) = json_response(response, &secret).await?;
    Ok(payload)
}

#[tauri::command]
pub async fn provider_discover_model_endpoints(request: ProviderEndpointRequest) -> Result<Value, String> {
    discover_openrouter_model_endpoints(&request).await
}

#[tauri::command]
pub async fn provider_chat(
    request: ProviderChatRequest,
    on_stream: Channel<ProviderStreamEvent>,
    emit_stream_events: bool,
) -> Result<ProviderChatResponse, ProviderCallError> {
    validate_chat_request(&request).map_err(ProviderCallError::configuration)?;
    let base = provider_base_url(request.provider, request.base_url.as_deref()).map_err(ProviderCallError::configuration)?;
    let binding = normalized_credential_endpoint(&base).map_err(ProviderCallError::configuration)?;
    validation::validate_continuation_bindings(&request, &binding).map_err(ProviderCallError::configuration)?;
    let secret = secrets::get_credential_for_binding(
        &request.credential_id,
        request.provider.binding_kind(),
        &binding,
    )
    .map_err(ProviderCallError::configuration)?;
    let (url, mut body) = build_chat_request(&request, &base).map_err(ProviderCallError::configuration)?;
    let use_streaming = matches!(request.provider, ProviderKind::Openrouter);
    if use_streaming {
        enable_openrouter_streaming(&mut body).map_err(ProviderCallError::configuration)?;
    }
    let debug_endpoint = url.clone();
    let debug_request = request.detailed_diagnostics.then(|| {
        let mut value = body.clone();
        scrub_debug_value(&mut value, &secret, None);
        value
    });
    let legacy_timeout_ms = request.timeout_ms.unwrap_or(120_000);
    let timeout_policy = request.timeout_policy.clone().unwrap_or_else(|| ProviderTimeoutPolicy::from_legacy(legacy_timeout_ms));
    let builder = {
        let builder = authenticated(client().map_err(ProviderCallError::configuration)?.post(url).json(&body), request.provider, &secret);
        if matches!(request.provider, ProviderKind::Openrouter) {
            builder.header("X-OpenRouter-Metadata", "enabled")
        } else {
            builder
        }
    };
    let (payload, request_id, semantic_output_started) = if use_streaming {
        let streamed = send_openrouter_streaming_chat_request(
            builder,
            request.request_id.as_deref(),
            &secret,
            &timeout_policy,
            emit_stream_events.then_some(&on_stream),
        )
        .await?;
        (streamed.payload, streamed.request_id, streamed.semantic_output_started)
    } else {
        let (payload, request_id) = send_chat_request(
            builder.timeout(Duration::from_millis(timeout_policy.non_streaming_timeout_ms)),
            request.request_id.as_deref(),
            &secret,
        )
        .await?;
        (payload, request_id, false)
    };
    let debug_response = request.detailed_diagnostics.then(|| {
        let mut value = payload.clone();
        scrub_debug_value(&mut value, &secret, None);
        value
    });
    let mut parsed = parse_chat_response(request.provider, payload.clone(), request_id.clone()).map_err(|message| {
        let (provider_error_type, provider_code) = provider_error_metadata(&payload);
        let code = if provider_error_type.is_some() || provider_code.is_some() {
            "provider_error"
        } else if message.to_ascii_lowercase().contains("empty") && !message.to_ascii_lowercase().contains("reasoning without") {
            "empty_assistant_response"
        } else {
            "unknown"
        };
        let mut failure = ProviderCallError::new(code, message, "validating_response");
        failure.provider_error_type = provider_error_type;
        failure.provider_code = provider_code;
        failure.provider_request_id = request_id.map(String::into_boxed_str);
        if semantic_output_started {
            failure.semantic_output_started = Some(true);
        }
        failure
    })?;
    parsed.debug_payload = Some(ProviderDebugPayload {
        endpoint: debug_endpoint,
        request: debug_request,
        response: debug_response,
    });
    Ok(parsed)
}

#[tauri::command]
pub fn cancel_provider_request(request_id: String) -> Result<bool, String> {
    cancel_request(request_id)
}

#[cfg(test)]
mod tests;
