mod secrets;
mod migrations;
mod providers;
mod artifacts;
mod storage;
mod database;
mod dialogs;
mod documents;
#[cfg(test)]
mod ux_data_compatibility;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations::registered_migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("pre-migration-backup")
                .setup(|app, _api| {
                    storage::backup_database_before_migrations(app)
                        .map_err(|error| Box::<dyn std::error::Error>::from(std::io::Error::other(error)))?;
                    Ok(())
                })
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:rv_harness.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            secrets::store_credential,
            secrets::has_credential,
            secrets::delete_credential,
            secrets::credential_identity_fingerprint,
            providers::provider_discover_models,
            providers::provider_chat,
            providers::cancel_provider_request,
            artifacts::store_reveal_artifact,
            artifacts::store_target_artifact,
            artifacts::read_reveal_image_for_judge,
            artifacts::write_export_package,
            storage::storage_paths,
            storage::validate_live_database,
            storage::prepare_backup,
            storage::prepare_portable_backup,
            storage::finalize_backup,
            storage::finalize_portable_backup,
            storage::inspect_portable_backup,
            storage::discard_portable_backup,
            storage::discard_backup,
            storage::list_storage_backups,
            storage::export_storage_backup,
            storage::restore_backup,
            storage::restore_portable_backup,
            storage::open_data_folder,
            storage::open_folder,
            storage::open_project_url,
            dialogs::choose_directory,
            dialogs::save_text_file,
            documents::choose_and_import_attachments,
            documents::list_builtin_documents,
            documents::read_builtin_document,
            documents::save_builtin_document,
            database::database_execute_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI RV Harness");
}
