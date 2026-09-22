use super::ProviderChatRequest;

pub(super) fn validate_request_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 80
        || !value.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("invalid provider request id".to_string());
    }
    Ok(())
}

pub(super) fn validate_chat_request(request: &ProviderChatRequest) -> Result<(), String> {
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
        if message.continuation_state.is_some() && (!matches!(request.provider, super::ProviderKind::Openrouter) || message.role != "assistant") {
            return Err("continuation state is supported only on OpenRouter assistant messages".to_string());
        }
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
    if let Some(policy) = request.timeout_policy.as_ref() {
        if !matches!(policy.timeout_class.as_str(), "interactive" | "analytical" | "long_reasoning") {
            return Err("invalid provider timeout class".to_string());
        }
        if !(1_000..=600_000).contains(&policy.first_event_timeout_ms)
            || !(1_000..=600_000).contains(&policy.idle_timeout_ms)
            || !(1_000..=600_000).contains(&policy.non_streaming_timeout_ms)
            || !(60_000..=7_200_000).contains(&policy.absolute_emergency_timeout_ms)
        {
            return Err("invalid provider timeout policy".to_string());
        }
    }
    Ok(())
}



fn validate_openrouter_reasoning_detail(detail: &serde_json::Value) -> bool {
    let Some(object) = detail.as_object() else { return false; };
    let Some(kind) = object.get("type").and_then(serde_json::Value::as_str) else { return false; };
    let id_ok = match object.get("id") {
        Some(serde_json::Value::Null) => true,
        Some(serde_json::Value::String(value)) => !value.is_empty() && value.len() <= 512,
        _ => false,
    };
    if !id_ok { return false; }
    let format_ok = object
        .get("format")
        .and_then(serde_json::Value::as_str)
        .map(|value| matches!(
            value,
            "unknown"
                | "openai-responses-v1"
                | "azure-openai-responses-v1"
                | "bedrock-openai-responses-v1"
                | "bedrock-xai-responses-v1"
                | "xai-responses-v1"
                | "meta-responses-v1"
                | "anthropic-claude-v1"
                | "google-gemini-v1"
        ))
        .unwrap_or(false);
    if !format_ok { return false; }
    if let Some(index) = object.get("index") {
        if index.as_u64().is_none() { return false; }
    }

    let allowed = |keys: &[&str]| object.keys().all(|key| keys.contains(&key.as_str()));
    match kind {
        "reasoning.summary" => {
            allowed(&["type", "summary", "id", "format", "index"])
                && object.get("summary").and_then(serde_json::Value::as_str).is_some()
        }
        "reasoning.encrypted" => {
            allowed(&["type", "data", "id", "format", "index"])
                && object.get("data").and_then(serde_json::Value::as_str).is_some_and(|value| !value.is_empty())
        }
        "reasoning.text" => {
            if !allowed(&["type", "text", "signature", "id", "format", "index"])
                || object.get("text").and_then(serde_json::Value::as_str).is_none()
            {
                return false;
            }
            match object.get("signature") {
                None | Some(serde_json::Value::Null) => true,
                Some(serde_json::Value::String(value)) => !value.is_empty(),
                _ => false,
            }
        }
        _ => false,
    }
}

pub(super) fn validate_continuation_bindings(request: &ProviderChatRequest, normalized_endpoint: &str) -> Result<(), String> {
    const MAX_BLOCKS: usize = 64;
    const MAX_BLOCK_BYTES: usize = 512 * 1024;
    const MAX_STATE_BYTES: usize = 2 * 1024 * 1024;
    const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;

    let mut request_bytes = 0usize;
    for message in &request.messages {
        let Some(state) = message.continuation_state.as_ref() else { continue; };
        if !matches!(request.provider, super::ProviderKind::Openrouter) {
            return Err("continuation state is supported only for OpenRouter in C1".to_string());
        }
        if message.role != "assistant" {
            return Err("continuation state is allowed only on assistant messages".to_string());
        }
        if state.schema_version != 1
            || state.transport != "openrouter"
            || state.format != "openrouter-reasoning-details"
            || state.replay_fingerprint.transport != "openrouter"
            || state.replay_fingerprint.state_format != "openrouter-reasoning-details"
            || state.replay_fingerprint.state_format_version != 1
        {
            return Err("unsupported OpenRouter continuation state".to_string());
        }
        if state.replay_fingerprint.normalized_endpoint != normalized_endpoint
            || state.replay_fingerprint.provider_config_id != request.provider_config_id
            || state.replay_fingerprint.credential_id != request.credential_id
            || state.replay_fingerprint.requested_model_id != request.model_id
        {
            return Err("OpenRouter continuation fingerprint is incompatible with this request".to_string());
        }
        if state.reasoning_details.len() > MAX_BLOCKS {
            return Err("OpenRouter continuation state exceeds block count limit".to_string());
        }
        for detail in &state.reasoning_details {
            if !validate_openrouter_reasoning_detail(detail) {
                return Err("invalid OpenRouter continuation detail".to_string());
            }
            let bytes = serde_json::to_vec(detail).map_err(|_| "invalid OpenRouter continuation detail".to_string())?.len();
            if bytes > MAX_BLOCK_BYTES {
                return Err("OpenRouter continuation state contains an oversized block".to_string());
            }
        }
        let state_bytes = serde_json::to_vec(state).map_err(|_| "invalid OpenRouter continuation state".to_string())?.len();
        if state_bytes > MAX_STATE_BYTES {
            return Err("OpenRouter continuation state exceeds per-message size limit".to_string());
        }
        request_bytes = request_bytes.saturating_add(state_bytes);
        if request_bytes > MAX_REQUEST_BYTES {
            return Err("OpenRouter continuation states exceed per-request size limit".to_string());
        }
    }
    Ok(())
}
