//! Native lifetime for workflow leases; independent of WebView timers.
use crate::workflow_ownership::{execute, Entity, Request};
use futures_util::future::{AbortHandle, Abortable};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};
use tauri::ipc::Channel;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Token {
    pub profile_id: String,
    pub owner: String,
    pub version: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Binding {
    #[serde(flatten)]
    pub token: Token,
    pub entities: Vec<Entity>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub kind: &'static str,
    pub message: String,
}
struct State {
    failure: Option<Failure>,
    requests: HashSet<String>,
}
struct Entry {
    token: Token,
    window: String,
    pool: SqlitePool,
    abort: AbortHandle,
    state: Mutex<State>,
    on_lost: Option<Channel<Failure>>,
}
#[derive(Default)]
struct Registry {
    active: HashMap<Token, Arc<Entry>>,
    closed_windows: HashSet<String>,
}
static ACTIVE: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));
impl Entry {
    fn fail(&self, failure: Failure) {
        let requests = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.failure.is_some() {
                return;
            }
            state.failure = Some(failure.clone());
            state.requests.iter().cloned().collect::<Vec<_>>()
        };
        for id in requests {
            let _ = crate::providers::cancel_provider_request(id);
        }
        if let Some(channel) = &self.on_lost {
            let _ = channel.send(failure);
        }
    }
}
pub(crate) fn start(
    pool: SqlitePool,
    token: Token,
    window: String,
    on_lost: Option<Channel<Failure>>,
) -> Result<(), String> {
    start_with_interval(pool, token, window, on_lost, Duration::from_secs(10))
}
fn start_with_interval(
    pool: SqlitePool,
    token: Token,
    window: String,
    on_lost: Option<Channel<Failure>>,
    interval: Duration,
) -> Result<(), String> {
    let (abort, registration) = AbortHandle::new_pair();
    let entry = Arc::new(Entry {
        token: token.clone(),
        window,
        pool,
        abort,
        state: Mutex::new(State {
            failure: None,
            requests: HashSet::new(),
        }),
        on_lost,
    });
    {
        let mut registry = ACTIVE
            .lock()
            .map_err(|_| "Workflow heartbeat registry unavailable")?;
        if registry.closed_windows.contains(&entry.window) {
            return Err("Workflow window has already closed".into());
        }
        if registry.active.contains_key(&token) {
            return Err("Workflow heartbeat is already active".into());
        }
        registry.active.insert(token, entry.clone());
    }
    tauri::async_runtime::spawn(async move {
        let work = async {
            loop {
                tokio::time::sleep(interval).await;
                let token = &entry.token;
                match execute(
                    &entry.pool,
                    Request::Renew {
                        profile_id: token.profile_id.clone(),
                        owner: token.owner.clone(),
                        version: token.version,
                    },
                )
                .await
                {
                    Ok(serde_json::Value::Bool(true)) => {}
                    Ok(_) => {
                        entry.fail(Failure {
                            kind: "ownership_lost",
                            message:
                                "Workflow ownership lost or expired; native execution cancelled"
                                    .into(),
                        });
                        break;
                    }
                    Err(message) => {
                        entry.fail(Failure {
                            kind: "database_error",
                            message: format!("Workflow heartbeat database error: {message}"),
                        });
                        break;
                    }
                }
            }
        };
        let _ = Abortable::new(work, registration).await;
    });
    Ok(())
}
pub(crate) fn assert_active(token: &Token, window: &str) -> Result<(), String> {
    let entry = ACTIVE
        .lock()
        .map_err(|_| "Workflow heartbeat registry unavailable")?
        .active
        .get(token)
        .cloned()
        .ok_or("Workflow heartbeat is no longer active")?;
    if entry.window != window {
        return Err("Workflow belongs to another window".into());
    }
    if let Some(failure) = &entry
        .state
        .lock()
        .map_err(|_| "Workflow heartbeat state unavailable")?
        .failure
    {
        return Err(failure.message.clone());
    }
    Ok(())
}
pub(crate) fn stop(token: &Token, window: &str) -> Result<(), String> {
    let entry = {
        let mut registry = ACTIVE
            .lock()
            .map_err(|_| "Workflow heartbeat registry unavailable")?;
        if registry
            .active
            .get(token)
            .is_some_and(|entry| entry.window != window)
        {
            return Err("Workflow belongs to another window".into());
        }
        registry.active.remove(token)
    };
    if let Some(entry) = entry {
        entry.abort.abort();
        entry.fail(Failure {
            kind: "workflow_settled",
            message: "Workflow settled; native execution cancelled".into(),
        });
    }
    Ok(())
}
/// Destroyed, not CloseRequested: a cancelled close dialog must preserve work.
pub(crate) fn window_destroyed(window: &str) {
    let entries = {
        let mut registry = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        registry.closed_windows.insert(window.to_owned());
        let tokens = registry
            .active
            .iter()
            .filter(|(_, entry)| entry.window == window)
            .map(|(token, _)| token.clone())
            .collect::<Vec<_>>();
        tokens
            .into_iter()
            .filter_map(|token| registry.active.remove(&token))
            .collect::<Vec<_>>()
    };
    for entry in entries {
        entry.abort.abort();
        entry.fail(Failure {
            kind: "view_closed",
            message: "Workflow window closed; native execution cancelled".into(),
        });
        tauri::async_runtime::spawn(async move {
            let token = &entry.token;
            let _ = execute(
                &entry.pool,
                Request::Release {
                    profile_id: token.profile_id.clone(),
                    owner: token.owner.clone(),
                    version: token.version,
                },
            )
            .await;
        });
    }
}
pub(crate) struct RequestGuard {
    entry: Arc<Entry>,
    request_id: String,
}
impl RequestGuard {
    pub(crate) fn failure(&self) -> Option<String> {
        self.entry
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .failure
            .as_ref()
            .map(|failure| failure.message.clone())
    }
}
impl Drop for RequestGuard {
    fn drop(&mut self) {
        self.entry
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .requests
            .remove(&self.request_id);
    }
}
pub(crate) async fn bind(
    binding: &Binding,
    window: &str,
    request_id: &str,
) -> Result<RequestGuard, String> {
    let entry = ACTIVE
        .lock()
        .map_err(|_| "Workflow heartbeat registry unavailable")?
        .active
        .get(&binding.token)
        .cloned()
        .ok_or("Workflow heartbeat is no longer active")?;
    if entry.window != window {
        return Err("Workflow belongs to another window".into());
    }
    execute(
        &entry.pool,
        Request::Check {
            profile_id: binding.token.profile_id.clone(),
            owner: binding.token.owner.clone(),
            version: binding.token.version,
            entities: binding.entities.clone(),
        },
    )
    .await?;
    {
        let mut state = entry
            .state
            .lock()
            .map_err(|_| "Workflow heartbeat state unavailable")?;
        if let Some(failure) = &state.failure {
            return Err(failure.message.clone());
        }
        state.requests.insert(request_id.to_owned());
    }
    Ok(RequestGuard {
        entry,
        request_id: request_id.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    async fn fixture() -> (SqlitePool, Token, String) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT); CREATE TABLE profiles(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO profiles VALUES('p',NULL);").execute(&pool).await.unwrap();
        let owner = format!("native-test-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let result = execute(
            &pool,
            Request::Acquire {
                profile_id: "p".into(),
                owner: owner.clone(),
            },
        )
        .await
        .unwrap();
        let token = Token {
            profile_id: "p".into(),
            owner: owner.clone(),
            version: result["version"].as_i64().unwrap(),
        };
        (pool, token, owner)
    }
    async fn expire(pool: &SqlitePool) {
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.expiresAt','2000-01-01T00:00:00.000Z')").execute(pool).await.unwrap();
    }
    async fn failure(guard: &RequestGuard) -> String {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(message) = guard.failure() {
                    return message;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }
    async fn bound(token: &Token, window: &str) -> RequestGuard {
        let binding: Binding = serde_json::from_value(json!({"profileId":token.profile_id,"owner":token.owner,"version":token.version,"entities":[{"kind":"profile","id":"p"}]})).unwrap();
        bind(&binding, window, &format!("request-{window}"))
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn native_renewal_survives_initial_expiry_without_frontend_timers() {
        let (pool, token, window) = fixture().await;
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 seconds'))").execute(&pool).await.unwrap();
        start_with_interval(
            pool.clone(),
            token.clone(),
            window.clone(),
            None,
            Duration::from_millis(25),
        )
        .unwrap();
        tokio::time::sleep(Duration::from_millis(2200)).await;
        let guard = bound(&token, &window).await;
        assert!(guard.failure().is_none());
        assert!(execute(
            &pool,
            Request::Acquire {
                profile_id: "p".into(),
                owner: "competitor".into()
            }
        )
        .await
        .is_err());
        stop(&token, &window).unwrap();
    }
    #[tokio::test]
    async fn takeover_fences_native_requests_and_stale_release() {
        let (pool, token, window) = fixture().await;
        start_with_interval(
            pool.clone(),
            token.clone(),
            window.clone(),
            None,
            Duration::from_millis(25),
        )
        .unwrap();
        let guard = bound(&token, &window).await;
        expire(&pool).await;
        let next = execute(
            &pool,
            Request::Acquire {
                profile_id: "p".into(),
                owner: "replacement".into(),
            },
        )
        .await
        .unwrap();
        assert!(next["version"].as_i64().unwrap() > token.version);
        assert!(failure(&guard).await.contains("ownership"));
        assert!(assert_active(&token, &window).is_err());
        stop(&token, &window).unwrap();
        assert_eq!(
            execute(
                &pool,
                Request::Release {
                    profile_id: token.profile_id,
                    owner: token.owner,
                    version: token.version
                }
            )
            .await
            .unwrap(),
            json!(false)
        );
    }
    #[tokio::test]
    async fn database_failure_cancels_and_fences_even_before_lease_expiry() {
        let (pool, token, window) = fixture().await;
        start_with_interval(
            pool.clone(),
            token.clone(),
            window.clone(),
            None,
            Duration::from_millis(25),
        )
        .unwrap();
        let guard = bound(&token, &window).await;
        sqlx::raw_sql("CREATE TRIGGER reject_heartbeat BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(FAIL,'fixture disk error'); END;").execute(&pool).await.unwrap();
        assert!(failure(&guard).await.contains("fixture disk error"));
        assert!(assert_active(&token, &window)
            .unwrap_err()
            .contains("database error"));
        stop(&token, &window).unwrap();
    }
    #[tokio::test]
    async fn destroyed_window_releases_and_prevents_late_restart() {
        let (pool, token, window) = fixture().await;
        start(pool.clone(), token.clone(), window.clone(), None).unwrap();
        let guard = bound(&token, &window).await;
        assert!(stop(&token, "another-window").is_err());
        window_destroyed(&window);
        assert!(failure(&guard).await.contains("window closed"));
        assert!(assert_active(&token, &window).is_err());
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let state = execute(
                    &pool,
                    Request::Inspect {
                        profile_id: "p".into(),
                    },
                )
                .await
                .unwrap();
                if state["active"] == json!(false) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(start(pool.clone(), token.clone(), window.clone(), None).is_err());
        let next = execute(
            &pool,
            Request::Acquire {
                profile_id: "p".into(),
                owner: "restarted".into(),
            },
        )
        .await
        .unwrap();
        let restarted: Token = serde_json::from_value(next).unwrap();
        assert!(restarted.version > token.version);
        start(pool, restarted.clone(), format!("{window}-restart"), None).unwrap();
        stop(&restarted, &format!("{window}-restart")).unwrap();
    }
}
