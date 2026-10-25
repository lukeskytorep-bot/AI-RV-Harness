use reqwest::{RequestBuilder, Url};

use super::ProviderKind;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ProviderFamily {
    OpenaiCompatible,
    Google,
    Anthropic,
}

pub(super) fn provider_family(provider: ProviderKind) -> ProviderFamily {
    match provider {
        ProviderKind::Google => ProviderFamily::Google,
        ProviderKind::Anthropic => ProviderFamily::Anthropic,
        _ => ProviderFamily::OpenaiCompatible,
    }
}

pub(super) fn provider_base_url(provider: ProviderKind, custom: Option<&str>) -> Result<String, String> {
    let fixed = match provider {
        ProviderKind::Openrouter => Some("https://openrouter.ai/api/v1"),
        ProviderKind::Google => Some("https://generativelanguage.googleapis.com/v1beta"),
        ProviderKind::Openai => Some("https://api.openai.com/v1"),
        ProviderKind::Anthropic => Some("https://api.anthropic.com/v1"),
        ProviderKind::Zai => Some("https://api.z.ai/api/paas/v4"),
        ProviderKind::Deepseek => Some("https://api.deepseek.com"),
        ProviderKind::Mistral => Some("https://api.mistral.ai/v1"),
        ProviderKind::Blackbox => return blackbox_base_url(custom),
        ProviderKind::CustomOpenai => None,
    };
    let candidate = fixed.or(custom).ok_or_else(|| "custom provider requires a base URL".to_string())?;
    validate_base_url(candidate)
}

fn blackbox_base_url(custom: Option<&str>) -> Result<String, String> {
    let candidate = custom.filter(|value| !value.trim().is_empty()).unwrap_or("https://api.blackbox.ai");
    let normalized = validate_base_url(candidate)?;
    let url = Url::parse(&normalized).map_err(|_| "invalid Blackbox base URL".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "blackbox.ai" && !host.ends_with(".blackbox.ai") {
        return Err("Blackbox base URL must use blackbox.ai or a blackbox.ai subdomain".to_string());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("Blackbox base URL must be an origin without an API path".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Blackbox base URL must not contain query or fragment components".to_string());
    }
    Ok(normalized)
}

pub(super) fn validate_base_url(value: &str) -> Result<String, String> {
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

pub(super) fn normalized_credential_endpoint(base: &str) -> Result<String, String> {
    let url = Url::parse(base.trim()).map_err(|_| "invalid provider base URL".to_string())?;
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub(super) fn authenticated(builder: RequestBuilder, provider: ProviderKind, secret: &str) -> RequestBuilder {
    match provider {
        ProviderKind::Google => builder.header("x-goog-api-key", secret),
        ProviderKind::Anthropic => builder
            .header("x-api-key", secret)
            .header("anthropic-version", "2023-06-01"),
        _ => builder.bearer_auth(secret),
    }
}

pub(super) fn endpoint(base: &str, suffix: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), suffix.trim_start_matches('/'))
}
