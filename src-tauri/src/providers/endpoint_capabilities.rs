use std::time::Duration;

use reqwest::Url;
use serde_json::Value;

use crate::secrets;
use super::{ProviderEndpointRequest, ProviderKind};
use super::adapters::{authenticated, normalized_credential_endpoint, provider_base_url};
use super::transport::{client, json_response};

pub(super) fn openrouter_model_endpoints_url(base: &str, model_id: &str) -> Result<String, String> {
    let (author, slug) = model_id.trim().split_once('/')
        .ok_or_else(|| "OpenRouter model id must use author/slug format".to_string())?;
    if author.is_empty() || slug.is_empty() || slug.contains('/') {
        return Err("OpenRouter model id must use author/slug format".to_string());
    }
    let mut url = Url::parse(base).map_err(|_| "invalid OpenRouter base URL".to_string())?;
    {
        let mut segments = url.path_segments_mut().map_err(|_| "invalid OpenRouter base URL".to_string())?;
        segments.pop_if_empty();
        segments.push("models");
        segments.push(author);
        segments.push(slug);
        segments.push("endpoints");
    }
    Ok(url.to_string())
}

pub(super) async fn discover_openrouter_model_endpoints(request: &ProviderEndpointRequest) -> Result<Value, String> {
    if !matches!(request.provider, ProviderKind::Openrouter) {
        return Err("endpoint capability discovery is available only for OpenRouter".to_string());
    }
    let base = provider_base_url(request.provider, request.base_url.as_deref())?;
    let binding = normalized_credential_endpoint(&base)?;
    let secret = secrets::get_credential_for_binding(
        &request.credential_id,
        request.provider.binding_kind(),
        &binding,
    )?;
    let url = openrouter_model_endpoints_url(&base, &request.model_id)?;
    let response = authenticated(client()?.get(url), request.provider, &secret)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let (payload, _) = json_response(response, &secret).await?;
    Ok(payload)
}
