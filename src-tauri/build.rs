const APP_COMMANDS: &[&str] = &[
    "store_credential",
    "has_credential",
    "delete_credential",
    "credential_identity_fingerprint",
    "provider_discover_models",
    "provider_chat",
    "cancel_provider_request",
    "store_reveal_artifact",
    "store_target_artifact",
    "read_reveal_image_for_judge",
    "write_export_package",
    "storage_paths",
    "validate_live_database",
    "prepare_backup",
    "prepare_portable_backup",
    "finalize_backup",
    "finalize_portable_backup",
    "inspect_portable_backup",
    "discard_portable_backup",
    "discard_backup",
    "list_storage_backups",
    "export_storage_backup",
    "restore_backup",
    "restore_portable_backup",
    "open_data_folder",
    "open_folder",
    "open_project_url",
    "choose_directory",
    "save_text_file",
    "choose_and_import_attachments",
    "list_builtin_documents",
    "read_builtin_document",
    "save_builtin_document",
    "database_execute_transaction",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run Tauri build script");
}
