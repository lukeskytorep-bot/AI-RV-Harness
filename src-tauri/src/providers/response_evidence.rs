//! Transport completion proof, constructed only after body read or SSE DONE.
//! No response text, reasoning, request messages or credentials belong here.
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProviderResponseEvidence {
    version: u8,
    transport_outcome: &'static str,
    boundary: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<UsageEvidence>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageEvidence {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    total_tokens: Option<u64>,
    cost_usd: Option<f64>,
}

pub(super) fn finished(payload: Option<&Value>, request_id: Option<&str>, boundary: &'static str) -> Box<ProviderResponseEvidence> {
    let empty = Value::Null;
    let payload = payload.unwrap_or(&empty);
    let number = |paths: &[&str]| paths.iter().find_map(|path| payload.pointer(path).and_then(Value::as_u64));
    let usage = UsageEvidence {
        input_tokens: number(&["/usage/prompt_tokens", "/usage/input_tokens", "/usageMetadata/promptTokenCount"]),
        output_tokens: number(&["/usage/completion_tokens", "/usage/output_tokens", "/usageMetadata/candidatesTokenCount"]),
        reasoning_tokens: number(&["/usage/completion_tokens_details/reasoning_tokens", "/usage/reasoning_tokens", "/usageMetadata/thoughtsTokenCount"]),
        total_tokens: number(&["/usage/total_tokens", "/usageMetadata/totalTokenCount"]),
        cost_usd: payload.pointer("/usage/cost").and_then(Value::as_f64).filter(|cost| cost.is_finite() && *cost >= 0.0),
    };
    let has_usage = usage.input_tokens.is_some() || usage.output_tokens.is_some() || usage.reasoning_tokens.is_some() || usage.total_tokens.is_some() || usage.cost_usd.is_some();
    Box::new(ProviderResponseEvidence {
        version: 1,
        transport_outcome: "response_finished",
        boundary,
        finish_reason: payload.pointer("/choices/0/finish_reason").or_else(|| payload.pointer("/candidates/0/finishReason")).or_else(|| payload.get("stop_reason")).and_then(Value::as_str).map(str::to_string),
        provider_request_id: request_id.map(str::to_string),
        generation_id: payload.get("id").and_then(Value::as_str).map(str::to_string),
        usage: has_usage.then_some(usage),
    })
}
