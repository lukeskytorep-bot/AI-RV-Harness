use serde::Deserialize;
use serde_json::Value;
use sqlx::{Sqlite, Transaction};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    id: String,
    profile_id: String,
    workspace_id: String,
    restore: bool,
    expected_run: Value,
    next_run: Value,
    sessions: Vec<SessionChange>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionChange {
    id: String,
    expected_archived_at: Option<String>,
    archived_at: Option<String>,
}

pub(crate) async fn apply(
    tx: &mut Transaction<'_, Sqlite>,
    profile_id: &str,
    plan: Plan,
) -> Result<(), String> {
    if profile_id != plan.profile_id {
        return Err("Training archive Profile mismatch".into());
    }
    let (raw, archived): (String, Option<String>) =
        sqlx::query_as("SELECT record_json, archived_at FROM training_runs WHERE id = ?")
            .bind(&plan.id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    let mut current: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    // SQL archived_at is authoritative. Preserve all other checkpoint fields.
    if let Some(stamp) = &archived {
        current["archivedAt"] = stamp.clone().into();
    } else {
        current
            .as_object_mut()
            .ok_or("Invalid Training record")?
            .remove("archivedAt");
    }
    if current.get("sessionIds").is_none_or(Value::is_null) {
        current["sessionIds"] = serde_json::json!([]);
    }
    if current != plan.expected_run
        || archived.is_some() != plan.restore
        || current["id"] != plan.id
        || current["profileId"] != profile_id
        || current["workspaceId"] != plan.workspace_id
    {
        return Err("Training changed before archive; refresh and try again".into());
    }
    let timestamp = plan.next_run["updatedAt"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("Missing archive time")?;
    let mut expected_next = current.clone();
    expected_next["updatedAt"] = timestamp.into();
    if plan.restore {
        expected_next.as_object_mut().unwrap().remove("archivedAt");
        expected_next
            .as_object_mut()
            .unwrap()
            .remove("archivedSessionIds");
    } else {
        expected_next["archivedAt"] = timestamp.into();
        expected_next["archivedSessionIds"] = plan
            .sessions
            .iter()
            .map(|session| Value::String(session.id.clone()))
            .collect();
    }
    if expected_next != plan.next_run {
        return Err("Invalid Training archive update".into());
    }
    let parent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workspaces w JOIN profiles p ON p.id=w.profile_id WHERE w.id=? AND p.id=? AND w.archived_at IS NULL AND p.archived_at IS NULL")
        .bind(&plan.workspace_id).bind(profile_id).fetch_one(&mut **tx).await.map_err(|e| e.to_string())?;
    if plan.restore && parent != 1 {
        return Err("Restore the parent Profile and Workspace first.".into());
    }
    let mut ids = current["sessionIds"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if let Some(id) = current
        .pointer("/activeTargetCheckpoint/sessionId")
        .and_then(Value::as_str)
    {
        ids.push(id.into());
    }
    let previous = current["archivedSessionIds"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut eligible = std::collections::HashSet::new();
    for id in &ids {
        let id = id.as_str().ok_or("Invalid Training session id")?;
        let row: Option<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT workspace_id, profile_id, research_project_id, archived_at FROM rv_sessions WHERE id=?")
            .bind(id).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
        if let Some((workspace, profile, research, stamp)) = row {
            if workspace != plan.workspace_id || profile != profile_id || research.is_some() {
                return Err("Training session ownership does not match its run.".into());
            }
            if if plan.restore {
                previous.contains(&Value::String(id.into())) && stamp == archived
            } else {
                stamp.is_none()
            } {
                eligible.insert(id.to_string());
            }
        }
    }
    if eligible
        != plan
            .sessions
            .iter()
            .map(|session| session.id.clone())
            .collect()
    {
        return Err("Training sessions changed before archive; refresh and try again".into());
    }
    let mut seen = std::collections::HashSet::new();
    for session in &plan.sessions {
        if !seen.insert(&session.id) || !ids.contains(&Value::String(session.id.clone())) {
            return Err("Invalid Training session membership".into());
        }
        let (workspace, profile, research, stamp): (String, String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT workspace_id, profile_id, research_project_id, archived_at FROM rv_sessions WHERE id=?")
            .bind(&session.id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        if workspace != plan.workspace_id
            || profile != profile_id
            || research.is_some()
            || stamp != session.expected_archived_at
        {
            return Err("Training session changed before archive".into());
        }
        let valid = if plan.restore {
            previous.contains(&Value::String(session.id.clone()))
                && stamp == archived
                && session.archived_at.is_none()
        } else {
            stamp.is_none() && session.archived_at.as_deref() == Some(timestamp)
        };
        if !valid {
            return Err("Invalid Training session archive update".into());
        }
        sqlx::query("UPDATE rv_sessions SET archived_at=?, updated_at=? WHERE id=?")
            .bind(&session.archived_at)
            .bind(timestamp)
            .bind(&session.id)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    sqlx::query("UPDATE training_runs SET record_json=?, archived_at=?, updated_at=? WHERE id=?")
        .bind(plan.next_run.to_string())
        .bind(if plan.restore { None } else { Some(timestamp) })
        .bind(timestamp)
        .bind(&plan.id)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        initialize(pool).await
    }

    async fn initialize(pool: sqlx::SqlitePool) -> sqlx::SqlitePool {
        for sql in [
            "CREATE TABLE training_runs(id TEXT,record_json TEXT,archived_at TEXT,updated_at TEXT)",
            "CREATE TABLE rv_sessions(id TEXT,workspace_id TEXT,profile_id TEXT,research_project_id TEXT,archived_at TEXT,updated_at TEXT)",
            "CREATE TABLE profiles(id TEXT,archived_at TEXT)",
            "CREATE TABLE workspaces(id TEXT,profile_id TEXT,archived_at TEXT)",
            "INSERT INTO profiles VALUES('p',NULL)",
            "INSERT INTO workspaces VALUES('w','p',NULL)",
            "INSERT INTO rv_sessions VALUES('a','w','p',NULL,NULL,'before'),('b','w','p',NULL,'independent','before')",
        ] { sqlx::query(sql).execute(&pool).await.unwrap(); }
        let record = json!({"id":"r","profileId":"p","workspaceId":"w","sessionIds":["a","b"],"updatedAt":"before"});
        sqlx::query("INSERT INTO training_runs VALUES('r',?,NULL,'before')")
            .bind(record.to_string())
            .execute(&pool)
            .await
            .unwrap();
        pool
    }
    async fn plan(pool: &sqlx::SqlitePool, restore: bool) -> Plan {
        let raw: String = sqlx::query_scalar("SELECT record_json FROM training_runs")
            .fetch_one(pool)
            .await
            .unwrap();
        let record: Value = serde_json::from_str(&raw).unwrap();
        let mut next = record.clone();
        next["updatedAt"] = "now".into();
        if restore {
            next.as_object_mut().unwrap().remove("archivedAt");
            next.as_object_mut().unwrap().remove("archivedSessionIds");
        } else {
            next["archivedAt"] = "now".into();
            next["archivedSessionIds"] = json!(["a"]);
        }
        serde_json::from_value(json!({
            "id":"r","profileId":"p","workspaceId":"w","restore":restore,"expectedRun":record,"nextRun":next,
            "sessions":[{"id":"a","expectedArchivedAt":if restore {json!("now")}else{Value::Null},"archivedAt":if restore {Value::Null}else{json!("now")}}]
        })).unwrap()
    }
    #[tokio::test]
    async fn archive_and_restore_keep_independently_archived_sessions() {
        let pool = pool().await;
        for restore in [false, true] {
            let plan = plan(&pool, restore).await;
            let mut tx = pool.begin().await.unwrap();
            apply(&mut tx, "p", plan).await.unwrap();
            tx.commit().await.unwrap();
        }
        let rows: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT id,archived_at FROM rv_sessions ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![("a".into(), None), ("b".into(), Some("independent".into()))]
        );
    }
    #[tokio::test]
    async fn failed_parent_write_rolls_back_every_session_write() {
        let pool = pool().await;
        let plan = plan(&pool, false).await;
        sqlx::query("CREATE TRIGGER fail BEFORE UPDATE ON training_runs BEGIN SELECT RAISE(ABORT,'disk full'); END").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(apply(&mut tx, "p", plan).await.is_err());
        tx.rollback().await.unwrap();
        let archived: Option<String> =
            sqlx::query_scalar("SELECT archived_at FROM rv_sessions WHERE id='a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(archived.is_none());
        let archived: Option<String> = sqlx::query_scalar("SELECT archived_at FROM training_runs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(archived.is_none());
    }
    #[tokio::test]
    async fn failed_restore_keeps_the_archived_run_and_sessions() {
        let pool = pool().await;
        let archive = plan(&pool, false).await;
        let mut tx = pool.begin().await.unwrap();
        apply(&mut tx, "p", archive).await.unwrap();
        tx.commit().await.unwrap();
        let restore = plan(&pool, true).await;
        sqlx::query("CREATE TRIGGER fail BEFORE UPDATE ON training_runs BEGIN SELECT RAISE(ABORT,'disk full'); END").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(apply(&mut tx, "p", restore).await.is_err());
        tx.rollback().await.unwrap();
        let archived: Option<String> =
            sqlx::query_scalar("SELECT archived_at FROM rv_sessions WHERE id='a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(archived.as_deref(), Some("now"));
        let archived: Option<String> = sqlx::query_scalar("SELECT archived_at FROM training_runs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(archived.as_deref(), Some("now"));
    }

    #[tokio::test]
    async fn committed_archive_can_be_restored_after_reopening_the_database() {
        let path = std::env::temp_dir().join(format!(
            "rvh-archive-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let file = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        let file = initialize(file).await;
        let archive = plan(&file, false).await;
        let mut tx = file.begin().await.unwrap();
        apply(&mut tx, "p", archive).await.unwrap();
        tx.commit().await.unwrap();
        file.close().await;
        let file = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let restore = plan(&file, true).await;
        let mut tx = file.begin().await.unwrap();
        apply(&mut tx, "p", restore).await.unwrap();
        tx.commit().await.unwrap();
        let rows: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT id,archived_at FROM rv_sessions ORDER BY id")
                .fetch_all(&file)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![("a".into(), None), ("b".into(), Some("independent".into()))]
        );
        file.close().await;
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn stale_checkpoint_and_lost_profile_are_rejected() {
        let pool = pool().await;
        let stale = plan(&pool, false).await;
        sqlx::query("UPDATE training_runs SET record_json=json_set(record_json,'$.termination.reason','user_finished')").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(apply(&mut tx, "p", stale)
            .await
            .unwrap_err()
            .contains("changed"));
        tx.rollback().await.unwrap();
        let wrong = plan(&pool, false).await;
        let mut tx = pool.begin().await.unwrap();
        assert!(apply(&mut tx, "other", wrong)
            .await
            .unwrap_err()
            .contains("Profile"));
    }
}
