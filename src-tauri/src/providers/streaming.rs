use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::RequestBuilder;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::ipc::Channel;

use super::{ProviderCallError, ProviderTimeoutPolicy};
use super::errors::{provider_error_metadata, request_error, safe_provider_error};
use super::transport::{retry_after_ms, run_cancellable_chat_request};

// Hard transport guards. They bound stream memory independently from model/output settings.
pub(super) const MAX_PENDING_SSE_EVENT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_ACCUMULATED_STREAM_DATA_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event", content = "data")]
pub(crate) enum ProviderStreamEvent {
    Started { provider_request_id: Option<String> },
    ContentDelta { content: String },
    Finished { finish_reason: Option<String> },
}

#[derive(Debug)]
pub(super) struct StreamingChatResult {
    pub(super) payload: Value,
    pub(super) request_id: Option<String>,
    pub(super) semantic_output_started: bool,
    pub(super) continuation_diagnostics: ProviderContinuationStreamDiagnostics,
}

#[derive(Clone, Debug, Default, Serialize)]
pub(super) struct ProviderContinuationStreamDiagnostics {
    pub(super) raw_sse_events: u64,
    pub(super) received_reasoning_detail_items: u64,
    pub(super) logical_reasoning_blocks: u64,
    pub(super) reasoning_details_present: bool,
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

const LIVE_REASONING_TAGS: [(&str, &str); 6] = [
    ("<think>", "</think>"),
    ("<thinking>", "</thinking>"),
    ("<reason>", "</reason>"),
    ("<reasoning>", "</reasoning>"),
    ("<thought>", "</thought>"),
    ("<|begin_of_thought|>", "<|end_of_thought|>"),
];

#[derive(Default)]
struct LiveVisibleContentFilter {
    pending: String,
    reasoning_close_tag: Option<&'static str>,
}

impl LiveVisibleContentFilter {
    fn filter_content(&mut self, value: Option<&Value>) -> String {
        match value {
            Some(Value::String(text)) => self.push_text(text),
            Some(Value::Array(parts)) => {
                let mut visible = String::new();
                for part in parts {
                    match part {
                        Value::String(text) => visible.push_str(&self.push_text(text)),
                        Value::Object(_) => {
                            let kind = part
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_ascii_lowercase();
                            let reasoning_part =
                                kind.contains("reason") || kind.contains("think") || kind.contains("thought");
                            if reasoning_part {
                                continue;
                            }
                            let text = part
                                .get("text")
                                .and_then(Value::as_str)
                                .or_else(|| part.pointer("/text/value").and_then(Value::as_str))
                                .or_else(|| part.get("thinking").and_then(Value::as_str))
                                .or_else(|| part.get("reasoning").and_then(Value::as_str));
                            if let Some(text) = text {
                                visible.push_str(&self.push_text(text));
                            }
                        }
                        _ => {}
                    }
                }
                visible
            }
            _ => String::new(),
        }
    }

    fn push_text(&mut self, text: &str) -> String {
        self.pending.push_str(text);
        let mut visible = String::new();

        loop {
            if let Some(close_tag) = self.reasoning_close_tag {
                let lower = self.pending.to_ascii_lowercase();
                if let Some(offset) = lower.find(close_tag) {
                    let end = offset + close_tag.len();
                    self.pending.drain(..end);
                    self.reasoning_close_tag = None;
                    continue;
                }

                let keep = longest_ascii_suffix_prefix(&self.pending, &[close_tag]);
                if keep == 0 {
                    self.pending.clear();
                } else if self.pending.len() > keep {
                    self.pending.drain(..self.pending.len() - keep);
                }
                break;
            }

            let lower = self.pending.to_ascii_lowercase();
            let next_open = LIVE_REASONING_TAGS
                .iter()
                .filter_map(|(open, close)| lower.find(*open).map(|offset| (offset, *open, *close)))
                .min_by_key(|entry| entry.0);

            if let Some((offset, open, close)) = next_open {
                visible.push_str(&self.pending[..offset]);
                self.pending.drain(..offset + open.len());
                self.reasoning_close_tag = Some(close);
                continue;
            }

            let opens = LIVE_REASONING_TAGS.map(|(open, _)| open);
            let keep = longest_ascii_suffix_prefix(&self.pending, &opens);
            let emit_len = self.pending.len().saturating_sub(keep);
            if emit_len > 0 {
                visible.push_str(&self.pending[..emit_len]);
                self.pending.drain(..emit_len);
            }
            break;
        }

        visible
    }

    fn finish(&mut self) -> String {
        if self.reasoning_close_tag.is_some() {
            self.pending.clear();
            return String::new();
        }
        std::mem::take(&mut self.pending)
    }
}

fn longest_ascii_suffix_prefix(value: &str, candidates: &[&str]) -> usize {
    let lower = value
        .as_bytes()
        .iter()
        .map(u8::to_ascii_lowercase)
        .collect::<Vec<_>>();
    candidates
        .iter()
        .flat_map(|candidate| 1..candidate.len())
        .filter(|length| *length <= lower.len())
        .filter(|length| {
            let suffix = &lower[lower.len() - *length..];
            candidates.iter().any(|candidate| {
                candidate.len() > *length && &candidate.as_bytes()[..*length] == suffix
            })
        })
        .max()
        .unwrap_or(0)
}

#[derive(Default)]
struct OpenRouterReasoningDetailsAccumulator {
    details: Vec<Value>,
    field_seen: bool,
    received_items: u64,
}

impl OpenRouterReasoningDetailsAccumulator {
    fn ingest(&mut self, value: Option<&Value>) -> Result<(), &'static str> {
        let Some(value) = value else { return Ok(()); };
        if value.is_null() {
            return Ok(());
        }
        let Value::Array(items) = value else {
            return Err("provider streaming reasoning_details must be an array or null when present");
        };
        self.field_seen = true;
        self.received_items = self.received_items.saturating_add(items.len() as u64);
        for detail in items {
            if let Some(last) = self.details.last_mut() {
                if merge_openrouter_reasoning_delta(last, detail) {
                    continue;
                }
            }
            self.details.push(detail.clone());
        }
        Ok(())
    }
}

fn detail_has_only_known_keys(object: &Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

fn nullable_string_field(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null) | Some(Value::String(_)))
}

fn compatible_identity_string(left: &Map<String, Value>, right: &Map<String, Value>, key: &str) -> bool {
    let left_value = left.get(key);
    let right_value = right.get(key);
    if !nullable_string_field(left_value) || !nullable_string_field(right_value) {
        return false;
    }
    match (left_value, right_value) {
        (Some(Value::String(a)), Some(Value::String(b))) => a == b,
        (Some(Value::String(_)), None)
        | (None, Some(Value::String(_)))
        | (Some(Value::Null), Some(Value::String(_)))
        | (Some(Value::String(_)), Some(Value::Null)) => false,
        _ => true,
    }
}

fn compatible_fillable_string(left: &Map<String, Value>, right: &Map<String, Value>, key: &str) -> bool {
    let left_value = left.get(key);
    let right_value = right.get(key);
    if !nullable_string_field(left_value) || !nullable_string_field(right_value) {
        return false;
    }
    match (left_value, right_value) {
        (Some(Value::String(a)), Some(Value::String(b))) if !a.is_empty() && !b.is_empty() => a == b,
        _ => true,
    }
}

fn merge_late_format(left: &mut Map<String, Value>, right: &Map<String, Value>) {
    let left_missing = !matches!(left.get("format"), Some(Value::String(value)) if !value.is_empty());
    if left_missing {
        if let Some(Value::String(format)) = right.get("format") {
            if !format.is_empty() {
                left.insert("format".to_string(), Value::String(format.clone()));
            }
        }
    }
}

fn merge_late_signature(left: &mut Map<String, Value>, right: &Map<String, Value>) {
    let left_missing = !matches!(left.get("signature"), Some(Value::String(value)) if !value.is_empty());
    if left_missing {
        if let Some(Value::String(signature)) = right.get("signature") {
            if !signature.is_empty() {
                left.insert("signature".to_string(), Value::String(signature.clone()));
            }
        }
    }
}

// OpenRouter stream canonicalization is intentionally narrow: only contiguous
// summary/text deltas with compatible known identity/format fields may merge.
// Stream `index` is preserved from the first delta but is not used as block identity.
fn merge_openrouter_reasoning_delta(last: &mut Value, next: &Value) -> bool {
    let (Some(last_object), Some(next_object)) = (last.as_object_mut(), next.as_object()) else {
        return false;
    };
    let Some(last_type) = last_object.get("type").and_then(Value::as_str) else { return false; };
    let Some(next_type) = next_object.get("type").and_then(Value::as_str) else { return false; };
    if last_type != next_type || !matches!(last_type, "reasoning.summary" | "reasoning.text") {
        return false;
    }
    let is_text = last_type == "reasoning.text";

    let (payload_key, allowed): (&str, &[&str]) = if is_text {
        ("text", &["type", "text", "signature", "id", "format", "index"])
    } else {
        ("summary", &["type", "summary", "id", "format", "index"])
    };
    if !detail_has_only_known_keys(last_object, allowed) || !detail_has_only_known_keys(next_object, allowed) {
        return false;
    }
    if !compatible_identity_string(last_object, next_object, "id")
        || !compatible_fillable_string(last_object, next_object, "format")
    {
        return false;
    }
    if is_text && !compatible_fillable_string(last_object, next_object, "signature") {
        return false;
    }
    let next_fragment = match next_object.get(payload_key) {
        Some(Value::String(fragment)) => fragment.as_str(),
        None | Some(Value::Null)
            if is_text && matches!(next_object.get("signature"), Some(Value::String(value)) if !value.is_empty()) => "",
        _ => return false,
    };
    let Some(Value::String(last_fragment)) = last_object.get_mut(payload_key) else { return false; };
    last_fragment.push_str(next_fragment);
    merge_late_format(last_object, next_object);
    if is_text {
        merge_late_signature(last_object, next_object);
    }
    true
}

#[derive(Default)]
pub(super) struct OpenRouterStreamAccumulator {
    content: String,
    reasoning: String,
    reasoning_details: OpenRouterReasoningDetailsAccumulator,
    finish_reason: Option<String>,
    native_finish_reason: Option<String>,
    actual_model: Option<String>,
    actual_provider: Option<String>,
    response_id: Option<String>,
    usage: Option<Value>,
    openrouter_metadata: Option<Value>,
    accumulated_stream_data_bytes: usize,
    raw_sse_events: u64,
    live_visible_content_filter: LiveVisibleContentFilter,
    done: bool,
    pub(super) semantic_output_started: bool,
}

impl OpenRouterStreamAccumulator {
    fn process_frame_with_events(&mut self, frame: SseFrame, secret: &str, request_id: Option<&str>) -> Result<Vec<ProviderStreamEvent>, ProviderCallError> {
        match frame {
            SseFrame::Comment => Ok(Vec::new()),
            SseFrame::Data(data) => self.process_data_with_events(&data, secret, request_id),
        }
    }

    pub(super) fn process_data_with_events(&mut self, data: &str, secret: &str, request_id: Option<&str>) -> Result<Vec<ProviderStreamEvent>, ProviderCallError> {
        self.raw_sse_events = self.raw_sse_events.saturating_add(1);
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
            let mut events = Vec::new();
            let visible_tail = self.live_visible_content_filter.finish();
            if !visible_tail.is_empty() {
                events.push(ProviderStreamEvent::ContentDelta { content: visible_tail });
            }
            events.push(ProviderStreamEvent::Finished { finish_reason: self.finish_reason.clone() });
            return Ok(events);
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
            return Ok(Vec::new());
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
        let reasoning_details_value = delta.get("reasoning_details");
        let reasoning_details = reasoning_details_value.and_then(Value::as_array);
        if first_semantic_chunk(delta, &content, &reasoning, reasoning_details.map(Vec::as_slice)) {
            self.semantic_output_started = true;
        }
        let mut events = Vec::new();
        if !content.is_empty() {
            self.content.push_str(&content);
        }
        let visible_content = self.live_visible_content_filter.filter_content(delta.get("content"));
        if !visible_content.is_empty() {
            events.push(ProviderStreamEvent::ContentDelta { content: visible_content });
        }
        if !reasoning.is_empty() {
            self.reasoning.push_str(&reasoning);
        }
        self.reasoning_details.ingest(reasoning_details_value).map_err(|message| {
            self.error("invalid_provider_json", message, "parsing_body", request_id)
        })?;
        Ok(events)
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
        if self.reasoning_details.field_seen {
            message.insert("reasoning_details".into(), Value::Array(self.reasoning_details.details.clone()));
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
            continuation_diagnostics: ProviderContinuationStreamDiagnostics {
                raw_sse_events: self.raw_sse_events,
                received_reasoning_detail_items: self.reasoning_details.received_items,
                logical_reasoning_blocks: self.reasoning_details.details.len() as u64,
                reasoning_details_present: self.reasoning_details.field_seen,
            },
        })
    }
}

fn first_semantic_chunk(delta: &Value, content: &str, reasoning: &str, reasoning_details: Option<&[Value]>) -> bool {
    !content.is_empty()
        || !reasoning.is_empty()
        || reasoning_details.is_some_and(|details| !details.is_empty())
        || delta.get("reasoning_details").is_some_and(|value| !value.is_null() && !value.is_array())
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
    on_stream: Option<&Channel<ProviderStreamEvent>>,
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
        if status.is_success() {
            if let Some(channel) = on_stream {
                let _ = channel.send(ProviderStreamEvent::Started { provider_request_id: provider_request_id.clone() });
            }
        }
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
                        let events = accumulator.process_frame_with_events(frame, secret, provider_request_id.as_deref())?;
                        if let Some(channel) = on_stream {
                            for event in events {
                                let _ = channel.send(event);
                            }
                        }
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
                        let events = accumulator.process_frame_with_events(frame, secret, provider_request_id.as_deref())?;
                        if let Some(channel) = on_stream {
                            for event in events {
                                let _ = channel.send(event);
                            }
                        }
                    }
                    return accumulator.finish(provider_request_id);
                }
            }
        }
    }).await
}
