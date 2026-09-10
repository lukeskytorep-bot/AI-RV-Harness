use std::{collections::{HashMap, HashSet}, sync::{LazyLock, Mutex}, time::Duration};

use futures_util::future::{AbortHandle, Abortable};
use reqwest::{Client, RequestBuilder};
use serde_json::Value;

use super::ProviderCallError;
use super::errors::{provider_error_metadata, request_error, safe_provider_error};
use super::validation::validate_request_id;

#[derive(Default)]
struct ChatCancellationRegistry {
    active: HashMap<String, AbortHandle>,
    cancelled_before_start: HashSet<String>,
}

static CHAT_CANCELLATIONS: LazyLock<Mutex<ChatCancellationRegistry>> =
    LazyLock::new(|| Mutex::new(ChatCancellationRegistry::default()));

static HTTP_CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .user_agent(format!("AI-RV-Harness/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
});

pub(super) fn client() -> Result<&'static Client, String> {
    HTTP_CLIENT.as_ref().map_err(Clone::clone)
}

pub(super) async fn json_response(response: reqwest::Response, secret: &str) -> Result<(Value, Option<String>), String> {
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
        failure.provider_request_id = request_id.clone().map(String::into_boxed_str);
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
        failure.provider_request_id = request_id.map(String::into_boxed_str);
        return Err(failure);
    }
    let value = serde_json::from_str(&body).map_err(|error| {
        let mut failure = ProviderCallError::new(
            "invalid_provider_json",
            format!("provider returned invalid JSON: {error}"),
            "parsing_body",
        );
        failure.provider_request_id = request_id.clone().map(String::into_boxed_str);
        failure
    })?;
    Ok((value, request_id))
}

pub(super) async fn send_chat_request(builder: RequestBuilder, request_id: Option<&str>, secret: &str) -> Result<(Value, Option<String>), ProviderCallError> {
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

pub(super) fn cancel_request(request_id: String) -> Result<bool, String> {
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
