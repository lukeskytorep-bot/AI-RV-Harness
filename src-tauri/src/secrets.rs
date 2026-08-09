use keyring::{Entry, Error};

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

// Intentionally no Tauri command returns a stored secret to the webview.
// Provider adapters will retrieve credentials natively and perform authenticated
// requests without copying API keys into frontend state or logs.
