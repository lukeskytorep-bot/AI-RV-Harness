//! DIRECT-3B2: non-generating settings/discovery, testable without Tauri or OS keyring.
use crate::native_connection_identity::{normalize_endpoint, verify_binding, Binding, StoredConnection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub trait SecretStore: Send + Sync {
    fn read(&self, id: &str, endpoint: &str) -> Result<String, String>;
    fn create(&self, id: &str, secret: &str, endpoint: &str) -> Result<(), String>;
    fn remove(&self, id: &str) -> Result<(), String>;
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SaveInput {
    pub expected: Option<Binding>, pub label:String, pub base_url:String, pub auth_mode:String,
    pub api_key:Option<String>, pub selected_model:Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Connection {
    pub id:String, pub provider:String, pub label:String, pub base_url:String, pub auth_mode:String,
    #[serde(skip_serializing_if="Option::is_none")] pub credential_id:Option<String>,
    pub connection_identity_id:String, pub connection_revision:u64, pub enabled:bool,
}
impl Connection {
    pub fn binding(&self)->Binding { Binding{version:1,provider:self.provider.clone(),provider_config_id:self.id.clone(),connection_identity_id:self.connection_identity_id.clone(),connection_revision:self.connection_revision,normalized_endpoint:self.base_url.clone(),auth_mode:self.auth_mode.clone()} }
    fn stored(&self)->StoredConnection { StoredConnection{id:self.id.clone(),provider:self.provider.clone(),endpoint:self.base_url.clone(),auth_mode:self.auth_mode.clone(),credential_id:self.credential_id.clone(),credential_hint:None,identity_id:self.connection_identity_id.clone(),revision:self.connection_revision,enabled:self.enabled} }
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Discovery {
    pub binding:Binding, pub server_version:Option<String>, pub captured_at_ms:u64,
    pub models:Vec<Model>, pub selected_model:Option<String>, pub selected_available:bool,
    pub details:Option<Value>, pub details_unavailable:bool, pub generation_available:bool,
}
#[derive(Clone,Serialize,Deserialize)]
pub struct Model { pub name:String, pub digest:Option<String> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct View { pub connection:Connection, pub discovery:Option<Discovery> }
fn now()->u64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64}
async fn unique(pool:&SqlitePool,prefix:&str)->Result<String,String> {
    let random:String=sqlx::query_scalar("SELECT lower(hex(randomblob(16)))").fetch_one(pool).await.map_err(|_|"Cannot allocate native identity")?;
    Ok(format!("{prefix}_{random}"))
}
fn safe_text(value:&str)->bool {!value.is_empty() && value.len()<=512 && !value.chars().any(char::is_control)}
fn cache_key(id:&str)->String {format!("native.discovery.v1.{id}")}
fn has_secret(value:&Value, secret:Option<&str>)->bool {
    let Some(secret)=secret.filter(|s|!s.is_empty()) else{return false};
    match value {Value::String(s)=>s.contains(secret),Value::Array(a)=>a.iter().any(|v|has_secret(v,Some(secret))),Value::Object(o)=>o.iter().any(|(k,v)|k.contains(secret)||has_secret(v,Some(secret))),_=>false}
}
// Check the complete serialized metadata shape, never a secret-bearing request input.
pub(crate) fn ensure_metadata_has_no_secret<T:Serialize>(metadata:&T,secret:Option<&str>)->Result<(),String>{
    let value=serde_json::to_value(metadata).map_err(|_|"Cannot validate native metadata")?;
    if has_secret(&value,secret){return Err("Native metadata contains sensitive data".into());}
    Ok(())
}
async fn request(client:&reqwest::Client, endpoint:&str, suffix:&str, body:Option<Value>, secret:Option<&str>)->Result<(u16,Option<Value>),String> {
    let url=format!("{endpoint}/api/{suffix}");
    let mut call=if let Some(body)=body{client.post(url).json(&body)}else{client.get(url)};
    if let Some(secret)=secret{call=call.bearer_auth(secret);}
    let mut response=call.send().await.map_err(|_|"Native discovery connection failed")?;
    let status=response.status().as_u16();
    if status==404 || status==405{return Ok((status,None));}
    if !(200..300).contains(&status){return Err(format!("Native discovery returned HTTP {status}"));}
    let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"Native discovery response was interrupted")?{
        if bytes.len()+chunk.len()>2*1024*1024{return Err("Native discovery response exceeded 2 MiB".into());}bytes.extend_from_slice(&chunk);
    }
    let payload:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid native discovery JSON")?;
    if has_secret(&payload,secret){return Err("Native discovery response contained sensitive data".into());}
    if payload.get("error").is_some(){return Err("Native discovery reported a server error".into());}
    Ok((status,Some(payload)))
}
pub fn discovery_client()->Result<reqwest::Client,String> {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(30)).build().map_err(|_|"Cannot create native discovery client".into())
}
pub(crate) async fn cloud_catalog(client:&reqwest::Client,secret:&str)->Result<Value,String>{
    if secret.trim().is_empty(){return Err("Ollama Cloud requires an API key".into());}
    let (_,account)=request(client,CLOUD_BASE,"balance",None,Some(secret)).await?;
    let account=account.ok_or("Cloud access check unavailable")?;
    if !account.get("included").is_some_and(Value::is_object)||!account.get("purchased").is_some_and(Value::is_object){return Err("Invalid cloud access response".into());}
    let (_,tags)=request(client,CLOUD_BASE,"tags",None,Some(secret)).await?;let tags=tags.ok_or("Cloud models unavailable")?;
    let models=tags.get("models").and_then(Value::as_array).ok_or("Invalid cloud models")?;
    if models.len()>2000{return Err("Cloud model list exceeds 2000 entries".into());}
    let mut names=std::collections::HashSet::new();for model in models{let name=model.get("name").and_then(Value::as_str).filter(|s|safe_text(s)&&!s.chars().any(char::is_whitespace)).ok_or("Invalid exact cloud model name")?;if !names.insert(name){return Err("Duplicate cloud model name".into());}}
    Ok(tags)
}
pub const CLOUD_BASE:&str="https://ollama.com";
pub fn is_cloud_endpoint(endpoint:&str)->bool {endpoint==CLOUD_BASE}
pub async fn probe(client:&reqwest::Client,binding:Binding,selected:Option<String>,secret:Option<&str>)->Result<Discovery,String>{
    let cloud=is_cloud_endpoint(&binding.normalized_endpoint);
    probe_contract(client,binding,selected,secret,cloud).await
}
// Only the public wrapper derives deployment from the canonical saved endpoint.
// Tests can exercise the hosted HTTP contract against a controlled loopback server.
async fn probe_contract(client:&reqwest::Client, binding:Binding, selected:Option<String>, secret:Option<&str>,cloud:bool)->Result<Discovery,String> {
    ensure_metadata_has_no_secret(&json!({"binding":&binding,"selectedModel":&selected}),secret)?;
    if let Some(model)=&selected {if !safe_text(model) || model.chars().any(char::is_whitespace){return Err("Invalid exact native model identifier".into());}}
    if cloud && (binding.auth_mode!="bearer" || secret.is_none_or(|s|s.trim().is_empty())) {return Err("Ollama Cloud requires a bound Bearer API key".into());}
    if cloud {
        // tags may be public: verify the key against the documented authenticated endpoint.
        // Validate and discard account data; never cache or return balances.
        let (_,account)=request(client,&binding.normalized_endpoint,"balance",None,secret).await?;
        let account=account.ok_or("Ollama Cloud authentication check is unavailable")?;
        if !account.get("included").is_some_and(Value::is_object) || !account.get("purchased").is_some_and(Value::is_object){return Err("Invalid Ollama Cloud authentication response".into());}
    }
    let version=if cloud {None}else{
        let (_,version)=request(client,&binding.normalized_endpoint,"version",None,secret).await?;
        Some(version.and_then(|v|v.get("version").and_then(Value::as_str).map(str::to_owned)).filter(|s|safe_text(s)).ok_or("Native server version was not provided")?)
    };
    let (_,tags)=request(client,&binding.normalized_endpoint,"tags",None,secret).await?;
    let tags=tags.ok_or("Native model list is unavailable")?;
    let array=tags.get("models").and_then(Value::as_array).ok_or("Invalid native model list")?;
    if array.len()>2000{return Err("Native model list exceeded 2000 entries".into());}
    let mut models=Vec::new();
    for item in array {
        let name=item.get("name").and_then(Value::as_str).filter(|s|safe_text(s)&&!s.chars().any(char::is_whitespace)).ok_or("Invalid native model identifier")?.to_owned();
        let digest=item.get("digest").and_then(Value::as_str).filter(|s|safe_text(s)).map(str::to_owned);
        if models.iter().any(|m:&Model|m.name==name){return Err("Duplicate native model identifier".into());}
        models.push(Model{name,digest});
    }
    let available=selected.as_ref().is_some_and(|s|models.iter().any(|m|&m.name==s));
    let mut details=None;let mut unavailable=false;
    if let Some(model)=selected.as_ref().filter(|_|available && !cloud){
        let (_,show)=request(client,&binding.normalized_endpoint,"show",Some(json!({"model":model,"verbose":false})),secret).await?;
        if let Some(show)=show {
            if !show.is_object(){return Err("Invalid native model details".into());}
            let architecture=show.get("model_info").and_then(|v|v.get("general.architecture")).and_then(Value::as_str);
            let context=architecture.and_then(|a|show.get("model_info")?.get(format!("{a}.context_length"))?.as_u64());
            let mut summary=json!({"sourceSha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&show).map_err(|_|"Cannot hash native metadata")?)),"contextAllocationVerified":false});
            if let Some(context)=context {summary["declaredContextTokens"]=json!(context);}
            for key in ["capabilities","thinking","details","parameters","renderer","parser","template_source"] {if let Some(v)=show.get(key){summary[key]=v.clone();}}
            details=Some(summary);
        }else{unavailable=true;}
    }
    if cloud {
        unavailable=true;
        if let Some(item)=array.iter().find(|v|v.get("name").and_then(Value::as_str)==selected.as_deref()) {
            details=Some(json!({"metadataSource":"cloud_tags","sourceSha256":format!("{:x}",Sha256::digest(serde_json::to_vec(item).map_err(|_|"Cannot hash cloud model metadata")?)),"contextAllocationVerified":false}));
        }
    }
    let result=Discovery{binding,server_version:version,captured_at_ms:now(),models,selected_model:selected,selected_available:available,details,details_unavailable:unavailable,generation_available:false};
    ensure_metadata_has_no_secret(&result,secret)?;
    Ok(result)
}
pub async fn load(pool:&SqlitePool,id:&str)->Result<Connection,String>{
    let row=sqlx::query("SELECT * FROM provider_configs WHERE id=$1 AND provider='ollama_native'").bind(id).fetch_optional(pool).await.map_err(|_|"Cannot read native connection")?.ok_or("Native connection not found")?;
    let c=Connection{id:row.try_get("id").map_err(|_|"Invalid connection")?,provider:"ollama_native".into(),label:row.try_get("label").map_err(|_|"Invalid connection")?,base_url:row.try_get("base_url").map_err(|_|"Invalid connection")?,auth_mode:row.try_get("auth_mode").map_err(|_|"Invalid connection")?,credential_id:row.try_get("credential_id").map_err(|_|"Invalid connection")?,connection_identity_id:row.try_get("connection_identity_id").map_err(|_|"Invalid connection")?,connection_revision:u64::try_from(row.try_get::<i64,_>("connection_revision").map_err(|_|"Invalid revision")?).map_err(|_|"Invalid revision")?,enabled:row.try_get::<i64,_>("enabled").map_err(|_|"Invalid connection")?!=0};
    verify_binding(&c.stored(),&c.binding())?;Ok(c)
}
async fn current(pool:&SqlitePool,binding:&Binding)->Result<Connection,String>{let c=load(pool,&binding.provider_config_id).await?;verify_binding(&c.stored(),binding)?;Ok(c)}
async fn cache(pool:&SqlitePool,discovery:&Discovery)->Result<(),String>{
    let mut tx=pool.begin_with("BEGIN IMMEDIATE").await.map_err(|_|"Cannot save native discovery")?;
    let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM provider_configs WHERE id=$1 AND connection_identity_id=$2 AND connection_revision=$3 AND base_url=$4 AND auth_mode=$5 AND provider='ollama_native' AND enabled=0")
        .bind(&discovery.binding.provider_config_id).bind(&discovery.binding.connection_identity_id).bind(discovery.binding.connection_revision as i64).bind(&discovery.binding.normalized_endpoint).bind(&discovery.binding.auth_mode).fetch_one(&mut *tx).await.map_err(|_|"Cannot check native revision")?;
    if count!=1{return Err("Native connection changed during discovery".into());}
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(cache_key(&discovery.binding.provider_config_id)).bind(serde_json::to_string(discovery).map_err(|_|"Cannot serialize native discovery")?).bind(now().to_string()).execute(&mut *tx).await.map_err(|_|"Cannot save native discovery")?;
    tx.commit().await.map_err(|_|"Cannot commit native discovery".into())
}
pub async fn discover<S:SecretStore>(pool:&SqlitePool,store:&S,binding:Binding,selected:Option<String>)->Result<Discovery,String>{
    let c=current(pool,&binding).await?;
    let secret=if c.auth_mode=="bearer"{Some(store.read(c.credential_id.as_deref().ok_or("Missing native credential")?,&c.base_url).map_err(|_|"Native credential is missing or bound to another endpoint")?)}else{None};
    ensure_metadata_has_no_secret(&c,secret.as_deref())?;
    let result=probe(&discovery_client()?,binding,selected,secret.as_deref()).await?;cache(pool,&result).await?;Ok(result)
}
pub async fn recover<S:SecretStore>(pool:&SqlitePool,store:&S)->Result<(),String>{
    let rows=sqlx::query("SELECT key,value FROM app_settings WHERE key LIKE 'native.secret.staging.v1.%'").fetch_all(pool).await.map_err(|_|"Cannot inspect staged native credentials")?;
    for row in rows {
        let key:String=row.get("key");let value:String=row.get("value");let v:Value=serde_json::from_str(&value).map_err(|_|"Invalid native credential journal")?;
        if v["expiresAtMs"].as_u64().is_some_and(|t|t<=now()){
            let id=v["credentialId"].as_str().filter(|s|s.starts_with("native_credential_")).ok_or("Invalid staged native credential id")?;
            let mut tx=pool.begin_with("BEGIN IMMEDIATE").await.map_err(|_|"Cannot acquire native recovery transaction")?;
            let still_current:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(&key).fetch_optional(&mut *tx).await.map_err(|_|"Cannot recheck native journal")?;
            if still_current.as_deref()!=Some(value.as_str()){continue;}
            let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM provider_configs WHERE credential_id=$1").bind(id).fetch_one(&mut *tx).await.map_err(|_|"Cannot check staged credential")?;
            if count==0 {store.remove(id).map_err(|_|"Cannot clean staged native credential")?;}
            sqlx::query("DELETE FROM app_settings WHERE key=$1 AND value=$2").bind(key).bind(value).execute(&mut *tx).await.map_err(|_|"Cannot settle native credential journal")?;
            tx.commit().await.map_err(|_|"Cannot commit native credential recovery")?;
        }
    }Ok(())
}
pub async fn list<S:SecretStore>(pool:&SqlitePool,store:&S)->Result<Vec<View>,String>{
    recover(pool,store).await?;
    let ids:Vec<String>=sqlx::query_scalar("SELECT id FROM provider_configs WHERE provider='ollama_native' ORDER BY updated_at DESC,id").fetch_all(pool).await.map_err(|_|"Cannot list native connections")?;
    let mut views=Vec::new();
    for id in ids {let connection=load(pool,&id).await?;let raw:Option<String>=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(cache_key(&id)).fetch_optional(pool).await.map_err(|_|"Cannot load discovery cache")?;
        let secret=if connection.auth_mode=="bearer"{Some(store.read(connection.credential_id.as_deref().ok_or("Missing native credential")?,&connection.base_url).map_err(|_|"Cannot verify native metadata against the bound credential")?)}else{None};
        ensure_metadata_has_no_secret(&connection,secret.as_deref())?;
        // Do not re-expose a cache contaminated before this validation existed.
        let discovery=raw.and_then(|s|serde_json::from_str::<Discovery>(&s).ok()).filter(|d|verify_binding(&connection.stored(),&d.binding).is_ok() && ensure_metadata_has_no_secret(d,secret.as_deref()).is_ok());views.push(View{connection,discovery});}
    Ok(views)
}
pub async fn save<S:SecretStore>(pool:&SqlitePool,store:&S,input:SaveInput)->Result<View,String>{
    let endpoint=normalize_endpoint(&input.base_url)?;
    if !safe_text(input.label.trim()) || !matches!(input.auth_mode.as_str(),"none"|"bearer"){return Err("Native label and explicit authentication mode are required".into());}
    if is_cloud_endpoint(&endpoint) && input.auth_mode!="bearer" {return Err("Ollama Cloud requires Bearer authentication".into());}
    if input.auth_mode=="none" && input.api_key.as_ref().is_some_and(|s|!s.is_empty()){return Err("Keyless mode must not carry a key".into());}
    let old=if let Some(binding)=&input.expected{Some(current(pool,binding).await?)}else{None};
    let explicit_key=input.api_key.as_ref().is_some_and(|s|!s.trim().is_empty());
    let secret=if input.auth_mode=="bearer"{
        match input.api_key.filter(|s|!s.trim().is_empty()) {Some(s)=>Some(s.trim().to_owned()),None=>{
            let c=old.as_ref().filter(|c|c.auth_mode=="bearer").ok_or("A Bearer API key is required")?;
            Some(store.read(c.credential_id.as_deref().ok_or("Missing credential")?,&c.base_url).map_err(|_|"Cannot read the bound native API key")?)}}
    }else{None};
    if secret.as_ref().is_some_and(|s|s.len()>16384 || s.contains(['\r','\n'])){return Err("Invalid native API key or label".into());}
    ensure_metadata_has_no_secret(&json!({"label":&input.label,"baseUrl":&input.base_url,"normalizedEndpoint":&endpoint,"selectedModel":&input.selected_model,"expected":&input.expected}),secret.as_deref())?;
    let route_changed=old.as_ref().is_none_or(|o|o.base_url!=endpoint || o.auth_mode!=input.auth_mode || explicit_key);
    let c=Connection{id:old.as_ref().map(|o|o.id.clone()).unwrap_or(unique(pool,"native_provider").await?),provider:"ollama_native".into(),label:input.label.trim().into(),base_url:endpoint.clone(),auth_mode:input.auth_mode,credential_id:if secret.is_none(){None}else if !route_changed{old.as_ref().and_then(|o|o.credential_id.clone())}else{Some(unique(pool,"native_credential").await?)},connection_identity_id:old.as_ref().map(|o|o.connection_identity_id.clone()).unwrap_or(unique(pool,"connection_identity").await?),connection_revision:old.as_ref().map_or(1,|o|o.connection_revision+u64::from(route_changed)),enabled:false};
    if c.connection_revision>9_007_199_254_740_991{return Err("Native revision exhausted".into());}
    ensure_metadata_has_no_secret(&c,secret.as_deref())?;
    let discovery=probe(&discovery_client()?,c.binding(),input.selected_model,secret.as_deref()).await?;
    // A new immutable key record is staged; the old key and binding remain intact until DB commit.
    let journal=c.credential_id.as_ref().filter(|_|route_changed).map(|id|format!("native.secret.staging.v1.{id}"));
    if let (Some(id),Some(key))=(&c.credential_id,&journal){
        sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,$3)").bind(key).bind(json!({"credentialId":id,"expiresAtMs":now()+900_000}).to_string()).bind(now().to_string()).execute(pool).await.map_err(|_|"Cannot stage native credential")?;
    }
    let result=commit_save(pool,store,&c,&discovery,old.as_ref(),journal.as_deref(),secret.as_deref()).await;
    if result.is_err(){
        // Commit errors can be ambiguous. Never delete a key which a committed row may reference.
        return Err("Native settings save was not confirmed; reload settings before retrying. The saved binding is retained.".into());
    }
    Ok(View{connection:c,discovery:Some(discovery)})
}
async fn commit_save<S:SecretStore>(pool:&SqlitePool,store:&S,c:&Connection,d:&Discovery,old:Option<&Connection>,journal:Option<&str>,secret:Option<&str>)->Result<(),String>{
    let mut tx=pool.begin_with("BEGIN IMMEDIATE").await.map_err(|_|"Cannot begin native save")?;
    if let Some(old)=old {
        let current:Option<(String,i64)>=sqlx::query_as("SELECT connection_identity_id,connection_revision FROM provider_configs WHERE id=$1 AND provider='ollama_native' AND enabled=0").bind(&old.id).fetch_optional(&mut *tx).await.map_err(|_|"Cannot check current revision")?;
        if current!=Some((old.connection_identity_id.clone(),old.connection_revision as i64)){return Err("Stale native settings".into());}
    }
    if let Some(id)=c.credential_id.as_ref().filter(|_|journal.is_some()) {sqlx::query("INSERT INTO credentials_metadata(id,provider,label,created_at,updated_at) VALUES($1,'ollama_native',$2,$3,$3)").bind(id).bind(&c.label).bind(now().to_string()).execute(&mut *tx).await.map_err(|_|"Cannot store native credential metadata")?;}
    if let Some(key)=journal {
        let present:i64=sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key=$1").bind(key).fetch_one(&mut *tx).await.map_err(|_|"Cannot verify staged key")?;
        if present!=1{return Err("Staged native key was already recovered".into());}
        // The immediate transaction excludes recovery while the OS write is active.
        store.create(c.credential_id.as_deref().ok_or("Missing staged credential")?,secret.ok_or("Missing staged secret")?,&c.base_url).map_err(|_|"Cannot persist the native key in secure storage")?;
    }
    if old.is_some(){sqlx::query("UPDATE provider_configs SET label=$1,base_url=$2,auth_mode=$3,credential_id=$4,credential_hint=NULL,connection_revision=$5,last_status='ok',last_error=NULL,last_tested_at=$6,updated_at=$6 WHERE id=$7")
        .bind(&c.label).bind(&c.base_url).bind(&c.auth_mode).bind(&c.credential_id).bind(c.connection_revision as i64).bind(now().to_string()).bind(&c.id).execute(&mut *tx).await.map_err(|_|"Cannot update native settings")?;
    }else{sqlx::query("INSERT INTO provider_configs(id,provider,label,base_url,auth_mode,credential_id,connection_identity_id,connection_revision,enabled,last_status,last_tested_at,created_at,updated_at) VALUES($1,'ollama_native',$2,$3,$4,$5,$6,1,0,'ok',$7,$7,$7)")
        .bind(&c.id).bind(&c.label).bind(&c.base_url).bind(&c.auth_mode).bind(&c.credential_id).bind(&c.connection_identity_id).bind(now().to_string()).execute(&mut *tx).await.map_err(|_|"Cannot insert native settings")?;}
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(cache_key(&c.id)).bind(serde_json::to_string(d).map_err(|_|"Cannot serialize discovery")?).bind(now().to_string()).execute(&mut *tx).await.map_err(|_|"Cannot save model cache")?;
    if let Some(key)=journal{sqlx::query("DELETE FROM app_settings WHERE key=$1").bind(key).execute(&mut *tx).await.map_err(|_|"Cannot settle native journal")?;}
    tx.commit().await.map_err(|_|"Cannot commit native settings".into())
}

/// Explicit promotion of an already verified hosted account. The source record and key are immutable.
/// `store.read` reads the native source; `store.create` binds a fresh hosted credential.
pub async fn activate_cloud<S: SecretStore>(pool: &SqlitePool, store: &S, binding: Binding) -> Result<String, String> {
    recover(pool,store).await?;
    let old=current(pool,&binding).await?;
    if old.base_url!=CLOUD_BASE || old.auth_mode!="bearer" {return Err("Only a saved Ollama Cloud Bearer account can be activated".into());}
    let secret=store.read(old.credential_id.as_deref().ok_or("Missing Cloud key")?,CLOUD_BASE).map_err(|_|"Cannot read the saved Cloud key")?;
    ensure_metadata_has_no_secret(&old,Some(&secret))?;
    // Successful authorization/catalog test precedes every new activation. No generation is billed.
    cloud_catalog(&discovery_client()?,&secret).await?;
    commit_cloud_activation(pool,store,&old,&secret).await
}
async fn commit_cloud_activation<S: SecretStore>(pool:&SqlitePool,store:&S,old:&Connection,secret:&str)->Result<String,String>{
    let mapping=format!("ollama.cloud.activation.v1.{}.{}",old.id,old.connection_revision);
    let id=unique(pool,"cloud_provider").await?;let credential=unique(pool,"native_credential").await?;
    let journal=format!("native.secret.staging.v1.{credential}");
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,$3)").bind(&journal).bind(json!({"credentialId":credential,"expiresAtMs":now()+900_000}).to_string()).bind(now().to_string()).execute(pool).await.map_err(|_|"Cannot stage Cloud credential")?;
    let mut tx=pool.begin_with("BEGIN IMMEDIATE").await.map_err(|_|"Cannot begin Cloud activation")?;
    let source:Option<(String,i64,String)>=sqlx::query_as("SELECT connection_identity_id,connection_revision,base_url FROM provider_configs WHERE id=$1 AND provider='ollama_native' AND auth_mode='bearer' AND credential_id=$2").bind(&old.id).bind(&old.credential_id).fetch_optional(&mut *tx).await.map_err(|_|"Cannot verify Cloud source")?;
    if source!=Some((old.connection_identity_id.clone(),old.connection_revision as i64,CLOUD_BASE.into())){return Err("Cloud settings changed; reload before activating".into());}
    let existing:Option<String>=sqlx::query_scalar("SELECT c.id FROM app_settings a JOIN provider_configs c ON c.id=a.value WHERE a.key=$1 AND c.provider='ollama_cloud' AND c.enabled=1").bind(&mapping).fetch_optional(&mut *tx).await.map_err(|_|"Cannot inspect Cloud activation")?;
    if let Some(existing)=existing {
        sqlx::query("DELETE FROM app_settings WHERE key=$1").bind(&journal).execute(&mut *tx).await.map_err(|_|"Cannot settle Cloud activation")?;
        tx.commit().await.map_err(|_|"Cannot confirm existing Cloud activation")?;return Ok(existing);
    }
    let staged:i64=sqlx::query_scalar("SELECT COUNT(*) FROM app_settings WHERE key=$1").bind(&journal).fetch_one(&mut *tx).await.map_err(|_|"Cannot check Cloud staging")?;
    if staged!=1{return Err("Cloud staging expired; retry activation".into());}
    store.create(&credential,secret,CLOUD_BASE).map_err(|_|"Cannot save the hosted key in secure storage")?;
    let stamp:String=sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')").fetch_one(&mut *tx).await.map_err(|_|"Cannot timestamp Cloud activation")?;let fingerprint=format!("{:x}",Sha256::digest(secret.as_bytes()))[..16].to_owned();
    sqlx::query("INSERT INTO credentials_metadata(id,provider,label,fingerprint,created_at,updated_at) VALUES($1,'ollama_cloud',$2,$3,$4,$4)").bind(&credential).bind(&old.label).bind(fingerprint).bind(&stamp).execute(&mut *tx).await.map_err(|_|"Cannot save hosted credential metadata")?;
    sqlx::query("INSERT INTO provider_configs(id,provider,label,credential_id,base_url,enabled,last_status,last_tested_at,created_at,updated_at) VALUES($1,'ollama_cloud',$2,$3,$4,1,'ok',$5,$5,$5)").bind(&id).bind(&old.label).bind(&credential).bind(CLOUD_BASE).bind(&stamp).execute(&mut *tx).await.map_err(|_|"Cannot save hosted connection")?;
    sqlx::query("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(mapping).bind(&id).bind(&stamp).execute(&mut *tx).await.map_err(|_|"Cannot link hosted account")?;
    sqlx::query("DELETE FROM app_settings WHERE key=$1").bind(journal).execute(&mut *tx).await.map_err(|_|"Cannot settle hosted key")?;
    tx.commit().await.map_err(|_|"Cloud activation was not confirmed; reload and retry. The original account is retained.")?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc,Mutex};
    use tokio::io::{AsyncReadExt,AsyncWriteExt};
    #[derive(Default)] struct Vault(Mutex<HashMap<String,(String,String)>>);
    impl SecretStore for Vault {
        fn read(&self,id:&str,endpoint:&str)->Result<String,String>{self.0.lock().unwrap().get(id).filter(|(_,e)|e==endpoint).map(|(s,_)|s.clone()).ok_or("binding mismatch".into())}
        fn create(&self,id:&str,secret:&str,endpoint:&str)->Result<(),String>{self.0.lock().unwrap().insert(id.into(),(secret.into(),endpoint.into()));Ok(())}
        fn remove(&self,id:&str)->Result<(),String>{self.0.lock().unwrap().remove(id);Ok(())}
    }
    async fn db()->SqlitePool {
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        assert_eq!(crate::migrations::MIGRATION_SPECS.last().unwrap().version,crate::migrations::CURRENT_MIGRATION_VERSION);
        for m in crate::migrations::MIGRATION_SPECS {let mut tx=pool.begin().await.unwrap();sqlx::raw_sql(m.sql).execute(&mut *tx).await.unwrap();tx.commit().await.unwrap();}
        pool
    }
    type Traffic=Arc<Mutex<Vec<String>>>;
    async fn server(status:u16,show_status:u16)->(String,Traffic,tokio::task::JoinHandle<()>) {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let endpoint=format!("http://{}",listener.local_addr().unwrap());let seen=Arc::new(Mutex::new(Vec::new()));let traffic=seen.clone();
        let task=tokio::spawn(async move {loop {let (mut socket,_)=listener.accept().await.unwrap();let mut bytes=Vec::new();let mut block=[0u8;4096];loop {let n=socket.read(&mut block).await.unwrap();if n==0{break;}bytes.extend_from_slice(&block[..n]);if let Some(end)=bytes.windows(4).position(|w|w==b"\r\n\r\n") {let head=String::from_utf8_lossy(&bytes[..end]).to_lowercase();let length=head.lines().find_map(|l|l.strip_prefix("content-length: ").and_then(|s|s.parse::<usize>().ok())).unwrap_or(0);if bytes.len()>=end+4+length{break;}}}
            let request=String::from_utf8(bytes).unwrap();let path=request.lines().next().unwrap();
            let code=if path.contains("/api/show "){show_status}else{status};
            let body=if path.contains("/api/version "){json!({"version":"0.99.fixture"})}else if path.contains("/api/tags "){json!({"models":[{"name":"exact:tag","digest":"sha256:fixture"}]})}else{json!({"capabilities":["completion"],"model_info":{"general.architecture":"fixture","fixture.context_length":8192},"thinking":{"values":[true,false]},"renderer":"fixture"})}.to_string();
            traffic.lock().unwrap().push(request);socket.write_all(format!("HTTP/1.1 {code} Test\r\nContent-Length: {}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
        }});(endpoint,seen,task)
    }
    fn input(url:&str)->SaveInput {SaveInput{expected:None,label:"Native".into(),base_url:url.into(),auth_mode:"none".into(),api_key:None,selected_model:Some("exact:tag".into())}}
    #[tokio::test] async fn keyless_discovery_uses_only_native_routes_and_survives_reload() {
        let db=db().await;let vault=Vault::default();let(url,seen,task)=server(200,200).await;
        let v=save(&db,&vault,input(&url)).await.unwrap();assert!(!v.connection.enabled);assert!(vault.0.lock().unwrap().is_empty());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM credentials_metadata").fetch_one(&db).await.unwrap(),0);
        let reopened=list(&db,&vault).await.unwrap();let d=reopened[0].discovery.as_ref().unwrap();assert_eq!(d.selected_model.as_deref(),Some("exact:tag"));assert_eq!(d.details.as_ref().unwrap()["declaredContextTokens"],8192);assert_eq!(d.details.as_ref().unwrap()["contextAllocationVerified"],false);assert!(!d.generation_available);
        let requests=seen.lock().unwrap();assert_eq!(requests.len(),3);assert!(requests[0].starts_with("GET /api/version "));assert!(requests[1].starts_with("GET /api/tags "));assert!(requests[2].starts_with("POST /api/show "));assert!(requests[2].contains("\"model\":\"exact:tag\""));assert!(requests.iter().all(|r|!r.to_lowercase().contains("authorization:")));task.abort();
    }
    #[tokio::test] async fn bearer_endpoint_change_reuses_key_and_preserves_id_but_revises_binding() {
        let db=db().await;let vault=Vault::default();let(a,_,ta)=server(200,200).await;let(b,seen,tb)=server(200,200).await;
        let mut i=input(&a);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let first=save(&db,&vault,i).await.unwrap();
        let mut i=input(&b);i.expected=Some(first.connection.binding());i.auth_mode="bearer".into();let second=save(&db,&vault,i).await.unwrap();
        assert_eq!(first.connection.id,second.connection.id);assert_eq!(second.connection.connection_revision,2);assert_ne!(first.connection.credential_id,second.connection.credential_id);assert!(current(&db,&first.connection.binding()).await.is_err());
        assert!(seen.lock().unwrap().iter().all(|r|r.contains("authorization: Bearer fixture-secret")));assert!(!serde_json::to_string(&second).unwrap().contains("fixture-secret"));
        assert!(vault.read(first.connection.credential_id.as_ref().unwrap(),&a).is_ok());assert!(vault.read(second.connection.credential_id.as_ref().unwrap(),&b).is_ok());ta.abort();tb.abort();
    }
    #[tokio::test] async fn authentication_failure_and_invalid_url_preserve_old_record() {
        let db=db().await;let vault=Vault::default();let(a,_,ta)=server(200,200).await;let(b,seen,tb)=server(401,200).await;
        let mut original=input(&a);original.auth_mode="bearer".into();original.api_key=Some("fixture-secret".into());let first=save(&db,&vault,original).await.unwrap();let mut i=input(&b);i.expected=Some(first.connection.binding());i.auth_mode="bearer".into();assert!(save(&db,&vault,i).await.is_err());assert_eq!(seen.lock().unwrap().len(),1);assert!(seen.lock().unwrap()[0].contains("authorization: Bearer fixture-secret"));assert_eq!(load(&db,&first.connection.id).await.unwrap().auth_mode,"bearer");assert_eq!(load(&db,&first.connection.id).await.unwrap().base_url,a);
        let mut i=input("http://remote.invalid/api/chat");i.expected=Some(first.connection.binding());assert!(save(&db,&vault,i).await.is_err());assert_eq!(load(&db,&first.connection.id).await.unwrap().base_url,a);ta.abort();tb.abort();
    }
    #[tokio::test] async fn show_unavailable_and_missing_model_are_explicit_and_retained() {
        let db=db().await;let vault=Vault::default();let(url,seen,task)=server(200,404).await;
        let v=save(&db,&vault,input(&url)).await.unwrap();assert!(v.discovery.as_ref().unwrap().details_unavailable);
        let d=discover(&db,&vault,v.connection.binding(),Some("absent:exact".into())).await.unwrap();assert!(!d.selected_available);assert_eq!(d.selected_model.as_deref(),Some("absent:exact"));assert!(d.details.is_none());assert_eq!(seen.lock().unwrap().len(),5);task.abort();
    }
    #[tokio::test] async fn database_failure_keeps_old_binding_and_recovers_only_orphaned_key() {
        let db=db().await;let vault=Vault::default();let(a,_,ta)=server(200,200).await;let(b,_,tb)=server(200,200).await;
        let mut i=input(&a);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let old=save(&db,&vault,i).await.unwrap();
        sqlx::raw_sql("CREATE TRIGGER fail_native_update BEFORE UPDATE ON provider_configs BEGIN SELECT RAISE(ABORT,'injected'); END;").execute(&db).await.unwrap();
        let mut i=input(&b);i.expected=Some(old.connection.binding());i.auth_mode="bearer".into();assert!(save(&db,&vault,i).await.is_err());assert_eq!(load(&db,&old.connection.id).await.unwrap().base_url,a);assert_eq!(vault.0.lock().unwrap().len(),2);
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.expiresAtMs',0) WHERE key LIKE 'native.secret.staging.v1.%'").execute(&db).await.unwrap();recover(&db,&vault).await.unwrap();assert_eq!(vault.0.lock().unwrap().len(),1);assert!(vault.read(old.connection.credential_id.as_ref().unwrap(),&a).is_ok());assert_eq!(list(&db,&vault).await.unwrap()[0].discovery.as_ref().unwrap().binding.normalized_endpoint,a);ta.abort();tb.abort();
    }
    #[tokio::test] async fn forged_none_and_stale_bindings_fail_before_network() {
        let db=db().await;let vault=Vault::default();let(url,seen,task)=server(200,200).await;let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let v=save(&db,&vault,i).await.unwrap();
        let mut binding=v.connection.binding();binding.auth_mode="none".into();assert!(discover(&db,&vault,binding,None).await.is_err());assert_eq!(seen.lock().unwrap().len(),3);task.abort();
    }
    #[test] fn sensitive_metadata_is_rejected_recursively() {assert!(has_secret(&json!({"nested":[{"a":"echo fixture-secret"}]}),Some("fixture-secret")));assert!(has_secret(&json!({"fixture-secret":false}),Some("fixture-secret")));assert!(!has_secret(&json!({"model":"exact:tag"}),None));}
    #[tokio::test] async fn persisted_settings_reopen_from_disk_with_same_identity_model_and_bearer() {
        let path=std::env::temp_dir().join(format!("rvh-native-discovery-{}-{}.sqlite",std::process::id(),now()));
        let options=sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options.clone()).await.unwrap();
        for m in crate::migrations::MIGRATION_SPECS {let mut tx=pool.begin().await.unwrap();sqlx::raw_sql(m.sql).execute(&mut *tx).await.unwrap();tx.commit().await.unwrap();}
        let vault=Vault::default();let(url,seen,task)=server(200,200).await;let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let before=save(&pool,&vault,i).await.unwrap();pool.close().await;
        let reopened=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        let rows=list(&reopened,&vault).await.unwrap();assert_eq!(rows[0].connection.binding(),before.connection.binding());assert_eq!(rows[0].discovery.as_ref().unwrap().selected_model.as_deref(),Some("exact:tag"));
        discover(&reopened,&vault,rows[0].connection.binding(),rows[0].discovery.as_ref().unwrap().selected_model.clone()).await.unwrap();assert_eq!(seen.lock().unwrap().len(),6);assert!(seen.lock().unwrap().iter().all(|r|r.contains("authorization: Bearer fixture-secret")));reopened.close().await;std::fs::remove_file(path).unwrap();task.abort();
    }
    #[tokio::test] async fn failed_secure_store_write_preserves_old_connection_and_journal() {
        struct BrokenVault;impl SecretStore for BrokenVault {fn read(&self,_:&str,_:&str)->Result<String,String>{Err("failed".into())}fn create(&self,_:&str,_:&str,_:&str)->Result<(),String>{Err("failed".into())}fn remove(&self,_:&str)->Result<(),String>{Ok(())}}
        let pool=db().await;let(url,_,task)=server(200,200).await;let before=save(&pool,&Vault::default(),input(&url)).await.unwrap();let mut i=input(&url);i.expected=Some(before.connection.binding());i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());assert!(save(&pool,&BrokenVault,i).await.is_err());assert_eq!(load(&pool,&before.connection.id).await.unwrap().binding(),before.connection.binding());assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM credentials_metadata").fetch_one(&pool).await.unwrap(),0);assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM app_settings WHERE key LIKE 'native.secret.staging.v1.%'").fetch_one(&pool).await.unwrap(),1);task.abort();
    }
    #[tokio::test] async fn native_contract_failures_and_secret_echo_never_trigger_fallback() {
        for (status,body) in [(404,"{}".into()),(405,"{}".into()),(302,"{}".into()),(200,"not-json".into()),(200,json!({"error":"failed"}).to_string()),(200,json!({"version":"echo fixture-secret"}).to_string()),(200,"x".repeat(2*1024*1024+1))] {
            let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let endpoint=format!("http://{}",listener.local_addr().unwrap());
            let task=tokio::spawn(async move {let(mut socket,_)=listener.accept().await.unwrap();let mut bytes=[0;4096];let n=socket.read(&mut bytes).await.unwrap();let request=String::from_utf8_lossy(&bytes[..n]).into_owned();let _=socket.write_all(format!("HTTP/1.1 {status} Test\r\nLocation: https://must-not-follow.invalid\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await;request});
            let binding=Binding{version:1,provider:"ollama_native".into(),provider_config_id:"pending".into(),connection_identity_id:"identity".into(),connection_revision:1,normalized_endpoint:endpoint,auth_mode:"bearer".into()};
            let error=probe(&discovery_client().unwrap(),binding,None,Some("fixture-secret")).await.err().unwrap();assert!(!error.contains("fixture-secret"));let request=task.await.unwrap();assert!(request.starts_with("GET /api/version "));assert!(request.contains("authorization: Bearer fixture-secret"));
        }
    }

    #[tokio::test] async fn new_bearer_rejects_secret_in_model_or_endpoint_before_network_and_write() {
        for field in ["model","endpoint"] {
            let pool=db().await;let vault=Vault::default();let(url,seen,task)=server(200,200).await;
            let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());
            if field=="model" {i.selected_model=Some("prefix-fixture-secret-suffix".into());}else{i.base_url=format!("{url}/fixture-secret");}
            let result=save(&pool,&vault,i).await;
            assert!(result.is_err(),"secret-bearing metadata must be rejected");
            assert!(!result.err().unwrap().contains("fixture-secret"));
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM provider_configs").fetch_one(&pool).await.unwrap(),0);
            assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM app_settings").fetch_one(&pool).await.unwrap(),0);
            assert!(vault.0.lock().unwrap().is_empty());assert!(seen.lock().unwrap().is_empty());task.abort();
        }
    }
    #[tokio::test] async fn reused_bearer_save_rejection_preserves_connection_cache_and_key() {
        let pool=db().await;let vault=Vault::default();let(url,seen,task)=server(200,200).await;
        let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let original=save(&pool,&vault,i).await.unwrap();
        let before=serde_json::to_string(&list(&pool,&vault).await.unwrap()).unwrap();
        for field in ["model","endpoint","label"] {
            let mut i=input(&url);i.auth_mode="bearer".into();i.expected=Some(original.connection.binding());
            match field {"model"=>i.selected_model=Some("fixture-secret".into()),"endpoint"=>i.base_url=format!("{url}/fixture-secret"),_=>i.label="fixture-secret".into()}
            let result=save(&pool,&vault,i).await;assert!(result.is_err());assert!(!result.err().unwrap().contains("fixture-secret"));
            assert_eq!(serde_json::to_string(&list(&pool,&vault).await.unwrap()).unwrap(),before);
        }
        assert_eq!(seen.lock().unwrap().len(),3);assert_eq!(vault.0.lock().unwrap().len(),1);task.abort();
    }
    #[tokio::test] async fn discover_rejects_reused_secret_model_without_changing_saved_cache() {
        let pool=db().await;let vault=Vault::default();let(url,seen,task)=server(200,200).await;
        let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let original=save(&pool,&vault,i).await.unwrap();
        let before:String=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(cache_key(&original.connection.id)).fetch_one(&pool).await.unwrap();
        let result=discover(&pool,&vault,original.connection.binding(),Some("fixture-secret".into())).await;assert!(result.is_err());assert!(!result.err().unwrap().contains("fixture-secret"));
        let after:String=sqlx::query_scalar("SELECT value FROM app_settings WHERE key=$1").bind(cache_key(&original.connection.id)).fetch_one(&pool).await.unwrap();assert_eq!(before,after);
        assert_eq!(seen.lock().unwrap().len(),3);assert!(!serde_json::to_string(&list(&pool,&vault).await.unwrap()).unwrap().contains("fixture-secret"));task.abort();
    }
    #[tokio::test] async fn list_does_not_return_a_previously_contaminated_discovery_cache() {
        let pool=db().await;let vault=Vault::default();let(url,_,task)=server(200,200).await;
        let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let original=save(&pool,&vault,i).await.unwrap();
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.selectedModel','fixture-secret') WHERE key=$1").bind(cache_key(&original.connection.id)).execute(&pool).await.unwrap();
        let rows=list(&pool,&vault).await.unwrap();assert!(!serde_json::to_string(&rows).unwrap().contains("fixture-secret"));assert!(rows[0].discovery.is_none());assert_eq!(rows[0].connection.binding(),original.connection.binding());
        sqlx::query("UPDATE provider_configs SET label='fixture-secret' WHERE id=$1").bind(&original.connection.id).execute(&pool).await.unwrap();
        let error=list(&pool,&vault).await.err().unwrap();assert!(!error.contains("fixture-secret"));
        vault.0.lock().unwrap().clear();let error=list(&pool,&vault).await.err().unwrap();assert!(!error.contains("fixture-secret"));task.abort();
    }
    async fn cloud_server(balance_status:u16,tags_status:u16,echo:bool)->(String,Traffic,tokio::task::JoinHandle<()>) {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let endpoint=format!("http://{}",listener.local_addr().unwrap());let seen=Arc::new(Mutex::new(Vec::new()));let traffic=seen.clone();
        let task=tokio::spawn(async move {loop{let(mut socket,_)=listener.accept().await.unwrap();let mut bytes=Vec::new();let mut block=[0;4096];loop{let n=socket.read(&mut block).await.unwrap();if n==0{break;}bytes.extend_from_slice(&block[..n]);if bytes.windows(4).any(|w|w==b"\r\n\r\n"){break;}}let request=String::from_utf8(bytes).unwrap();let balance=request.starts_with("GET /api/balance ");let code=if balance{balance_status}else{tags_status};
            let body=if echo{json!({"error":"fixture-secret"})}else if balance{json!({"included":{"balance_usd":12345},"purchased":{"balance_usd":67890}})}else{json!({"models":[{"name":"gemma4:31b"}]})}.to_string();traffic.lock().unwrap().push(request);socket.write_all(format!("HTTP/1.1 {code} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
        }});(endpoint,seen,task)
    }
    fn cloud_binding(endpoint:&str)->Binding{Binding{version:1,provider:"ollama_native".into(),provider_config_id:"cloud".into(),connection_identity_id:"identity".into(),connection_revision:1,normalized_endpoint:endpoint.into(),auth_mode:"bearer".into()}}
    #[tokio::test] async fn cloud_requires_real_bearer_and_never_downgrades_to_none(){
        let mut binding=cloud_binding(CLOUD_BASE);binding.auth_mode="none".into();assert!(probe(&discovery_client().unwrap(),binding,None,None).await.is_err());
        assert!(probe(&discovery_client().unwrap(),cloud_binding(CLOUD_BASE),None,None).await.is_err());
        let pool=db().await;let mut i=input(CLOUD_BASE);i.auth_mode="none".into();assert!(save(&pool,&Vault::default(),i).await.is_err());
        for endpoint in ["https://ollama.com.evil.invalid","https://evil.invalid/ollama.com","http://ollama.com","https://ollama.com:444","https://ollama.com/proxy"] {assert!(!is_cloud_endpoint(endpoint));}
        assert!(is_cloud_endpoint(&normalize_endpoint("HTTPS://OLLAMA.COM:443/").unwrap()));
    }
    #[tokio::test] async fn cloud_uses_balance_and_tags_without_local_endpoints_version_show_or_digest(){
        let(url,seen,task)=cloud_server(200,200,false).await;
        let result=probe_contract(&discovery_client().unwrap(),cloud_binding(&url),Some("gemma4:31b".into()),Some("fixture-secret"),true).await.unwrap();
        assert_eq!(result.server_version,None);assert!(result.selected_available);assert_eq!(result.models[0].digest,None);assert_eq!(result.selected_model.as_deref(),Some("gemma4:31b"));assert_eq!(result.details.as_ref().unwrap()["metadataSource"],"cloud_tags");assert!(!result.generation_available);
        let output=serde_json::to_string(&result).unwrap();for private in ["fixture-secret","balance_usd","allowance_usd"]{assert!(!output.contains(private));}
        let requests=seen.lock().unwrap();assert_eq!(requests.len(),2);assert!(requests[0].starts_with("GET /api/balance "));assert!(requests[1].starts_with("GET /api/tags "));assert!(requests.iter().all(|r|r.contains("authorization: Bearer fixture-secret")));task.abort();
    }
    #[tokio::test] async fn cloud_auth_failures_and_catalog_errors_do_not_fallback_or_generate(){
        for (balance,tags,requests) in [(401,200,1),(403,200,1),(429,200,1),(404,200,1),(200,404,2),(200,405,2),(200,500,2)] {
            let(url,seen,task)=cloud_server(balance,tags,false).await;let error=probe_contract(&discovery_client().unwrap(),cloud_binding(&url),None,Some("fixture-secret"),true).await.err().unwrap();assert!(!error.contains("fixture-secret"));assert_eq!(seen.lock().unwrap().len(),requests);task.abort();
        }
    }
    #[tokio::test] async fn cloud_preserves_absent_exact_model_and_rejects_secret_metadata(){
        let(url,seen,task)=cloud_server(200,200,false).await;let client=discovery_client().unwrap();
        let absent=probe_contract(&client,cloud_binding(&url),Some("gemma4:cloud".into()),Some("fixture-secret"),true).await.unwrap();assert!(!absent.selected_available);assert_eq!(absent.selected_model.as_deref(),Some("gemma4:cloud"));assert!(absent.details.is_none());
        let error=probe_contract(&client,cloud_binding(&url),Some("fixture-secret".into()),Some("fixture-secret"),true).await.err().unwrap();assert!(!error.contains("fixture-secret"));assert_eq!(seen.lock().unwrap().len(),2);task.abort();
        let(url,_,task)=cloud_server(200,200,true).await;let error=probe_contract(&client,cloud_binding(&url),None,Some("fixture-secret"),true).await.err().unwrap();assert!(!error.contains("fixture-secret"));task.abort();
    }

    #[tokio::test] async fn cloud_activation_commit_is_idempotent_and_keeps_source_key() {
        let pool=db().await;let vault=Vault::default();let (url,_,task)=server(200,200).await;
        let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());
        let mut old=save(&pool,&vault,i).await.unwrap().connection;
        sqlx::query("UPDATE provider_configs SET base_url=$1 WHERE id=$2").bind(CLOUD_BASE).bind(&old.id).execute(&pool).await.unwrap();old.base_url=CLOUD_BASE.into();
        let first=commit_cloud_activation(&pool,&vault,&old,"fixture-secret").await.unwrap();
        assert_eq!(commit_cloud_activation(&pool,&vault,&old,"fixture-secret").await.unwrap(),first);
        let target:String=sqlx::query_scalar("SELECT credential_id FROM provider_configs WHERE id=$1 AND provider='ollama_cloud'").bind(&first).fetch_one(&pool).await.unwrap();
        let stamp:String=sqlx::query_scalar("SELECT last_tested_at FROM provider_configs WHERE id=$1").bind(&first).fetch_one(&pool).await.unwrap();assert!(stamp.contains('T')&&stamp.ends_with('Z'));
        assert_ne!(Some(target.as_str()),old.credential_id.as_deref());assert_eq!(vault.read(&target,CLOUD_BASE).unwrap(),"fixture-secret");assert_eq!(load(&pool,&old.id).await.unwrap().binding(),old.binding());assert_eq!(vault.0.lock().unwrap().len(),2);
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM app_settings WHERE key LIKE 'native.secret.staging.v1.%'").fetch_one(&pool).await.unwrap(),0);task.abort();
    }
    #[tokio::test] async fn failed_cloud_activation_rolls_back_and_recovery_removes_only_orphan_key() {
        let pool=db().await;let vault=Vault::default();let (url,_,task)=server(200,200).await;
        let mut i=input(&url);i.auth_mode="bearer".into();i.api_key=Some("fixture-secret".into());let mut old=save(&pool,&vault,i).await.unwrap().connection;
        sqlx::query("UPDATE provider_configs SET base_url=$1 WHERE id=$2").bind(CLOUD_BASE).bind(&old.id).execute(&pool).await.unwrap();old.base_url=CLOUD_BASE.into();
        sqlx::raw_sql("CREATE TRIGGER fail_cloud BEFORE INSERT ON provider_configs WHEN NEW.provider='ollama_cloud' BEGIN SELECT RAISE(ABORT,'injected'); END").execute(&pool).await.unwrap();
        assert!(commit_cloud_activation(&pool,&vault,&old,"fixture-secret").await.is_err());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM provider_configs WHERE provider='ollama_cloud'").fetch_one(&pool).await.unwrap(),0);
        sqlx::query("UPDATE app_settings SET value=json_set(value,'$.expiresAtMs',0) WHERE key LIKE 'native.secret.staging.v1.%'").execute(&pool).await.unwrap();recover(&pool,&vault).await.unwrap();assert_eq!(vault.0.lock().unwrap().len(),1);assert_eq!(load(&pool,&old.id).await.unwrap().binding(),old.binding());task.abort();
    }

}
