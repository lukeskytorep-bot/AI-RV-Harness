mod secrets;
mod providers;
mod artifacts;
mod storage;
mod database;
mod dialogs;
mod documents;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial_rv_harness_schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "provider_registry",
            sql: include_str!("../migrations/002_provider_registry.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "judge_freeze_guards",
            sql: include_str!("../migrations/003_judge_freeze.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "research_lock_guards",
            sql: include_str!("../migrations/004_research_lock.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "workspace_source_content_and_thread_selection",
            sql: include_str!("../migrations/005_workspace_sources.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "immutable_post_reveal_target_clarifications",
            sql: include_str!("../migrations/006_target_clarifications.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "target_image_artifact_manifest",
            sql: include_str!("../migrations/007_target_image_artifacts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "persistent_model_favorites",
            sql: include_str!("../migrations/008_model_favorites.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "append_only_post_reveal_transcript",
            sql: include_str!("../migrations/009_post_reveal_append_only.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "atomic_reveal_state_transition",
            sql: include_str!("../migrations/010_atomic_reveal.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "profile_ai_role_defaults",
            sql: include_str!("../migrations/011_profile_ai_defaults.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "target_mutation_guards",
            sql: include_str!("../migrations/012_target_mutation_guards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "profile_viewer_generation_and_prompt_defaults",
            sql: include_str!("../migrations/013_profile_viewer_defaults.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "chat_thread_archiving_and_recent_selection",
            sql: include_str!("../migrations/014_chat_thread_archiving.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "is_be_identity_and_monitor_prompt",
            sql: include_str!("../migrations/015_is_be_identity_and_monitor_prompt.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "training_run_checkpoints",
            sql: include_str!("../migrations/016_training_runs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "chat_thread_conversation_hierarchy",
            sql: include_str!("../migrations/017_chat_thread_conversation_hierarchy.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "retire_legacy_training_target_pack",
            sql: include_str!("../migrations/018_retire_legacy_training_targets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add_blackbox_provider",
            sql: include_str!("../migrations/019_add_blackbox_provider.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri::plugin::Builder::new("pre-migration-backup")
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
            dialogs::choose_directory,
            dialogs::choose_attachments,
            documents::import_attachment,
            documents::list_builtin_documents,
            documents::read_builtin_document,
            documents::save_builtin_document,
            database::database_execute_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI RV Harness");
}
