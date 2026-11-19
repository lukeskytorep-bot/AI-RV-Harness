//! DIRECT-3B1: pending connection metadata only. No HTTP or secret-store access.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub version: u8,
    pub provider: String,
    pub provider_config_id: String,
    pub connection_identity_id: String,
    pub connection_revision: u64,
    pub normalized_endpoint: String,
    pub auth_mode: String,
}

pub struct StoredConnection {
    pub id: String,
    pub provider: String,
    pub endpoint: String,
    pub auth_mode: String,
    pub credential_id: Option<String>,
    pub credential_hint: Option<String>,
    pub identity_id: String,
    pub revision: u64,
    pub enabled: bool,
}

pub fn normalize_endpoint(input: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(input.trim()).map_err(|_| "Invalid native connection URL")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Native connection requires HTTPS or loopback HTTP".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path().contains('%') {
        return Err("Native base URL must not contain credentials, encoded paths, query or fragment".into());
    }
    if url.path().split('/').any(|part| part.eq_ignore_ascii_case("api") || part.eq_ignore_ascii_case("v1")) {
        return Err("Enter the native server base before /api".into());
    }
    Ok(url.to_string().trim_end_matches('/').into())
}

pub fn verify_binding(stored: &StoredConnection, requested: &Binding) -> Result<Binding, String> {
    let mode_valid = match stored.auth_mode.as_str() {
        "none" => stored.credential_id.is_none() && stored.credential_hint.is_none(),
        "bearer" => stored.credential_id.as_ref().is_some_and(|id| !id.trim().is_empty()),
        _ => false,
    };
    if stored.provider != "ollama_native" || stored.id.trim().is_empty() || stored.identity_id.trim().is_empty() || stored.revision == 0 || stored.revision > 9_007_199_254_740_991 || stored.enabled || !mode_valid {
        return Err("Invalid pending native connection".into());
    }
    let endpoint = normalize_endpoint(&stored.endpoint)?;
    if endpoint != stored.endpoint {
        return Err("Saved native endpoint is not canonical".into());
    }
    let canonical = Binding { version: 1, provider: stored.provider.clone(), provider_config_id: stored.id.clone(), connection_identity_id: stored.identity_id.clone(), connection_revision: stored.revision, normalized_endpoint: endpoint, auth_mode: stored.auth_mode.clone() };
    if requested != &canonical { return Err("Native connection identity, endpoint, authentication or revision changed".into()); }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stored() -> StoredConnection { StoredConnection { id:"p".into(), provider:"ollama_native".into(), endpoint:"http://localhost:11434".into(), auth_mode:"none".into(), credential_id:None, credential_hint:None, identity_id:"identity".into(), revision:1, enabled:false } }
    fn binding() -> Binding { Binding { version:1, provider:"ollama_native".into(), provider_config_id:"p".into(), connection_identity_id:"identity".into(), connection_revision:1, normalized_endpoint:"http://localhost:11434".into(), auth_mode:"none".into() } }
    #[test]
    fn keyless_is_real_and_revisions_and_endpoints_are_bound() {
        assert_eq!(verify_binding(&stored(), &binding()).unwrap(), binding());
        for field in ["revision", "mode", "endpoint", "identity", "provider", "id", "version"] {
            let mut b=binding(); match field { "revision"=>b.connection_revision=2,"mode"=>b.auth_mode="bearer".into(),"endpoint"=>b.normalized_endpoint="https://other.invalid".into(),"identity"=>b.connection_identity_id="other".into(),"provider"=>b.provider="custom_openai".into(),"id"=>b.provider_config_id="other".into(),_=>b.version=2 }; assert!(verify_binding(&stored(),&b).is_err());
        }
    }
    #[test]
    fn forged_no_auth_cannot_bypass_bearer_or_legacy_and_missing_modes_fail() {
        let mut s=stored();s.auth_mode="bearer".into();s.credential_id=Some("bound".into());assert!(verify_binding(&s,&binding()).is_err());
        let mut b=binding();b.auth_mode="bearer".into();assert!(verify_binding(&s,&b).is_ok());
        s.credential_id=None;assert!(verify_binding(&s,&b).is_err());
        s=stored();s.provider="openrouter".into();assert!(verify_binding(&s,&binding()).is_err());
        s=stored();s.auth_mode.clear();assert!(verify_binding(&s,&binding()).is_err());
        s=stored();s.credential_hint=Some("fake".into());assert!(verify_binding(&s,&binding()).is_err());
        s=stored();s.enabled=true;assert!(verify_binding(&s,&binding()).is_err());
    }
    #[test]
    fn urls_are_canonical_and_do_not_broaden_local_http() {
        assert_eq!(normalize_endpoint(" HTTP://LOCALHOST:11434/ ").unwrap(),"http://localhost:11434");
        assert_eq!(normalize_endpoint("http://[::1]:11434/").unwrap(),"http://[::1]:11434");
        assert_eq!(normalize_endpoint("https://proxy.invalid/Ollama/").unwrap(),"https://proxy.invalid/Ollama");
        for url in ["http://127.0.0.2:11434","http://192.168.0.1:11434","https://u:p@host.invalid","https://host.invalid?","https://host.invalid#x","https://host.invalid/api/chat","https://host.invalid/v1","https://host.invalid/%61pi"] { assert!(normalize_endpoint(url).is_err(),"{url}"); }
    }
    #[test]
    fn json_contract_round_trips_and_rejects_missing_or_extra_auth_fields() {
        let json=serde_json::to_value(binding()).unwrap();
        assert_eq!(json["authMode"], "none");
        assert_eq!(serde_json::from_value::<Binding>(json.clone()).unwrap(),binding());
        let mut missing=json.clone();missing.as_object_mut().unwrap().remove("authMode");assert!(serde_json::from_value::<Binding>(missing).is_err());
        let mut injected=json;injected["credentialId"]=serde_json::json!("borrowed");assert!(serde_json::from_value::<Binding>(injected).is_err());
    }

}
