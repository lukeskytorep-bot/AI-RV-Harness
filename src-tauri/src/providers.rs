use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::secrets;

mod adapters;
mod errors;
mod reasoning;
mod request_builders;
mod response_parsers;
mod transport;
mod validation;

use adapters::{authenticated, endpoint, provider_base_url};
use errors::provider_error_metadata;
use request_builders::build_chat_request;
use response_parsers::parse_chat_response;
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
        }
    }

    fn configuration(message: impl Into<String>) -> Self {
        Self::new("configuration", message, "before_dispatch")
    }
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
        failure.provider_request_id = request_id.map(String::into_boxed_str);
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
