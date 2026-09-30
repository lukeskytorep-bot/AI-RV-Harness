use keyring::{Entry, Error};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SERVICE_NAME: &str = "org.airvharness.app";
const CREDENTIAL_RECORD_PREFIX: &str = "ai-rv-harness-credential:v1:";
const CREDENTIAL_BINDING_VERSION: u8 = 1;
const BINDING_REQUIRED_MESSAGE: &str = "credential binding required: re-enter the API key for this provider connection";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CredentialRecord {
    version: u8,
    credential_id: String,
    secret: String,
    provider_kind: String,
    normalized_endpoint: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum StoredCredential {
    Bound(CredentialRecord),
    LegacySecret(String),
}

fn entry_for(credential_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, credential_id).map_err(|error| error.to_string())
}

fn validate_non_empty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

fn encode_bound_credential(
    credential_id: &str,
    secret: &str,
    provider_kind: &str,
    normalized_endpoint: &str,
) -> Result<String, String> {
    validate_non_empty(credential_id, "credential id")?;
    if secret.is_empty() {
        return Err("secret is required".to_string());
    }
    validate_non_empty(provider_kind, "provider kind")?;
    validate_non_empty(normalized_endpoint, "normalized endpoint")?;

    let record = CredentialRecord {
        version: CREDENTIAL_BINDING_VERSION,
        credential_id: credential_id.trim().to_string(),
        secret: secret.to_string(),
        provider_kind: provider_kind.trim().to_string(),
        normalized_endpoint: normalized_endpoint.trim().to_string(),
    };
    let payload = serde_json::to_string(&record)
        .map_err(|error| format!("credential binding serialization failed: {error}"))?;
    Ok(format!("{CREDENTIAL_RECORD_PREFIX}{payload}"))
}

fn decode_stored_credential(value: &str) -> Result<StoredCredential, String> {
    let Some(payload) = value.strip_prefix(CREDENTIAL_RECORD_PREFIX) else {
        return Ok(StoredCredential::LegacySecret(value.to_string()));
    };
    let record = serde_json::from_str::<CredentialRecord>(payload)
        .map_err(|_| "credential binding record is invalid; re-enter the API key".to_string())?;
    if record.version != CREDENTIAL_BINDING_VERSION {
        return Err("credential binding record version is unsupported; re-enter the API key".to_string());
    }
    validate_non_empty(&record.credential_id, "credential id")?;
    if record.secret.is_empty() {
        return Err("credential binding record contains an empty secret; re-enter the API key".to_string());
    }
    validate_non_empty(&record.provider_kind, "provider kind")?;
    validate_non_empty(&record.normalized_endpoint, "normalized endpoint")?;
    Ok(StoredCredential::Bound(record))
}

fn read_stored_credential(credential_id: &str) -> Result<StoredCredential, String> {
    validate_non_empty(credential_id, "credential id")?;
    let stored = entry_for(credential_id.trim())?
        .get_password()
        .map_err(|error| match error {
            Error::NoEntry => "credential not found in secure storage".to_string(),
            other => other.to_string(),
        })?;
    decode_stored_credential(&stored)
}

fn write_bound_credential(
    credential_id: &str,
    secret: &str,
    provider_kind: &str,
    normalized_endpoint: &str,
) -> Result<(), String> {
    let credential_id = credential_id.trim();
    let encoded = encode_bound_credential(credential_id, secret, provider_kind, normalized_endpoint)?;

    entry_for(credential_id)?
        .set_password(&encoded)
        .map_err(|error| error.to_string())?;

    // Build a fresh entry and read the value back. This verifies that the
    // platform credential backend actually persisted the complete binding
    // record instead of accepting it only in a transient/default store.
    let verified = entry_for(credential_id)?
        .get_password()
        .map_err(|error| format!("secure storage verification failed: {error}"))?;
    if verified != encoded {
        return Err("secure storage verification failed: stored value does not match".to_string());
    }
    Ok(())
}

pub(crate) fn store_new_bound_credential(
    credential_id: &str,
    secret: &str,
    provider_kind: &str,
    normalized_endpoint: &str,
) -> Result<(), String> {
    validate_non_empty(credential_id, "credential id")?;
    match entry_for(credential_id.trim())?.get_password() {
        Ok(_) => return Err("credential id already exists in secure storage".to_string()),
        Err(Error::NoEntry) => {}
        Err(error) => return Err(error.to_string()),
    }
    write_bound_credential(credential_id, secret, provider_kind, normalized_endpoint)
}

pub(crate) fn rebind_bound_credential(
    credential_id: &str,
    secret: &str,
    provider_kind: &str,
    normalized_endpoint: &str,
) -> Result<(), String> {
    validate_non_empty(credential_id, "credential id")?;
    match entry_for(credential_id.trim())?.get_password() {
        Ok(_) => write_bound_credential(credential_id, secret, provider_kind, normalized_endpoint),
        Err(Error::NoEntry) => Err("credential not found in secure storage".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

fn credential_for_binding(
    stored: StoredCredential,
    credential_id: &str,
    provider_kind: &str,
    normalized_endpoint: &str,
) -> Result<String, String> {
    match stored {
        StoredCredential::LegacySecret(_) => Err(BINDING_REQUIRED_MESSAGE.to_string()),
        StoredCredential::Bound(record) => {
            if record.credential_id != credential_id.trim() {
                return Err("credential binding mismatch: credential id differs from secure record".to_string());
            }
            if record.provider_kind != provider_kind.trim() {
                return Err("credential binding mismatch: provider differs from secure record; re-enter the API key to rebind".to_string());
            }
            if record.normalized_endpoint != normalized_endpoint.trim() {
                return Err("credential binding mismatch: endpoint differs from secure record; re-enter the API key to rebind".to_string());
            }
            Ok(record.secret)
        }
    }
}

pub(crate) fn get_credential_for_binding(
    credential_id: &str,
    provider_kind: &str,
    normalized_endpoint: &str,
) -> Result<String, String> {
    let stored = read_stored_credential(credential_id)?;
    credential_for_binding(stored, credential_id, provider_kind, normalized_endpoint)
}

pub(crate) fn get_credential(credential_id: &str) -> Result<String, String> {
    match read_stored_credential(credential_id)? {
        StoredCredential::Bound(record) => Ok(record.secret),
        StoredCredential::LegacySecret(secret) => Ok(secret),
    }
}

#[tauri::command]
pub fn has_credential(credential_id: String) -> Result<bool, String> {
    validate_non_empty(&credential_id, "credential id")?;
    match entry_for(credential_id.trim())?.get_password() {
        Ok(value) => {
            decode_stored_credential(&value)?;
            Ok(true)
        }
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_credential(credential_id: String) -> Result<(), String> {
    validate_non_empty(&credential_id, "credential id")?;
    match entry_for(credential_id.trim())?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn credential_identity_fingerprint(credential_id: String) -> Result<String, String> {
    let secret = get_credential(&credential_id)?;
    // Domain-separated HMAC: the API secret remains inside the native process
    // and is used as the HMAC key. Only the irreversible digest crosses into
    // the webview and may be persisted as an AI identity pseudonym.
    let digest = hmac_sha256(secret.as_bytes(), b"org.airvharness.app/ai-identity/v1");
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut normalized = [0_u8; BLOCK];
    if key.len() > BLOCK {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK];
    let mut outer_pad = [0x5c_u8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

// Intentionally no Tauri command returns a stored secret to the webview.
// Provider adapters retrieve credentials natively and may only receive a
// secret after provider kind + normalized endpoint match the keychain binding.

#[cfg(test)]
mod tests {
    use super::*;

    fn bound_value() -> String {
        encode_bound_credential(
            "credential-1",
            "sk-test-secret",
            "openrouter",
            "https://openrouter.ai/api/v1",
        )
        .unwrap()
    }

    #[test]
    fn bound_record_round_trips_without_exposing_legacy_shape() {
        let stored = decode_stored_credential(&bound_value()).unwrap();
        assert_eq!(
            credential_for_binding(
                stored,
                "credential-1",
                "openrouter",
                "https://openrouter.ai/api/v1",
            )
            .unwrap(),
            "sk-test-secret",
        );
        assert!(bound_value().starts_with(CREDENTIAL_RECORD_PREFIX));
    }

    #[test]
    fn legacy_secret_is_recognized_but_requires_explicit_rebinding_before_provider_use() {
        let stored = decode_stored_credential("sk-legacy-secret").unwrap();
        assert!(matches!(stored, StoredCredential::LegacySecret(_)));
        assert_eq!(
            credential_for_binding(
                stored,
                "credential-1",
                "openrouter",
                "https://openrouter.ai/api/v1",
            )
            .unwrap_err(),
            BINDING_REQUIRED_MESSAGE,
        );
    }

    #[test]
    fn binding_rejects_provider_or_endpoint_substitution() {
        let provider_error = credential_for_binding(
            decode_stored_credential(&bound_value()).unwrap(),
            "credential-1",
            "openai",
            "https://api.openai.com/v1",
        )
        .unwrap_err();
        assert!(provider_error.contains("provider differs"));

        let endpoint_error = credential_for_binding(
            decode_stored_credential(&bound_value()).unwrap(),
            "credential-1",
            "openrouter",
            "https://attacker.example/v1",
        )
        .unwrap_err();
        assert!(endpoint_error.contains("endpoint differs"));
    }

    #[test]
    fn binding_rejects_credential_id_substitution() {
        let error = credential_for_binding(
            decode_stored_credential(&bound_value()).unwrap(),
            "credential-2",
            "openrouter",
            "https://openrouter.ai/api/v1",
        )
        .unwrap_err();
        assert!(error.contains("credential id differs"));
    }

    #[test]
    fn unknown_binding_version_is_rejected_instead_of_treated_as_plain_secret() {
        let value = bound_value().replacen("\"version\":1", "\"version\":2", 1);
        let error = decode_stored_credential(&value).unwrap_err();
        assert!(error.contains("version is unsupported"));
    }
}
