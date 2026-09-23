use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::RequestBuilder;
use serde_json::{json, Map, Value};

use super::{ProviderCallError, ProviderTimeoutPolicy};
use super::errors::{provider_error_metadata, request_error, safe_provider_error};
use super::transport::{retry_after_ms, run_cancellable_chat_request};

// Hard transport guards. They bound stream memory independently from model/output settings.
pub(super) const MAX_PENDING_SSE_EVENT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_ACCUMULATED_STREAM_DATA_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug)]
pub(super) struct StreamingChatResult {
    pub(super) payload: Value,
    pub(super) request_id: Option<String>,
    pub(super) semantic_output_started: bool,
}

#[derive(Debug, PartialEq)]
pub(super) enum SseFrame {
    Comment,
    Data(String),
}

#[derive(Default)]
pub(super) struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    pub(super) fn push(&mut self, bytes: &[u8]) -> Result<Vec<SseFrame>, ProviderCallError> {
        // Only the last three buffered bytes can participate in a delimiter
        // split across the old/new chunk boundary. Starting there avoids
        // rescanning the entire growing event for every network chunk.
        let mut search_from = self.buffer.len().saturating_sub(3);
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        while let Some((boundary, delimiter_len)) = next_event_boundary(&self.buffer, search_from) {
            if boundary > MAX_PENDING_SSE_EVENT_BYTES {
                return Err(stream_size_error(
                    "provider SSE event exceeded the maximum buffered event size",
                ));
            }
            let event = self.buffer.drain(..boundary).collect::<Vec<_>>();
            self.buffer.drain(..delimiter_len);
            if let Some(frame) = parse_sse_event(&event)? {
                frames.push(frame);
            }
            // drain() changed every offset. Scan the remaining bytes once
            // from their new beginning so multiple events in one chunk are
            // still decoded in order.
            search_from = 0;
        }
        if self.buffer.len() > MAX_PENDING_SSE_EVENT_BYTES {
            return Err(stream_size_error(
                "provider SSE event exceeded the maximum buffered event size",
            ));
        }
        Ok(frames)
    }

    pub(super) fn finish(&mut self) -> Result<Vec<SseFrame>, ProviderCallError> {
        if self.buffer.is_empty() {
            return Ok(Vec::new());
        }
        if self.buffer.len() > MAX_PENDING_SSE_EVENT_BYTES {
            return Err(stream_size_error(
                "provider SSE event exceeded the maximum buffered event size",
            ));
        }
        let event = std::mem::take(&mut self.buffer);
        Ok(parse_sse_event(&event)?.into_iter().collect())
    }
}

fn next_event_boundary(buffer: &[u8], search_from: usize) -> Option<(usize, usize)> {
    let mut index = search_from.min(buffer.len());
    while index < buffer.len() {
        match buffer[index] {
            b'\r'
                if index + 3 < buffer.len()
                    && buffer[index + 1] == b'\n'
                    && buffer[index + 2] == b'\r'
                    && buffer[index + 3] == b'\n' =>
            {
                return Some((index, 4));
            }
            b'\n' if index + 1 < buffer.len() && buffer[index + 1] == b'\n' => {
                return Some((index, 2));
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn stream_size_error(message: &str) -> ProviderCallError {
    ProviderCallError::new("response_body_too_large", message, "reading_body")
}

fn parse_sse_event(event: &[u8]) -> Result<Option<SseFrame>, ProviderCallError> {
    if event.is_empty() {
        return Ok(None);
    }
    let text = std::str::from_utf8(event).map_err(|error| {
        ProviderCallError::new(
            "response_body_decode",
            format!("provider SSE event was not valid UTF-8: {error}"),
            "parsing_body",
        )
    })?;
    let mut data_lines = Vec::new();
    let mut saw_comment = false;
    for raw_line in text.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if line.starts_with(':') {
            saw_comment = true;
            continue;
        }
        if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.strip_prefix(' ').unwrap_or(value).to_string());
        }
    }
    if !data_lines.is_empty() {
        Ok(Some(SseFrame::Data(data_lines.join("\n"))))
    } else if saw_comment {
        Ok(Some(SseFrame::Comment))
    } else {
        Ok(None)
    }
}

#[derive(Default)]
pub(super) struct OpenRouterStreamAccumulator {
    content: String,
    reasoning: String,
    reasoning_details: Vec<Value>,
    finish_reason: Option<String>,
    native_finish_reason: Option<String>,
    actual_model: Option<String>,
    actual_provider: Option<String>,
    response_id: Option<String>,
    usage: Option<Value>,
    openrouter_metadata: Option<Value>,
    accumulated_stream_data_bytes: usize,
    done: bool,
    pub(super) semantic_output_started: bool,
}

impl OpenRouterStreamAccumulator {
    fn process_frame(&mut self, frame: SseFrame, secret: &str, request_id: Option<&str>) -> Result<(), ProviderCallError> {
        match frame {
            SseFrame::Comment => Ok(()),
            SseFrame::Data(data) => self.process_data(&data, secret, request_id),
        }
    }

    pub(super) fn process_data(&mut self, data: &str, secret: &str, request_id: Option<&str>) -> Result<(), ProviderCallError> {
        let Some(next_total) = self
            .accumulated_stream_data_bytes
            .checked_add(data.len())
            .filter(|total| *total <= MAX_ACCUMULATED_STREAM_DATA_BYTES)
        else {
            return Err(self.error(
                "response_body_too_large",
                "provider streaming response exceeded the maximum accumulated data size",
                "reading_body",
                request_id,
            ));
        };
        self.accumulated_stream_data_bytes = next_total;
        if data.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let payload: Value = serde_json::from_str(data).map_err(|error| {
            self.error(
                "invalid_provider_json",
                format!("provider returned malformed SSE JSON: {error}"),
                "parsing_body",
                request_id,
            )
        })?;
        if payload.get("error").is_some() {
            let event_has_semantic_output = payload
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("delta"))
                .is_some_and(|delta| {
                    let content = stream_text(delta.get("content"));
                    let reasoning = ["reasoning", "reasoning_content", "thinking"]
                        .iter()
                        .find_map(|field| {
                            let value = stream_text(delta.get(*field));
                            (!value.is_empty()).then_some(value)
                        })
                        .unwrap_or_default();
                    first_semantic_chunk(
                        delta,
                        &content,
                        &reasoning,
                        delta.get("reasoning_details").and_then(Value::as_array).map(Vec::as_slice),
                    )
                });
            return Err(stream_provider_error(
                &payload,
                secret,
                request_id,
                self.semantic_output_started || event_has_semantic_output,
            ));
        }

        if let Some(value) = payload.get("id").and_then(Value::as_str) {
            self.response_id = Some(value.to_string());
        }
        if let Some(value) = payload.get("model").and_then(Value::as_str) {
            self.actual_model = Some(value.to_string());
        }
        if let Some(value) = payload.get("provider").and_then(Value::as_str) {
            self.actual_provider = Some(value.to_string());
        }
        if let Some(value) = payload.get("openrouter_metadata") {
            self.openrouter_metadata = Some(value.clone());
        }
        if let Some(value) = payload.get("usage") {
            if !value.is_null() {
                self.usage = Some(value.clone());
            }
        }

        let Some(choice) = payload.get("choices").and_then(Value::as_array).and_then(|choices| choices.first()) else {
            return Ok(());
        };
        if let Some(value) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(value.to_string());
        }
        if let Some(value) = choice.get("native_finish_reason").and_then(Value::as_str) {
            self.native_finish_reason = Some(value.to_string());
        }
        let delta = choice.get("delta").unwrap_or(&Value::Null);
        let content = stream_text(delta.get("content"));
        let reasoning = ["reasoning", "reasoning_content", "thinking"]
            .iter()
            .find_map(|field| {
                let value = stream_text(delta.get(*field));
                (!value.is_empty()).then_some(value)
            })
            .unwrap_or_default();
        let reasoning_details = delta.get("reasoning_details").and_then(Value::as_array);
        if first_semantic_chunk(delta, &content, &reasoning, reasoning_details.map(Vec::as_slice)) {
            self.semantic_output_started = true;
        }
        if !content.is_empty() {
            self.content.push_str(&content);
        }
        if !reasoning.is_empty() {
            self.reasoning.push_str(&reasoning);
        }
        if let Some(details) = reasoning_details {
            self.reasoning_details.extend(details.iter().cloned());
        }
        Ok(())
    }

    fn error(&self, code: &str, message: impl Into<String>, phase: &str, request_id: Option<&str>) -> ProviderCallError {
        let mut error = ProviderCallError::new(code, message, phase);
        error.provider_request_id = request_id.map(|value| value.to_string().into_boxed_str());
        if self.semantic_output_started {
            error.semantic_output_started = Some(true);
        }
        error
    }

    pub(super) fn finish(self, request_id: Option<String>) -> Result<StreamingChatResult, ProviderCallError> {
        if !self.done {
            let mut error = ProviderCallError::new(
                "response_body_read",
                "provider streaming response ended before [DONE]",
                "reading_body",
            );
            error.provider_request_id = request_id.clone().map(String::into_boxed_str);
            if self.semantic_output_started {
                error.semantic_output_started = Some(true);
            }
            return Err(error);
        }
        let semantic_output_started = self.semantic_output_started;
        let mut message = Map::new();
        message.insert("role".into(), Value::String("assistant".to_string()));
        message.insert("content".into(), Value::String(self.content));
        if !self.reasoning.is_empty() {
            message.insert("reasoning".into(), Value::String(self.reasoning));
        }
        if !self.reasoning_details.is_empty() {
            message.insert("reasoning_details".into(), Value::Array(self.reasoning_details));
        }
        let mut choice = Map::new();
        choice.insert("index".into(), json!(0));
        choice.insert("message".into(), Value::Object(message));
        choice.insert(
            "finish_reason".into(),
            self.finish_reason.map(Value::String).unwrap_or(Value::Null),
        );
        if let Some(native) = self.native_finish_reason {
            choice.insert("native_finish_reason".into(), Value::String(native));
        }
        let mut payload = Map::new();
        payload.insert("choices".into(), Value::Array(vec![Value::Object(choice)]));
        if let Some(value) = self.response_id {
            payload.insert("id".into(), Value::String(value));
        }
        if let Some(value) = self.actual_model {
            payload.insert("model".into(), Value::String(value));
        }
        if let Some(value) = self.actual_provider {
            payload.insert("provider".into(), Value::String(value));
        }
        if let Some(value) = self.usage {
            payload.insert("usage".into(), value);
        }
        if let Some(value) = self.openrouter_metadata {
            payload.insert("openrouter_metadata".into(), value);
        }
        Ok(StreamingChatResult {
            payload: Value::Object(payload),
            request_id,
            semantic_output_started,
        })
    }
}

fn first_semantic_chunk(delta: &Value, content: &str, reasoning: &str, reasoning_details: Option<&[Value]>) -> bool {
    !content.is_empty()
        || !reasoning.is_empty()
        || reasoning_details.is_some_and(|details| !details.is_empty())
        || delta.get("tool_calls").and_then(Value::as_array).is_some_and(|calls| !calls.is_empty())
}

fn stream_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| match part {
                Value::String(text) => Some(text.as_str()),
                Value::Object(_) => part.get("text").and_then(Value::as_str)
                    .or_else(|| part.pointer("/text/value").and_then(Value::as_str)),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn stream_provider_error(payload: &Value, secret: &str, request_id: Option<&str>, semantic_output_started: bool) -> ProviderCallError {
    let (provider_error_type, provider_code) = provider_error_metadata(payload);
    let raw_message = payload.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| payload.get("error").and_then(Value::as_str))
        .unwrap_or("provider returned an SSE error event");
    let safe_message = raw_message.replace(secret, "[REDACTED]").chars().take(1200).collect::<String>();
    let mut failure = ProviderCallError::new("provider_error", safe_message, "reading_body");
    failure.provider_error_type = provider_error_type;
    failure.provider_code = provider_code;
    failure.provider_request_id = request_id.map(|value| value.to_string().into_boxed_str());
    if semantic_output_started {
        failure.semantic_output_started = Some(true);
    }
    failure
}

fn response_request_id(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get("x-generation-id")
        .or_else(|| response.headers().get("x-request-id"))
        .or_else(|| response.headers().get("request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn timeout_error(message: &str, phase: &str, request_id: Option<&str>, semantic_output_started: bool) -> ProviderCallError {
    let mut error = ProviderCallError::new("timeout", message, phase);
    error.provider_request_id = request_id.map(|value| value.to_string().into_boxed_str());
    if semantic_output_started {
        error.semantic_output_started = Some(true);
    }
    error
}

fn remaining_until(deadline: Instant) -> Option<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|duration| !duration.is_zero())
}

fn earlier_deadline(a: Instant, b: Instant) -> Instant {
    a.min(b)
}

pub(super) async fn send_openrouter_streaming_chat_request(
    builder: RequestBuilder,
    request_id: Option<&str>,
    secret: &str,
    policy: &ProviderTimeoutPolicy,
) -> Result<StreamingChatResult, ProviderCallError> {
    let first_event_timeout = Duration::from_millis(policy.first_event_timeout_ms);
    let idle_timeout = Duration::from_millis(policy.idle_timeout_ms);
    let emergency_timeout = Duration::from_millis(policy.absolute_emergency_timeout_ms);

    run_cancellable_chat_request(request_id, "reading_body", async move {
        let started = Instant::now();
        let first_event_deadline = started + first_event_timeout;
        let emergency_deadline = started + emergency_timeout;
        let header_deadline = earlier_deadline(first_event_deadline, emergency_deadline);
        let Some(header_wait) = remaining_until(header_deadline) else {
            return Err(timeout_error("provider first-event timeout elapsed before dispatch", "awaiting_headers", None, false));
        };
        let response = tokio::time::timeout(header_wait, builder.send())
            .await
            .map_err(|_| timeout_error("provider first-event timeout while awaiting response headers", "awaiting_headers", None, false))?
            .map_err(|error| request_error(error, "awaiting_headers"))?;

        let status = response.status();
        let retry_after = retry_after_ms(response.headers());
        let provider_request_id = response_request_id(&response);
        if !status.is_success() {
            let error_body_deadline = earlier_deadline(
                Instant::now() + Duration::from_millis(policy.non_streaming_timeout_ms),
                emergency_deadline,
            );
            let Some(wait) = remaining_until(error_body_deadline) else {
                return Err(timeout_error("provider timeout while reading error response", "reading_body", provider_request_id.as_deref(), false));
            };
            let body = tokio::time::timeout(wait, response.text())
                .await
                .map_err(|_| timeout_error("provider timeout while reading error response", "reading_body", provider_request_id.as_deref(), false))?
                .map_err(|error| request_error(error, "reading_body"))?;
            let parsed = serde_json::from_str::<Value>(&body).ok();
            let (provider_error_type, provider_code) = parsed.as_ref().map(provider_error_metadata).unwrap_or_default();
            let mut failure = ProviderCallError::new(
                "http_status",
                safe_provider_error(status, &body, secret, retry_after),
                "reading_body",
            );
            failure.http_status = Some(status.as_u16());
            failure.provider_error_type = provider_error_type;
            failure.provider_code = provider_code;
            failure.retry_after_ms = retry_after;
            failure.provider_request_id = provider_request_id.map(String::into_boxed_str);
            return Err(failure);
        }

        let mut stream = response.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut accumulator = OpenRouterStreamAccumulator::default();
        let mut saw_transport_activity = false;
        let mut last_transport_activity = started;

        loop {
            if accumulator.done {
                return accumulator.finish(provider_request_id);
            }
            let activity_deadline = if saw_transport_activity {
                last_transport_activity + idle_timeout
            } else {
                first_event_deadline
            };
            let deadline = earlier_deadline(activity_deadline, emergency_deadline);
            let Some(wait) = remaining_until(deadline) else {
                let emergency = Instant::now() >= emergency_deadline;
                let message = if emergency {
                    "provider streaming emergency timeout elapsed"
                } else if saw_transport_activity {
                    "provider streaming idle timeout elapsed"
                } else {
                    "provider first-event timeout elapsed"
                };
                return Err(timeout_error(message, "reading_body", provider_request_id.as_deref(), accumulator.semantic_output_started));
            };
            let next = tokio::time::timeout(wait, stream.next())
                .await
                .map_err(|_| {
                    let emergency = Instant::now() >= emergency_deadline;
                    let message = if emergency {
                        "provider streaming emergency timeout elapsed"
                    } else if saw_transport_activity {
                        "provider streaming idle timeout elapsed"
                    } else {
                        "provider first-event timeout elapsed"
                    };
                    timeout_error(message, "reading_body", provider_request_id.as_deref(), accumulator.semantic_output_started)
                })?;
            match next {
                Some(Ok(bytes)) => {
                    if !bytes.is_empty() {
                        saw_transport_activity = true;
                        last_transport_activity = Instant::now();
                    }
                    let frames = decoder.push(&bytes).map_err(|mut error| {
                        error.provider_request_id = provider_request_id.clone().map(String::into_boxed_str);
                        if accumulator.semantic_output_started {
                            error.semantic_output_started = Some(true);
                        }
                        error
                    })?;
                    for frame in frames {
                        accumulator.process_frame(frame, secret, provider_request_id.as_deref())?;
                    }
                }
                Some(Err(error)) => {
                    let mut failure = request_error(error, "reading_body");
                    failure.provider_request_id = provider_request_id.clone().map(String::into_boxed_str);
                    if accumulator.semantic_output_started {
                        failure.semantic_output_started = Some(true);
                    }
                    return Err(failure);
                }
                None => {
                    let frames = decoder.finish().map_err(|mut error| {
                        error.provider_request_id = provider_request_id.clone().map(String::into_boxed_str);
                        if accumulator.semantic_output_started {
                            error.semantic_output_started = Some(true);
                        }
                        error
                    })?;
                    for frame in frames {
                        accumulator.process_frame(frame, secret, provider_request_id.as_deref())?;
                    }
                    return accumulator.finish(provider_request_id);
                }
            }
        }
    }).await
}
