use std::{collections::HashSet, future::Future, time::Duration};

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{SqliteConnection, SqlitePool};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_sql::DbInstances;

use super::{authenticated, binding_endpoint, endpoint, model_discovery_url, ProviderKind};
use crate::{database::sqlite_pool, secrets};

const CUSTOM: ProviderKind = ProviderKind::CustomOpenai;

async fn active_connection(
    db: &mut SqliteConnection,
    credential_id: &str,
) -> Result<(String, String), String> {
    let rows = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT id, base_url FROM provider_configs WHERE provider = 'custom_openai' AND credential_id = ? LIMIT 2",
    )
    .bind(credential_id)
    .fetch_all(db)
    .await
    .map_err(|_| "Could not read the current Custom OpenAI connection".to_string())?;
    let [(id, url)] = rows.as_slice() else {
        return Err("The saved Custom OpenAI connection is missing or ambiguous".to_string());
    };
    Ok((id.clone(), binding_endpoint(CUSTOM, url.as_deref())?))
}

fn require_active_endpoint(active: &str, expected: &str) -> Result<(), String> {
    if active != expected {
        return Err("credential binding mismatch: the Custom OpenAI endpoint changed; reload the connection settings".to_string());
    }
    Ok(())
}

pub(super) async fn get_credential_for_binding(
    instances: &State<'_, DbInstances>,
    provider: ProviderKind,
    credential_id: &str,
    endpoint: &str,
) -> Result<String, String> {
    if !matches!(provider, ProviderKind::CustomOpenai) {
        return secrets::get_credential_for_binding(
            credential_id,
            provider.binding_kind(),
            endpoint,
        );
    }
    let pool = sqlite_pool(instances).await?;
    let mut db = pool
        .acquire()
        .await
        .map_err(|_| "Could not read the active endpoint".to_string())?;
    let (id, active) = active_connection(&mut db, credential_id).await?;
    require_active_endpoint(&active, endpoint)?;
    secrets::custom_credential(credential_id, &id, &active)
}

pub(super) async fn replace_key(
    instances: &State<'_, DbInstances>,
    credential_id: &str,
    endpoint: &str,
    secret: &str,
) -> Result<(), String> {
    let pool = sqlite_pool(instances).await?;
    let mut transaction = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| e.to_string())?;
    let (_, active) = active_connection(&mut transaction, credential_id).await?;
    require_active_endpoint(&active, endpoint)?;
    secrets::rebind_bound_credential(credential_id, secret, CUSTOM.binding_kind(), endpoint)?;
    transaction.commit().await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointChangeResult {
    missing_model_ids: Vec<String>,
}

fn destination_endpoint(value: &str) -> Result<String, String> {
    let normalized = binding_endpoint(CUSTOM, Some(value))?;
    let url =
        reqwest::Url::parse(&normalized).map_err(|_| "Invalid provider base URL".to_string())?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err("The Custom OpenAI base URL must not contain a query or fragment".to_string());
    }
    Ok(normalized)
}

static TEST_CLIENT: std::sync::LazyLock<Result<reqwest::Client, reqwest::Error>> =
    std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .build()
    });

#[derive(Debug)]
enum DestinationProof {
    ModelList(HashSet<String>),
    Generated,
}

struct GenerationProbe {
    model_id: String,
    output_token_field: &'static str,
}

async fn saved_generation_probe(
    pool: &SqlitePool,
    connection_id: &str,
    credential_id: &str,
) -> Result<GenerationProbe, String> {
    let model_id = sqlx::query_scalar::<_, String>(
        "SELECT model_id FROM (
            SELECT 0 AS priority, default_viewer_model_id AS model_id FROM profiles WHERE credential_id = ?1
            UNION ALL SELECT 1, default_monitor_model_id FROM profiles WHERE default_monitor_provider_config_id = ?2
            UNION ALL SELECT 2, default_judge_model_id FROM profiles WHERE default_judge_provider_config_id = ?2
            UNION ALL SELECT 3, MIN(model_id) FROM model_registry WHERE provider_config_id = ?2 HAVING COUNT(*) = 1
        ) WHERE model_id IS NOT NULL AND trim(model_id) <> '' ORDER BY priority, model_id LIMIT 1",
    )
    .bind(credential_id)
    .bind(connection_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| "Could not read the assigned Custom OpenAI model".to_string())?
    .ok_or_else(|| "The new address does not support GET /models. Assign a model to this connection before testing it.".to_string())?;

    let field = sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = ?")
        .bind(format!("provider.customOutputTokenField.{connection_id}"))
        .fetch_optional(pool)
        .await
        .map_err(|_| "Could not read the Custom OpenAI output token setting".to_string())?;
    let output_token_field = if field.as_deref() == Some("max_completion_tokens") {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    Ok(GenerationProbe {
        model_id,
        output_token_field,
    })
}

async fn test_generation(
    client: &reqwest::Client,
    base: &str,
    secret: &str,
    probe: GenerationProbe,
) -> Result<(), String> {
    let body = json!({
        "model": probe.model_id,
        "messages": [{"role": "user", "content": "Reply with OK."}],
        "stream": false,
        (probe.output_token_field): 16,
    });
    let response = authenticated(
        client.post(endpoint(base, "chat/completions")),
        CUSTOM,
        secret,
    )
    .json(&body)
    .send()
    .await
    .map_err(|_| {
        "Could not reach the new Custom OpenAI address for the generation test".to_string()
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "The new Custom OpenAI address rejected the generation test (HTTP {})",
            response.status().as_u16()
        ));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "The generation test did not return a valid OpenAI response".to_string())?;
    let has_answer = payload
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .is_some_and(|content| !content.trim().is_empty());
    if payload.get("error").is_some_and(|error| !error.is_null()) || !has_answer {
        return Err("The generation test did not return an assistant answer".to_string());
    }
    Ok(())
}

async fn test_destination(
    base: &str,
    secret: &str,
    fallback: impl Future<Output = Result<GenerationProbe, String>>,
) -> Result<DestinationProof, String> {
    let client = TEST_CLIENT
        .as_ref()
        .map_err(|_| "Could not initialize the connection test".to_string())?;
    let url = model_discovery_url(CUSTOM, base)?;
    let response = authenticated(client.get(url), CUSTOM, secret)
        .send()
        .await
        .map_err(|_| "Could not connect to the new Custom OpenAI address".to_string())?;
    if matches!(response.status().as_u16(), 404 | 405) {
        test_generation(client, base, secret, fallback.await?).await?;
        return Ok(DestinationProof::Generated);
    }
    if !response.status().is_success() {
        return Err(format!(
            "The new Custom OpenAI address rejected GET /models (HTTP {})",
            response.status().as_u16()
        ));
    }
    // Inspect the provider response in native code. Do not relay any of its
    // content, including server errors or model ids that might echo the key.
    #[derive(serde::Deserialize)]
    struct ModelList {
        data: Vec<Model>,
    }
    #[derive(serde::Deserialize)]
    struct Model {
        id: String,
    }
    let models: ModelList = response
        .json()
        .await
        .map_err(|_| "The new address did not return a valid OpenAI model list".to_string())?;
    Ok(DestinationProof::ModelList(
        models.data.into_iter().map(|model| model.id).collect(),
    ))
}

async fn commit_endpoint(
    pool: &SqlitePool,
    connection_id: &str,
    credential_id: &str,
    from: &str,
    to: &str,
    stage: impl FnOnce() -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "Could not begin the Custom OpenAI endpoint change".to_string())?;
    let (id, active) = active_connection(&mut tx, credential_id).await?;
    if id != connection_id {
        return Err("The saved Custom OpenAI connection changed".to_string());
    }
    require_active_endpoint(&active, from)?;
    let model_ids = sqlx::query_scalar::<_, String>(
        "SELECT model_id FROM model_registry WHERE provider_config_id = ? ORDER BY model_id",
    )
    .bind(connection_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| "Could not read the saved model list".to_string())?;
    stage()?;
    // Until this transaction commits, the staged credential still resolves
    // only to the old endpoint. The same rule applies after a restart.
    sqlx::query("UPDATE provider_configs SET base_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_tested_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_status = 'ok', last_error = NULL WHERE id = ?")
        .bind(to).bind(connection_id).execute(&mut *tx).await
        .map_err(|_| "Could not save the new Custom OpenAI address".to_string())?;
    tx.commit().await.map_err(|_| "Could not confirm saving the new Custom OpenAI address; reopen settings to check the active address".to_string())?;
    Ok(model_ids)
}

async fn confirm_destination(
    app: AppHandle,
    address: String,
    language: &str,
) -> Result<bool, String> {
    let (title, message, confirm, cancel) = if language == "pl" {
        ("Adres bazowy API", "Harness użyje zapisanego klucza API pod poniższym adresem. Jeśli lista modeli jest niedostępna, test wykona krótkie żądanie generowania na zapisanym modelu.", "Zapisz i przetestuj", "Anuluj")
    } else {
        (
            "API base URL",
            "Harness will use the saved API key at the address below. If model listing is unsupported, the test will send a short generation request to a saved model.",
            "Save and test",
            "Cancel",
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(format!("{message}\n\n{address}"))
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                confirm.into(),
                cancel.into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| "Could not confirm the new Custom OpenAI address".to_string())
}

#[tauri::command]
pub async fn change_custom_openai_endpoint(
    app: AppHandle,
    db_instances: State<'_, DbInstances>,
    connection_id: String,
    credential_id: String,
    expected_endpoint: String,
    destination: String,
    language: String,
) -> Result<Option<EndpointChangeResult>, String> {
    let to = destination_endpoint(&destination)?;
    let from = binding_endpoint(CUSTOM, Some(&expected_endpoint))?;
    let pool = sqlite_pool(&db_instances).await?;
    let (id, active) = {
        let mut db = pool
            .acquire()
            .await
            .map_err(|_| "Could not read the active endpoint".to_string())?;
        active_connection(&mut db, &credential_id).await?
    };
    if id != connection_id {
        return Err("The saved Custom OpenAI connection changed".to_string());
    }
    require_active_endpoint(&active, &from)?;
    if !confirm_destination(app, to.clone(), &language).await? {
        return Ok(None);
    }
    let secret = {
        let mut db = pool
            .acquire()
            .await
            .map_err(|_| "Could not read the active endpoint".to_string())?;
        let (current_id, current_endpoint) = active_connection(&mut db, &credential_id).await?;
        if current_id != id {
            return Err("The saved Custom OpenAI connection changed".to_string());
        }
        require_active_endpoint(&current_endpoint, &from)?;
        secrets::custom_credential(&credential_id, &id, &from)?
    };
    let proof = test_destination(
        &to,
        &secret,
        saved_generation_probe(&pool, &id, &credential_id),
    )
    .await?;
    let models = commit_endpoint(&pool, &id, &credential_id, &from, &to, || {
        if secrets::custom_credential(&credential_id, &id, &from)? != secret {
            return Err(
                "The API key changed during the connection test; test the new address again"
                    .to_string(),
            );
        }
        if from != to {
            secrets::stage_custom_endpoint(&credential_id, &id, &secret, &from, &to)?;
        }
        Ok(())
    })
    .await?;
    // Collapse the transition after commit when secure storage is available.
    // A crash or failed cleanup leaves a usable transition: SQLite selects B.
    if from != to {
        if let Ok(mut tx) = pool.begin_with("BEGIN IMMEDIATE").await {
            if let Ok((current_id, current_endpoint)) =
                active_connection(&mut tx, &credential_id).await
            {
                if current_id == id && current_endpoint == to {
                    let _ = secrets::settle_custom_endpoint(&credential_id, &id, &to);
                }
            }
            let _ = tx.rollback().await;
        }
    }
    Ok(Some(EndpointChangeResult {
        missing_model_ids: match proof {
            DestinationProof::ModelList(available) => models
                .into_iter()
                .filter(|id| !available.contains(id))
                .collect(),
            DestinationProof::Generated => Vec::new(),
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    const A: &str = "https://old.example/v1";
    const B: &str = "https://new.example/v1";

    #[test]
    fn normalizes_destination_and_rejects_unsafe_or_ambiguous_addresses() {
        assert_eq!(
            destination_endpoint(" HTTPS://NEW.EXAMPLE:443/v1/// ").unwrap(),
            B
        );
        for url in [
            "not-a-url",
            "http://new.example/v1",
            "https://a:b@new.example/v1",
            "https://new.example/v1?key=x",
            "https://new.example/v1#fragment",
        ] {
            assert!(destination_endpoint(url).is_err(), "{url}");
        }
    }

    #[tokio::test]
    async fn test_sends_the_saved_key_to_the_selected_models_route_and_keeps_replies_private() {
        for (status, headers, body) in [
            ("200 OK", "", r#"{"data":[{"id":"model-1"}]}"#),
            ("401 Unauthorized", "", "server echoed test-key"),
            (
                "302 Found",
                "Location: https://redirect.example/v1/models\r\n",
                "server echoed test-key",
            ),
        ] {
            let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}/v1", server.local_addr().unwrap());
            let handler = tokio::spawn(async move {
                let (mut stream, _) = server.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let byte = stream.read_u8().await.unwrap();
                    request.push(byte);
                    assert!(request.len() < 16_384);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
                assert!(request
                    .to_ascii_lowercase()
                    .contains("\r\nauthorization: bearer test-key\r\n"));
                stream.write_all(format!("HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            });
            let result = test_destination(&base, "test-key", async {
                panic!("GET status must not trigger a generation test")
            })
            .await;
            handler.await.unwrap();
            if status == "200 OK" {
                let DestinationProof::ModelList(models) = result.unwrap() else {
                    panic!("expected model list");
                };
                assert_eq!(models, HashSet::from(["model-1".to_string()]));
            } else {
                let error = result.unwrap_err();
                assert!(error.contains(&status[..3]));
                assert!(!error.contains("test-key"));
            }
        }
    }

    #[tokio::test]
    async fn tests_a_saved_model_when_listing_is_not_supported() {
        for (list_status, generation_status, answer, success) in [
            (
                "404 Not Found",
                "200 OK",
                r#"{"choices":[{"message":{"content":"OK"}}]}"#,
                true,
            ),
            (
                "405 Method Not Allowed",
                "200 OK",
                r#"{"choices":[{"message":{"content":"OK"}}]}"#,
                true,
            ),
            (
                "404 Not Found",
                "401 Unauthorized",
                "server echoed test-key",
                false,
            ),
            (
                "405 Method Not Allowed",
                "200 OK",
                r#"{"choices":[]}"#,
                false,
            ),
        ] {
            let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}/v1", server.local_addr().unwrap());
            let handler = tokio::spawn(async move {
                for (path, status, body) in [
                    ("GET /v1/models HTTP/1.1", list_status, ""),
                    (
                        "POST /v1/chat/completions HTTP/1.1",
                        generation_status,
                        answer,
                    ),
                ] {
                    let (stream, _) = server.accept().await.unwrap();
                    let mut io = BufReader::new(stream);
                    let mut line = String::new();
                    io.read_line(&mut line).await.unwrap();
                    assert_eq!(line.trim_end(), path);
                    let mut length = 0;
                    let mut authorized = false;
                    loop {
                        line.clear();
                        assert_ne!(io.read_line(&mut line).await.unwrap(), 0);
                        let header = line.trim().to_ascii_lowercase();
                        if header.is_empty() {
                            break;
                        }
                        if let Some(value) = header.strip_prefix("content-length:") {
                            length = value.trim().parse().unwrap();
                        }
                        authorized |= header == "authorization: bearer test-key";
                    }
                    assert!(authorized);
                    if path.starts_with("POST") {
                        let mut body = vec![0; length];
                        io.read_exact(&mut body).await.unwrap();
                        let payload: Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(payload["model"], "saved-model");
                        assert_eq!(payload["stream"], false);
                        assert_eq!(payload["max_completion_tokens"], 16);
                        assert!(payload.get("max_tokens").is_none());
                    }
                    io.get_mut().write_all(format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                }
            });
            let result = test_destination(&base, "test-key", async {
                Ok(GenerationProbe {
                    model_id: "saved-model".into(),
                    output_token_field: "max_completion_tokens",
                })
            })
            .await;
            tokio::time::timeout(Duration::from_secs(2), handler)
                .await
                .unwrap()
                .unwrap();
            if success {
                assert!(matches!(result, Ok(DestinationProof::Generated)));
            } else {
                let error = result.unwrap_err();
                assert!(!error.contains("test-key"));
                assert!(
                    error.contains("401") || error.contains("did not return an assistant answer")
                );
            }
        }
    }

    #[tokio::test]
    async fn probe_uses_assigned_model_and_saved_output_field_without_guessing() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [
            "CREATE TABLE profiles (credential_id TEXT, default_viewer_model_id TEXT, default_monitor_provider_config_id TEXT, default_monitor_model_id TEXT, default_judge_provider_config_id TEXT, default_judge_model_id TEXT)",
            "CREATE TABLE model_registry (provider_config_id TEXT, model_id TEXT)",
            "CREATE TABLE app_settings (key TEXT, value TEXT)",
            "INSERT INTO model_registry VALUES ('connection','cached-one'), ('connection','cached-two')",
            "INSERT INTO app_settings VALUES ('provider.customOutputTokenField.connection', 'max_completion_tokens')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        assert!(saved_generation_probe(&pool, "connection", "cred")
            .await
            .is_err());
        sqlx::query("INSERT INTO profiles (credential_id, default_viewer_model_id) VALUES ('cred', 'assigned-model')")
            .execute(&pool).await.unwrap();
        let probe = saved_generation_probe(&pool, "connection", "cred")
            .await
            .unwrap();
        assert_eq!(probe.model_id, "assigned-model");
        assert_eq!(probe.output_token_field, "max_completion_tokens");
    }

    #[tokio::test]
    async fn credential_selection_survives_a_failed_save_and_a_committed_save_after_reopen() {
        let name = format!(
            "rvh-endpoint-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(name);
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        for sql in [
            "CREATE TABLE provider_configs (id TEXT, provider TEXT, credential_id TEXT, base_url TEXT, updated_at TEXT, last_tested_at TEXT, last_status TEXT, last_error TEXT)",
            "CREATE TABLE model_registry (provider_config_id TEXT, model_id TEXT)",
            "INSERT INTO model_registry VALUES ('connection', 'model-1')",
            "CREATE TRIGGER deny_url BEFORE UPDATE OF base_url ON provider_configs BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
        ] { sqlx::query(sql).execute(&pool).await.unwrap(); }
        sqlx::query("INSERT INTO provider_configs VALUES ('connection', 'custom_openai', 'cred', ?, NULL, NULL, NULL, NULL)").bind(A).execute(&pool).await.unwrap();

        let stage_failure = commit_endpoint(&pool, "connection", "cred", A, B, || {
            Err("vault failure".into())
        })
        .await;
        assert_eq!(stage_failure.unwrap_err(), "vault failure");
        let mut secure_record = None;
        assert!(commit_endpoint(&pool, "connection", "cred", A, B, || {
            secure_record = Some(secrets::test_custom_transition("connection", "cred", A, B));
            Ok(())
        })
        .await
        .is_err());
        pool.close().await;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        let (id, endpoint) = active_connection(&mut *pool.acquire().await.unwrap(), "cred")
            .await
            .unwrap();
        assert_eq!(endpoint, A);
        assert!(require_active_endpoint(&endpoint, B).is_err());
        assert_eq!(
            secrets::test_resolve_custom_transition(
                secure_record.as_ref().unwrap(),
                &id,
                "cred",
                &endpoint
            )
            .unwrap(),
            "test-key"
        );
        sqlx::query("DROP TRIGGER deny_url")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            commit_endpoint(&pool, "connection", "cred", A, B, || Ok(()))
                .await
                .unwrap(),
            vec!["model-1"]
        );
        pool.close().await;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let (id, endpoint) = active_connection(&mut *pool.acquire().await.unwrap(), "cred")
            .await
            .unwrap();
        assert_eq!(endpoint, B);
        assert!(require_active_endpoint(&endpoint, A).is_err());
        assert_eq!(
            secrets::test_resolve_custom_transition(
                secure_record.as_ref().unwrap(),
                &id,
                "cred",
                &endpoint
            )
            .unwrap(),
            "test-key"
        );
        assert!(secrets::test_resolve_custom_transition(
            secure_record.as_ref().unwrap(),
            "other",
            "cred",
            &endpoint
        )
        .is_err());
        let model: String = sqlx::query_scalar("SELECT model_id FROM model_registry")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(model, "model-1");
        pool.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
