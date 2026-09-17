use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256, Sha384};
use sqlx::{sqlite::{SqliteConnectOptions, SqliteConnection}, Connection, Row};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::migrations::{CURRENT_MIGRATION_VERSION, MIGRATION_SPECS};

const BACKUP_SCHEMA_VERSION: u8 = 1;
const DATABASE_FILE_NAME: &str = "rv_harness.db";
const LEGACY_MAX_MIGRATION_VERSION: i64 = 20;
const V0713_MIN_MIGRATION_VERSION: i64 = 21;
const CURRENT_DATA_EPOCH: &str = "v0.7.13";
const INCOMPLETE_DATA_EPOCH: &str = "v0.7.13-incomplete";
const LEGACY_DATA_EPOCH: &str = "v0.7.12-or-earlier";
const INITIALIZATION_MARKER_FILE_NAME: &str = "rv_harness.initializing-v0.7.13.json";
const DATABASE_PRESERVATION_COLLISION_LIMIT: usize = 100;
const ALLOWED_PROJECT_URLS: [&str; 6] = [
    "https://github.com/lukeskytorep-bot",
    "https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md",
    "https://presence-beyond-form.blogspot.com/",
    "https://echoofpresence.substack.com/",
    "https://archive.org/details/resonant-contact-protocol-ai-is-be-v-1.5a",
    "https://web.archive.org/",
];

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

#[derive(Debug, Clone, Serialize)]
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
    safety_backup: BackupRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageExportResult {
    directory: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseCompatibilityKind {
    Missing,
    Compatible,
    Legacy,
    IncompleteCurrentInitialization,
    CorruptOrUnknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCompatibilityStatus {
    kind: DatabaseCompatibilityKind,
    database_path: String,
    migration_version: Option<i64>,
    data_epoch: Option<String>,
    interface_language: Option<String>,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabasePreservation {
    backup_path: String,
    migration_version: Option<i64>,
    data_epoch: String,
    preserved_kind: DatabaseCompatibilityKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct InitializationMarker {
    data_epoch: String,
    target_migration_version: i64,
    created_at_unix_ms: u64,
}


pub fn backup_database_before_migrations(app: &tauri::AppHandle, expected_previous_migration_version: i64) -> Result<(), String> {
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
        "expectedPreviousMigrationVersion": expected_previous_migration_version,
        "createdAtUnixMs": timestamp,
        "files": files,
        "secretsIncluded": false,
    });
    fs::write(directory.join("manifest.json"), serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    fs::write(marker, directory.to_string_lossy().as_bytes()).map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn validate_database_snapshot_destination(app: &tauri::AppHandle, destination_path: &str) -> Result<PathBuf, String> {
    let destination = PathBuf::from(destination_path);
    if destination.file_name().and_then(|value| value.to_str()) != Some(DATABASE_FILE_NAME) {
        return Err("database snapshot must target the managed database filename".to_string());
    }
    if destination.exists() {
        return Err("database snapshot destination already exists".to_string());
    }
    let parent = destination.parent().ok_or_else(|| "database snapshot destination has no parent".to_string())?;
    let parent = fs::canonicalize(parent).map_err(|_| "database snapshot directory does not exist".to_string())?;
    let name = parent.file_name().and_then(|value| value.to_str()).ok_or_else(|| "database snapshot directory is invalid".to_string())?;
    if name.starts_with("backup_") {
        let root = fs::canonicalize(backup_root(app)?).map_err(|_| "backup root does not exist".to_string())?;
        if parent.parent() != Some(root.as_path()) {
            return Err("internal database snapshot must stay inside the managed backup root".to_string());
        }
    } else if !name.starts_with("AI_RV_Harness_backup_") {
        return Err("database snapshot destination is not a prepared backup directory".to_string());
    }
    if parent.join("manifest.json").exists() {
        return Err("completed backup directory cannot be overwritten".to_string());
    }
    Ok(parent.join(DATABASE_FILE_NAME))
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

#[derive(Debug)]
struct DatabaseIdentity {
    migration_version: i64,
    interface_language: Option<String>,
}

#[tauri::command]
pub async fn inspect_database_compatibility(app: tauri::AppHandle) -> Result<DatabaseCompatibilityStatus, String> {
    let path = database_path(&app)?;
    Ok(inspect_database_compatibility_path(&path).await)
}

#[tauri::command]
pub async fn prepare_database_for_load(app: tauri::AppHandle) -> Result<DatabaseCompatibilityStatus, String> {
    let path = database_path(&app)?;
    let status = inspect_database_compatibility_path(&path).await;
    match status.kind {
        DatabaseCompatibilityKind::Missing => {
            ensure_initialization_marker(&path)?;
            Ok(inspect_database_compatibility_path(&path).await)
        }
        DatabaseCompatibilityKind::Compatible => {
            if let Some(version) = status.migration_version {
                if version < CURRENT_MIGRATION_VERSION {
                    backup_database_before_migrations(&app, version)?;
                }
            }
            Ok(status)
        }
        DatabaseCompatibilityKind::Legacy
        | DatabaseCompatibilityKind::IncompleteCurrentInitialization
        | DatabaseCompatibilityKind::CorruptOrUnknown => Ok(status),
    }
}

async fn inspect_database_compatibility_path(path: &Path) -> DatabaseCompatibilityStatus {
    let database_path = path.to_string_lossy().to_string();
    let marker = match read_initialization_marker(path) {
        Ok(marker) => marker,
        Err(error) => return incompatible_status(database_path, None, None, &error),
    };

    if !path.exists() {
        return DatabaseCompatibilityStatus {
            kind: DatabaseCompatibilityKind::Missing,
            database_path,
            migration_version: None,
            data_epoch: Some(CURRENT_DATA_EPOCH.to_string()),
            interface_language: None,
            detail: marker.map(|_| "fresh v0.7.13 initialization marker is active; database creation may be retried".to_string()),
        };
    }
    if !path.is_file() {
        return incompatible_status(database_path, None, None, "managed database path is not a regular file");
    }
    match fs::metadata(path) {
        Ok(metadata) if metadata.len() > 0 => {}
        Ok(_) => return incompatible_status(database_path, None, None, "managed database file is empty"),
        Err(error) => return incompatible_status(database_path, None, None, &format!("database metadata cannot be read: {error}")),
    }

    let identity = match inspect_database_identity(path).await {
        Ok(identity) => identity,
        Err(error) => return incompatible_status(database_path, None, None, &error),
    };
    let migration_version = identity.migration_version;

    if marker.is_some() && migration_version < CURRENT_MIGRATION_VERSION {
        return DatabaseCompatibilityStatus {
            kind: DatabaseCompatibilityKind::IncompleteCurrentInitialization,
            database_path,
            migration_version: Some(migration_version),
            data_epoch: Some(INCOMPLETE_DATA_EPOCH.to_string()),
            interface_language: identity.interface_language,
            detail: Some(format!(
                "fresh v0.7.13 initialization was interrupted at migration version {migration_version}; automatic continuation is disabled"
            )),
        };
    }

    if (1..=LEGACY_MAX_MIGRATION_VERSION).contains(&migration_version) {
        return DatabaseCompatibilityStatus {
            kind: DatabaseCompatibilityKind::Legacy,
            database_path,
            migration_version: Some(migration_version),
            data_epoch: Some(LEGACY_DATA_EPOCH.to_string()),
            interface_language: identity.interface_language,
            detail: Some(format!(
                "recognized AI RV Harness legacy schema at migration version {migration_version}; automatic migration to v0.7.13 is disabled"
            )),
        };
    }
    if (V0713_MIN_MIGRATION_VERSION..=CURRENT_MIGRATION_VERSION).contains(&migration_version) {
        return DatabaseCompatibilityStatus {
            kind: DatabaseCompatibilityKind::Compatible,
            database_path,
            migration_version: Some(migration_version),
            data_epoch: Some(CURRENT_DATA_EPOCH.to_string()),
            interface_language: identity.interface_language,
            detail: marker.map(|_| format!("fresh v0.7.13 initialization reached schema {migration_version} and awaits final live validation")),
        };
    }
    incompatible_status(
        database_path,
        Some(migration_version),
        identity.interface_language,
        &format!("unsupported database migration version {migration_version}"),
    )
}

fn incompatible_status(
    database_path: String,
    migration_version: Option<i64>,
    interface_language: Option<String>,
    detail: &str,
) -> DatabaseCompatibilityStatus {
    DatabaseCompatibilityStatus {
        kind: DatabaseCompatibilityKind::CorruptOrUnknown,
        database_path,
        migration_version,
        data_epoch: None,
        interface_language,
        detail: Some(detail.to_string()),
    }
}

fn initialization_marker_path(database: &Path) -> Result<PathBuf, String> {
    let parent = database.parent().ok_or_else(|| "managed database path has no parent directory".to_string())?;
    Ok(parent.join(INITIALIZATION_MARKER_FILE_NAME))
}

fn validate_initialization_marker(marker: &InitializationMarker) -> Result<(), String> {
    if marker.data_epoch != CURRENT_DATA_EPOCH
        || !(V0713_MIN_MIGRATION_VERSION..=CURRENT_MIGRATION_VERSION).contains(&marker.target_migration_version)
    {
        return Err("v0.7.13 initialization marker is invalid or belongs to an unsupported schema epoch".to_string());
    }
    Ok(())
}

fn read_initialization_marker(database: &Path) -> Result<Option<InitializationMarker>, String> {
    let path = initialization_marker_path(database)?;
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err("v0.7.13 initialization marker path is not a regular file".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| format!("v0.7.13 initialization marker cannot be read: {error}"))?;
    let marker = serde_json::from_slice::<InitializationMarker>(&bytes)
        .map_err(|error| format!("v0.7.13 initialization marker is malformed: {error}"))?;
    validate_initialization_marker(&marker)?;
    Ok(Some(marker))
}

fn ensure_initialization_marker(database: &Path) -> Result<(), String> {
    if database.exists() {
        return Err("fresh v0.7.13 initialization marker can only be created when the managed database does not exist".to_string());
    }
    let marker_path = initialization_marker_path(database)?;
    let parent = marker_path.parent().ok_or_else(|| "initialization marker path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("database directory cannot be created: {error}"))?;
    if marker_path.exists() {
        read_initialization_marker(database)?;
        return Ok(());
    }
    let marker = InitializationMarker {
        data_epoch: CURRENT_DATA_EPOCH.to_string(),
        target_migration_version: CURRENT_MIGRATION_VERSION,
        created_at_unix_ms: unix_ms()?,
    };
    let bytes = serde_json::to_vec_pretty(&marker).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker_path)
        .map_err(|error| format!("v0.7.13 initialization marker cannot be created atomically: {error}"))?;
    file.write_all(&bytes).map_err(|error| format!("v0.7.13 initialization marker cannot be written: {error}"))?;
    file.sync_all().map_err(|error| format!("v0.7.13 initialization marker cannot be flushed: {error}"))?;
    Ok(())
}

fn remove_initialization_marker(database: &Path) -> Result<(), String> {
    let marker_path = initialization_marker_path(database)?;
    if !marker_path.exists() {
        return Ok(());
    }
    read_initialization_marker(database)?;
    fs::remove_file(&marker_path).map_err(|error| format!("v0.7.13 initialization marker cannot be finalized: {error}"))
}

async fn validate_and_finalize_current_database(path: &Path) -> Result<(), String> {
    validate_current_database(path).await?;
    remove_initialization_marker(path)?;
    Ok(())
}

async fn inspect_database_identity(path: &Path) -> Result<DatabaseIdentity, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("database cannot be opened read-only: {error}"))?;

    let integrity = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("database integrity_check failed to run: {error}"))?;
    if integrity.len() != 1 || integrity[0].try_get::<String, _>(0).ok().as_deref() != Some("ok") {
        return Err("database failed SQLite integrity_check".to_string());
    }
    let foreign_key_violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut connection)
        .await
        .map_err(|error| format!("database foreign_key_check failed to run: {error}"))?;
    if !foreign_key_violations.is_empty() {
        return Err("database contains foreign-key violations".to_string());
    }

    let migration_rows = sqlx::query(
        "SELECT version, description, success, checksum FROM _sqlx_migrations ORDER BY version ASC",
    )
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("database migration ledger cannot be read: {error}"))?;
    if migration_rows.is_empty() {
        return Err("database migration ledger is empty".to_string());
    }
    if migration_rows.len() > MIGRATION_SPECS.len() {
        return Err("database migration ledger contains a future or unknown migration".to_string());
    }
    for (index, row) in migration_rows.iter().enumerate() {
        let version = row.try_get::<i64, _>("version").map_err(|error| error.to_string())?;
        let description = row.try_get::<String, _>("description").map_err(|error| error.to_string())?;
        let success = row.try_get::<bool, _>("success").map_err(|error| error.to_string())?;
        let checksum = row.try_get::<Vec<u8>, _>("checksum").map_err(|error| error.to_string())?;
        let expected = MIGRATION_SPECS
            .get(index)
            .ok_or_else(|| "database migration ledger contains an unknown entry".to_string())?;
        let expected_checksum = Sha384::digest(expected.sql.as_bytes()).to_vec();
        if !success
            || version != expected.version
            || description != expected.description
            || checksum != expected_checksum
        {
            return Err(format!(
                "database migration ledger does not match the AI RV Harness schema registry at version {version}"
            ));
        }
    }
    let migration_version = migration_rows
        .last()
        .and_then(|row| row.try_get::<i64, _>("version").ok())
        .ok_or_else(|| "database migration version cannot be determined".to_string())?;

    let mut required_tables = vec!["app_settings", "profiles", "workspaces", "rv_sessions", "chat_threads"];
    if migration_version >= 2 {
        required_tables.push("provider_configs");
    }
    if migration_version >= 16 {
        required_tables.push("training_runs");
    }
    if migration_version >= 20 {
        required_tables.extend([
            "ai_identities",
            "ai_note_settings",
            "ai_note_reflection_runs",
            "ai_note_versions",
            "ai_note_activation_events",
        ]);
    }
    for table in required_tables {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("database schema identity check failed: {error}"))?;
        if exists != 1 {
            return Err(format!("database is missing required AI RV Harness table {table}"));
        }
    }

    if migration_version >= 21 {
        for (table, column) in [
            ("rv_sessions", "archived_at"),
            ("training_runs", "archived_at"),
            ("research_projects", "archived_at"),
            ("targets", "archived_at"),
        ] {
            if !column_exists(&mut connection, table, column).await? {
                return Err(format!("database migration 021 marker is missing: {table}.{column}"));
            }
        }
    }
    if migration_version >= 22 {
        for (table, column) in [
            ("ai_note_reflection_runs", "source_snapshot_json"),
            ("ai_note_versions", "source_snapshot_json"),
        ] {
            if !column_exists(&mut connection, table, column).await? {
                return Err(format!("database migration 022 marker is missing: {table}.{column}"));
            }
        }
    }
    if migration_version >= 23 {
        let purge_table = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'controlled_purge_context'",
        )
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("database migration 023 marker check failed: {error}"))?;
        if purge_table != 1
            || !column_exists(&mut connection, "rv_sessions", "target_id_snapshot").await?
            || !column_exists(&mut connection, "research_assignments", "target_id_snapshot").await?
        {
            return Err("database migration 023 structural markers are incomplete".to_string());
        }
    }
    if migration_version >= 24 {
        for table in [
            "field_guide_settings",
            "field_guide_versions",
            "field_guide_activation_events",
            "field_guide_legacy_baselines",
        ] {
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_one(&mut connection)
            .await
            .map_err(|error| format!("database migration 024 marker check failed: {error}"))?;
            if exists != 1 {
                return Err(format!("database migration 024 marker is missing: {table}"));
            }
        }
    }

    let interface_language = sqlx::query_scalar::<_, Option<String>>(
        "SELECT value FROM app_settings WHERE key = 'interfaceLanguage' LIMIT 1",
    )
    .fetch_one(&mut connection)
    .await
    .unwrap_or(None)
    .filter(|value| value == "pl" || value == "en");

    connection.close().await.map_err(|error| format!("read-only database inspection could not close cleanly: {error}"))?;
    Ok(DatabaseIdentity { migration_version, interface_language })
}

async fn column_exists(connection: &mut SqliteConnection, table: &str, column: &str) -> Result<bool, String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| format!("database column check failed for {table}.{column}: {error}"))?;
    Ok(rows.iter().any(|row| row.try_get::<String, _>("name").ok().as_deref() == Some(column)))
}

async fn confirm_start_fresh(
    app: &tauri::AppHandle,
    status: &DatabaseCompatibilityStatus,
    requested_language: Option<String>,
) -> Result<bool, String> {
    let language = requested_language
        .filter(|value| value == "pl" || value == "en")
        .or_else(|| status.interface_language.clone())
        .unwrap_or_else(|| "en".to_string());
    let incomplete = status.kind == DatabaseCompatibilityKind::IncompleteCurrentInitialization;
    let (title, message, confirm, cancel) = if language == "pl" {
        if incomplete {
            (
                "Utworzyć świeżą bazę v0.7.13?",
                "Niedokończona baza v0.7.13 zostanie zachowana jako kopia diagnostyczna. Następnie AI RV Harness utworzy nową bazę. Oryginalne dane nie zostaną usunięte.",
                "Zachowaj kopię i rozpocznij od nowa",
                "Anuluj",
            )
        } else {
            (
                "Rozpocząć od nowa w v0.7.13?",
                "Dotychczasowa baza zostanie zachowana pod nową nazwą. Następnie AI RV Harness utworzy świeżą bazę v0.7.13. Oryginalne dane nie zostaną usunięte.",
                "Rozpocznij od nowa w v0.7.13",
                "Anuluj",
            )
        }
    } else if incomplete {
        (
            "Create a fresh v0.7.13 database?",
            "The incomplete v0.7.13 database will be preserved as a diagnostic backup. AI RV Harness will then create a new database. The original data will not be deleted.",
            "Preserve backup and start fresh",
            "Cancel",
        )
    } else {
        (
            "Start fresh in v0.7.13?",
            "Your existing database will be preserved under a new name. AI RV Harness will then create a fresh v0.7.13 database. The original data will not be deleted.",
            "Start fresh in v0.7.13",
            "Cancel",
        )
    };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .message(message)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(confirm.to_string(), cancel.to_string()))
            .blocking_show()
    })
    .await
    .map_err(|error| format!("native start-fresh confirmation failed: {error}"))
}

#[tauri::command]
pub async fn start_fresh_database(
    app: tauri::AppHandle,
    db_instances: tauri::State<'_, DbInstances>,
    interface_language: Option<String>,
) -> Result<DatabasePreservation, String> {
    let path = database_path(&app)?;
    let status = inspect_database_compatibility_path(&path).await;
    if status.kind != DatabaseCompatibilityKind::Legacy
        && status.kind != DatabaseCompatibilityKind::IncompleteCurrentInitialization
    {
        return Err("start-fresh is allowed only for a recognized legacy database or an incomplete current initialization".to_string());
    }
    let before_size = fs::metadata(&path).map_err(|error| error.to_string())?.len();
    let before_sha256 = sha256_file(&path)?;
    if !confirm_start_fresh(&app, &status, interface_language).await? {
        return Err("start-fresh was cancelled by the user in the native confirmation dialog".to_string());
    }
    let confirmed_status = inspect_database_compatibility_path(&path).await;
    let confirmed_size = fs::metadata(&path).map_err(|error| error.to_string())?.len();
    let confirmed_sha256 = sha256_file(&path)?;
    if confirmed_status.kind != status.kind
        || confirmed_status.migration_version != status.migration_version
        || confirmed_size != before_size
        || confirmed_sha256 != before_sha256
    {
        return Err("database changed while start-fresh confirmation was open; no files were changed".to_string());
    }

    close_loaded_database(&db_instances).await?;
    let preserved_kind = confirmed_status.kind;
    let data_epoch = confirmed_status.data_epoch.clone().unwrap_or_else(|| {
        if preserved_kind == DatabaseCompatibilityKind::Legacy {
            LEGACY_DATA_EPOCH.to_string()
        } else {
            INCOMPLETE_DATA_EPOCH.to_string()
        }
    });
    let flavor = if preserved_kind == DatabaseCompatibilityKind::Legacy {
        "legacy-v0.7.12"
    } else {
        "incomplete-v0.7.13"
    };
    let backup_path = preserve_database(&path, unix_ms()?, flavor)?;
    Ok(DatabasePreservation {
        backup_path: backup_path.to_string_lossy().to_string(),
        migration_version: confirmed_status.migration_version,
        data_epoch,
        preserved_kind,
    })
}

async fn close_loaded_database(db_instances: &tauri::State<'_, DbInstances>) -> Result<(), String> {
    let loaded = {
        let mut instances = db_instances.0.write().await;
        instances.remove("sqlite:rv_harness.db")
    };
    if let Some(DbPool::Sqlite(pool)) = loaded {
        pool.close().await;
    }
    Ok(())
}

fn preserve_database(path: &Path, timestamp: u64, flavor: &str) -> Result<PathBuf, String> {
    if !path.is_file() {
        return Err("database file to preserve is missing".to_string());
    }
    let backup = next_preservation_backup_path(path, timestamp, flavor)?;
    let pairs = database_rename_pairs(path, &backup);
    let mut fingerprints: Vec<(PathBuf, PathBuf, u64, String)> = Vec::new();

    for (source, destination) in &pairs {
        if !source.exists() {
            continue;
        }
        if !source.is_file() {
            return Err(format!("database file is not a regular file: {}", source.to_string_lossy()));
        }
        let size = fs::metadata(source).map_err(|error| error.to_string())?.len();
        if source == path && size == 0 {
            return Err("database file to preserve is empty".to_string());
        }
        if destination.exists() {
            return Err("database backup destination changed during preparation; no files were changed".to_string());
        }
        fingerprints.push((source.clone(), destination.clone(), size, sha256_file(source)?));
    }
    if fingerprints.first().map(|(source, _, _, _)| source.as_path()) != Some(path) {
        return Err("database preservation fingerprint preparation failed".to_string());
    }

    let mut completed: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (source, destination, _, _) in &fingerprints {
        if let Err(error) = fs::rename(source, destination) {
            rollback_database_renames(&completed)?;
            return Err(format!("database preservation rename failed: {error}"));
        }
        completed.push((source.clone(), destination.clone()));
    }

    let verified = fingerprints.iter().all(|(source, destination, expected_size, expected_sha256)| {
        destination.is_file()
            && fs::metadata(destination)
                .map(|metadata| metadata.len() == *expected_size && (source != path || metadata.len() > 0))
                .unwrap_or(false)
            && sha256_file(destination)
                .map(|hash| hash == *expected_sha256)
                .unwrap_or(false)
    });
    if !verified {
        rollback_database_renames(&completed)?;
        return Err("database preservation verification failed".to_string());
    }
    Ok(backup)
}

#[cfg(test)]
fn restore_preserved_database(original: &Path, backup: &Path) -> Result<(), String> {
    let pairs = database_rename_pairs(original, backup);
    let completed = pairs
        .into_iter()
        .filter(|(_, preserved)| preserved.exists())
        .collect::<Vec<_>>();
    rollback_database_renames(&completed)
}

fn next_preservation_backup_path(path: &Path, timestamp: u64, flavor: &str) -> Result<PathBuf, String> {
    if flavor != "legacy-v0.7.12" && flavor != "incomplete-v0.7.13" {
        return Err("unsupported database preservation flavor".to_string());
    }
    let parent = path.parent().ok_or_else(|| "managed database path has no parent directory".to_string())?;
    for collision in 0..DATABASE_PRESERVATION_COLLISION_LIMIT {
        let suffix = if collision == 0 { String::new() } else { format!(".{collision}") };
        let candidate = parent.join(format!("ai-rv-harness.{flavor}.{timestamp}{suffix}.sqlite"));
        let sidecars_free = ["-wal", "-shm"]
            .iter()
            .all(|suffix| !PathBuf::from(format!("{}{}", candidate.to_string_lossy(), suffix)).exists());
        if !candidate.exists() && sidecars_free {
            return Ok(candidate);
        }
    }
    Err("database preservation name collision limit reached; no files were changed".to_string())
}

fn database_rename_pairs(source: &Path, backup: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut pairs = vec![(source.to_path_buf(), backup.to_path_buf())];
    for suffix in ["-wal", "-shm"] {
        pairs.push((
            PathBuf::from(format!("{}{}", source.to_string_lossy(), suffix)),
            PathBuf::from(format!("{}{}", backup.to_string_lossy(), suffix)),
        ));
    }
    pairs
}

fn rollback_database_renames(completed: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut failures = Vec::new();
    for (source, destination) in completed.iter().rev() {
        if destination.exists() {
            if let Err(error) = fs::rename(destination, source) {
                failures.push(format!("{}: {error}", destination.to_string_lossy()));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("database preservation rollback failed: {}", failures.join("; ")))
    }
}

#[tauri::command]
pub fn close_application(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn validate_live_database(app: tauri::AppHandle) -> Result<(), String> {
    let path = database_path(&app)?;
    validate_and_finalize_current_database(&path).await
}

async fn validate_current_database(path: &Path) -> Result<(), String> {
    let migration_version = validate_sqlite_database(path).await?;
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
    records.sort_by_key(|record| std::cmp::Reverse(record.created_at_unix_ms));
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

async fn create_closed_database_safety_backup(app: &tauri::AppHandle) -> Result<BackupRecord, String> {
    let prepared = prepare_backup(app.clone())?;
    let source = database_path(app)?;
    let destination = PathBuf::from(&prepared.database_path);
    let result = async {
        if !source.is_file() {
            return Err("live database is missing before restore".to_string());
        }
        validate_current_database(&source).await?;
        fs::copy(&source, &destination).map_err(|error| error.to_string())?;
        finalize_backup(app.clone(), BackupIdRequest { backup_id: prepared.backup_id.clone() })
    }.await;
    if result.is_err() {
        let _ = discard_backup(app.clone(), BackupIdRequest { backup_id: prepared.backup_id });
    }
    result
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

    let safety_backup = create_closed_database_safety_backup(&app).await?;

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
    validate_sqlite_database(&restore_temp).await.inspect_err(|_| {
        let _ = fs::remove_file(&restore_temp);
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

    Ok(RestoreResult { backup_id: request.backup_id, previous_database_path, safety_backup })
}

#[tauri::command]
pub async fn restore_portable_backup(app: tauri::AppHandle, request: PortableRestoreRequest) -> Result<RestoreResult, String> {
    let (directory, manifest) = validated_portable_backup(&request.directory)?;
    let source_database = directory.join(DATABASE_FILE_NAME);
    validate_sqlite_database(&source_database).await?;
    let safety_backup = create_closed_database_safety_backup(&app).await?;

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
    validate_sqlite_database(&restore_temp).await.inspect_err(|_| {
        let _ = fs::remove_file(&restore_temp);
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

    Ok(RestoreResult { backup_id: manifest.backup_id, previous_database_path, safety_backup })
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

#[tauri::command]
pub fn open_project_url(url: String) -> Result<(), String> {
    validate_project_url(&url)?;
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command.arg(url).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_project_url(url: &str) -> Result<(), String> {
    if !ALLOWED_PROJECT_URLS.contains(&url) {
        return Err("external URL is not on the project allowlist".to_string());
    }
    Ok(())
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

pub(crate) fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

#[cfg(test)]
mod tests {
    use super::{
        ensure_initialization_marker, initialization_marker_path, inspect_database_compatibility_path,
        inspect_portable_backup, next_preservation_backup_path, preserve_database,
        restore_preserved_database, sha256_file,
        validate_and_finalize_current_database, validate_current_database, validate_project_url,
        validate_sqlite_database, BackupManifest, DatabaseCompatibilityKind, BACKUP_SCHEMA_VERSION,
        CURRENT_DATA_EPOCH, DATABASE_FILE_NAME, DATABASE_PRESERVATION_COLLISION_LIMIT,
        INCOMPLETE_DATA_EPOCH, InitializationMarker, LEGACY_DATA_EPOCH,
    };
    use crate::migrations::{CURRENT_MIGRATION_VERSION, MIGRATION_SPECS};
    use sha2::{Digest, Sha384};
    use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
    use std::{fs, path::{Path, PathBuf}, process, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn complete_project_credits_url_is_allowed() {
        assert!(validate_project_url(
            "https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md"
        )
        .is_ok());
    }

    #[test]
    fn arbitrary_external_url_is_rejected() {
        assert!(validate_project_url("https://example.com/").is_err());
    }

    fn temp_case(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "ai-rv-harness-{label}-{}-{nonce}",
            process::id()
        ));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    async fn create_migration_ledger(connection: &mut SqliteConnection) {
        sqlx::raw_sql(
            r#"
            CREATE TABLE _sqlx_migrations (
              version BIGINT PRIMARY KEY NOT NULL,
              description TEXT NOT NULL,
              installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              success BOOLEAN NOT NULL,
              checksum BLOB NOT NULL,
              execution_time BIGINT NOT NULL
            );
            "#,
        )
        .execute(&mut *connection)
        .await
        .expect("migration ledger should be created");
    }

    async fn apply_migration_range(
        connection: &mut SqliteConnection,
        start_index: usize,
        end_index: usize,
    ) {
        for migration in &MIGRATION_SPECS[start_index..end_index] {
            sqlx::raw_sql(migration.sql)
                .execute(&mut *connection)
                .await
                .unwrap_or_else(|error| {
                    panic!(
                        "migration {:03} ({}) should apply: {error}",
                        migration.version, migration.description
                    )
                });
            let checksum = Sha384::digest(migration.sql.as_bytes()).to_vec();
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?, ?, 1, ?, 0)",
            )
            .bind(migration.version)
            .bind(migration.description)
            .bind(checksum)
            .execute(&mut *connection)
            .await
            .expect("migration ledger row should be recorded");
        }
    }

    async fn create_database_through(path: &Path, migration_count: usize) {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .expect("test database should open");
        create_migration_ledger(&mut connection).await;
        apply_migration_range(&mut connection, 0, migration_count).await;
        connection.close().await.expect("test database should close");
    }

    #[tokio::test]
    async fn database_after_migrations_001_through_024_passes_live_validation() {
        let directory = temp_case("migration-024-live-validation");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, MIGRATION_SPECS.len()).await;

        assert_eq!(CURRENT_MIGRATION_VERSION, 24);
        validate_current_database(&database)
            .await
            .expect("migration-024 database should pass live validation");

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn database_upgrade_from_exact_green_023_to_024_preserves_custom_profile_prompt_as_unresolved_baseline() {
        let directory = temp_case("migration-023-to-024");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, 23).await;

        let options = SqliteConnectOptions::new()
            .filename(&database)
            .create_if_missing(false)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .expect("migration-023 database should reopen");
        let custom_prompt = "CUSTOM VIEWER FIELD MEMORY\nDo not guess my identity.";
        sqlx::query("INSERT INTO profiles (id, display_name, default_viewer_system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind("profile_field_guide_bootstrap")
            .bind("Viewer")
            .bind(custom_prompt)
            .bind("2026-09-17T12:00:00.000Z")
            .bind("2026-09-17T12:00:00.000Z")
            .execute(&mut connection)
            .await
            .expect("green-v23 profile fixture should insert");

        apply_migration_range(&mut connection, 23, MIGRATION_SPECS.len()).await;

        let baseline = sqlx::query("SELECT original_content, resolution_status, resolved_ai_identity_id, resolved_language, resolved_version_id FROM field_guide_legacy_baselines WHERE profile_id = ?")
            .bind("profile_field_guide_bootstrap")
            .fetch_one(&mut connection)
            .await
            .expect("migration 024 should preserve the Profile Viewer prompt");
        assert_eq!(baseline.try_get::<String, _>("original_content").unwrap(), custom_prompt);
        assert_eq!(baseline.try_get::<String, _>("resolution_status").unwrap(), "unresolved");
        assert!(baseline.try_get::<Option<String>, _>("resolved_ai_identity_id").unwrap().is_none());
        assert!(baseline.try_get::<Option<String>, _>("resolved_language").unwrap().is_none());
        assert!(baseline.try_get::<Option<String>, _>("resolved_version_id").unwrap().is_none());
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&mut connection).await.unwrap();
        let foreign_key_violations = sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut connection).await.unwrap();
        assert_eq!(integrity, "ok");
        assert!(foreign_key_violations.is_empty());
        connection.close().await.expect("upgraded database should close");

        validate_current_database(&database)
            .await
            .expect("database upgraded from exact green 023 to 024 should pass live validation");

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn portable_backup_and_restore_preflight_accept_database_version_024() {
        let root = temp_case("backup-version-024");
        let backup_id = "backup_security_ipc_1a_v23";
        let directory = root.join(format!("AI_RV_Harness_{backup_id}"));
        fs::create_dir_all(&directory).expect("portable backup directory should be created");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, MIGRATION_SPECS.len()).await;

        let manifest = BackupManifest {
            schema_version: BACKUP_SCHEMA_VERSION,
            application_version: env!("CARGO_PKG_VERSION").to_string(),
            backup_id: backup_id.to_string(),
            created_at_unix_ms: 1,
            database_sha256: sha256_file(&database).expect("database hash should be available"),
            database_size_bytes: fs::metadata(&database)
                .expect("database metadata should be available")
                .len(),
            artifacts: Vec::new(),
            secrets_included: false,
        };
        fs::write(
            directory.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).expect("manifest should serialize"),
        )
        .expect("manifest should be written");

        inspect_portable_backup(directory.to_string_lossy().to_string())
            .await
            .expect("portable backup with migration version 23 should be accepted");

        let restore_copy = root.join("restore-preflight.db");
        fs::copy(&database, &restore_copy).expect("restore candidate should copy");
        assert_eq!(
            validate_sqlite_database(&restore_copy)
                .await
                .expect("restore preflight should accept migration version 23"),
            23
        );

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn fresh_initialization_marker_is_created_only_without_database_and_finalized_after_current_validation() {
        let directory = temp_case("epoch-r1-marker-lifecycle");
        let database = directory.join(DATABASE_FILE_NAME);
        let marker = initialization_marker_path(&database).expect("marker path should resolve");

        ensure_initialization_marker(&database).expect("fresh initialization marker should be created");
        assert!(marker.is_file());
        let missing = inspect_database_compatibility_path(&database).await;
        assert_eq!(missing.kind, DatabaseCompatibilityKind::Missing);
        assert_eq!(missing.data_epoch.as_deref(), Some(CURRENT_DATA_EPOCH));

        create_database_through(&database, MIGRATION_SPECS.len()).await;
        assert!(ensure_initialization_marker(&database).is_err(), "marker creation must be rejected once the database exists");
        let before_finalize = inspect_database_compatibility_path(&database).await;
        assert_eq!(before_finalize.kind, DatabaseCompatibilityKind::Compatible);
        assert!(marker.is_file(), "marker must survive until live validation succeeds");

        validate_and_finalize_current_database(&database)
            .await
            .expect("validated current database should finalize the initialization marker");
        assert!(!marker.exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn initialization_marker_from_green_schema_23_remains_valid_inside_the_same_v0713_epoch() {
        let directory = temp_case("epoch-marker-v23-forward-compatible");
        let database = directory.join(DATABASE_FILE_NAME);
        let marker_path = initialization_marker_path(&database).expect("marker path should resolve");
        let marker = InitializationMarker {
            data_epoch: CURRENT_DATA_EPOCH.to_string(),
            target_migration_version: 23,
            created_at_unix_ms: 1,
        };
        fs::write(&marker_path, serde_json::to_vec_pretty(&marker).unwrap()).expect("green-v23 marker should be written");
        create_database_through(&database, 23).await;

        let status = inspect_database_compatibility_path(&database).await;
        assert_eq!(status.kind, DatabaseCompatibilityKind::IncompleteCurrentInitialization);
        assert_eq!(status.migration_version, Some(23));
        assert_eq!(status.data_epoch.as_deref(), Some(INCOMPLETE_DATA_EPOCH));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn interrupted_fresh_initialization_at_1_10_and_20_is_not_legacy() {
        for migration_count in [1_usize, 10, 20, 21, 22] {
            let directory = temp_case(&format!("epoch-r1-interrupted-{migration_count}"));
            let database = directory.join(DATABASE_FILE_NAME);
            ensure_initialization_marker(&database).expect("fresh initialization marker should be created");
            create_database_through(&database, migration_count).await;

            let status = inspect_database_compatibility_path(&database).await;
            assert_eq!(status.kind, DatabaseCompatibilityKind::IncompleteCurrentInitialization);
            assert_eq!(status.migration_version, Some(migration_count as i64));
            assert_eq!(status.data_epoch.as_deref(), Some(INCOMPLETE_DATA_EPOCH));

            fs::remove_dir_all(directory).expect("test directory should be removed");
        }
    }

    #[tokio::test]
    async fn genuine_v20_without_initialization_marker_is_legacy() {
        let directory = temp_case("epoch-r1-real-v20");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, 20).await;

        let status = inspect_database_compatibility_path(&database).await;
        assert_eq!(status.kind, DatabaseCompatibilityKind::Legacy);
        assert_eq!(status.migration_version, Some(20));
        assert_eq!(status.data_epoch.as_deref(), Some(LEGACY_DATA_EPOCH));
        assert!(!initialization_marker_path(&database).expect("marker path should resolve").exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn initialization_marker_never_turns_partial_database_into_compatible() {
        let directory = temp_case("epoch-r1-marker-not-pass");
        let database = directory.join(DATABASE_FILE_NAME);
        ensure_initialization_marker(&database).expect("marker should be created");
        create_database_through(&database, 20).await;

        let status = inspect_database_compatibility_path(&database).await;
        assert_ne!(status.kind, DatabaseCompatibilityKind::Compatible);
        assert_eq!(status.kind, DatabaseCompatibilityKind::IncompleteCurrentInitialization);

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn migration_checksum_mismatch_is_corrupt_or_unknown_even_with_same_version_description_and_structure() {
        let directory = temp_case("epoch-r1-checksum-mismatch");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, 20).await;

        let options = SqliteConnectOptions::new().filename(&database).create_if_missing(false).foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options).await.expect("checksum fixture should open");
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 20")
            .bind(vec![0xA5_u8; 48])
            .execute(&mut connection)
            .await
            .expect("checksum fixture should be modified");
        connection.close().await.expect("checksum fixture should close");

        let status = inspect_database_compatibility_path(&database).await;
        assert_eq!(status.kind, DatabaseCompatibilityKind::CorruptOrUnknown);
        assert!(status.detail.as_deref().unwrap_or_default().contains("does not match"));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn canonical_sqlx_checksums_classify_v20_and_v23_correctly() {
        for (count, expected_kind) in [
            (20_usize, DatabaseCompatibilityKind::Legacy),
            (MIGRATION_SPECS.len(), DatabaseCompatibilityKind::Compatible),
        ] {
            let directory = temp_case(&format!("epoch-r1-valid-ledger-{count}"));
            let database = directory.join(DATABASE_FILE_NAME);
            create_database_through(&database, count).await;
            let status = inspect_database_compatibility_path(&database).await;
            assert_eq!(status.kind, expected_kind);
            fs::remove_dir_all(directory).expect("test directory should be removed");
        }
    }

    #[tokio::test]
    async fn preservation_keeps_legacy_database_and_sidecars_byte_identical() {
        let directory = temp_case("epoch-r1-preserve-legacy");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, 20).await;
        let before_hash = sha256_file(&database).expect("database hash should be available");
        let wal = PathBuf::from(format!("{}-wal", database.to_string_lossy()));
        let shm = PathBuf::from(format!("{}-shm", database.to_string_lossy()));
        fs::write(&wal, b"wal bytes").expect("WAL fixture should be written");
        fs::write(&shm, b"shm bytes").expect("SHM fixture should be written");

        let backup = preserve_database(&database, 1_758_106_800_000, "legacy-v0.7.12")
            .expect("legacy database should be preserved");
        assert_eq!(sha256_file(&backup).expect("backup hash should be available"), before_hash);
        assert_eq!(fs::read(PathBuf::from(format!("{}-wal", backup.to_string_lossy()))).unwrap(), b"wal bytes");
        assert_eq!(fs::read(PathBuf::from(format!("{}-shm", backup.to_string_lossy()))).unwrap(), b"shm bytes");

        restore_preserved_database(&database, &backup).expect("rollback helper should restore original database");
        assert_eq!(sha256_file(&database).expect("restored hash should be available"), before_hash);

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn preservation_collision_and_preflight_failure_do_not_overwrite_data() {
        let directory = temp_case("epoch-r1-preserve-failure");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, 20).await;
        let before = fs::read(&database).expect("database bytes should be readable");
        let timestamp = 77_u64;
        for collision in 0..DATABASE_PRESERVATION_COLLISION_LIMIT {
            let suffix = if collision == 0 { String::new() } else { format!(".{collision}") };
            fs::write(
                directory.join(format!("ai-rv-harness.legacy-v0.7.12.{timestamp}{suffix}.sqlite")),
                b"occupied",
            )
            .expect("collision fixture should be written");
        }
        assert!(preserve_database(&database, timestamp, "legacy-v0.7.12").is_err());
        assert_eq!(fs::read(&database).expect("database should remain"), before);

        let first = next_preservation_backup_path(&database, 88, "legacy-v0.7.12")
            .expect("non-colliding path should resolve");
        assert!(first.file_name().and_then(|name| name.to_str()).unwrap_or_default().contains("legacy-v0.7.12"));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn incomplete_database_can_be_preserved_as_diagnostic_copy_without_removing_marker() {
        let directory = temp_case("epoch-r1-incomplete-preserve");
        let database = directory.join(DATABASE_FILE_NAME);
        ensure_initialization_marker(&database).expect("marker should be created");
        create_database_through(&database, 10).await;
        let marker = initialization_marker_path(&database).expect("marker path should resolve");
        let before_hash = sha256_file(&database).expect("partial database hash should be available");

        let backup = preserve_database(&database, 1234, "incomplete-v0.7.13")
            .expect("partial database should be preserved");
        assert!(marker.is_file(), "active initialization marker must remain for the next fresh attempt");
        assert_eq!(sha256_file(&backup).expect("diagnostic backup hash should be readable"), before_hash);
        assert!(!database.exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn corrupted_database_is_not_modified_by_compatibility_inspection() {
        let directory = temp_case("epoch-r1-corrupt");
        let database = directory.join(DATABASE_FILE_NAME);
        fs::write(&database, b"not sqlite; preserve me").expect("corrupt fixture should be written");
        let before = fs::read(&database).expect("corrupt fixture should be readable");

        let status = inspect_database_compatibility_path(&database).await;
        assert_eq!(status.kind, DatabaseCompatibilityKind::CorruptOrUnknown);
        assert_eq!(fs::read(&database).expect("corrupt fixture should remain"), before);

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn unicode_windows_safe_preservation_path_is_supported() {
        let root = temp_case("epoch-r1-unicode");
        let directory = root.join("Dane Łódź 用户");
        fs::create_dir_all(&directory).expect("unicode directory should be created");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, 20).await;

        let backup = preserve_database(&database, 123_456_789, "legacy-v0.7.12")
            .expect("unicode path should be supported");
        let name = backup.file_name().and_then(|value| value.to_str()).expect("backup filename should be UTF-8");
        assert!(!name.chars().any(|value| r#"<>:\\|?*"#.contains(value)));

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn fresh_v23_integrity_and_foreign_keys_are_clean() {
        let directory = temp_case("epoch-r1-fresh-v23");
        let database = directory.join(DATABASE_FILE_NAME);
        create_database_through(&database, MIGRATION_SPECS.len()).await;
        assert_eq!(validate_sqlite_database(&database).await.expect("fresh database should validate"), 24);
        let options = SqliteConnectOptions::new().filename(&database).read_only(true).create_if_missing(false);
        let mut connection = SqliteConnection::connect_with(&options).await.expect("fresh database should reopen");
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&mut connection).await.unwrap();
        let fk_rows = sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut connection).await.unwrap();
        assert_eq!(integrity, "ok");
        assert!(fk_rows.is_empty());
        connection.close().await.expect("fresh validation connection should close");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

}
