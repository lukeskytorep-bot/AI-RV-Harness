use std::{fs, path::{Component, Path, PathBuf}};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::documents;

const MAX_ARTIFACT_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreRevealArtifactRequest {
    session_id: String,
    original_file_name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreTargetArtifactRequest {
    target_id: String,
    original_file_name: String,
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealArtifactRecord {
    artifact_id: String,
    path: String,
    original_file_name: String,
    mime_type: String,
    size: usize,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeImage {
    mime_type: String,
    data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTextFile {
    relative_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifactCopy {
    source_path: String,
    relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteExportRequest {
    export_id: String,
    files: Vec<ExportTextFile>,
    #[serde(default)]
    artifact_copies: Vec<ExportArtifactCopy>,
    #[serde(default)]
    destination: Option<String>,
    #[serde(default)]
    base_directory: Option<String>,
    #[serde(default)]
    overwrite_existing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteExportResponse {
    directory: String,
}

#[tauri::command]
pub fn store_reveal_artifact(app: tauri::AppHandle, request: StoreRevealArtifactRequest) -> Result<RevealArtifactRecord, String> {
    validate_session_id(&request.session_id)?;
    let mut mime = normalize_mime(&request.mime_type, &request.original_file_name)?;
    let bytes = BASE64.decode(request.data_base64.as_bytes()).map_err(|_| "invalid artifact encoding".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("reveal artifact must be between 1 byte and 25 MB".to_string());
    }
    if mime.starts_with("image/") {
        let (detected, _, _) = documents::validate_image_bytes(&request.original_file_name, &bytes)?;
        if mime != detected { return Err("image MIME type does not match its byte signature".to_string()); }
        mime = detected.to_string();
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let artifact_id = format!("artifact_{}", &sha256[..20]);
    let extension = extension_for_mime(&mime);
    let root = artifact_root(&app)?;
    let directory = root.join(&request.session_id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{artifact_id}.{extension}"));
    fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    Ok(RevealArtifactRecord {
        artifact_id,
        path: path.to_string_lossy().to_string(),
        original_file_name: safe_original_name(&request.original_file_name),
        mime_type: mime,
        size: bytes.len(),
        sha256,
    })
}

#[tauri::command]
pub fn store_target_artifact(app: tauri::AppHandle, request: StoreTargetArtifactRequest) -> Result<RevealArtifactRecord, String> {
    validate_session_id(&request.target_id)?;
    let mut mime = normalize_mime(&request.mime_type, &request.original_file_name)?;
    if !mime.starts_with("image/") {
        return Err("target artifact must be a supported image".to_string());
    }
    let bytes = BASE64.decode(request.data_base64.as_bytes()).map_err(|_| "invalid artifact encoding".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("target image must be between 1 byte and 25 MB".to_string());
    }
    let (detected, _, _) = documents::validate_image_bytes(&request.original_file_name, &bytes)?;
    if mime != detected { return Err("image MIME type does not match its byte signature".to_string()); }
    mime = detected.to_string();
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let artifact_id = format!("artifact_{}", &sha256[..20]);
    let extension = extension_for_mime(&mime);
    let directory = managed_artifact_root(&app)?.join("targets").join(&request.target_id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{artifact_id}.{extension}"));
    fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    Ok(RevealArtifactRecord {
        artifact_id,
        path: path.to_string_lossy().to_string(),
        original_file_name: safe_original_name(&request.original_file_name),
        mime_type: mime,
        size: bytes.len(),
        sha256,
    })
}

#[tauri::command]
pub fn read_reveal_image_for_judge(app: tauri::AppHandle, path: String) -> Result<JudgeImage, String> {
    let root = managed_artifact_root(&app)?;
    let canonical_root = fs::canonicalize(&root).map_err(|error| error.to_string())?;
    let candidate = fs::canonicalize(PathBuf::from(&path)).map_err(|_| "artifact does not exist".to_string())?;
    if !candidate.starts_with(&canonical_root) {
        return Err("artifact path is outside managed application storage".to_string());
    }
    let bytes = fs::read(&candidate).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("invalid reveal image size".to_string());
    }
    let file_name = candidate.file_name().and_then(|value| value.to_str()).ok_or_else(|| "artifact file name is invalid".to_string())?;
    let (mime, _, _) = documents::validate_image_bytes(file_name, &bytes)?;
    Ok(JudgeImage { mime_type: mime.to_string(), data_base64: BASE64.encode(bytes) })
}

#[tauri::command]
pub fn write_export_package(app: tauri::AppHandle, request: WriteExportRequest) -> Result<WriteExportResponse, String> {
    validate_export_id(&request.export_id)?;
    if request.files.len() > 2000 || request.artifact_copies.len() > 500 {
        return Err("export contains too many files".to_string());
    }
    let export_root = export_root(&app, request.destination.as_deref(), request.base_directory.as_deref())?;
    fs::create_dir_all(&export_root).map_err(|error| error.to_string())?;
    let directory = if request.overwrite_existing {
        if request.destination.as_deref() != Some("training") {
            return Err("only Training exports may update an existing package".to_string());
        }
        let directory = export_root.join(&request.export_id);
        if directory.exists() && !directory.is_dir() {
            return Err("Training export path is not a directory".to_string());
        }
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        directory
    } else {
        let directory = unique_export_directory(&export_root, &request.export_id)?;
        fs::create_dir(&directory).map_err(|error| error.to_string())?;
        directory
    };
    let mut total_text_bytes = 0usize;
    for file in &request.files {
        total_text_bytes = total_text_bytes.saturating_add(file.content.len());
        if file.content.len() > 20 * 1024 * 1024 || total_text_bytes > 100 * 1024 * 1024 {
            return Err("export text size limit exceeded".to_string());
        }
        let relative = safe_relative_path(&file.relative_path)?;
        let destination = directory.join(relative);
        reject_symlink_path(&directory, &destination)?;
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::write(destination, file.content.as_bytes()).map_err(|error| error.to_string())?;
    }
    if !request.artifact_copies.is_empty() {
        let managed_root = managed_artifact_root(&app)?;
        let canonical_managed_root = fs::canonicalize(managed_root).map_err(|error| error.to_string())?;
        for copy in &request.artifact_copies {
            let source = fs::canonicalize(PathBuf::from(&copy.source_path)).map_err(|_| "export artifact does not exist".to_string())?;
            if !source.starts_with(&canonical_managed_root) { return Err("export artifact is outside managed storage".to_string()); }
            let relative = safe_relative_path(&copy.relative_path)?;
            let destination = directory.join(relative);
            reject_symlink_path(&directory, &destination)?;
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            fs::copy(source, destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(WriteExportResponse { directory: directory.to_string_lossy().to_string() })
}

fn export_root(app: &tauri::AppHandle, destination: Option<&str>, base_directory: Option<&str>) -> Result<PathBuf, String> {
    match destination.unwrap_or("managed") {
        "managed" => Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("exports")),
        "training" | "external" => {
            if let Some(value) = base_directory.map(str::trim).filter(|value| !value.is_empty()) {
                let path = PathBuf::from(value);
                if !path.is_absolute() || path.parent().is_none() || path.components().any(|component| matches!(component, Component::ParentDir)) {
                    return Err("export directory must be an absolute non-root path".to_string());
                }
                if path.exists() && !path.is_dir() {
                    return Err("export path is not a directory".to_string());
                }
                return Ok(path);
            }
            let documents = app.path().document_dir()
                .or_else(|_| app.path().app_data_dir())
                .map_err(|error| error.to_string())?;
            let folder = if destination == Some("training") { "Training" } else { "Exports" };
            Ok(documents.join("AI RV Harness").join(folder))
        }
        _ => Err("unsupported export destination".to_string()),
    }
}

fn unique_export_directory(root: &Path, export_id: &str) -> Result<PathBuf, String> {
    let first = root.join(export_id);
    if !first.exists() {
        return Ok(first);
    }
    for suffix in 2..=9999 {
        let candidate = root.join(format!("{export_id}_{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("could not allocate a unique export package directory".to_string())
}

fn reject_symlink_path(root: &Path, destination: &Path) -> Result<(), String> {
    let relative = destination.strip_prefix(root).map_err(|_| "export path escaped its package directory".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("invalid export path".to_string());
        };
        current.push(part);
        if current.exists() && fs::symlink_metadata(&current).map_err(|error| error.to_string())?.file_type().is_symlink() {
            return Err("symbolic links are not allowed inside export packages".to_string());
        }
    }
    Ok(())
}

fn artifact_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(managed_artifact_root(app)?.join("reveals"))
}

fn managed_artifact_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("artifacts"))
}

fn validate_session_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 100 || !value.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-') {
        return Err("invalid session id for artifact storage".to_string());
    }
    Ok(())
}

fn validate_export_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 120 || !value.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-') {
        return Err("invalid export id".to_string());
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() || value.is_empty() {
        return Err("invalid export relative path".to_string());
    }
    if path.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err("export path traversal is not allowed".to_string());
    }
    Ok(path)
}

fn safe_original_name(value: &str) -> String {
    Path::new(value).file_name().and_then(|name| name.to_str()).unwrap_or("artifact").chars().take(180).collect()
}

fn normalize_mime(mime: &str, name: &str) -> Result<String, String> {
    let value = mime.trim().to_ascii_lowercase();
    let known = match value.as_str() {
        "text/plain" | "text/markdown" | "image/png" | "image/jpeg" | "image/webp" | "image/gif" => Some(value),
        "application/octet-stream" | "" => mime_from_name(name).map(str::to_string),
        _ => None,
    };
    known.ok_or_else(|| "unsupported reveal artifact type".to_string())
}

fn mime_from_name(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".txt") { Some("text/plain") }
    else if lower.ends_with(".md") { Some("text/markdown") }
    else if lower.ends_with(".png") { Some("image/png") }
    else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") { Some("image/jpeg") }
    else if lower.ends_with(".webp") { Some("image/webp") }
    else if lower.ends_with(".gif") { Some("image/gif") }
    else { None }
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "text/plain" => "txt",
        "text/markdown" => "md",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    }
}
