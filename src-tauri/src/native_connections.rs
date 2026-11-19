//! Pending native connection settings and discovery; generation remains disabled.
use serde::Serialize;
use sqlx::Row;
use tauri::State;
use tauri_plugin_sql::DbInstances;
use crate::native_connection_identity::{Binding, StoredConnection, verify_binding};

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct PendingBindingMetadata { binding: Binding, generation_available: bool }

#[tauri::command]
pub async fn native_connection_binding(instances: State<'_, DbInstances>, binding: Binding) -> Result<PendingBindingMetadata,String> {
    let pool=crate::database::sqlite_pool(&instances).await?;
    let row=sqlx::query("SELECT id,provider,base_url,auth_mode,credential_id,credential_hint,connection_identity_id,connection_revision,enabled FROM provider_configs WHERE id=$1")
        .bind(&binding.provider_config_id).fetch_optional(&pool).await.map_err(|_|"Cannot inspect saved native connection")?.ok_or("Native connection not found")?;
    let stored=StoredConnection {id:row.try_get("id").map_err(|_|"Invalid connection row")?,provider:row.try_get("provider").map_err(|_|"Invalid connection row")?,endpoint:row.try_get("base_url").map_err(|_|"Invalid connection row")?,auth_mode:row.try_get("auth_mode").map_err(|_|"Invalid connection row")?,credential_id:row.try_get("credential_id").map_err(|_|"Invalid connection row")?,credential_hint:row.try_get("credential_hint").map_err(|_|"Invalid connection row")?,identity_id:row.try_get("connection_identity_id").map_err(|_|"Invalid connection row")?,revision:u64::try_from(row.try_get::<i64,_>("connection_revision").map_err(|_|"Invalid connection revision")?).map_err(|_|"Invalid connection revision")?,enabled:row.try_get::<i64,_>("enabled").map_err(|_|"Invalid connection row")?!=0};
    Ok(PendingBindingMetadata { binding:verify_binding(&stored,&binding)?,generation_available:false })
}

struct NativeOsSecrets;
impl crate::native_connection_settings::SecretStore for NativeOsSecrets {
    fn read(&self,id:&str,endpoint:&str)->Result<String,String>{crate::secrets::get_credential_for_binding(id,"ollama_native",endpoint)}
    fn create(&self,id:&str,secret:&str,endpoint:&str)->Result<(),String>{crate::secrets::store_new_bound_credential(id,secret,"ollama_native",endpoint)}
    fn remove(&self,id:&str)->Result<(),String>{crate::secrets::remove_staged_native_credential(id)}
}
#[tauri::command]
pub async fn native_connection_list(instances:State<'_,DbInstances>)->Result<Vec<crate::native_connection_settings::View>,String>{
    let pool=crate::database::sqlite_pool(&instances).await?;
    crate::native_connection_settings::list(&pool,&NativeOsSecrets).await
}
#[tauri::command]
pub async fn native_connection_save(instances:State<'_,DbInstances>,input:crate::native_connection_settings::SaveInput)->Result<crate::native_connection_settings::View,String>{
    let pool=crate::database::sqlite_pool(&instances).await?;
    crate::native_connection_settings::save(&pool,&NativeOsSecrets,input).await
}
#[tauri::command]
pub async fn native_connection_discover(instances:State<'_,DbInstances>,binding:Binding,selected_model:Option<String>)->Result<crate::native_connection_settings::Discovery,String>{
    let pool=crate::database::sqlite_pool(&instances).await?;
    crate::native_connection_settings::discover(&pool,&NativeOsSecrets,binding,selected_model).await
}

#[tauri::command]
pub async fn native_connection_generation_settings(instances:State<'_,DbInstances>,binding:Binding,model:String)->Result<crate::native_generation_settings::State,String>{
    let pool=crate::database::sqlite_pool(&instances).await?;
    crate::native_generation_settings::get(&pool,&NativeOsSecrets,binding,model).await
}
#[tauri::command]
pub async fn native_connection_save_generation_settings(instances:State<'_,DbInstances>,draft:crate::native_generation_settings::Draft)->Result<crate::native_generation_settings::State,String>{
    let pool=crate::database::sqlite_pool(&instances).await?;
    crate::native_generation_settings::save(&pool,&NativeOsSecrets,draft).await
}

struct CloudActivationSecrets;
impl crate::native_connection_settings::SecretStore for CloudActivationSecrets {
    fn read(&self,id:&str,endpoint:&str)->Result<String,String>{crate::secrets::get_credential_for_binding(id,"ollama_native",endpoint)}
    fn create(&self,id:&str,secret:&str,endpoint:&str)->Result<(),String>{crate::secrets::store_new_bound_credential(id,secret,"ollama_cloud",endpoint)}
    fn remove(&self,id:&str)->Result<(),String>{crate::secrets::remove_staged_native_credential(id)}
}
#[tauri::command]
pub async fn activate_ollama_cloud(instances:State<'_,DbInstances>,binding:Binding)->Result<String,String>{
    let pool=crate::database::sqlite_pool(&instances).await?;
    crate::native_connection_settings::activate_cloud(&pool,&CloudActivationSecrets,binding).await
}
