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

