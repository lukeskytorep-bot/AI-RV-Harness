use std::{collections::{HashMap, HashSet}, error::Error as StdError, sync::{LazyLock, Mutex}, time::Duration};

use futures_util::future::{AbortHandle, Abortable};
use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::secrets;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequest {
    provider: ProviderKind,
    credential_id: String,
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderChatRequest {
    provider: ProviderKind,
    credential_id: String,
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
    detailed_diagnostics: bool,
}

#[derive(Default)]
struct ChatCancellationRegistry {
    active: HashMap<String, AbortHandle>,
    cancelled_before_start: HashSet<String>,
}

static CHAT_CANCELLATIONS: LazyLock<Mutex<ChatCancellationRegistry>> =
    LazyLock::new(|| Mutex::new(ChatCancellationRegistry::default()));

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ProviderMessage {
    role: String,
    content: String,
    #[serde(default)]
    images: Vec<ProviderImage>,
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
    code: String,
    message: String,
    phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_error_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_request_id: Option<String>,
}

impl ProviderCallError {
    fn new(code: &str, message: impl Into<String>, phase: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            phase: phase.to_string(),
            http_status: None,
            provider_error_type: None,
            provider_code: None,
            retry_after_ms: None,
            provider_request_id: None,
        }
    }

    fn configuration(message: impl Into<String>) -> Self {
        Self::new("configuration", message, "before_dispatch")
    }
}

fn error_chain(error: &reqwest::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(next) = source {
        let text = next.to_string();
        if !parts.iter().any(|part| part == &text) {
            parts.push(text);
        }
        source = next.source();
    }
    parts.join(": ")
}

fn request_error(error: reqwest::Error, phase: &str) -> ProviderCallError {
    let code = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_decode() {
        "response_body_decode"
    } else if error.is_body() {
        "response_body_read"
    } else {
        "request_send"
    };
    ProviderCallError::new(code, error_chain(&error), phase)
}

fn provider_error_metadata(payload: &Value) -> (Option<String>, Option<String>) {
    let Some(error) = payload.get("error") else {
        return (None, None);
    };
    let error_type = error.get("type")
        .or_else(|| error.get("error_type"))
        .or_else(|| error.pointer("/metadata/error_type"))
        .or_else(|| payload.get("error_type"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let code = error.get("code").or_else(|| error.pointer("/metadata/code")).and_then(|value| {
        value.as_str().map(str::to_string).or_else(|| value.as_i64().map(|number| number.to_string()))
    });
    (error_type, code)
}

fn provider_base_url(provider: ProviderKind, custom: Option<&str>) -> Result<String, String> {
    let fixed = match provider {
        ProviderKind::Openrouter => Some("https://openrouter.ai/api/v1"),
        ProviderKind::Google => Some("https://generativelanguage.googleapis.com/v1beta"),
        ProviderKind::Openai => Some("https://api.openai.com/v1"),
        ProviderKind::Anthropic => Some("https://api.anthropic.com/v1"),
        ProviderKind::Zai => Some("https://api.z.ai/api/paas/v4"),
        ProviderKind::Deepseek => Some("https://api.deepseek.com"),
        ProviderKind::Mistral => Some("https://api.mistral.ai/v1"),
        ProviderKind::Blackbox => Some("https://api.blackbox.ai"),
        ProviderKind::CustomOpenai => None,
    };
    let candidate = fixed.or(custom).ok_or_else(|| "custom provider requires a base URL".to_string())?;
    validate_base_url(candidate)
}

fn validate_base_url(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "invalid provider base URL".to_string())?;
    let local_http = url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1") | Some("::1"));
    if url.scheme() != "https" && !local_http {
        return Err("provider base URL must use HTTPS (HTTP is allowed only for localhost)".to_string());
    }
    if url.username() != "" || url.password().is_some() {
        return Err("provider base URL must not contain credentials".to_string());
    }
    Ok(value.trim().trim_end_matches('/').to_string())
}

static HTTP_CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .user_agent(format!("AI-RV-Harness/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
});

fn client() -> Result<&'static Client, String> {
    HTTP_CLIENT.as_ref().map_err(Clone::clone)
}

fn authenticated(builder: RequestBuilder, provider: ProviderKind, secret: &str) -> RequestBuilder {
    match provider {
        ProviderKind::Google => builder.header("x-goog-api-key", secret),
        ProviderKind::Anthropic => builder
            .header("x-api-key", secret)
            .header("anthropic-version", "2023-06-01"),
        _ => builder.bearer_auth(secret),
    }
}

fn endpoint(base: &str, suffix: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), suffix.trim_start_matches('/'))
}

fn safe_provider_error(status: reqwest::StatusCode, body: &str, secret: &str, retry_after_ms: Option<u64>) -> String {
    let redacted = if secret.is_empty() {
        body.to_string()
    } else {
        body.replace(secret, "[REDACTED]")
    };
    let compact = redacted.chars().take(1200).collect::<String>();
    let retry_hint = retry_after_ms
        .map(|milliseconds| format!(" [retry-after-ms={milliseconds}]"))
        .unwrap_or_default();
    format!("provider request failed ({status}){retry_hint}: {compact}")
}

async fn json_response(response: reqwest::Response, secret: &str) -> Result<(Value, Option<String>), String> {
    let status = response.status();
    let retry_after_ms = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|seconds| seconds.saturating_mul(1_000).min(30_000));
    let request_id = response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.map_err(|error| format!("provider response body read failed: {error}"))?;
    if !status.is_success() {
        return Err(safe_provider_error(status, &body, secret, retry_after_ms));
    }
    let value = serde_json::from_str(&body).map_err(|_| "provider returned invalid JSON".to_string())?;
    Ok((value, request_id))
}

async fn chat_json_response(response: reqwest::Response, secret: &str) -> Result<(Value, Option<String>), ProviderCallError> {
    let status = response.status();
    let retry_after_ms = response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|seconds| seconds.saturating_mul(1_000).min(30_000));
    let request_id = response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.map_err(|error| {
        let mut failure = request_error(error, "reading_body");
        failure.provider_request_id = request_id.clone();
        failure
    })?;
    if !status.is_success() {
        let parsed = serde_json::from_str::<Value>(&body).ok();
        let (provider_error_type, provider_code) = parsed.as_ref().map(provider_error_metadata).unwrap_or_default();
        let mut failure = ProviderCallError::new(
            "http_status",
            safe_provider_error(status, &body, secret, retry_after_ms),
            "reading_body",
        );
        failure.http_status = Some(status.as_u16());
        failure.provider_error_type = provider_error_type;
        failure.provider_code = provider_code;
        failure.retry_after_ms = retry_after_ms;
        failure.provider_request_id = request_id;
        return Err(failure);
    }
    let value = serde_json::from_str(&body).map_err(|error| {
        let mut failure = ProviderCallError::new(
            "invalid_provider_json",
            format!("provider returned invalid JSON: {error}"),
            "parsing_body",
        );
        failure.provider_request_id = request_id.clone();
        failure
    })?;
    Ok((value, request_id))
}

#[tauri::command]
pub async fn provider_discover_models(request: ProviderRequest) -> Result<Value, String> {
    let secret = secrets::get_credential(&request.credential_id)?;
    let base = provider_base_url(request.provider, request.base_url.as_deref())?;
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
pub async fn provider_chat(request: ProviderChatRequest) -> Result<ProviderChatResponse, ProviderCallError> {
    validate_chat_request(&request).map_err(ProviderCallError::configuration)?;
    let secret = secrets::get_credential(&request.credential_id).map_err(ProviderCallError::configuration)?;
    let base = provider_base_url(request.provider, request.base_url.as_deref()).map_err(ProviderCallError::configuration)?;
    let (url, body) = build_chat_request(&request, &base).map_err(ProviderCallError::configuration)?;
    let debug_endpoint = url.clone();
    let debug_request = request.detailed_diagnostics.then(|| {
        let mut value = body.clone();
        scrub_debug_value(&mut value, &secret, None);
        value
    });
    let timeout_ms = request.timeout_ms.unwrap_or(120_000);
    let (payload, request_id) = send_chat_request(
        authenticated(client().map_err(ProviderCallError::configuration)?.post(url).json(&body), request.provider, &secret)
            .timeout(Duration::from_millis(timeout_ms)),
        request.request_id.as_deref(),
        &secret,
    )
    .await?;
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
        failure.provider_request_id = request_id;
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
    validate_request_id(&request_id)?;
    let mut registry = CHAT_CANCELLATIONS
        .lock()
        .map_err(|_| "provider cancellation registry is unavailable".to_string())?;
    let handle = registry.active.remove(&request_id);
    if let Some(handle) = handle {
        handle.abort();
        Ok(true)
    } else {
        if registry.cancelled_before_start.len() >= 1024 {
            registry.cancelled_before_start.clear();
        }
        registry.cancelled_before_start.insert(request_id);
        Ok(false)
    }
}

async fn send_chat_request(builder: RequestBuilder, request_id: Option<&str>, secret: &str) -> Result<(Value, Option<String>), ProviderCallError> {
    let Some(request_id) = request_id else {
        let response = builder.send().await.map_err(|error| request_error(error, "awaiting_headers"))?;
        return chat_json_response(response, secret).await;
    };
    validate_request_id(request_id).map_err(ProviderCallError::configuration)?;
    let (handle, registration) = AbortHandle::new_pair();
    {
        let mut registry = CHAT_CANCELLATIONS
            .lock()
            .map_err(|_| ProviderCallError::configuration("provider cancellation registry is unavailable"))?;
        if registry.cancelled_before_start.remove(request_id) {
            return Err(ProviderCallError::new("cancelled", "provider request cancelled", "before_dispatch"));
        }
        if registry.active.insert(request_id.to_string(), handle).is_some() {
            return Err(ProviderCallError::configuration("duplicate provider request id"));
        }
    }
    let request = async {
        let response = builder.send().await.map_err(|error| request_error(error, "awaiting_headers"))?;
        chat_json_response(response, secret).await
    };
    let result = Abortable::new(request, registration).await;
    CHAT_CANCELLATIONS
        .lock()
        .map_err(|_| ProviderCallError::configuration("provider cancellation registry is unavailable"))?
        .active
        .remove(request_id);
    match result {
        Ok(response) => response,
        Err(_) => Err(ProviderCallError::new("cancelled", "provider request cancelled", "awaiting_headers")),
    }
}

fn validate_request_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 80
        || !value.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("invalid provider request id".to_string());
    }
    Ok(())
}

fn scrub_debug_value(value: &mut Value, secret: &str, parent_key: Option<&str>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                let lower = key.to_ascii_lowercase().replace(['-', '_'], "");
                if matches!(lower.as_str(), "authorization" | "apikey" | "xapikey" | "xgoogapikey") {
                    *child = Value::String("[REDACTED]".to_string());
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

fn validate_chat_request(request: &ProviderChatRequest) -> Result<(), String> {
    if let Some(request_id) = request.request_id.as_deref() {
        validate_request_id(request_id)?;
    }
    if request.model_id.trim().is_empty() {
        return Err("model id is required".to_string());
    }
    if request.messages.is_empty() {
        return Err("at least one message is required".to_string());
    }
    if request
        .messages
        .iter()
        .any(|message| !matches!(message.role.as_str(), "system" | "user" | "assistant"))
    {
        return Err("unsupported chat role".to_string());
    }
    for message in &request.messages {
        if !message.images.is_empty() && message.role != "user" {
            return Err("image input is allowed only on user messages".to_string());
        }
        if message.images.len() > 8 {
            return Err("a message may contain at most 8 images".to_string());
        }
        for image in &message.images {
            if !matches!(image.mime_type.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif") {
                return Err("unsupported image MIME type".to_string());
            }
            if image.data_base64.is_empty() || image.data_base64.len() > 35 * 1024 * 1024 {
                return Err("invalid image payload size".to_string());
            }
        }
    }
    if let Some(value) = request.temperature {
        if !value.is_finite() {
            return Err("temperature must be finite".to_string());
        }
    }
    if let Some(value) = request.reasoning_effort.as_deref() {
        if !matches!(value, "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") {
            return Err("invalid reasoning effort".to_string());
        }
    }
    if let Some(kind) = request.reasoning_transport_kind.as_deref() {
        if !matches!(kind, "effort" | "enabled_boolean" | "thinking_level") {
            return Err("invalid reasoning transport kind".to_string());
        }
        if request.reasoning_transport_value.as_deref().unwrap_or_default().is_empty() {
            return Err("reasoning transport value is required".to_string());
        }
    }
    if let Some(value) = request.timeout_ms {
        if !(1_000..=600_000).contains(&value) {
            return Err("request timeout must be between 1000 and 600000 ms".to_string());
        }
    }
    Ok(())
}

fn build_chat_request(request: &ProviderChatRequest, base: &str) -> Result<(String, Value), String> {
    match request.provider {
        ProviderKind::Google => build_google_request(request, base),
        ProviderKind::Anthropic => Ok(build_anthropic_request(request, base)),
        _ => Ok(build_openai_compatible_request(request, base)),
    }
}

fn build_openai_compatible_request(request: &ProviderChatRequest, base: &str) -> (String, Value) {
    let mut body = Map::new();
    body.insert("model".into(), Value::String(request.model_id.clone()));
    body.insert("messages".into(), Value::Array(request.messages.iter().map(openai_message).collect()));
    if let Some(value) = request.temperature {
        body.insert("temperature".into(), json!(value));
    }
    if let Some(value) = request.max_output_tokens {
        body.insert("max_tokens".into(), json!(value));
    }
    if let Some(value) = request.reasoning_transport_value.as_deref().or(request.reasoning_effort.as_deref()) {
        let kind = request.reasoning_transport_kind.as_deref().unwrap_or("effort");
        if matches!(request.provider, ProviderKind::Openrouter) && kind == "enabled_boolean" {
            body.insert("reasoning".into(), json!({ "enabled": value == "true" }));
        } else if matches!(request.provider, ProviderKind::Openrouter) {
            body.insert("reasoning".into(), json!({ "effort": value }));
        } else {
            body.insert("reasoning_effort".into(), json!(value));
        }
    }
    (endpoint(base, "chat/completions"), Value::Object(body))
}

fn openai_message(message: &ProviderMessage) -> Value {
    if message.images.is_empty() {
        return json!({ "role": message.role, "content": message.content });
    }
    let mut parts = vec![json!({ "type": "text", "text": message.content })];
    for image in &message.images {
        parts.push(json!({ "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", image.mime_type, image.data_base64) } }));
    }
    json!({ "role": message.role, "content": parts })
}

fn build_google_request(request: &ProviderChatRequest, base: &str) -> Result<(String, Value), String> {
    let clean_model = request.model_id.trim().trim_start_matches("models/");
    if clean_model.contains('/') || clean_model.contains(':') {
        return Err("invalid Google model id".to_string());
    }
    let system_text = request
        .messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let contents = request
        .messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            let role = if message.role == "assistant" { "model" } else { "user" };
            let mut parts = vec![json!({ "text": message.content })];
            for image in &message.images {
                parts.push(json!({ "inlineData": { "mimeType": image.mime_type, "data": image.data_base64 } }));
            }
            json!({ "role": role, "parts": parts })
        })
        .collect::<Vec<_>>();
    let mut generation = Map::new();
    if let Some(value) = request.temperature {
        generation.insert("temperature".into(), json!(value));
    }
    if let Some(value) = request.max_output_tokens {
        generation.insert("maxOutputTokens".into(), json!(value));
    }
    if let Some(value) = request.reasoning_transport_value.as_deref().or(request.reasoning_effort.as_deref()) {
        let kind = request.reasoning_transport_kind.as_deref().unwrap_or("thinking_level");
        if kind == "enabled_boolean" {
            generation.insert("thinkingConfig".into(), json!({ "thinkingLevel": if value == "true" { "high" } else { "minimal" } }));
        } else {
            generation.insert("thinkingConfig".into(), json!({ "thinkingLevel": value }));
        }
    }
    let mut body = Map::new();
    body.insert("contents".into(), Value::Array(contents));
    if !system_text.is_empty() {
        body.insert("systemInstruction".into(), json!({ "parts": [{ "text": system_text }] }));
    }
    if !generation.is_empty() {
        body.insert("generationConfig".into(), Value::Object(generation));
    }
    Ok((endpoint(base, &format!("models/{clean_model}:generateContent")), Value::Object(body)))
}

fn build_anthropic_request(request: &ProviderChatRequest, base: &str) -> (String, Value) {
    let system_text = request
        .messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let messages = request
        .messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            if message.images.is_empty() {
                json!({ "role": message.role, "content": message.content })
            } else {
                let mut blocks = vec![json!({ "type": "text", "text": message.content })];
                for image in &message.images {
                    blocks.push(json!({ "type": "image", "source": { "type": "base64", "media_type": image.mime_type, "data": image.data_base64 } }));
                }
                json!({ "role": message.role, "content": blocks })
            }
        })
        .collect::<Vec<_>>();
    let mut body = Map::new();
    body.insert("model".into(), json!(request.model_id));
    body.insert("messages".into(), Value::Array(messages));
    body.insert("max_tokens".into(), json!(request.max_output_tokens.unwrap_or(8192)));
    if !system_text.is_empty() {
        body.insert("system".into(), json!(system_text));
    }
    if let Some(value) = request.temperature {
        body.insert("temperature".into(), json!(value));
    }
    // Exact Anthropic thinking controls vary by model generation. They are deliberately
    // not synthesized here; the dynamic registry currently leaves those levels unknown.
    (endpoint(base, "messages"), Value::Object(body))
}

fn parse_chat_response(
    provider: ProviderKind,
    payload: Value,
    request_id: Option<String>,
) -> Result<ProviderChatResponse, String> {
    match provider {
        ProviderKind::Google => parse_google_response(payload, request_id),
        ProviderKind::Anthropic => parse_anthropic_response(payload, request_id),
        _ => parse_openai_compatible_response(payload, request_id),
    }
}

fn parse_openai_compatible_response(payload: Value, request_id: Option<String>) -> Result<ProviderChatResponse, String> {
    if let Some(error) = provider_payload_error(&payload) {
        return Err(error);
    }
    let actual_model = payload.get("model").and_then(Value::as_str).map(str::to_string);
    let finish_reason = payload.pointer("/choices/0/finish_reason").and_then(Value::as_str).map(str::to_string);
    let message = payload.pointer("/choices/0/message").unwrap_or(&Value::Null);
    let raw_content = extract_openai_text(message.get("content"));
    let reasoning_details = message.get("reasoning_details").and_then(Value::as_array).cloned();
    let (native_reasoning, native_source) = extract_openai_reasoning(message, reasoning_details.as_deref());
    let normalized = normalize_reasoning_response(raw_content, native_reasoning, native_source);
    let content = normalized.content;
    if content.trim().is_empty() {
        return Err(empty_response_error_with_reasoning(
            finish_reason.as_deref(),
            None,
            normalized.reasoning_content.as_deref(),
            normalized.incomplete_tag,
        ));
    }
    let usage = payload.get("usage").unwrap_or(&Value::Null);
    let reasoning_tokens = usage
        .pointer("/completion_tokens_details/reasoning_tokens")
        .and_then(Value::as_u64)
        .or_else(|| usage.get("reasoning_tokens").and_then(Value::as_u64));
    Ok(ProviderChatResponse {
        content,
        reasoning_content: normalized.reasoning_content,
        reasoning_details,
        reasoning_source: normalized.reasoning_source,
        finish_reason,
        actual_model,
        usage: ProviderUsage {
            input_tokens: usage.get("prompt_tokens").and_then(Value::as_u64),
            output_tokens: usage.get("completion_tokens").and_then(Value::as_u64),
            reasoning_tokens,
            total_tokens: usage.get("total_tokens").and_then(Value::as_u64),
            cost_usd: usage.get("cost").and_then(Value::as_f64),
        },
        provider_request_id: request_id,
        debug_payload: None,
    })
}

fn parse_google_response(payload: Value, request_id: Option<String>) -> Result<ProviderChatResponse, String> {
    if let Some(error) = provider_payload_error(&payload) {
        return Err(error);
    }
    let actual_model = payload.get("modelVersion").and_then(Value::as_str).map(str::to_string);
    let finish_reason = payload.pointer("/candidates/0/finishReason").and_then(Value::as_str).map(str::to_string);
    let block_reason = payload.pointer("/promptFeedback/blockReason").and_then(Value::as_str);
    let parts = payload
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let raw_content = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) != Some(true))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    let native_reasoning = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) == Some(true))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    let reasoning_details = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) == Some(true))
        .cloned()
        .collect::<Vec<_>>();
    let normalized = normalize_reasoning_response(
        raw_content,
        (!native_reasoning.trim().is_empty()).then_some(native_reasoning),
        Some("google_thought_parts".to_string()),
    );
    let content = normalized.content;
    if content.trim().is_empty() {
        return Err(empty_response_error_with_reasoning(
            finish_reason.as_deref(),
            block_reason,
            normalized.reasoning_content.as_deref(),
            normalized.incomplete_tag,
        ));
    }
    let usage = payload.get("usageMetadata").unwrap_or(&Value::Null);
    Ok(ProviderChatResponse {
        content,
        reasoning_content: normalized.reasoning_content,
        reasoning_details: (!reasoning_details.is_empty()).then_some(reasoning_details),
        reasoning_source: normalized.reasoning_source,
        finish_reason,
        actual_model,
        usage: ProviderUsage {
            input_tokens: usage.get("promptTokenCount").and_then(Value::as_u64),
            output_tokens: usage.get("candidatesTokenCount").and_then(Value::as_u64),
            reasoning_tokens: usage.get("thoughtsTokenCount").and_then(Value::as_u64),
            total_tokens: usage.get("totalTokenCount").and_then(Value::as_u64),
            cost_usd: None,
        },
        provider_request_id: request_id,
        debug_payload: None,
    })
}

fn parse_anthropic_response(payload: Value, request_id: Option<String>) -> Result<ProviderChatResponse, String> {
    if let Some(error) = provider_payload_error(&payload) {
        return Err(error);
    }
    let actual_model = payload.get("model").and_then(Value::as_str).map(str::to_string);
    let finish_reason = payload.get("stop_reason").and_then(Value::as_str).map(str::to_string);
    let blocks = payload.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
    let raw_content = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    let native_reasoning = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("thinking"))
        .filter_map(|block| block.get("thinking").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    let reasoning_details = blocks
        .iter()
        .filter(|block| matches!(block.get("type").and_then(Value::as_str), Some("thinking") | Some("redacted_thinking")))
        .map(|block| if block.get("type").and_then(Value::as_str) == Some("redacted_thinking") {
            json!({ "type": "redacted_thinking", "redacted": true })
        } else {
            block.clone()
        })
        .collect::<Vec<_>>();
    let normalized = normalize_reasoning_response(
        raw_content,
        (!native_reasoning.trim().is_empty()).then_some(native_reasoning),
        Some("anthropic_thinking".to_string()),
    );
    let content = normalized.content;
    if content.trim().is_empty() {
        return Err(empty_response_error_with_reasoning(
            finish_reason.as_deref(),
            None,
            normalized.reasoning_content.as_deref(),
            normalized.incomplete_tag,
        ));
    }
    let usage = payload.get("usage").unwrap_or(&Value::Null);
    let input = usage.get("input_tokens").and_then(Value::as_u64);
    let output = usage.get("output_tokens").and_then(Value::as_u64);
    Ok(ProviderChatResponse {
        content,
        reasoning_content: normalized.reasoning_content,
        reasoning_details: (!reasoning_details.is_empty()).then_some(reasoning_details),
        reasoning_source: normalized.reasoning_source,
        finish_reason,
        actual_model,
        usage: ProviderUsage {
            input_tokens: input,
            output_tokens: output,
            reasoning_tokens: None,
            total_tokens: match (input, output) {
                (Some(a), Some(b)) => Some(a + b),
                _ => None,
            },
            cost_usd: None,
        },
        provider_request_id: request_id,
        debug_payload: None,
    })
}

fn extract_openai_text(content: Option<&Value>) -> String {
    extract_final_text_parts(content)
}

fn extract_reasoning_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.to_string(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| match part {
                Value::String(text) => Some(text.as_str()),
                Value::Object(_) => part.get("text").and_then(Value::as_str)
                    .or_else(|| part.pointer("/text/value").and_then(Value::as_str))
                    .or_else(|| part.get("thinking").and_then(Value::as_str))
                    .or_else(|| part.get("reasoning").and_then(Value::as_str)),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn extract_final_text_parts(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.to_string(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| match part {
                Value::String(text) => Some(text.as_str()),
                Value::Object(_) => {
                    let kind = part.get("type").and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase();
                    let reasoning_part = kind.contains("reason") || kind.contains("think") || kind.contains("thought");
                    if reasoning_part {
                        None
                    } else {
                        part.get("text").and_then(Value::as_str)
                            .or_else(|| part.pointer("/text/value").and_then(Value::as_str))
                            .or_else(|| part.get("thinking").and_then(Value::as_str))
                            .or_else(|| part.get("reasoning").and_then(Value::as_str))
                    }
                },
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

#[derive(Debug)]
struct NormalizedReasoningResponse {
    content: String,
    reasoning_content: Option<String>,
    reasoning_source: Option<String>,
    incomplete_tag: bool,
}

fn extract_openai_reasoning(message: &Value, details: Option<&[Value]>) -> (Option<String>, Option<String>) {
    for (field, source) in [
        ("reasoning", "openai_reasoning"),
        ("reasoning_content", "openai_reasoning_content"),
        ("thinking", "openai_thinking"),
    ] {
        let text = extract_reasoning_text(message.get(field));
        if !text.trim().is_empty() {
            return (Some(text), Some(source.to_string()));
        }
    }
    let embedded = extract_embedded_reasoning(message.get("content"));
    if !embedded.trim().is_empty() {
        return (Some(embedded), Some("openai_reasoning_details".to_string()));
    }
    let text = details
        .unwrap_or_default()
        .iter()
        .filter_map(|detail| detail.get("text").and_then(Value::as_str)
            .or_else(|| detail.pointer("/summary/0/text").and_then(Value::as_str)))
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        (None, None)
    } else {
        (Some(text), Some("openai_reasoning_details".to_string()))
    }
}

fn extract_embedded_reasoning(content: Option<&Value>) -> String {
    content
        .and_then(Value::as_array)
        .map(|parts| parts
            .iter()
            .filter(|part| {
                let kind = part.get("type").and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase();
                kind.contains("reason") || kind.contains("think") || kind.contains("thought")
            })
            .filter_map(|part| part.get("text").and_then(Value::as_str)
                .or_else(|| part.pointer("/text/value").and_then(Value::as_str))
                .or_else(|| part.get("thinking").and_then(Value::as_str))
                .or_else(|| part.get("reasoning").and_then(Value::as_str)))
            .collect::<Vec<_>>()
            .join(""))
        .unwrap_or_default()
}

fn normalize_reasoning_response(
    raw_content: String,
    native_reasoning: Option<String>,
    native_source: Option<String>,
) -> NormalizedReasoningResponse {
    let tagged = split_tagged_reasoning(&raw_content);
    let has_native_reasoning = native_reasoning.as_deref().is_some_and(|value| !value.trim().is_empty());
    NormalizedReasoningResponse {
        content: tagged.as_ref().map(|value| value.content.clone()).unwrap_or(raw_content),
        reasoning_content: if has_native_reasoning {
            native_reasoning
        } else {
            tagged.as_ref().and_then(|value| (!value.reasoning.trim().is_empty()).then(|| value.reasoning.clone()))
        },
        reasoning_source: if has_native_reasoning {
            native_source
        } else if tagged.is_some() {
            Some("tagged_content".to_string())
        } else {
            None
        },
        incomplete_tag: tagged.as_ref().is_some_and(|value| value.incomplete),
    }
}

#[derive(Debug)]
struct TaggedReasoningSplit {
    content: String,
    reasoning: String,
    incomplete: bool,
}

fn split_tagged_reasoning(value: &str) -> Option<TaggedReasoningSplit> {
    const TAGS: [(&str, &str); 6] = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<reason>", "</reason>"),
        ("<reasoning>", "</reasoning>"),
        ("<thought>", "</thought>"),
        ("<|begin_of_thought|>", "<|end_of_thought|>"),
    ];
    let lower = value.to_ascii_lowercase();
    let mut cursor = 0usize;
    let mut content = String::new();
    let mut reasoning_parts = Vec::new();
    let mut found = false;
    let mut incomplete = false;

    while cursor < value.len() {
        let next = TAGS.iter().filter_map(|(open, close)| {
            lower[cursor..].find(*open).map(|offset| (cursor + offset, *open, *close))
        }).min_by_key(|entry| entry.0);
        let Some((start, open, close)) = next else {
            content.push_str(&value[cursor..]);
            break;
        };
        found = true;
        content.push_str(&value[cursor..start]);
        let reasoning_start = start + open.len();
        if let Some(close_offset) = lower[reasoning_start..].find(close) {
            let reasoning_end = reasoning_start + close_offset;
            reasoning_parts.push(value[reasoning_start..reasoning_end].to_string());
            cursor = reasoning_end + close.len();
        } else {
            reasoning_parts.push(value[reasoning_start..].to_string());
            cursor = value.len();
            incomplete = true;
        }
    }

    found.then(|| TaggedReasoningSplit {
        content,
        reasoning: reasoning_parts.join("\n\n"),
        incomplete,
    })
}

fn provider_payload_error(payload: &Value) -> Option<String> {
    let error = payload.get("error")?;
    let message = error.get("message").and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("provider returned an error payload");
    let code = error.get("code").and_then(|value| value.as_str().map(str::to_string).or_else(|| value.as_i64().map(|number| number.to_string())));
    let kind = error.get("type").and_then(Value::as_str);
    let safe_message = message.chars().take(500).collect::<String>();
    Some(format!(
        "provider error payload{}{}: {}",
        code.as_deref().map(|value| format!(" code={value}")).unwrap_or_default(),
        kind.map(|value| format!(" type={value}")).unwrap_or_default(),
        safe_message,
    ))
}

fn empty_response_error(finish_reason: Option<&str>, block_reason: Option<&str>) -> String {
    if let Some(reason) = block_reason {
        return format!("provider blocked the response [block-reason={reason}]");
    }
    match finish_reason {
        Some(reason) if matches!(reason.to_ascii_lowercase().as_str(), "content_filter" | "safety" | "blocked" | "recitation") =>
            format!("provider blocked the response [finish-reason={reason}]"),
        Some(reason) => format!("provider returned an empty assistant response [finish-reason={reason}]"),
        None => "provider returned an empty assistant response".to_string(),
    }
}

fn empty_response_error_with_reasoning(
    finish_reason: Option<&str>,
    block_reason: Option<&str>,
    reasoning_content: Option<&str>,
    incomplete_tag: bool,
) -> String {
    if block_reason.is_some() {
        return empty_response_error(finish_reason, block_reason);
    }
    if incomplete_tag || reasoning_content.is_some_and(|value| !value.trim().is_empty()) {
        return match finish_reason {
            Some(reason) => format!("provider returned reasoning without a final assistant response [finish-reason={reason}]"),
            None => "provider returned reasoning without a final assistant response".to_string(),
        };
    }
    empty_response_error(finish_reason, block_reason)
}

#[cfg(test)]
mod tests {
    use super::*;
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
}
