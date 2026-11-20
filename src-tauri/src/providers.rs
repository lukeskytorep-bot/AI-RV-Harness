use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::Channel, State};
use tauri_plugin_sql::DbInstances;

use crate::secrets;

mod adapters;
mod ollama_cloud;
mod ollama_stream;
pub(crate) mod custom_endpoint;
mod endpoint_capabilities;
mod errors;
mod reasoning;
mod request_builders;
mod response_parsers;
mod response_evidence;
mod streaming;
mod transport;
mod validation;

use adapters::{authenticated, endpoint, normalized_credential_endpoint, provider_base_url};
use endpoint_capabilities::discover_openrouter_model_endpoints;
use errors::provider_error_metadata;
use request_builders::{build_chat_request, enable_chat_streaming, enable_mistral_chat_streaming};
use response_parsers::parse_chat_response;
use streaming::{send_blackbox_streaming_chat_request, send_custom_openai_streaming_chat_request, send_mistral_streaming_chat_request, send_openrouter_streaming_chat_request, ProviderContinuationStreamDiagnostics, ProviderStreamEvent};
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
    OllamaCloud,
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
            "ollama_cloud" => Ok(Self::OllamaCloud),
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
            Self::OllamaCloud => "ollama_cloud",
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
    require_parameters: Option<bool>,
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum CustomOpenAiOutputTokenField {
    MaxTokens,
    MaxCompletionTokens,
}

impl CustomOpenAiOutputTokenField {
    fn as_str(self) -> &'static str {
        match self {
            Self::MaxTokens => "max_tokens",
            Self::MaxCompletionTokens => "max_completion_tokens",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomOpenAiCompatibilityProfile {
    Generic,
    LlamaCpp,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderChatRequest {
    provider: ProviderKind,
    credential_id: String,
    provider_config_id: String,
    base_url: Option<String>,
    request_id: Option<String>,
    #[serde(default)]
    workflow_ownership: Option<crate::workflow_heartbeat::Binding>,
    model_id: String,
    messages: Vec<ProviderMessage>,
    reasoning_effort: Option<String>,
    reasoning_max_tokens: Option<u32>,
    reasoning_transport_kind: Option<String>,
    reasoning_transport_value: Option<String>,
    temperature: Option<f64>,
    top_p: Option<f64>,
    top_k: Option<u64>,
    seed: Option<u64>,
    max_output_tokens: Option<u32>,
    custom_output_token_field: Option<CustomOpenAiOutputTokenField>,
    #[serde(default)]
    custom_compatibility_profile: Option<CustomOpenAiCompatibilityProfile>,
    #[serde(default)]
    custom_streaming_enabled: bool,
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
    Ollama(OllamaContinuationState),
    Mistral(MistralContinuationState),
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
struct MistralContinuationState {
    schema_version: u8,
    transport: String,
    format: String,
    replay_fingerprint: ProviderReplayFingerprint,
    content: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OllamaContinuationState {
    schema_version: u8,
    #[serde(deserialize_with = "deserialize_ollama_transport")]
    transport: String,
    format: String,
    replay_fingerprint: ProviderReplayFingerprint,
    content: Vec<Value>,
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
    #[serde(skip_serializing_if="Option::is_none")]
    native_metrics:Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct ProviderChatResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    final_candidate: Option<Box<ProviderFinalCandidate>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_evidence: Option<Box<response_evidence::ProviderResponseEvidence>>,
    content: String,
    reasoning_content: Option<String>,
    reasoning_details: Option<Vec<Value>>,
    reasoning_source: Option<String>,
    finish_reason: Option<String>,
    actual_model: Option<String>,
    usage: ProviderUsage,
    provider_request_id: Option<String>,
    actual_provider: Option<String>,
    continuation_diagnostics: Option<ProviderContinuationStreamDiagnostics>,
    debug_payload: Option<ProviderDebugPayload>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderFinalCandidate {
    content: Option<String>,
    content_sha256: String,
    byte_length: usize,
    omitted_for_size: bool,
    envelope_removed: bool,
    native_validation: &'static str,
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
    // Keep Result's inline Err small; serde preserves the existing flat IPC JSON.
    #[serde(flatten)]
    metadata: Box<ProviderCallErrorMetadata>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCallErrorMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    final_candidate: Option<Box<ProviderFinalCandidate>>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    response_evidence: Option<Box<response_evidence::ProviderResponseEvidence>>,
}

impl ProviderCallError {
    fn new(code: &str, message: impl Into<String>, phase: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into().into_boxed_str(),
            phase: phase.into(),
            metadata: Box::default(),
        }
    }

    fn configuration(message: impl Into<String>) -> Self {
        Self::new("configuration", message, "before_dispatch")
    }
}

fn deserialize_ollama_transport<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if value != "ollama-cloud" { return Err(serde::de::Error::custom("not an Ollama Cloud continuation transport")); }
    Ok(value)
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
                } else if lower == "thinking" || lower == "reasoningcontent" || lower == "reasoningdetails"
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
pub async fn rebind_credential(
    db_instances: State<'_, DbInstances>,
    credential_id: String,
    secret: String,
    provider: String,
    base_url: Option<String>,
) -> Result<(), String> {
    let provider = ProviderKind::parse_binding_kind(&provider)?;
    let endpoint = binding_endpoint(provider, base_url.as_deref())?;
    if matches!(provider, ProviderKind::CustomOpenai) {
        return custom_endpoint::replace_key(&db_instances, &credential_id, &endpoint, &secret).await;
    }
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

fn model_discovery_url(provider: ProviderKind, base: &str) -> Result<String, String> {
    if matches!(provider, ProviderKind::Blackbox) {
        let normalized = normalized_credential_endpoint(base)?;
        if normalized != "https://api.blackbox.ai" {
            return Err(
                "Blackbox model discovery is not enabled for this Blackbox route: the current chat API contract does not establish GET /models. This is a discovery limitation, not evidence that the configured chat route or credential is invalid."
                    .to_string(),
            );
        }
    }
    Ok(if matches!(provider, ProviderKind::Google) {
        format!("{}?pageSize=1000", endpoint(base, "models"))
    } else {
        endpoint(base, "models")
    })
}

#[tauri::command]
pub async fn provider_discover_models(db_instances: State<'_, DbInstances>, request: ProviderRequest) -> Result<Value, String> {
    let base = provider_base_url(request.provider, request.base_url.as_deref())?;
    // Resolve the discovery contract before reading the credential. In particular,
    // explicit Blackbox Enterprise/organization routes must never receive a guessed /models request.
    let url = if matches!(request.provider,ProviderKind::OllamaCloud){String::new()}else{model_discovery_url(request.provider, &base)?};
    let binding = normalized_credential_endpoint(&base)?;
    let secret = custom_endpoint::get_credential_for_binding(&db_instances, request.provider, &request.credential_id, &binding).await?;
    if matches!(request.provider,ProviderKind::OllamaCloud){return crate::native_connection_settings::cloud_catalog(&crate::native_connection_settings::discovery_client()?,&secret).await;}
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

fn parse_finished_chat_response(
    provider: ProviderKind,
    payload: &Value,
    request_id: Option<String>,
    semantic_output_started: bool,
    response_evidence: Box<response_evidence::ProviderResponseEvidence>,
) -> Result<ProviderChatResponse, ProviderCallError> {
    let mut final_candidate = response_parsers::capture_final_candidate(provider, payload);
    let mut parsed = parse_chat_response(provider, payload.clone(), request_id.clone()).map_err(|message| {
        let (provider_error_type, provider_code) = provider_error_metadata(payload);
        let code = if provider_error_type.is_some() || provider_code.is_some() {
            "provider_error"
        } else if message.to_ascii_lowercase().contains("empty") && !message.to_ascii_lowercase().contains("reasoning without") {
            "empty_assistant_response"
        } else {
            "unknown"
        };
        let mut failure = ProviderCallError::new(code, message, "validating_response");
        failure.metadata.provider_error_type = provider_error_type;
        failure.metadata.provider_code = provider_code;
        failure.metadata.provider_request_id = request_id.map(String::into_boxed_str);
        failure.metadata.response_evidence = Some(response_evidence.clone());
        if let Some(candidate) = final_candidate.as_mut() { candidate.native_validation = "rejected"; }
        failure.metadata.final_candidate = final_candidate.clone();
        if semantic_output_started {
            failure.metadata.semantic_output_started = Some(true);
        }
        failure
    })?;
    parsed.response_evidence = Some(response_evidence);
    if let Some(candidate) = final_candidate.as_mut() { candidate.native_validation = "accepted"; }
    parsed.final_candidate = final_candidate;
    Ok(parsed)
}

#[tauri::command]
pub async fn provider_chat(
    db_instances: State<'_, DbInstances>,
    window: tauri::WebviewWindow,
    request: ProviderChatRequest,
    on_stream: Channel<ProviderStreamEvent>,
    emit_stream_events: bool,
) -> Result<ProviderChatResponse, ProviderCallError> {
    validate_chat_request(&request).map_err(ProviderCallError::configuration)?;
    let ownership = if let Some(binding) = &request.workflow_ownership {
        let id = request.request_id.as_deref().ok_or_else(|| ProviderCallError::configuration("Owned provider request requires its transport identity"))?;
        Some(crate::workflow_heartbeat::bind(binding, window.label(), id).await.map_err(ProviderCallError::configuration)?)
    } else { None };
    let ownership_error = |mut failure: ProviderCallError| {
        if let Some(message) = ownership.as_ref().and_then(|guard| guard.failure()) { failure.code = "cancelled".into(); failure.message = message.into(); }
        failure
    };
    let base = provider_base_url(request.provider, request.base_url.as_deref()).map_err(ProviderCallError::configuration)?;
    let binding = normalized_credential_endpoint(&base).map_err(ProviderCallError::configuration)?;
    validation::validate_continuation_bindings(&request, &binding).map_err(ProviderCallError::configuration)?;
    if matches!(request.provider,ProviderKind::OllamaCloud) {
        let pool=crate::database::sqlite_pool(&db_instances).await.map_err(ProviderCallError::configuration)?;
        ollama_cloud::validate_binding(&pool,&request).await.map_err(ProviderCallError::configuration)?;
    }
    let secret = custom_endpoint::get_credential_for_binding(&db_instances, request.provider, &request.credential_id, &binding).await
    .map_err(ProviderCallError::configuration)?;
    let (url, mut body) = build_chat_request(&request, &base).map_err(ProviderCallError::configuration)?;
    let use_openrouter_streaming = matches!(request.provider, ProviderKind::Openrouter);
    let use_custom_streaming = matches!(request.provider, ProviderKind::CustomOpenai) && request.custom_streaming_enabled;
    let use_mistral_streaming = matches!(request.provider, ProviderKind::Mistral);
    let use_blackbox_streaming = matches!(request.provider, ProviderKind::Blackbox);
    let use_ollama_streaming = matches!(request.provider, ProviderKind::OllamaCloud);
    let use_streaming = use_openrouter_streaming || use_custom_streaming || use_mistral_streaming || use_blackbox_streaming;
    if use_ollama_streaming {
        body["stream"] = Value::Bool(true);
    } else if use_mistral_streaming {
        enable_mistral_chat_streaming(&mut body).map_err(ProviderCallError::configuration)?;
    } else if use_streaming {
        enable_chat_streaming(&mut body).map_err(ProviderCallError::configuration)?;
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
        let cloud_client=matches!(request.provider,ProviderKind::OllamaCloud).then(crate::native_connection_settings::discovery_client).transpose().map_err(ProviderCallError::configuration)?;
        let http=cloud_client.as_ref().unwrap_or(client().map_err(ProviderCallError::configuration)?);
        let builder = authenticated(http.post(url).json(&body), request.provider, &secret);
        if matches!(request.provider, ProviderKind::Openrouter) {
            builder.header("X-OpenRouter-Metadata", "enabled")
        } else {
            builder
        }
    };
    let (payload, request_id, semantic_output_started, continuation_diagnostics, response_evidence) = if use_ollama_streaming {
        let result = ollama_stream::send(builder, request.request_id.as_deref(), &secret, &request.model_id, &timeout_policy, |event| {
            if emit_stream_events {
                let event = match event {
                    ollama_stream::Event::Started(provider_request_id) => ProviderStreamEvent::Started { provider_request_id },
                    ollama_stream::Event::Content(content) => ProviderStreamEvent::ContentDelta { content },
                    ollama_stream::Event::Finished(finish_reason) => ProviderStreamEvent::Finished { finish_reason },
                };
                let _ = on_stream.send(event);
            }
        }).await.map_err(ownership_error)?;
        (result.payload, result.request_id, result.semantic_output_started, None, result.response_evidence)
    } else if use_streaming {
        let streamed = if use_openrouter_streaming {
            send_openrouter_streaming_chat_request(
                builder,
                request.request_id.as_deref(),
                &secret,
                &timeout_policy,
                emit_stream_events.then_some(&on_stream),
            ).await
        } else if use_mistral_streaming {
            send_mistral_streaming_chat_request(
                builder,
                request.request_id.as_deref(),
                &secret,
                &timeout_policy,
                emit_stream_events.then_some(&on_stream),
            ).await
        } else if use_blackbox_streaming {
            send_blackbox_streaming_chat_request(
                builder,
                request.request_id.as_deref(),
                &secret,
                &timeout_policy,
                emit_stream_events.then_some(&on_stream),
            ).await
        } else {
            send_custom_openai_streaming_chat_request(
                builder,
                request.request_id.as_deref(),
                &secret,
                &timeout_policy,
                emit_stream_events.then_some(&on_stream),
            ).await
        }.map_err(ownership_error)?;
        (
            streamed.payload,
            streamed.request_id,
            streamed.semantic_output_started,
            use_openrouter_streaming.then_some(streamed.continuation_diagnostics),
            streamed.response_evidence,
        )
    } else {
        let builder=builder.timeout(Duration::from_millis(timeout_policy.non_streaming_timeout_ms));
        let result=if matches!(request.provider,ProviderKind::OllamaCloud){transport::send_cloud_chat_request(builder,request.request_id.as_deref(),&secret).await}else{send_chat_request(builder,request.request_id.as_deref(),&secret).await};
        let (payload,request_id)=result.map_err(ownership_error)?;
        let evidence = response_evidence::finished(Some(&payload), request_id.as_deref(), "body_read");
        (payload, request_id, false, None, evidence)
    };
    if matches!(request.provider,ProviderKind::OllamaCloud) && crate::native_connection_settings::ensure_metadata_has_no_secret(&payload,Some(&secret)).is_err() {return Err(ProviderCallError::new("unsafe_metadata","Ollama Cloud response contains credential material","validating_response"));}
    let debug_response = request.detailed_diagnostics.then(|| {
        let mut value = payload.clone();
        scrub_debug_value(&mut value, &secret, None);
        value
    });
    if matches!(request.provider,ProviderKind::OllamaCloud) && payload.get("model").and_then(Value::as_str)!=Some(request.model_id.as_str()) {
        let mut failure=ProviderCallError::new("model_mismatch","Ollama Cloud returned a different model","validating_response");failure.metadata.response_evidence=Some(response_evidence);failure.metadata.final_candidate=response_parsers::capture_final_candidate(request.provider,&payload);return Err(failure);
    }
    let mut parsed = parse_finished_chat_response(request.provider, &payload, request_id, semantic_output_started, response_evidence)?;
    parsed.continuation_diagnostics = continuation_diagnostics;
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
