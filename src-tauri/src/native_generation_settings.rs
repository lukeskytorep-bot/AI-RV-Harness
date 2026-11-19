//! Pending numeric preferences; no activation and no HTTP dispatch.
use crate::{native_connection_identity::Binding,native_connection_settings::{self as connections,SecretStore},native_generation_contract::{Settings,Readiness,readiness}};
use serde::{Serialize,Deserialize};
use sqlx::SqlitePool;
use sha2::{Digest,Sha256};
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Draft {pub version:u8,pub binding:Binding,pub model:String,pub settings:Settings}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct State {pub draft:Draft,pub readiness:Readiness}
fn key(binding:&Binding,model:&str)->String{format!("native.generation.draft.v1.{}.{}.{:x}",binding.provider_config_id,binding.connection_revision,Sha256::digest(model.as_bytes()))}
async fn view<S:SecretStore>(pool:&SqlitePool,store:&S,binding:&Binding,model:&str)->Result<connections::Discovery,String>{
    let view=connections::list(pool,store).await?.into_iter().find(|v|v.connection.id==binding.provider_config_id).ok_or("Native connection not found")?;
    if view.connection.binding()!=*binding{return Err("Native connection changed; reload settings".into());}
    let d=view.discovery.filter(|d|d.selected_available && d.selected_model.as_deref()==Some(model)).ok_or("Select an available exact model and refresh native discovery first")?;Ok(d)
}
fn state(draft:Draft,discovery:&connections::Discovery)->State{
    let declared=discovery.details.as_ref().and_then(|d|d.get("declaredContextTokens")).and_then(serde_json::Value::as_u64);
    State{readiness:readiness(&draft.settings,declared),draft}
}
pub async fn get<S:SecretStore>(pool:&SqlitePool,store:&S,binding:Binding,model:String)->Result<State,String>{
    let discovery=view(pool,store,&binding,&model).await?;
    let raw:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(key(&binding,&model)).fetch_optional(pool).await.map_err(|_|"Cannot read native generation preferences")?;
    let draft=if let Some(raw)=raw {let draft:Draft=serde_json::from_str(&raw).map_err(|_|"Invalid native generation preferences")?;if draft.version!=1||draft.binding!=binding||draft.model!=model{return Err("Native preferences have an incompatible binding".into());}draft.settings.validate()?;draft}else{Draft{version:1,binding,model,settings:Settings::default()}};
    Ok(state(draft,&discovery))
}
pub async fn save<S:SecretStore>(pool:&SqlitePool,store:&S,draft:Draft)->Result<State,String>{
    if draft.version!=1{return Err("Unsupported native preferences version".into());}draft.settings.validate()?;
    if connections::is_cloud_endpoint(&draft.binding.normalized_endpoint) && draft.settings.num_ctx.is_some(){return Err("Ollama Cloud context allocation is managed by the service; clear num_ctx".into());}
    let discovery=view(pool,store,&draft.binding,&draft.model).await?;
    let mut tx=pool.begin_with("BEGIN IMMEDIATE").await.map_err(|_|"Cannot begin native preferences save")?;
    let current:Option<(String,i64,String,String)>=sqlx::query_as("SELECT connection_identity_id,connection_revision,base_url,auth_mode FROM provider_configs WHERE id=$1 AND provider='ollama_native' AND enabled=0").bind(&draft.binding.provider_config_id).fetch_optional(&mut *tx).await.map_err(|_|"Cannot verify native preferences binding")?;
    if current!=Some((draft.binding.connection_identity_id.clone(),draft.binding.connection_revision as i64,draft.binding.normalized_endpoint.clone(),draft.binding.auth_mode.clone())){return Err("Native connection changed while saving preferences".into());}
    let cached:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(format!("native.discovery.v1.{}",draft.binding.provider_config_id)).fetch_optional(&mut *tx).await.map_err(|_|"Cannot verify native model selection")?;
    if cached.and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok())!=Some(serde_json::to_value(&discovery).map_err(|_|"Invalid native discovery")?){return Err("Native model discovery changed while saving preferences".into());}
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key(&draft.binding,&draft.model)).bind(serde_json::to_string(&draft).map_err(|_|"Cannot encode native preferences")?).execute(&mut *tx).await.map_err(|_|"Cannot save native preferences")?;
    tx.commit().await.map_err(|_|"Cannot commit native preferences")?;Ok(state(draft,&discovery))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct NoSecrets;
    impl SecretStore for NoSecrets {fn read(&self,_:&str,_:&str)->Result<String,String>{panic!("keyless preferences must not read secrets")}fn create(&self,_:&str,_:&str,_:&str)->Result<(),String>{panic!("must not create secrets")}fn remove(&self,_:&str)->Result<(),String>{panic!("must not remove secrets")}}
    async fn db()->SqlitePool{
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        assert_eq!(crate::migrations::MIGRATION_SPECS.last().unwrap().version,crate::migrations::CURRENT_MIGRATION_VERSION);
        for m in crate::migrations::MIGRATION_SPECS{let mut tx=pool.begin().await.unwrap();sqlx::raw_sql(m.sql).execute(&mut *tx).await.unwrap();tx.commit().await.unwrap();}pool
    }
    async fn setup(pool:&SqlitePool)->Binding{
        sqlx::query("INSERT INTO provider_configs(id,provider,label,base_url,auth_mode,connection_identity_id,connection_revision,enabled,created_at,updated_at) VALUES('p','ollama_native','Native','http://localhost:11434','none','identity',1,0,'now','now')").execute(pool).await.unwrap();
        let binding=connections::load(pool,"p").await.unwrap().binding();let d=json!({"binding":&binding,"serverVersion":"fixture-only","capturedAtMs":1,"models":[{"name":"exact:tag","digest":"fixture"}],"selectedModel":"exact:tag","selectedAvailable":true,"details":{"sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","declaredContextTokens":65536},"detailsUnavailable":false,"generationAvailable":false});
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES('native.discovery.v1.p',$1,'now')").bind(d.to_string()).execute(pool).await.unwrap();binding
    }
    #[tokio::test] async fn preferences_persist_zero_and_auto_without_enabling_provider_or_creating_key(){
        let pool=db().await;let binding=setup(&pool).await;let original=get(&pool,&NoSecrets,binding.clone(),"exact:tag".into()).await.unwrap();assert_eq!(original.draft.settings,Settings::default());
        let settings=Settings{num_ctx:Some(65536),temperature:Some(0.0),top_p:Some(0.0),top_k:Some(0),seed:Some(0)};
        let saved=save(&pool,&NoSecrets,Draft{version:1,binding:binding.clone(),model:"exact:tag".into(),settings:settings.clone()}).await.unwrap();assert!(!saved.readiness.generation_available);assert_eq!(saved.readiness.requested_context_tokens,Some(65536));assert_eq!(saved.readiness.observed_running_context_tokens,None);
        assert_eq!(get(&pool,&NoSecrets,binding.clone(),"exact:tag".into()).await.unwrap().draft.settings,settings);
        let auto=save(&pool,&NoSecrets,Draft{version:1,binding:binding.clone(),model:"exact:tag".into(),settings:Settings::default()}).await.unwrap();assert_eq!(serde_json::to_value(&auto.draft.settings).unwrap(),json!({}));
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT enabled FROM provider_configs WHERE id='p'").fetch_one(&pool).await.unwrap(),0);assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM credentials_metadata").fetch_one(&pool).await.unwrap(),0);
    }
    #[tokio::test] async fn invalid_settings_and_stale_or_missing_models_preserve_existing_draft(){
        let pool=db().await;let binding=setup(&pool).await;save(&pool,&NoSecrets,Draft{version:1,binding:binding.clone(),model:"exact:tag".into(),settings:Settings::default()}).await.unwrap();
        let before:String=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(key(&binding,"exact:tag")).fetch_one(&pool).await.unwrap();
        let mut stale=binding.clone();stale.connection_revision=2;
        for draft in [Draft{version:1,binding:stale,model:"exact:tag".into(),settings:Settings::default()},Draft{version:1,binding:binding.clone(),model:"absent".into(),settings:Settings::default()},Draft{version:1,binding:binding.clone(),model:"exact:tag".into(),settings:Settings{num_ctx:Some(0),..Settings::default()}}]{assert!(save(&pool,&NoSecrets,draft).await.is_err());}
        let after:String=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(key(&binding,"exact:tag")).fetch_one(&pool).await.unwrap();assert_eq!(before,after);
    }
    #[tokio::test] async fn sqlite_failure_rolls_back_preferences(){
        let pool=db().await;let binding=setup(&pool).await;
        sqlx::raw_sql("CREATE TRIGGER reject_draft BEFORE INSERT ON app_settings WHEN NEW.key LIKE 'native.generation.draft.%' BEGIN SELECT RAISE(ABORT,'injected'); END;").execute(&pool).await.unwrap();
        assert!(save(&pool,&NoSecrets,Draft{version:1,binding:binding.clone(),model:"exact:tag".into(),settings:Settings::default()}).await.is_err());assert_eq!(get(&pool,&NoSecrets,binding,"exact:tag".into()).await.unwrap().draft.settings,Settings::default());
    }
    #[tokio::test] async fn preferences_survive_disk_close_and_reopen_without_changing_the_model(){
        let path=std::env::temp_dir().join(format!("rvh-native-draft-{}-{}.sqlite",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let options=sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options.clone()).await.unwrap();
        for m in crate::migrations::MIGRATION_SPECS{let mut tx=pool.begin().await.unwrap();sqlx::raw_sql(m.sql).execute(&mut *tx).await.unwrap();tx.commit().await.unwrap();}
        let binding=setup(&pool).await;let settings=Settings{seed:Some(0),num_ctx:Some(65536),..Settings::default()};
        save(&pool,&NoSecrets,Draft{version:1,binding:binding.clone(),model:"exact:tag".into(),settings:settings.clone()}).await.unwrap();pool.close().await;
        let reopened=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        let restored=get(&reopened,&NoSecrets,binding,"exact:tag".into()).await.unwrap();assert_eq!(restored.draft.settings,settings);assert_eq!(restored.draft.model,"exact:tag");assert!(!restored.readiness.generation_available);reopened.close().await;std::fs::remove_file(path).unwrap();
    }

    #[tokio::test] async fn cloud_cannot_persist_local_context_even_before_credentials_are_resolved(){
        let pool=db().await;let mut binding=setup(&pool).await;binding.normalized_endpoint="https://ollama.com".into();binding.auth_mode="bearer".into();let error=save(&pool,&NoSecrets,Draft{version:1,binding,model:"exact:tag".into(),settings:Settings{num_ctx:Some(65536),..Settings::default()}}).await.err().unwrap();assert!(error.contains("managed"));assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM app_settings WHERE key LIKE 'native.generation.draft.%'").fetch_one(&pool).await.unwrap(),0);
    }

}
