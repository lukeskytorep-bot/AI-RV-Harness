use std::{fs, path::{Component, Path, PathBuf}};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteExportResponse {
    directory: String,
}

#[tauri::command]
pub fn store_reveal_artifact(app: tauri::AppHandle, request: StoreRevealArtifactRequest) -> Result<RevealArtifactRecord, String> {
    validate_session_id(&request.session_id)?;
    let mime = normalize_mime(&request.mime_type, &request.original_file_name)?;
    let bytes = BASE64.decode(request.data_base64.as_bytes()).map_err(|_| "invalid artifact encoding".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("reveal artifact must be between 1 byte and 25 MB".to_string());
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
    let mime = normalize_mime(&request.mime_type, &request.original_file_name)?;
    if !mime.starts_with("image/") {
        return Err("target artifact must be a supported image".to_string());
    }
    let bytes = BASE64.decode(request.data_base64.as_bytes()).map_err(|_| "invalid artifact encoding".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("target image must be between 1 byte and 25 MB".to_string());
    }
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
    let mime = mime_from_path(&candidate).ok_or_else(|| "artifact is not a supported Judge image".to_string())?;
    let bytes = fs::read(&candidate).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_ARTIFACT_BYTES {
        return Err("invalid reveal image size".to_string());
    }
    Ok(JudgeImage { mime_type: mime.to_string(), data_base64: BASE64.encode(bytes) })
}

#[tauri::command]
pub fn write_export_package(app: tauri::AppHandle, request: WriteExportRequest) -> Result<WriteExportResponse, String> {
    validate_export_id(&request.export_id)?;
    if request.files.len() > 2000 || request.artifact_copies.len() > 500 {
        return Err("export contains too many files".to_string());
    }
    let export_root = app.path().app_data_dir().map_err(|error| error.to_string())?.join("exports");
    fs::create_dir_all(&export_root).map_err(|error| error.to_string())?;
    let directory = export_root.join(&request.export_id);
    if directory.exists() {
        return Err("export package id already exists".to_string());
    }
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let mut total_text_bytes = 0usize;
    for file in &request.files {
        total_text_bytes = total_text_bytes.saturating_add(file.content.len());
        if file.content.len() > 20 * 1024 * 1024 || total_text_bytes > 100 * 1024 * 1024 {
            return Err("export text size limit exceeded".to_string());
        }
        let relative = safe_relative_path(&file.relative_path)?;
        let destination = directory.join(relative);
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
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            fs::copy(source, destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(WriteExportResponse { directory: directory.to_string_lossy().to_string() })
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

fn mime_from_path(path: &Path) -> Option<&'static str> {
    mime_from_name(path.file_name()?.to_str()?)
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
