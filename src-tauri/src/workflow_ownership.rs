use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::State;
use tauri_plugin_sql::DbInstances;
use crate::database::{DatabaseWriteStatement, execute_statement_internal, sqlite_pool};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity { kind: String, id: String, #[serde(default)] profile_id: Option<String>, #[serde(default)] allow_ended: bool }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFence { session_id: String, lease_owner: String, lease_version: i64 }
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Request {
    Acquire { profile_id: String, owner: String },
    Renew { profile_id: String, owner: String, version: i64 },
    Release { profile_id: String, owner: String, version: i64 },
    Inspect { profile_id: String },
    Check { profile_id: String, owner: String, version: i64, entities: Vec<Entity> },
    EvaluationSave { profile_id: String, owner: String, version: i64, record: Value, expected_revision: i64 },
    EndResearch { profile_id: String, owner: String, version: i64, ended_at: String },
    Write { profile_id: String, owner: String, version: i64, entities: Vec<Entity>, statements: Vec<DatabaseWriteStatement>, post_reveal_fence: Option<ReviewFence> },
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ownership { owner: Option<String>, version: i64, expires_at: Option<String>, active: bool }
fn key(profile_id: &str) -> Result<String, String> {
    if profile_id.trim().is_empty() || profile_id.len() > 200 { return Err("Invalid workflow Profile id".into()); }
    Ok(format!("rvh.workflow.v1:{profile_id}"))
}
async fn guard(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, profile_id: &str, owner: &str, version: i64, entities: &[Entity]) -> Result<(), String> {
    let key = key(profile_id)?;
    // Acquire the SQLite writer lock before checking ownership and terminal state.
    sqlx::query("UPDATE app_settings SET value=value WHERE key=$1").bind(&key).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    let valid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key=$1 AND json_extract(value,'$.owner')=$2 AND json_extract(value,'$.version')=$3 AND json_extract(value,'$.expiresAt') > strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .bind(&key).bind(owner).bind(version).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
    if valid != 1 { return Err("Workflow ownership lost before provider dispatch or checkpoint save".into()); }
    let research_id = profile_id.strip_prefix("research:");
    if let Some(project_id)=research_id {
        let active:i64=sqlx::query_scalar("SELECT COUNT(*) FROM research_projects r JOIN workspaces w ON w.id=r.workspace_id JOIN profiles p ON p.id=w.profile_id WHERE r.id=$1 AND r.archived_at IS NULL AND w.archived_at IS NULL AND p.archived_at IS NULL").bind(project_id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        if active!=1 {return Err("Active Research project or parent not found".into());}
        let allow_ended=entities.iter().any(|entity|entity.kind=="research" && entity.id==project_id && entity.allow_ended);
        let ended:i64=sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key='rvh.research.end.v1:' || $1").bind(project_id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        let evaluation_only=entities.len()==1 && entities[0].kind=="research_evaluation" && entities[0].id==project_id;
        if ended>0 && !allow_ended && !evaluation_only {return Err("Research execution was ended by the user".into());}
    } else {
        let profile: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at IS NULL").bind(profile_id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        if profile != 1 { return Err("Active workflow Profile not found".into()); }
    }
    if entities.is_empty() || entities.len() > 8 { return Err("Invalid workflow entity scope".into()); }
    for entity in entities {
        let entity_profile=entity.profile_id.as_deref().unwrap_or(profile_id);
        if research_id.is_none() && entity_profile!=profile_id {return Err("Profile scope mismatch".into());}
        if entity.kind=="research_evaluation" {
            if entities.len()!=1 || research_id!=Some(entity.id.as_str()) {return Err("Research evaluation scope mismatch".into());}
            continue;
        }
        if entity.kind=="research" {
            if research_id!=Some(entity.id.as_str()) {return Err("Research scope mismatch".into());}
            continue;
        }
        if research_id.is_some() {
            let active_profile:i64=sqlx::query_scalar("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at IS NULL").bind(entity_profile).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
            if active_profile!=1 {return Err("Research participant Profile was archived or removed".into());}
        }
        if entity.kind=="rv" {
            if let Some(project_id)=research_id {
                let linked:i64=sqlx::query_scalar("SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND research_project_id=$2").bind(&entity.id).bind(project_id).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
                if linked!=1 {return Err("Research session scope mismatch".into());}
            }
        }
        let valid: i64 = match entity.kind.as_str() {
            "profile" => sqlx::query_scalar("SELECT COUNT(*) FROM profiles WHERE id=$1 AND id=$2 AND archived_at IS NULL"),
            "training" => sqlx::query_scalar("SELECT COUNT(*) FROM training_runs WHERE id=$1 AND archived_at IS NULL AND json_extract(record_json,'$.profileId')=$2 AND COALESCE(json_extract(record_json,'$.termination.reason'),'')=''"),
            "rv" => sqlx::query_scalar("SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND profile_id=$2 AND archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM session_events WHERE session_id=$1 AND event_type='RV_USER_FINISHED')"),
            _ => return Err("Invalid workflow entity kind".into()),
        }.bind(&entity.id).bind(entity_profile).fetch_one(&mut **tx).await.map_err(|e|e.to_string())?;
        if valid != 1 { return Err("Workflow was ended, archived or removed; execution and late writes are refused".into()); }
    }
    Ok(())
}
pub(crate) async fn execute(pool: &SqlitePool, request: Request) -> Result<Value, String> {
    match request {
        Request::Inspect { profile_id } => {
            let row: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(key(&profile_id)?).fetch_optional(pool).await.map_err(|e|e.to_string())?;
            if let Some(row) = row {
                let value: Value = serde_json::from_str(&row).map_err(|e|e.to_string())?;
                let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key=$1 AND json_extract(value,'$.owner') IS NOT NULL AND json_extract(value,'$.expiresAt') > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(key(&profile_id)?).fetch_one(pool).await.map_err(|e|e.to_string())?;
                Ok(json!(Ownership { owner:value["owner"].as_str().map(str::to_owned), version:value["version"].as_i64().unwrap_or(0), expires_at:value["expiresAt"].as_str().map(str::to_owned), active:active==1 }))
            } else { Ok(json!(Ownership { owner:None, version:0, expires_at:None, active:false })) }
        }
        Request::Acquire { profile_id, owner } => {
            if owner.is_empty() || owner.len()>200 { return Err("Invalid workflow owner".into()); }
            let key=key(&profile_id)?; let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
            sqlx::query("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES($1,'{\"owner\":null,\"version\":0,\"expiresAt\":null}',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(&key).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            let active: i64=if let Some(project_id)=profile_id.strip_prefix("research:") {
                sqlx::query_scalar("SELECT COUNT(*) FROM research_projects r JOIN workspaces w ON w.id=r.workspace_id JOIN profiles p ON p.id=w.profile_id WHERE r.id=$1 AND r.archived_at IS NULL AND w.archived_at IS NULL AND p.archived_at IS NULL").bind(project_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?
            }else{sqlx::query_scalar("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at IS NULL").bind(&profile_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?};
            if active!=1 { return Err("Active workflow scope not found".into()); }
            let changed=sqlx::query("UPDATE app_settings SET value=json_set(value,'$.owner',$1,'$.version',COALESCE(json_extract(value,'$.version'),0)+1,'$.expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','+45 seconds')),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key=$2 AND (json_extract(value,'$.owner') IS NULL OR json_extract(value,'$.expiresAt') <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(&owner).bind(&key).execute(&mut *tx).await.map_err(|e|e.to_string())?.rows_affected();
            if changed!=1 { return Err("Work for this Profile is running in another window".into()); }
            let version: i64=sqlx::query_scalar("SELECT json_extract(value,'$.version') FROM app_settings WHERE key=$1").bind(&key).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
            tx.commit().await.map_err(|e|e.to_string())?;Ok(json!({"profileId":profile_id,"owner":owner,"version":version}))
        }
        Request::Renew { profile_id, owner, version } => {
            let query="UPDATE app_settings SET value=json_set(value,'$.expiresAt',strftime('%Y-%m-%dT%H:%M:%fZ','now','+45 seconds')),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key=$1 AND json_extract(value,'$.owner')=$2 AND json_extract(value,'$.version')=$3 AND json_extract(value,'$.expiresAt') > strftime('%Y-%m-%dT%H:%M:%fZ','now')";
            let changed=sqlx::query(query).bind(key(&profile_id)?).bind(owner).bind(version).execute(pool).await.map_err(|e|e.to_string())?.rows_affected();Ok(json!(changed==1))
        }
        Request::Release { profile_id, owner, version } => {
            let changed=sqlx::query("UPDATE app_settings SET value=json_set(value,'$.owner',NULL,'$.expiresAt',NULL),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key=$1 AND json_extract(value,'$.owner')=$2 AND json_extract(value,'$.version')=$3").bind(key(&profile_id)?).bind(owner).bind(version).execute(pool).await.map_err(|e|e.to_string())?.rows_affected();Ok(json!(changed==1))
        }
        Request::Check { profile_id, owner, version, entities } => {
            let mut tx=pool.begin().await.map_err(|e|e.to_string())?;guard(&mut tx,&profile_id,&owner,version,&entities).await?;tx.commit().await.map_err(|e|e.to_string())?;Ok(json!(true))
        }
        Request::EvaluationSave { profile_id, owner, version, record, expected_revision } => {
            let project_id=profile_id.strip_prefix("research:").ok_or("Research ownership is required")?;
            let entities=vec![Entity{kind:"research_evaluation".into(),id:project_id.into(),profile_id:None,allow_ended:false}];
            let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
            guard(&mut tx,&profile_id,&owner,version,&entities).await?;
            let result=crate::research_evaluation::save(&mut tx,project_id,record,expected_revision).await?;
            tx.commit().await.map_err(|e|e.to_string())?;Ok(result)
        }
        Request::EndResearch { profile_id, owner, version, ended_at } => {
            let project_id=profile_id.strip_prefix("research:").ok_or("Research ownership is required for End")?;
            if ended_at.trim().is_empty() || ended_at.len()>100 {return Err("Invalid Research termination time".into());}
            let entities=vec![Entity{kind:"research".into(),id:project_id.into(),profile_id:None,allow_ended:true}];
            let mut tx=pool.begin().await.map_err(|e|e.to_string())?;guard(&mut tx,&profile_id,&owner,version,&entities).await?;
            let marker_key=format!("rvh.research.end.v1:{project_id}");
            let existing:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(&marker_key).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
            if let Some(marker)=existing {let value:Value=serde_json::from_str(&marker).map_err(|e|e.to_string())?;if value["reason"]!="user_finished" || value["endedAt"].as_str().is_none(){return Err("Invalid Research termination marker".into());}return Ok(value);}
            let state:String=sqlx::query_scalar("SELECT state FROM research_projects WHERE id=$1").bind(project_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
            if !["Locked","Running","Interrupted","SessionsComplete","Judging","ScoresFrozen","Unblinded"].contains(&state.as_str()) {return Err("Research execution cannot be ended in this state".into());}
            if state=="SessionsComplete" {
                let judges:i64=sqlx::query_scalar("SELECT COALESCE(json_array_length(config_json,'$.judges'),0) FROM research_projects WHERE id=$1").bind(project_id).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
                if judges==0 {return Err("Save-only Research execution is already complete".into());}
            }
            let phase=match state.as_str(){"SessionsComplete"|"Judging"=>"judging","ScoresFrozen"|"Unblinded"=>"finalization",_=>"sessions"};
            let marker=json!({"reason":"user_finished","endedAt":ended_at,"stateAtEnd":state,"phase":phase});
            sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(marker_key).bind(marker.to_string()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
            tx.commit().await.map_err(|e|e.to_string())?;Ok(marker)
        }
        Request::Write { profile_id, owner, version, entities, statements, post_reveal_fence } => {
            if entities.iter().any(|entity|entity.kind=="research_evaluation") {return Err("Research evaluation cannot change source work".into());}
            if statements.len()>5000 { return Err("Too many workflow statements".into()); }
            let mut tx=pool.begin().await.map_err(|e|e.to_string())?;guard(&mut tx,&profile_id,&owner,version,&entities).await?;
            if let Some(fence)=post_reveal_fence {
                let valid:i64=sqlx::query_scalar("SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND post_reveal_review_lease_owner=$2 AND post_reveal_review_lease_version=$3 AND post_reveal_review_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(fence.session_id).bind(fence.lease_owner).bind(fence.lease_version).fetch_one(&mut *tx).await.map_err(|e|e.to_string())?;
                if valid!=1 { return Err("Post-Reveal review ownership lost before workflow checkpoint".into()); }
            }
            let mut rows=Vec::with_capacity(statements.len());for statement in statements { rows.push(execute_statement_internal(&mut tx,statement,profile_id.strip_prefix("research:")).await?); }
            tx.commit().await.map_err(|e|e.to_string())?;Ok(json!(rows))
        }
    }
}
#[tauri::command]
pub async fn database_workflow_ownership(window: tauri::WebviewWindow, db_instances: State<'_,DbInstances>, request: Request, on_lost: Option<tauri::ipc::JavaScriptChannelId>) -> Result<Value,String> {
    // Deserialize an optional channel ID without allocating a native Channel for reads/writes.
    // Acquire still requires its loss notification stream, as before this optimization.
    let on_lost = if matches!(&request, Request::Acquire { .. }) {
        Some(on_lost.ok_or("Workflow Acquire requires a loss notification channel")?
            .channel_on::<_, crate::workflow_heartbeat::Failure>(window.as_ref().clone()))
    } else { None };
    let pool = sqlite_pool(&db_instances).await?;
    if let Request::Release { profile_id, owner, version } = &request {
        crate::workflow_heartbeat::stop(&crate::workflow_heartbeat::Token { profile_id: profile_id.clone(), owner: owner.clone(), version: *version }, window.label())?;
    }
    match &request {
        Request::Check { profile_id, owner, version, .. } | Request::Write { profile_id, owner, version, .. }
        | Request::EndResearch { profile_id, owner, version, .. } | Request::Renew { profile_id, owner, version } => {
            crate::workflow_heartbeat::assert_active(&crate::workflow_heartbeat::Token { profile_id: profile_id.clone(), owner: owner.clone(), version: *version }, window.label())?;
        }, _ => {},
    }
    let acquiring = matches!(&request, Request::Acquire { .. });
    let mut result = execute(&pool, request).await?;
    if acquiring {
        let token: crate::workflow_heartbeat::Token = serde_json::from_value(result.clone()).map_err(|e| e.to_string())?;
        if let Err(error) = crate::workflow_heartbeat::start(pool.clone(), token.clone(), window.label().to_owned(), on_lost) {
            let _ = execute(&pool, Request::Release { profile_id: token.profile_id, owner: token.owner, version: token.version }).await;
            return Err(error);
        }
        result["nativeHeartbeat"] = json!(true);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::execute_statement;
    use sqlx::sqlite::SqlitePoolOptions;
    async fn fixture() -> SqlitePool {
        let pool=SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT); CREATE TABLE profiles(id TEXT PRIMARY KEY,archived_at TEXT); INSERT INTO profiles VALUES('p',NULL); CREATE TABLE training_runs(id TEXT PRIMARY KEY,archived_at TEXT,record_json TEXT); INSERT INTO training_runs VALUES('t',NULL,'{\"profileId\":\"p\"}'); CREATE TABLE rv_sessions(id TEXT PRIMARY KEY,profile_id TEXT,archived_at TEXT,state TEXT,updated_at TEXT,completed_at TEXT,research_project_id TEXT); INSERT INTO rv_sessions VALUES('s','p',NULL,'Interrupted','old',NULL,NULL); CREATE TABLE session_events(id TEXT PRIMARY KEY,session_id TEXT,sequence_number INTEGER,event_type TEXT,role TEXT,content TEXT,metadata_json TEXT,created_at TEXT);").execute(&pool).await.unwrap();
        pool
    }
    fn entities(kind:&str,id:&str)->Vec<Entity>{vec![Entity{kind:kind.into(),id:id.into(),profile_id:None,allow_ended:false}]}
    async fn acquire(pool:&SqlitePool,owner:&str)->i64 {execute(pool,Request::Acquire{profile_id:"p".into(),owner:owner.into()}).await.unwrap()["version"].as_i64().unwrap()}
    fn write(owner:&str,version:i64,kind:&str,id:&str)->Request {
        Request::Write{profile_id:"p".into(),owner:owner.into(),version,entities:entities(kind,id),post_reveal_fence:None,statements:vec![DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsInsertAppSettings01,values:vec![json!("global-learning-fixture"),json!("accepted"),json!("time")]}]}
    }
    #[tokio::test]
    async fn another_owner_is_denied_and_expired_owner_cannot_write_global_learning() {
        let pool=fixture().await;let first=acquire(&pool,"first").await;
        assert!(execute(&pool,Request::Acquire{profile_id:"p".into(),owner:"second".into()}).await.is_err());
        execute(&pool,write("first",first,"training","t")).await.unwrap();
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.expiresAt','2000-01-01T00:00:00.000Z') WHERE key='rvh.workflow.v1:p'").execute(&pool).await.unwrap();
        let second=acquire(&pool,"second").await;assert!(second>first);
        assert!(execute(&pool,write("first",first,"training","t")).await.is_err());
        assert_eq!(execute(&pool,Request::Release{profile_id:"p".into(),owner:"first".into(),version:first}).await.unwrap(),json!(false));
        assert!(execute(&pool,write("second",second,"training","t")).await.is_ok());
    }
    #[tokio::test]
    async fn terminal_entities_reject_owned_writes_but_evidence_is_retained() {
        let pool=fixture().await;let version=acquire(&pool,"owner").await;
        sqlx::query("UPDATE training_runs SET record_json=json_set(record_json,'$.termination.reason','user_finished') WHERE id='t'").execute(&pool).await.unwrap();
        assert!(execute(&pool,write("owner",version,"training","t")).await.is_err());
        sqlx::query("INSERT INTO session_events VALUES('end','s',1,'RV_USER_FINISHED','controller',NULL,'{\"reason\":\"user_finished\"}','end')").execute(&pool).await.unwrap();
        assert!(execute(&pool,write("owner",version,"rv","s")).await.is_err());
        let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key='global-learning-fixture'").fetch_one(&pool).await.unwrap();assert_eq!(count,0);
        let state:String=sqlx::query_scalar("SELECT state FROM rv_sessions WHERE id='s'").fetch_one(&pool).await.unwrap();assert_eq!(state,"Interrupted");
        // Even a direct legacy named session write must not bypass the terminal event.
        let mut tx=pool.begin().await.unwrap();
        assert!(execute_statement(&mut tx,DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SessionsUpdateRvSessions01,values:vec![json!("Completed"),json!("late"),json!("s")]}).await.is_err());
        tx.rollback().await.unwrap();
    }
    #[tokio::test]
    async fn reserved_key_cannot_be_written_through_the_generic_statement_channel() {
        let pool=fixture().await;let mut tx=pool.begin().await.unwrap();
        assert!(execute_statement(&mut tx,DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsInsertAppSettings01,values:vec![json!("rvh.workflow.v1:p"),json!("{}"),json!("t")]}).await.is_err());
        tx.rollback().await.unwrap();
        let request:Request=serde_json::from_value(json!({"action":"check","profileId":"p","owner":"o","version":1,"entities":[{"kind":"rv","id":"s"}]})).unwrap();
        assert!(matches!(request,Request::Check{profile_id,..} if profile_id=="p"));
    }
    #[tokio::test]
    async fn failed_owned_batch_rolls_back_the_earlier_write() {
        let pool=fixture().await;let version=acquire(&pool,"owner").await;
        let statement=DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsInsertAppSettings01,values:vec![json!("global-learning-fixture"),json!("accepted"),json!("t")]};
        let invalid=DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsInsertAppSettings01,values:vec![]};
        assert!(execute(&pool,Request::Write{profile_id:"p".into(),owner:"owner".into(),version,entities:entities("rv","s"),post_reveal_fence:None,statements:vec![statement,invalid]}).await.is_err());
        let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key='global-learning-fixture'").fetch_one(&pool).await.unwrap();assert_eq!(count,0);
    }

    async fn research_fixture()->SqlitePool {
        let pool=fixture().await;
        sqlx::raw_sql("CREATE TABLE workspaces(id TEXT PRIMARY KEY,profile_id TEXT,archived_at TEXT);INSERT INTO workspaces VALUES('w','p',NULL);CREATE TABLE research_projects(id TEXT PRIMARY KEY,workspace_id TEXT,archived_at TEXT,state TEXT,config_json TEXT,config_hash TEXT,locked_at TEXT);INSERT INTO research_projects VALUES('r','w',NULL,'Interrupted','{\"judges\":[{}]}','frozen','lock');UPDATE rv_sessions SET research_project_id='r' WHERE id='s';INSERT INTO profiles VALUES('p2',NULL);INSERT INTO rv_sessions VALUES('s2','p2',NULL,'Interrupted','old',NULL,'r');").execute(&pool).await.unwrap();pool
    }
    async fn research_acquire(pool:&SqlitePool,owner:&str)->i64 {execute(pool,Request::Acquire{profile_id:"research:r".into(),owner:owner.into()}).await.unwrap()["version"].as_i64().unwrap()}
    fn research_write(owner:&str,version:i64)->Request {
        Request::Write{profile_id:"research:r".into(),owner:owner.into(),version,entities:vec![Entity{kind:"rv".into(),id:"s2".into(),profile_id:Some("p2".into()),allow_ended:false}],post_reveal_fence:None,statements:vec![DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsInsertAppSettings01,values:vec![json!("global-fixture"),json!("value"),json!("t")]}]}
    }
    #[tokio::test]
    async fn research_end_retains_frozen_method_and_refuses_late_work() {
        let pool=research_fixture().await;let version=research_acquire(&pool,"owner").await;
        let before:(String,String,String,String)=sqlx::query_as("SELECT config_json,config_hash,locked_at,state FROM research_projects WHERE id='r'").fetch_one(&pool).await.unwrap();
        let marker=execute(&pool,Request::EndResearch{profile_id:"research:r".into(),owner:"owner".into(),version,ended_at:"first".into()}).await.unwrap();
        assert_eq!(execute(&pool,Request::EndResearch{profile_id:"research:r".into(),owner:"owner".into(),version,ended_at:"second".into()}).await.unwrap(),marker);
        let after:(String,String,String,String)=sqlx::query_as("SELECT config_json,config_hash,locked_at,state FROM research_projects WHERE id='r'").fetch_one(&pool).await.unwrap();assert_eq!(before,after);
        assert!(execute(&pool,research_write("owner",version)).await.is_err());
        let mut tx=pool.begin().await.unwrap();assert!(execute_statement(&mut tx,DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SessionsUpdateRvSessions01,values:vec![json!("Completed"),json!("late"),json!("s")]}).await.is_err());tx.rollback().await.unwrap();
    }
    #[tokio::test]
    async fn research_multi_profile_scope_is_fenced_after_takeover() {
        let pool=research_fixture().await;let first=research_acquire(&pool,"first").await;
        assert!(execute(&pool,research_write("first",first)).await.is_ok());
        assert!(execute(&pool,Request::Acquire{profile_id:"research:r".into(),owner:"second".into()}).await.is_err());
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.expiresAt','2000-01-01T00:00:00.000Z') WHERE key='rvh.workflow.v1:research:r'").execute(&pool).await.unwrap();let second=research_acquire(&pool,"second").await;
        assert!(second>first);assert!(execute(&pool,research_write("first",first)).await.is_err());assert_eq!(execute(&pool,Request::Release{profile_id:"research:r".into(),owner:"first".into(),version:first}).await.unwrap(),json!(false));assert!(execute(&pool,research_write("second",second)).await.is_ok());
    }
    #[tokio::test]
    async fn research_failed_end_transaction_can_be_retried() {
        let pool=research_fixture().await;let version=research_acquire(&pool,"owner").await;
        sqlx::raw_sql("CREATE TRIGGER reject_end BEFORE INSERT ON app_settings WHEN NEW.key LIKE 'rvh.research.end.v1:%' BEGIN SELECT RAISE(ABORT,'marker save failed');END;").execute(&pool).await.unwrap();
        assert!(execute(&pool,Request::EndResearch{profile_id:"research:r".into(),owner:"owner".into(),version,ended_at:"first".into()}).await.is_err());let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key='rvh.research.end.v1:r'").fetch_one(&pool).await.unwrap();assert_eq!(count,0);
        sqlx::raw_sql("DROP TRIGGER reject_end;").execute(&pool).await.unwrap();assert!(execute(&pool,Request::EndResearch{profile_id:"research:r".into(),owner:"owner".into(),version,ended_at:"retry".into()}).await.is_ok());
    }
    #[tokio::test]
    async fn generic_channel_cannot_erase_research_termination() {
        let pool=research_fixture().await;let version=research_acquire(&pool,"owner").await;execute(&pool,Request::EndResearch{profile_id:"research:r".into(),owner:"owner".into(),version,ended_at:"end".into()}).await.unwrap();
        let mut tx=pool.begin().await.unwrap();assert!(execute_statement(&mut tx,DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsDeleteAppSettings01,values:vec![json!("rvh.research.end.v1:r")]}).await.is_err());tx.rollback().await.unwrap();
        let request:Request=serde_json::from_value(json!({"action":"endResearch","profileId":"research:r","owner":"o","version":1,"endedAt":"end"})).unwrap();assert!(matches!(request,Request::EndResearch{..}));
    }

}

#[cfg(test)]
mod evaluation_tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn ended_source_allows_only_isolated_evaluation_writes_and_fences_stale_owners() {
        let pool=SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT);CREATE TABLE profiles(id TEXT PRIMARY KEY,archived_at TEXT);INSERT INTO profiles VALUES('p',NULL);CREATE TABLE workspaces(id TEXT PRIMARY KEY,profile_id TEXT,archived_at TEXT);INSERT INTO workspaces VALUES('w','p',NULL);CREATE TABLE research_projects(id TEXT PRIMARY KEY,workspace_id TEXT,archived_at TEXT);INSERT INTO research_projects VALUES('r','w',NULL);CREATE TABLE rv_sessions(id TEXT PRIMARY KEY,research_project_id TEXT,pre_reveal_sealed_at TEXT,pre_reveal_hash TEXT,archived_at TEXT);INSERT INTO rv_sessions VALUES('s','r','t','hash',NULL);CREATE TABLE reveals(session_id TEXT PRIMARY KEY);INSERT INTO reveals VALUES('s');INSERT INTO app_settings VALUES('rvh.research.end.v1:r','{\"reason\":\"user_finished\"}','t');").execute(&pool).await.unwrap();
        let token=execute(&pool,Request::Acquire{profile_id:"research:r".into(),owner:"owner".into()}).await.unwrap();let version=token["version"].as_i64().unwrap();
        let record=json!({"schemaVersion":1,"id":"panel","projectId":"r","revision":1,"createdAt":"t","language":"en","budgetPolicy":"default","status":"Ready","judges":[{"providerConfig":{"id":"pc"},"model":{"route":"route"}}],"sources":[{"sessionId":"s","anonymousSessionId":"BlindSession_ABCDEF12","sourceSha256":"a".repeat(64)}],"scores":{},"events":[]});
        let save=|owner:&str,version:i64|Request::EvaluationSave{profile_id:"research:r".into(),owner:owner.into(),version,record:record.clone(),expected_revision:0};
        assert!(execute(&pool,save("stale",version)).await.is_err());assert!(execute(&pool,save("owner",version)).await.is_ok());
        let entities=vec![Entity{kind:"research_evaluation".into(),id:"r".into(),profile_id:None,allow_ended:false}];
        assert!(execute(&pool,Request::Write{profile_id:"research:r".into(),owner:"owner".into(),version,entities,statements:vec![],post_reveal_fence:None}).await.is_err());
        let marker:String=sqlx::query_scalar("SELECT value FROM app_settings WHERE key='rvh.research.end.v1:r'").fetch_one(&pool).await.unwrap();assert_eq!(marker,"{\"reason\":\"user_finished\"}");
        let mut tx=pool.begin().await.unwrap();assert!(crate::database::execute_statement(&mut tx,DatabaseWriteStatement{operation:crate::database::DatabaseWriteOperation::SettingsModelsDeleteAppSettings01,values:vec![json!("rvh.research.evaluation.v1:r:panel")]}).await.is_err());
    }
}
