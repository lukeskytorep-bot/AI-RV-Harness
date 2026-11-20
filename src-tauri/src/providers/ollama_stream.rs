//! Native hosted NDJSON. Uses the shared cancellation registry, without SSE parsing.
use std::time::{Duration, Instant};
use futures_util::StreamExt;
use reqwest::RequestBuilder;
use serde_json::{json, Value};
use super::{ProviderCallError, ProviderTimeoutPolicy};
use super::errors::request_error;
use super::response_evidence::{finished, ProviderResponseEvidence};
use super::transport::{run_cancellable_chat_request, chat_json_response_with_limit};
const MAX_LINE: usize = 2 * 1024 * 1024;
const MAX_TOTAL: usize = 16 * 1024 * 1024;

pub(super) enum Event { Started(Option<String>), Content(String), Finished(Option<String>) }
pub(super) struct ResultBody {
    pub payload: Value,
    pub request_id: Option<String>,
    pub semantic_output_started: bool,
    pub response_evidence: Box<ProviderResponseEvidence>,
}
fn invalid(message: &str) -> ProviderCallError { ProviderCallError::new("response_body_decode", message, "reading_body") }
#[derive(Default)]
struct Decoder { pending: Vec<u8>, bytes: usize }
impl Decoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, ProviderCallError> {
        self.bytes = self.bytes.saturating_add(chunk.len());
        if self.bytes > MAX_TOTAL { return Err(ProviderCallError::new("response_body_too_large", "Ollama stream exceeds 16 MiB", "reading_body")); }
        let mut frames = Vec::new();
        for part in chunk.split_inclusive(|b| *b == b'\n') {
            if self.pending.len().saturating_add(part.len()) > MAX_LINE { return Err(ProviderCallError::new("response_body_too_large", "Ollama NDJSON line exceeds 2 MiB", "reading_body")); }
            self.pending.extend_from_slice(part);
            if part.last() == Some(&b'\n') {
                let line = std::mem::take(&mut self.pending);
                if let Some(v) = Self::line(&line)? { frames.push(v); }
            }
        }
        Ok(frames)
    }
    fn line(line: &[u8]) -> Result<Option<Value>, ProviderCallError> {
        if line.iter().all(u8::is_ascii_whitespace) { return Ok(None); }
        serde_json::from_slice(line).map(Some).map_err(|_| invalid("Invalid Ollama NDJSON frame"))
    }
    fn finish(&mut self) -> Result<Vec<Value>, ProviderCallError> {
        Ok(Self::line(&std::mem::take(&mut self.pending))?.into_iter().collect())
    }
}
#[derive(Default)]
struct Accumulator { content: String, thinking: String }
impl Accumulator {
    fn accept(&mut self, value: Value, model: &str, secret: &str) -> Result<(String, Option<Value>), ProviderCallError> {
        crate::native_connection_settings::ensure_metadata_has_no_secret(&value, Some(secret)).map_err(|_| invalid("Ollama response contains credential material"))?;
        if value.get("error").is_some() { return Err(ProviderCallError::new("provider_error", "Ollama returned a stream error", "reading_body")); }
        if value.get("model").and_then(Value::as_str) != Some(model) { return Err(invalid("Ollama response model differs from the requested model")); }
        let done = value.get("done").and_then(Value::as_bool).ok_or_else(|| invalid("Ollama frame has no boolean done field"))?;
        let mut delta = String::new();
        if let Some(message) = value.get("message") {
            if !message.is_object() || message.get("role").is_some_and(|r| r.as_str() != Some("assistant")) || message.get("tool_calls").is_some_and(|t| t.as_array().is_none_or(|a| !a.is_empty())) { return Err(invalid("Unsupported Ollama assistant frame")); }
            for (key, target) in [("content", &mut self.content), ("thinking", &mut self.thinking)] {
                if let Some(v) = message.get(key).filter(|v| !v.is_null()) {
                    let text = v.as_str().ok_or_else(|| invalid("Invalid Ollama assistant text"))?;
                    target.push_str(text);
                    if key == "content" { delta = text.to_owned(); }
                }
            }
        }
        if self.content.len().saturating_add(self.thinking.len()) > MAX_TOTAL { return Err(ProviderCallError::new("response_body_too_large", "Ollama output exceeds 16 MiB", "reading_body")); }
        // Also catch credential material split between separate valid frames before emitting the completing delta.
        crate::native_connection_settings::ensure_metadata_has_no_secret(&json!([&self.content, &self.thinking]), Some(secret)).map_err(|_| invalid("Ollama output contains credential material"))?;
        if !done { return Ok((delta, None)); }
        let mut payload = value;
        payload["message"] = json!({"role":"assistant", "content":self.content, "thinking":self.thinking});
        Ok((delta, Some(payload)))
    }
}
fn timeout() -> ProviderCallError { ProviderCallError::new("timeout", "Ollama stream deadline exceeded", "reading_body") }
fn wait(deadline: Instant) -> Result<Duration, ProviderCallError> { deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero()).ok_or_else(timeout) }

pub(super) async fn send(
    builder: RequestBuilder, request_id: Option<&str>, secret: &str, model: &str,
    policy: &ProviderTimeoutPolicy, mut emit: impl FnMut(Event),
) -> Result<ResultBody, ProviderCallError> {
    let mut provider_id = None;
    let mut semantic = false;
    let result = run_cancellable_chat_request(request_id, "reading_body", async {
        let started = Instant::now();
        let first = started + Duration::from_millis(policy.first_event_timeout_ms);
        let emergency = started + Duration::from_millis(policy.absolute_emergency_timeout_ms);
        let response = tokio::time::timeout(wait(first.min(emergency))?, builder.timeout(Duration::from_millis(policy.absolute_emergency_timeout_ms)).send())
            .await.map_err(|_| timeout())?.map_err(|e| request_error(e, "awaiting_headers"))?;
        provider_id = response.headers().get("x-request-id").or_else(|| response.headers().get("request-id")).and_then(|v| v.to_str().ok()).filter(|v| v.len() <= 512).map(str::to_owned);
        if provider_id.as_ref().is_some_and(|s| !secret.is_empty() && s.contains(secret)) { return Err(invalid("Ollama response contains credential material")); }
        let json_body = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next().is_some_and(|s| s.trim().eq_ignore_ascii_case("application/json")));
        if !response.status().is_success() || json_body {
            // Some endpoints/proxies return a complete native JSON body even when streaming was requested.
            let (value, id) = tokio::time::timeout(wait((Instant::now() + Duration::from_millis(policy.non_streaming_timeout_ms)).min(emergency))?, chat_json_response_with_limit(response, secret, Some(MAX_TOTAL))).await.map_err(|_| timeout())??;
            let proof = finished(Some(&value), id.as_deref(), "body_read");
            let mut accumulator = Accumulator::default();
            let (delta, payload) = accumulator.accept(value, model, secret).map_err(|mut e| { e.metadata.response_evidence = Some(proof.clone()); e })?;
            let payload = payload.ok_or_else(|| { let mut e = invalid("Incomplete Ollama JSON response"); e.metadata.response_evidence = Some(proof.clone()); e })?;
            emit(Event::Started(id.clone()));
            if !delta.is_empty() { semantic = true; emit(Event::Content(delta)); }
            emit(Event::Finished(payload.get("done_reason").and_then(Value::as_str).map(str::to_owned)));
            return Ok(ResultBody { payload, request_id: id, semantic_output_started: semantic, response_evidence: proof });
        }
        emit(Event::Started(provider_id.clone()));
        let mut stream = response.bytes_stream();
        let mut decoder = Decoder::default();
        let mut accumulator = Accumulator::default();
        let mut saw_frame = false;
        let mut last = started;
        loop {
            let deadline = if saw_frame { last + Duration::from_millis(policy.idle_timeout_ms) } else { first };
            let next = tokio::time::timeout(wait(deadline.min(emergency))?, stream.next()).await.map_err(|_| timeout())?;
            let eof = next.is_none();
            let frames = match next { Some(bytes) => decoder.push(&bytes.map_err(|e| request_error(e, "reading_body"))?)?, None => decoder.finish()? };
            for value in frames {
                saw_frame = true; last = Instant::now();
                let (delta, payload) = accumulator.accept(value, model, secret)?;
                if !delta.is_empty() { semantic = true; emit(Event::Content(delta)); }
                if let Some(payload) = payload {
                    let proof = finished(Some(&payload), provider_id.as_deref(), "ndjson_done");
                    emit(Event::Finished(payload.get("done_reason").and_then(Value::as_str).map(str::to_owned)));
                    return Ok(ResultBody { payload, request_id: provider_id.clone(), semantic_output_started: semantic, response_evidence: proof });
                }
            }
            if eof { return Err(ProviderCallError::new("response_body_read", "Ollama stream ended before done=true", "reading_body")); }
        }
    }).await;
    result.map_err(|mut e| {
        e.metadata.semantic_output_started = Some(semantic);
        if e.metadata.provider_request_id.is_none() { e.metadata.provider_request_id = provider_id.map(String::into_boxed_str); }
        e
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    const SECRET: &str = "fixture-private-key";
    const MODEL: &str = "qwen3:235b";
    fn frame(content: &str, thinking: &str, done: bool) -> Value {
        json!({"model":MODEL,"message":{"role":"assistant","content":content,"thinking":thinking},"done":done,"done_reason":if done {"stop"} else {""},"eval_count":11,"prompt_eval_count":7,"total_duration":1234})
    }
    fn policy() -> ProviderTimeoutPolicy {
        ProviderTimeoutPolicy {first_event_timeout_ms:2000,idle_timeout_ms:2000,absolute_emergency_timeout_ms:5000,non_streaming_timeout_ms:2000,timeout_class:"test".into()}
    }
    async fn fixture(body: Vec<u8>, content_type: &str, hold: bool) -> (String,tokio::task::JoinHandle<()>) {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url=format!("http://{}",listener.local_addr().unwrap());
        let content_type=content_type.to_owned();
        let task=tokio::spawn(async move {
            let (mut socket,_)=listener.accept().await.unwrap();let mut request=[0;4096];
            let n=socket.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..n]).contains("Bearer fixture-private-key"));
            let length=body.len()+if hold {1000} else {0};
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nx-request-id: req-native\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
            for chunk in body.chunks(7) { if socket.write_all(chunk).await.is_err() {return;} tokio::task::yield_now().await; }
            if hold { std::future::pending::<()>().await; }
        });(url,task)
    }
    fn builder(url: String) -> RequestBuilder { reqwest::Client::new().post(url).bearer_auth(SECRET) }
    #[test]
    fn decoder_handles_each_byte_of_utf8_and_final_line_without_newline() {
        let body=format!("{}\n{}",frame("Żółw", "private", false),frame("!", "", true));
        let mut decoder=Decoder::default();let mut values=Vec::new();
        for byte in body.bytes() { values.extend(decoder.push(&[byte]).unwrap()); }
        values.extend(decoder.finish().unwrap());assert_eq!(values.len(),2);
        let mut accumulator=Accumulator::default();
        assert!(accumulator.accept(values.remove(0),MODEL,SECRET).unwrap().1.is_none());
        let payload=accumulator.accept(values.remove(0),MODEL,SECRET).unwrap().1.unwrap();
        assert_eq!(payload["message"]["content"],"Żółw!");assert_eq!(payload["message"]["thinking"],"private");assert_eq!(payload["eval_count"],11);
    }
    #[test]
    fn invalid_frames_limits_wrong_models_and_split_secret_are_rejected() {
        assert!(Decoder::default().push(b"not-json\n").is_err());
        assert!(Decoder::default().push(&vec![b' ';MAX_LINE+1]).is_err());
        let mut decoder=Decoder{bytes:MAX_TOTAL,..Default::default()};assert!(decoder.push(b" ").is_err());
        let mut accumulator=Accumulator::default();
        assert!(accumulator.accept(frame("x","",false),"different",SECRET).is_err());
        accumulator.accept(frame("fixture-private-","",false),MODEL,SECRET).unwrap();
        let error=accumulator.accept(frame("key","",true),MODEL,SECRET).unwrap_err();
        assert!(!serde_json::to_string(&error).unwrap().contains(SECRET));
    }
    #[tokio::test]
    async fn ndjson_emits_only_content_and_retains_terminal_usage_and_evidence() {
        let body=format!("{}\n{}\n",frame("Hello ","hidden",false),frame("world","",true));
        let (url,task)=fixture(body.into_bytes(),"application/x-ndjson",false).await;
        let mut events=Vec::new();let result=send(builder(url),Some("ndjson-success"),SECRET,MODEL,&policy(),|e| events.push(e)).await.unwrap();task.await.unwrap();
        let text=events.iter().filter_map(|e| if let Event::Content(s)=e {Some(s.as_str())} else {None}).collect::<String>();
        assert_eq!(text,"Hello world");assert_eq!(result.payload["message"]["thinking"],"hidden");
        assert_eq!(result.payload["total_duration"],1234);assert_eq!(result.request_id.as_deref(),Some("req-native"));
        let proof=serde_json::to_value(&result.response_evidence).unwrap();assert_eq!(proof["boundary"],"ndjson_done");assert_eq!(proof["usage"]["outputTokens"],11);
        assert!(matches!(events.last(),Some(Event::Finished(Some(reason))) if reason=="stop"));
    }
    #[tokio::test]
    async fn complete_json_fallback_preserves_body_read_boundary() {
        let (url,task)=fixture(frame("Final","",true).to_string().into_bytes(),"Application/JSON; charset=utf-8",false).await;
        let result=send(builder(url),Some("json-fallback"),SECRET,MODEL,&policy(),|_|{}).await.unwrap();task.await.unwrap();
        assert_eq!(result.payload["message"]["content"],"Final");assert_eq!(serde_json::to_value(result.response_evidence).unwrap()["boundary"],"body_read");
    }
    #[tokio::test]
    async fn eof_before_done_has_no_completion_proof() {
        let (url,task)=fixture(format!("{}\n",frame("partial","",false)).into_bytes(),"application/x-ndjson",false).await;
        let error=send(builder(url),Some("ndjson-eof"),SECRET,MODEL,&policy(),|_|{}).await.err().unwrap();task.await.unwrap();
        assert_eq!(error.code.as_ref(),"response_body_read");assert!(error.metadata.response_evidence.is_none());assert_eq!(error.metadata.semantic_output_started,Some(true));
    }
    #[tokio::test]
    async fn stop_during_stream_uses_shared_registry_and_never_finishes() {
        let (url,task)=fixture(format!("{}\n",frame("partial","",false)).into_bytes(),"application/x-ndjson",true).await;
        let mut finished=false;
        let error=send(builder(url),Some("ndjson-stop"),SECRET,MODEL,&policy(),|e|match e {Event::Content(_)=>{super::super::transport::cancel_request("ndjson-stop".into()).unwrap();},Event::Finished(_)=>finished=true,_=>{}}).await.err().unwrap();task.abort();
        assert_eq!(error.code.as_ref(),"cancelled");assert!(!finished);assert!(error.metadata.response_evidence.is_none());
    }
    #[tokio::test]
    async fn idle_timeout_retains_partial_without_completion_proof() {
        let (url,task)=fixture(format!("{}\n",frame("partial","",false)).into_bytes(),"application/x-ndjson",true).await;
        let mut limits=policy();limits.idle_timeout_ms=20;
        let error=send(builder(url),Some("ndjson-idle"),SECRET,MODEL,&limits,|_|{}).await.err().unwrap();task.abort();
        assert_eq!(error.code.as_ref(),"timeout");assert!(error.metadata.response_evidence.is_none());assert_eq!(error.metadata.semantic_output_started,Some(true));
    }
}
