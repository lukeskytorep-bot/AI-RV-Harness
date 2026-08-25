use std::{collections::{HashMap, HashSet}, sync::{LazyLock, Mutex}, time::Duration};

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
    finish_reason: Option<String>,
    usage: ProviderUsage,
    provider_request_id: Option<String>,
    debug_payload: Option<ProviderDebugPayload>,
}

#[derive(Debug, Serialize)]
struct ProviderDebugPayload {
    endpoint: String,
    request: Value,
    response: Value,
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

fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .user_agent("AI-RV-Harness/0.7.8")
        .build()
        .map_err(|error| error.to_string())
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

fn safe_provider_error(status: reqwest::StatusCode, body: &str, secret: &str) -> String {
    let redacted = if secret.is_empty() {
        body.to_string()
    } else {
        body.replace(secret, "[REDACTED]")
    };
    let compact = redacted.chars().take(1200).collect::<String>();
    format!("provider request failed ({status}): {compact}")
}

async fn json_response(response: reqwest::Response, secret: &str) -> Result<(Value, Option<String>), String> {
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(safe_provider_error(status, &body, secret));
    }
    let value = serde_json::from_str(&body).map_err(|_| "provider returned invalid JSON".to_string())?;
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
pub async fn provider_chat(request: ProviderChatRequest) -> Result<ProviderChatResponse, String> {
    validate_chat_request(&request)?;
    let secret = secrets::get_credential(&request.credential_id)?;
    let base = provider_base_url(request.provider, request.base_url.as_deref())?;
    let (url, body) = build_chat_request(&request, &base)?;
    let debug_endpoint = url.clone();
    let mut debug_request = body.clone();
    scrub_debug_value(&mut debug_request, &secret, None);
    let timeout_ms = request.timeout_ms.unwrap_or(120_000);
    let (payload, request_id) = send_chat_request(
        authenticated(client()?.post(url).json(&body), request.provider, &secret)
            .timeout(Duration::from_millis(timeout_ms)),
        request.request_id.as_deref(),
        &secret,
    )
    .await?;
    let mut debug_response = payload.clone();
    scrub_debug_value(&mut debug_response, &secret, None);
    let mut parsed = parse_chat_response(request.provider, payload, request_id)?;
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

async fn send_chat_request(builder: RequestBuilder, request_id: Option<&str>, secret: &str) -> Result<(Value, Option<String>), String> {
    let Some(request_id) = request_id else {
        let response = builder.send().await.map_err(|error| error.to_string())?;
        return json_response(response, secret).await;
    };
    validate_request_id(request_id)?;
    let (handle, registration) = AbortHandle::new_pair();
    {
        let mut registry = CHAT_CANCELLATIONS
            .lock()
            .map_err(|_| "provider cancellation registry is unavailable".to_string())?;
        if registry.cancelled_before_start.remove(request_id) {
            return Err("provider request cancelled".to_string());
        }
        if registry.active.insert(request_id.to_string(), handle).is_some() {
            return Err("duplicate provider request id".to_string());
        }
    }
    let request = async {
        let response = builder.send().await.map_err(|error| error.to_string())?;
        json_response(response, secret).await
    };
    let result = Abortable::new(request, registration).await;
    CHAT_CANCELLATIONS
        .lock()
        .map_err(|_| "provider cancellation registry is unavailable".to_string())?
        .active
        .remove(request_id);
    match result {
        Ok(response) => response,
        Err(_) => Err("provider request cancelled".to_string()),
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
                let lower = key.to_ascii_lowercase().replace('-', "").replace('_', "");
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
    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if content.trim().is_empty() {
        return Err("provider returned an empty assistant response".to_string());
    }
    let usage = payload.get("usage").unwrap_or(&Value::Null);
    let reasoning_tokens = usage
        .pointer("/completion_tokens_details/reasoning_tokens")
        .and_then(Value::as_u64)
        .or_else(|| usage.get("reasoning_tokens").and_then(Value::as_u64));
    Ok(ProviderChatResponse {
        content,
        finish_reason: payload.pointer("/choices/0/finish_reason").and_then(Value::as_str).map(str::to_string),
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
    let parts = payload
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let content = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    if content.trim().is_empty() {
        return Err("provider returned an empty assistant response".to_string());
    }
    let usage = payload.get("usageMetadata").unwrap_or(&Value::Null);
    Ok(ProviderChatResponse {
        content,
        finish_reason: payload.pointer("/candidates/0/finishReason").and_then(Value::as_str).map(str::to_string),
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
    let content = payload
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err("provider returned an empty assistant response".to_string());
    }
    let usage = payload.get("usage").unwrap_or(&Value::Null);
    let input = usage.get("input_tokens").and_then(Value::as_u64);
    let output = usage.get("output_tokens").and_then(Value::as_u64);
    Ok(ProviderChatResponse {
        content,
        finish_reason: payload.get("stop_reason").and_then(Value::as_str).map(str::to_string),
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let error = safe_provider_error(reqwest::StatusCode::UNAUTHORIZED, "bad sk-secret", "sk-secret");
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
}
