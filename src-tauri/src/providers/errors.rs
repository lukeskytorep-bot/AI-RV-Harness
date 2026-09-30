use std::error::Error as StdError;

use serde_json::Value;

use super::ProviderCallError;

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

pub(super) fn request_error(error: reqwest::Error, phase: &str) -> ProviderCallError {
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

pub(super) fn provider_error_metadata(payload: &Value) -> (Option<Box<str>>, Option<Box<str>>) {
    let Some(error) = payload.get("error") else {
        return (None, None);
    };
    let error_type = error.get("type")
        .or_else(|| error.get("error_type"))
        .or_else(|| error.pointer("/metadata/error_type"))
        .or_else(|| payload.get("error_type"))
        .and_then(Value::as_str)
        .map(Box::<str>::from);
    let code = error.get("code").or_else(|| error.pointer("/metadata/code")).and_then(|value| {
        value.as_str().map(Box::<str>::from)
            .or_else(|| value.as_i64().map(|number| number.to_string().into_boxed_str()))
    });
    (error_type, code)
}

pub(super) fn safe_provider_error(status: reqwest::StatusCode, body: &str, secret: &str, retry_after_ms: Option<u64>) -> String {
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

