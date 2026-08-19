use std::{path::PathBuf, process::Command};
use tauri::Manager;

#[tauri::command]
pub fn choose_directory(app: tauri::AppHandle, title: String, initial_directory: Option<String>) -> Result<Option<String>, String> {
    let initial_directory = initial_directory.or_else(|| app.path().document_dir().ok().map(|path| path.to_string_lossy().to_string()));
    #[cfg(target_os = "windows")]
    let output = {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:RVH_DIALOG_TITLE
$dialog.ShowNewFolderButton = $true
if ($env:RVH_DIALOG_INITIAL -and (Test-Path -LiteralPath $env:RVH_DIALOG_INITIAL -PathType Container)) {
  $dialog.SelectedPath = $env:RVH_DIALOG_INITIAL
}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
"#;
        Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", script])
            .env("RVH_DIALOG_TITLE", &title)
            .env("RVH_DIALOG_INITIAL", initial_directory.as_deref().unwrap_or(""))
            .output()
            .map_err(|error| error.to_string())?
    };

    #[cfg(target_os = "macos")]
    let output = Command::new("osascript")
        .args(["-e", "on run argv", "-e", "set chosenFolder to choose folder with prompt (item 1 of argv)", "-e", "return POSIX path of chosenFolder", "-e", "end run", "--", &title])
        .output()
        .map_err(|error| error.to_string())?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let output = {
        let mut command = Command::new("zenity");
        command.args(["--file-selection", "--directory", "--title", &title]);
        if let Some(initial) = initial_directory.as_deref() {
            command.args(["--filename", initial]);
        }
        command.output().map_err(|error| error.to_string())?
    };

    if !output.status.success() {
        return Ok(None);
    }
    let selected = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    let selected = selected.trim();
    if selected.is_empty() {
        return Ok(None);
    }
    let directory = PathBuf::from(selected);
    if !directory.is_dir() {
        return Err("selected path is not an accessible folder".to_string());
    }
    Ok(Some(directory.to_string_lossy().to_string()))
}
