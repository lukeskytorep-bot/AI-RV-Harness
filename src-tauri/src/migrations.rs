use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Clone, Copy)]
pub(crate) struct MigrationSpec {
    pub(crate) version: i64,
    pub(crate) description: &'static str,
    pub(crate) sql: &'static str,
}

pub(crate) const MIGRATION_SPECS: &[MigrationSpec] = &[
    MigrationSpec {
        version: 1,
        description: "initial_rv_harness_schema",
        sql: include_str!("../migrations/001_initial.sql"),
    },
    MigrationSpec {
        version: 2,
        description: "provider_registry",
        sql: include_str!("../migrations/002_provider_registry.sql"),
    },
    MigrationSpec {
        version: 3,
        description: "judge_freeze_guards",
        sql: include_str!("../migrations/003_judge_freeze.sql"),
    },
    MigrationSpec {
        version: 4,
        description: "research_lock_guards",
        sql: include_str!("../migrations/004_research_lock.sql"),
    },
    MigrationSpec {
        version: 5,
        description: "workspace_source_content_and_thread_selection",
        sql: include_str!("../migrations/005_workspace_sources.sql"),
    },
    MigrationSpec {
        version: 6,
        description: "immutable_post_reveal_target_clarifications",
        sql: include_str!("../migrations/006_target_clarifications.sql"),
    },
    MigrationSpec {
        version: 7,
        description: "target_image_artifact_manifest",
        sql: include_str!("../migrations/007_target_image_artifacts.sql"),
    },
    MigrationSpec {
        version: 8,
        description: "persistent_model_favorites",
        sql: include_str!("../migrations/008_model_favorites.sql"),
    },
    MigrationSpec {
        version: 9,
        description: "append_only_post_reveal_transcript",
        sql: include_str!("../migrations/009_post_reveal_append_only.sql"),
    },
    MigrationSpec {
        version: 10,
        description: "atomic_reveal_state_transition",
        sql: include_str!("../migrations/010_atomic_reveal.sql"),
    },
    MigrationSpec {
        version: 11,
        description: "profile_ai_role_defaults",
        sql: include_str!("../migrations/011_profile_ai_defaults.sql"),
    },
    MigrationSpec {
        version: 12,
        description: "target_mutation_guards",
        sql: include_str!("../migrations/012_target_mutation_guards.sql"),
    },
    MigrationSpec {
        version: 13,
        description: "profile_viewer_generation_and_prompt_defaults",
        sql: include_str!("../migrations/013_profile_viewer_defaults.sql"),
    },
    MigrationSpec {
        version: 14,
        description: "chat_thread_archiving_and_recent_selection",
        sql: include_str!("../migrations/014_chat_thread_archiving.sql"),
    },
    MigrationSpec {
        version: 15,
        description: "is_be_identity_and_monitor_prompt",
        sql: include_str!("../migrations/015_is_be_identity_and_monitor_prompt.sql"),
    },
    MigrationSpec {
        version: 16,
        description: "training_run_checkpoints",
        sql: include_str!("../migrations/016_training_runs.sql"),
    },
    MigrationSpec {
        version: 17,
        description: "chat_thread_conversation_hierarchy",
        sql: include_str!("../migrations/017_chat_thread_conversation_hierarchy.sql"),
    },
    MigrationSpec {
        version: 18,
        description: "retire_legacy_training_target_pack",
        sql: include_str!("../migrations/018_retire_legacy_training_targets.sql"),
    },
    MigrationSpec {
        version: 19,
        description: "add_blackbox_provider",
        sql: include_str!("../migrations/019_add_blackbox_provider.sql"),
    },
    MigrationSpec {
        version: 20,
        description: "ai_center_viewer_notes",
        sql: include_str!("../migrations/020_ai_center_viewer_notes.sql"),
    },
    MigrationSpec {
        version: 21,
        description: "soft_archive_lifecycle",
        sql: include_str!("../migrations/021_soft_archive_lifecycle.sql"),
    },
    MigrationSpec {
        version: 22,
        description: "viewer_notes_source_preservation",
        sql: include_str!("../migrations/022_viewer_notes_source_preservation.sql"),
    },
    MigrationSpec {
        version: 23,
        description: "controlled_purge",
        sql: include_str!("../migrations/023_controlled_purge.sql"),
    },
];

pub(crate) const CURRENT_MIGRATION_VERSION: i64 =
    MIGRATION_SPECS[MIGRATION_SPECS.len() - 1].version;

pub(crate) fn registered_migrations() -> Vec<Migration> {
    MIGRATION_SPECS
        .iter()
        .map(|migration| Migration {
            version: migration.version,
            description: migration.description,
            sql: migration.sql,
            kind: MigrationKind::Up,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_is_contiguous_and_current_version_is_023() {
        let versions = MIGRATION_SPECS
            .iter()
            .map(|migration| migration.version)
            .collect::<Vec<_>>();
        assert_eq!(versions, (1_i64..=23).collect::<Vec<_>>());
        assert_eq!(CURRENT_MIGRATION_VERSION, 23);
        assert_eq!(registered_migrations().len(), MIGRATION_SPECS.len());
    }
}
