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
        ProviderKind::Blackbox => Some("https://api.blackbox.ai"),
        ProviderKind::CustomOpenai => None,
    };
    let candidate = fixed.or(custom).ok_or_else(|| "custom provider requires a base URL".to_string())?;
    validate_base_url(candidate)
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

pub(super) const OPENROUTER_APP_REFERER: &str = "https://github.com/lukeskytorep-bot/AI-RV-Harness";
pub(super) const OPENROUTER_APP_TITLE: &str = "AI RV Harness";

pub(super) fn authenticated(builder: RequestBuilder, provider: ProviderKind, secret: &str) -> RequestBuilder {
    match provider {
        ProviderKind::Openrouter => builder
            .bearer_auth(secret)
            .header("HTTP-Referer", OPENROUTER_APP_REFERER)
            .header("X-OpenRouter-Title", OPENROUTER_APP_TITLE),
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
