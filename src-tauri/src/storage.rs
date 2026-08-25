use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{sqlite::{SqliteConnectOptions, SqliteConnection}, Connection, Row};
use tauri::Manager;

const BACKUP_SCHEMA_VERSION: u8 = 1;
const DATABASE_FILE_NAME: &str = "rv_harness.db";
const CURRENT_MIGRATION_VERSION: i64 = 19;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupIdRequest {
    backup_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableBackupRequest {
    backup_id: String,
    directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableRestoreRequest {
    directory: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePaths {
    database_path: String,
    artifacts_path: String,
    backups_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedBackup {
    backup_id: String,
    directory: String,
    database_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArtifact {
    relative_path: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    schema_version: u8,
    #[serde(default = "current_application_version")]
    application_version: String,
    backup_id: String,
    created_at_unix_ms: u64,
    database_sha256: String,
    database_size_bytes: u64,
    artifacts: Vec<BackupArtifact>,
    secrets_included: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    backup_id: String,
    directory: String,
    created_at_unix_ms: u64,
    database_sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    backup_id: String,
    previous_database_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageExportResult {
    directory: String,
}

pub fn backup_database_before_migrations(app: &tauri::AppHandle) -> Result<(), String> {
    let source = database_path(app)?;
    if !source.is_file() {
        return Ok(());
    }
    let root = backup_root(app)?.join("pre_migration");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let marker = root.join(format!("v{}_complete", current_application_version().replace('.', "_")));
    if marker.is_file() {
        return Ok(());
    }

    let timestamp = unix_ms()?;
    let directory = root.join(format!("before_v{}_{}", current_application_version().replace('.', "_"), timestamp));
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    for (name, path) in [
        (DATABASE_FILE_NAME.to_string(), source.clone()),
        (format!("{DATABASE_FILE_NAME}-wal"), PathBuf::from(format!("{}-wal", source.to_string_lossy()))),
        (format!("{DATABASE_FILE_NAME}-shm"), PathBuf::from(format!("{}-shm", source.to_string_lossy()))),
    ] {
        if !path.is_file() { continue; }
        let destination = directory.join(&name);
        fs::copy(&path, &destination).map_err(|error| error.to_string())?;
        files.push(json!({
            "fileName": name,
            "sha256": sha256_file(&destination)?,
            "sizeBytes": fs::metadata(&destination).map_err(|error| error.to_string())?.len(),
        }));
    }
    if files.is_empty() {
        let _ = fs::remove_dir(&directory);
        return Err("pre-migration database backup did not copy any files".to_string());
    }
    let manifest = json!({
        "backupKind": "automatic_pre_migration",
        "targetApplicationVersion": current_application_version(),
        "expectedPreviousMigrationVersion": 18,
        "createdAtUnixMs": timestamp,
        "files": files,
        "secretsIncluded": false,
    });
    fs::write(directory.join("manifest.json"), serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    fs::write(marker, directory.to_string_lossy().as_bytes()).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn storage_paths(app: tauri::AppHandle) -> Result<StoragePaths, String> {
    let database_path = database_path(&app)?;
    let artifacts_path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("artifacts");
    let backups_path = backup_root(&app)?;
    Ok(StoragePaths {
        database_path: database_path.to_string_lossy().to_string(),
        artifacts_path: artifacts_path.to_string_lossy().to_string(),
        backups_path: backups_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn validate_live_database(app: tauri::AppHandle) -> Result<(), String> {
    let path = database_path(&app)?;
    let migration_version = validate_sqlite_database(&path).await?;
    if migration_version != CURRENT_MIGRATION_VERSION {
        return Err(format!(
            "database migration validation failed: expected version {CURRENT_MIGRATION_VERSION}, found {migration_version}"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn prepare_backup(app: tauri::AppHandle) -> Result<PreparedBackup, String> {
    let root = backup_root(&app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let backup_id = format!("backup_{}", unix_ms()?);
    validate_backup_id(&backup_id)?;
    let directory = root.join(&backup_id);
    if directory.exists() {
        return Err("backup id collision".to_string());
    }
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    Ok(PreparedBackup {
        backup_id,
        database_path: directory.join(DATABASE_FILE_NAME).to_string_lossy().to_string(),
        directory: directory.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn prepare_portable_backup(destination_root: String) -> Result<PreparedBackup, String> {
    let root = fs::canonicalize(PathBuf::from(destination_root)).map_err(|_| "selected backup folder does not exist".to_string())?;
    if !root.is_dir() {
        return Err("selected backup path is not a folder".to_string());
    }
    let backup_id = format!("backup_{}", unix_ms()?);
    validate_backup_id(&backup_id)?;
    let directory = root.join(format!("AI_RV_Harness_{backup_id}"));
    if directory.exists() {
        return Err("backup folder collision".to_string());
    }
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    Ok(PreparedBackup {
        backup_id,
        database_path: directory.join(DATABASE_FILE_NAME).to_string_lossy().to_string(),
        directory: directory.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn finalize_backup(app: tauri::AppHandle, request: BackupIdRequest) -> Result<BackupRecord, String> {
    validate_backup_id(&request.backup_id)?;
    let directory = backup_directory(&app, &request.backup_id)?;
    let database = directory.join(DATABASE_FILE_NAME);
    if !database.is_file() {
        return Err("backup database snapshot is missing".to_string());
    }
    let database_size_bytes = fs::metadata(&database).map_err(|error| error.to_string())?.len();
    let database_sha256 = sha256_file(&database)?;
    let source_artifacts = app.path().app_data_dir().map_err(|error| error.to_string())?.join("artifacts");
    let destination_artifacts = directory.join("artifacts");
    let mut artifacts = Vec::new();
    if source_artifacts.exists() {
        copy_artifacts(&source_artifacts, &source_artifacts, &destination_artifacts, &mut artifacts)?;
    }
    let manifest = BackupManifest {
        schema_version: BACKUP_SCHEMA_VERSION,
        application_version: current_application_version(),
        backup_id: request.backup_id.clone(),
        created_at_unix_ms: unix_ms()?,
        database_sha256: database_sha256.clone(),
        database_size_bytes,
        artifacts,
        secrets_included: false,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(directory.join("manifest.json"), manifest_bytes).map_err(|error| error.to_string())?;
    Ok(record_from_manifest(&directory, &manifest))
}

#[tauri::command]
pub fn finalize_portable_backup(app: tauri::AppHandle, request: PortableBackupRequest) -> Result<BackupRecord, String> {
    validate_backup_id(&request.backup_id)?;
    let directory = fs::canonicalize(PathBuf::from(&request.directory)).map_err(|_| "portable backup folder is missing".to_string())?;
    let expected_folder_name = format!("AI_RV_Harness_{}", request.backup_id);
    if !directory.is_dir() || directory.file_name().and_then(|value| value.to_str()) != Some(expected_folder_name.as_str()) {
        return Err("portable backup folder does not match its identifier".to_string());
    }
    let database = directory.join(DATABASE_FILE_NAME);
    if !database.is_file() {
        return Err("backup database snapshot is missing".to_string());
    }
    let database_size_bytes = fs::metadata(&database).map_err(|error| error.to_string())?.len();
    let database_sha256 = sha256_file(&database)?;
    let source_artifacts = app.path().app_data_dir().map_err(|error| error.to_string())?.join("artifacts");
    let destination_artifacts = directory.join("artifacts");
    let mut artifacts = Vec::new();
    if source_artifacts.exists() {
        copy_artifacts(&source_artifacts, &source_artifacts, &destination_artifacts, &mut artifacts)?;
    }
    let manifest = BackupManifest {
        schema_version: BACKUP_SCHEMA_VERSION,
        application_version: current_application_version(),
        backup_id: request.backup_id,
        created_at_unix_ms: unix_ms()?,
        database_sha256,
        database_size_bytes,
        artifacts,
        secrets_included: false,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(directory.join("manifest.json"), manifest_bytes).map_err(|error| error.to_string())?;
    Ok(record_from_manifest(&directory, &manifest))
}

#[tauri::command]
pub async fn inspect_portable_backup(directory: String) -> Result<BackupRecord, String> {
    let (directory, manifest) = validated_portable_backup(&directory)?;
    validate_sqlite_database(&directory.join(DATABASE_FILE_NAME)).await?;
    Ok(record_from_manifest(&directory, &manifest))
}

#[tauri::command]
pub fn discard_portable_backup(request: PortableBackupRequest) -> Result<(), String> {
    validate_backup_id(&request.backup_id)?;
    let directory = fs::canonicalize(PathBuf::from(&request.directory)).map_err(|_| "portable backup folder is missing".to_string())?;
    let expected_folder_name = format!("AI_RV_Harness_{}", request.backup_id);
    if !directory.is_dir() || directory.file_name().and_then(|value| value.to_str()) != Some(expected_folder_name.as_str()) {
        return Err("portable backup folder does not match its identifier".to_string());
    }
    if directory.join("manifest.json").exists() {
        return Err("a completed portable backup cannot be discarded".to_string());
    }
    fs::remove_dir_all(directory).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn discard_backup(app: tauri::AppHandle, request: BackupIdRequest) -> Result<(), String> {
    validate_backup_id(&request.backup_id)?;
    let directory = backup_directory(&app, &request.backup_id)?;
    if directory.exists() && !directory.join("manifest.json").exists() {
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_storage_backups(app: tauri::AppHandle) -> Result<Vec<BackupRecord>, String> {
    let root = backup_root(&app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }
        let manifest = read_manifest(&manifest_path)?;
        let entry_name = entry.file_name().to_string_lossy().to_string();
        if validate_backup_id(&manifest.backup_id).is_err()
            || manifest.backup_id != entry_name
            || manifest.schema_version != BACKUP_SCHEMA_VERSION
            || manifest.secrets_included
        {
            continue;
        }
        records.push(record_from_manifest(&entry.path(), &manifest));
    }
    records.sort_by(|a, b| b.created_at_unix_ms.cmp(&a.created_at_unix_ms));
    Ok(records)
}

#[tauri::command]
pub fn export_storage_backup(app: tauri::AppHandle, request: BackupIdRequest) -> Result<StorageExportResult, String> {
    validate_backup_id(&request.backup_id)?;
    let source = backup_directory(&app, &request.backup_id)?;
    let manifest = read_manifest(&source.join("manifest.json"))?;
    if manifest.schema_version != BACKUP_SCHEMA_VERSION || manifest.backup_id != request.backup_id || manifest.secrets_included {
        return Err("backup manifest is invalid or unsupported".to_string());
    }
    if sha256_file(&source.join(DATABASE_FILE_NAME))? != manifest.database_sha256 {
        return Err("backup database integrity check failed".to_string());
    }
    for artifact in &manifest.artifacts {
        let relative = safe_relative(&artifact.relative_path)?;
        let source_artifact = source.join("artifacts").join(relative);
        if !source_artifact.is_file() || sha256_file(&source_artifact)? != artifact.sha256 {
            return Err("backup artifact integrity check failed".to_string());
        }
    }
    let export_root = app.path().app_data_dir().map_err(|error| error.to_string())?.join("exports").join("storage");
    fs::create_dir_all(&export_root).map_err(|error| error.to_string())?;
    let destination = export_root.join(format!("RV_Harness_Storage_{}", unix_ms()?));
    fs::create_dir(&destination).map_err(|error| error.to_string())?;
    copy_directory(&source, &source, &destination)?;
    Ok(StorageExportResult { directory: destination.to_string_lossy().to_string() })
}

#[tauri::command]
pub async fn restore_backup(app: tauri::AppHandle, request: BackupIdRequest) -> Result<RestoreResult, String> {
    validate_backup_id(&request.backup_id)?;
    let directory = backup_directory(&app, &request.backup_id)?;
    let manifest = read_manifest(&directory.join("manifest.json"))?;
    if manifest.schema_version != BACKUP_SCHEMA_VERSION || manifest.backup_id != request.backup_id || manifest.secrets_included {
        return Err("backup manifest is invalid or unsupported".to_string());
    }
    let source_database = directory.join(DATABASE_FILE_NAME);
    if sha256_file(&source_database)? != manifest.database_sha256 {
        return Err("backup database integrity check failed".to_string());
    }
    validate_sqlite_database(&source_database).await?;
    for artifact in &manifest.artifacts {
        let relative = safe_relative(&artifact.relative_path)?;
        let source = directory.join("artifacts").join(&relative);
        if !source.is_file() || sha256_file(&source)? != artifact.sha256 {
            return Err("backup artifact integrity check failed".to_string());
        }
    }

    // Artifact restore is additive. Extra current artifacts are retained so restore remains recoverable.
    let destination_artifacts = app.path().app_data_dir().map_err(|error| error.to_string())?.join("artifacts");
    for artifact in &manifest.artifacts {
        let relative = safe_relative(&artifact.relative_path)?;
        let source = directory.join("artifacts").join(&relative);
        let destination = destination_artifacts.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source, destination).map_err(|error| error.to_string())?;
    }

    let destination_database = database_path(&app)?;
    if let Some(parent) = destination_database.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let restore_temp = destination_database.with_extension(format!("restore_{}.tmp", unix_ms()?));
    fs::copy(&source_database, &restore_temp).map_err(|error| error.to_string())?;
    if sha256_file(&restore_temp)? != manifest.database_sha256 {
        let _ = fs::remove_file(&restore_temp);
        return Err("restored database copy failed integrity check".to_string());
    }
    validate_sqlite_database(&restore_temp).await.map_err(|error| {
        let _ = fs::remove_file(&restore_temp);
        error
    })?;

    let safety_suffix = unix_ms()?;
    let previous_database = destination_database.with_file_name(format!("rv_harness.pre_restore_{safety_suffix}.db"));
    let mut previous_database_path = None;
    if destination_database.exists() {
        fs::rename(&destination_database, &previous_database).map_err(|error| error.to_string())?;
        previous_database_path = Some(previous_database.to_string_lossy().to_string());
    }
    if let Err(error) = fs::rename(&restore_temp, &destination_database) {
        if previous_database.exists() {
            let _ = fs::rename(&previous_database, &destination_database);
        }
        return Err(error.to_string());
    }
    preserve_sidecar(&destination_database, "-wal", safety_suffix)?;
    preserve_sidecar(&destination_database, "-shm", safety_suffix)?;

    Ok(RestoreResult { backup_id: request.backup_id, previous_database_path })
}

#[tauri::command]
pub async fn restore_portable_backup(app: tauri::AppHandle, request: PortableRestoreRequest) -> Result<RestoreResult, String> {
    let (directory, manifest) = validated_portable_backup(&request.directory)?;
    let source_database = directory.join(DATABASE_FILE_NAME);
    validate_sqlite_database(&source_database).await?;

    let destination_artifacts = app.path().app_data_dir().map_err(|error| error.to_string())?.join("artifacts");
    for artifact in &manifest.artifacts {
        let relative = safe_relative(&artifact.relative_path)?;
        let source = directory.join("artifacts").join(&relative);
        let destination = destination_artifacts.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source, destination).map_err(|error| error.to_string())?;
    }

    let destination_database = database_path(&app)?;
    if let Some(parent) = destination_database.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let restore_temp = destination_database.with_extension(format!("restore_{}.tmp", unix_ms()?));
    fs::copy(&source_database, &restore_temp).map_err(|error| error.to_string())?;
    if sha256_file(&restore_temp)? != manifest.database_sha256 {
        let _ = fs::remove_file(&restore_temp);
        return Err("restored database copy failed integrity check".to_string());
    }
    validate_sqlite_database(&restore_temp).await.map_err(|error| {
        let _ = fs::remove_file(&restore_temp);
        error
    })?;

    let safety_suffix = unix_ms()?;
    let previous_database = destination_database.with_file_name(format!("rv_harness.pre_restore_{safety_suffix}.db"));
    let mut previous_database_path = None;
    if destination_database.exists() {
        fs::rename(&destination_database, &previous_database).map_err(|error| error.to_string())?;
        previous_database_path = Some(previous_database.to_string_lossy().to_string());
    }
    if let Err(error) = fs::rename(&restore_temp, &destination_database) {
        if previous_database.exists() {
            let _ = fs::rename(&previous_database, &destination_database);
        }
        return Err(error.to_string());
    }
    preserve_sidecar(&destination_database, "-wal", safety_suffix)?;
    preserve_sidecar(&destination_database, "-shm", safety_suffix)?;

    Ok(RestoreResult { backup_id: manifest.backup_id, previous_database_path })
}

#[tauri::command]
pub fn open_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    open_directory(&directory)
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let directory = fs::canonicalize(PathBuf::from(path)).map_err(|_| "folder does not exist".to_string())?;
    if !directory.is_dir() {
        return Err("path is not a folder".to_string());
    }
    open_directory(&directory)
}

fn open_directory(directory: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command.arg(directory).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

fn backup_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("backups"))
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|error| error.to_string())?.join(DATABASE_FILE_NAME))
}

fn backup_directory(app: &tauri::AppHandle, backup_id: &str) -> Result<PathBuf, String> {
    validate_backup_id(backup_id)?;
    Ok(backup_root(app)?.join(backup_id))
}

fn validate_backup_id(value: &str) -> Result<(), String> {
    if value.len() < 8 || value.len() > 80 || !value.starts_with("backup_") || !value.chars().all(|character| character.is_ascii_alphanumeric() || character == '_') {
        return Err("invalid backup id".to_string());
    }
    Ok(())
}

fn validated_portable_backup(value: &str) -> Result<(PathBuf, BackupManifest), String> {
    let directory = fs::canonicalize(PathBuf::from(value)).map_err(|_| "selected backup folder does not exist".to_string())?;
    if !directory.is_dir() {
        return Err("selected backup path is not a folder".to_string());
    }
    let manifest = read_manifest(&directory.join("manifest.json"))?;
    validate_backup_id(&manifest.backup_id)?;
    if manifest.schema_version != BACKUP_SCHEMA_VERSION || manifest.secrets_included {
        return Err("backup manifest is invalid or unsupported".to_string());
    }
    let source_database = directory.join(DATABASE_FILE_NAME);
    if !source_database.is_file() || sha256_file(&source_database)? != manifest.database_sha256 {
        return Err("backup database integrity check failed".to_string());
    }
    for artifact in &manifest.artifacts {
        let relative = safe_relative(&artifact.relative_path)?;
        let source = directory.join("artifacts").join(&relative);
        if !source.is_file() || sha256_file(&source)? != artifact.sha256 {
            return Err("backup artifact integrity check failed".to_string());
        }
    }
    Ok((directory, manifest))
}

async fn validate_sqlite_database(path: &Path) -> Result<i64, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("backup database cannot be opened: {error}"))?;

    let integrity = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("backup database integrity check failed: {error}"))?;
    if integrity.len() != 1 || integrity[0].try_get::<String, _>(0).ok().as_deref() != Some("ok") {
        return Err("backup database failed SQLite integrity_check".to_string());
    }

    let foreign_key_violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("backup database foreign-key check failed: {error}"))?;
    if !foreign_key_violations.is_empty() {
        return Err("backup database contains foreign-key violations".to_string());
    }

    let rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('profiles','workspaces','rv_sessions','chat_threads','provider_configs')",
    )
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("backup database schema check failed: {error}"))?;
    if rows.len() != 5 {
        return Err("backup database is missing required RV Harness tables".to_string());
    }

    let migration_version = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("backup database migration-version check failed: {error}"))?
    .ok_or_else(|| "backup database has no successful migration record".to_string())?;
    if !(1..=CURRENT_MIGRATION_VERSION).contains(&migration_version) {
        return Err(format!(
            "backup database has unsupported migration version {migration_version}"
        ));
    }
    Ok(migration_version)
}

fn unix_ms() -> Result<u64, String> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis() as u64)
}

fn current_application_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 { break; }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn copy_artifacts(source_root: &Path, current: &Path, destination_root: &Path, records: &mut Vec<BackupArtifact>) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err("managed artifact store contains an unsupported symbolic link".to_string());
        }
        if file_type.is_dir() {
            copy_artifacts(source_root, &entry.path(), destination_root, records)?;
            continue;
        }
        if !file_type.is_file() { continue; }
        let relative = entry.path().strip_prefix(source_root).map_err(|error| error.to_string())?.to_path_buf();
        if relative.components().any(|component| !matches!(component, Component::Normal(_))) {
            return Err("invalid managed artifact path".to_string());
        }
        let destination = destination_root.join(&relative);
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::copy(entry.path(), &destination).map_err(|error| error.to_string())?;
        records.push(BackupArtifact {
            relative_path: relative.to_string_lossy().replace('\\', "/"),
            sha256: sha256_file(&destination)?,
            size_bytes: fs::metadata(&destination).map_err(|error| error.to_string())?.len(),
        });
    }
    Ok(())
}

fn safe_relative(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if value.is_empty() || path.is_absolute() || path.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("invalid backup artifact path".to_string());
    }
    Ok(path)
}

fn copy_directory(source_root: &Path, current: &Path, destination_root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() { return Err("backup contains an unsupported symbolic link".to_string()); }
        let relative = entry.path().strip_prefix(source_root).map_err(|error| error.to_string())?.to_path_buf();
        if relative.components().any(|component| !matches!(component, Component::Normal(_))) { return Err("invalid backup path".to_string()); }
        let destination = destination_root.join(relative);
        if file_type.is_dir() {
            fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
            copy_directory(source_root, &entry.path(), destination_root)?;
        } else if file_type.is_file() {
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            fs::copy(entry.path(), destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn read_manifest(path: &Path) -> Result<BackupManifest, String> {
    let bytes = fs::read(path).map_err(|_| "backup manifest is missing".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "backup manifest is invalid".to_string())
}

fn record_from_manifest(directory: &Path, manifest: &BackupManifest) -> BackupRecord {
    BackupRecord {
        backup_id: manifest.backup_id.clone(),
        directory: directory.to_string_lossy().to_string(),
        created_at_unix_ms: manifest.created_at_unix_ms,
        database_sha256: manifest.database_sha256.clone(),
        size_bytes: manifest.database_size_bytes + manifest.artifacts.iter().map(|artifact| artifact.size_bytes).sum::<u64>(),
    }
}

fn preserve_sidecar(database: &Path, suffix: &str, safety_suffix: u64) -> Result<(), String> {
    let source = PathBuf::from(format!("{}{}", database.to_string_lossy(), suffix));
    if !source.exists() { return Ok(()); }
    let destination = database.with_file_name(format!("rv_harness.pre_restore_{safety_suffix}.db{suffix}"));
    fs::rename(source, destination).map_err(|error| error.to_string())
}
