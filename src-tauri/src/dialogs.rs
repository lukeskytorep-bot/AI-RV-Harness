use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

fn path_string(path: tauri_plugin_dialog::FilePath) -> Result<String, String> {
    path.into_path()
        .map(|value| value.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn choose_directory(
    app: tauri::AppHandle,
    title: String,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(title);
        if let Some(initial) = initial_directory.map(PathBuf::from).filter(|path| path.is_dir()) {
            dialog = dialog.set_directory(initial);
        }
        dialog.blocking_pick_folder().map(path_string).transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn choose_attachments(app: tauri::AppHandle, title: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .add_filter(
                "Documents and images",
                &["txt", "md", "pdf", "docx", "png", "jpg", "jpeg", "webp", "gif"],
            )
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(path_string)
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn save_text_file(
    app: tauri::AppHandle,
    title: String,
    file_name: String,
    content: String,
) -> Result<Option<String>, String> {
    if content.len() > 16 * 1024 * 1024 {
        return Err("Text export exceeds the 16 MiB safety limit".to_string());
    }
    let safe_name = PathBuf::from(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("export.md")
        .to_string();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name(safe_name)
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(path) = selected else { return Ok(None); };
    if path.exists() && path.is_symlink() {
        return Err("Refusing to overwrite a symbolic link".to_string());
    }
    std::fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

pub async fn choose_document_save_path(
    app: tauri::AppHandle,
    title: String,
    file_name: String,
) -> Result<Option<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name(file_name)
            .add_filter("Word document", &["docx"])
            .blocking_save_file()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}
