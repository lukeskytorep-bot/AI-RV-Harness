use keyring::{Entry, Error};
use sha2::{Digest, Sha256};

const SERVICE_NAME: &str = "org.airvharness.app";

fn entry_for(credential_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, credential_id).map_err(|error| error.to_string())
}

pub(crate) fn get_credential(credential_id: &str) -> Result<String, String> {
    if credential_id.trim().is_empty() {
        return Err("credential id is required".to_string());
    }
    entry_for(credential_id)?
        .get_password()
        .map_err(|error| match error {
            Error::NoEntry => "credential not found in secure storage".to_string(),
            other => other.to_string(),
        })
}

#[tauri::command]
pub fn store_credential(credential_id: String, secret: String) -> Result<(), String> {
    if credential_id.trim().is_empty() || secret.is_empty() {
        return Err("credential id and secret are required".to_string());
    }

    let credential_id = credential_id.trim();
    entry_for(credential_id)?
        .set_password(&secret)
        .map_err(|error| error.to_string())?;

    // Build a fresh entry and read the value back. This verifies that the
    // platform credential backend actually persisted the secret instead of
    // accepting it only in a transient/default store.
    let verified = entry_for(credential_id)?
        .get_password()
        .map_err(|error| format!("secure storage verification failed: {error}"))?;
    if verified != secret {
        return Err("secure storage verification failed: stored value does not match".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn has_credential(credential_id: String) -> Result<bool, String> {
    match entry_for(&credential_id)?.get_password() {
        Ok(_) => Ok(true),
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_credential(credential_id: String) -> Result<(), String> {
    match entry_for(&credential_id)?.delete_credential() {
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
// Provider adapters will retrieve credentials natively and perform authenticated
// requests without copying API keys into frontend state or logs.
