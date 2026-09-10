use serde_json::Value;
use sqlx::{Connection, Row, SqliteConnection};

const PRE_UX_DATA_MIGRATIONS: [&str; 20] = [
    include_str!("../migrations/001_initial.sql"),
    include_str!("../migrations/002_provider_registry.sql"),
    include_str!("../migrations/003_judge_freeze.sql"),
    include_str!("../migrations/004_research_lock.sql"),
    include_str!("../migrations/005_workspace_sources.sql"),
    include_str!("../migrations/006_target_clarifications.sql"),
    include_str!("../migrations/007_target_image_artifacts.sql"),
    include_str!("../migrations/008_model_favorites.sql"),
    include_str!("../migrations/009_post_reveal_append_only.sql"),
    include_str!("../migrations/010_atomic_reveal.sql"),
    include_str!("../migrations/011_profile_ai_defaults.sql"),
    include_str!("../migrations/012_target_mutation_guards.sql"),
    include_str!("../migrations/013_profile_viewer_defaults.sql"),
    include_str!("../migrations/014_chat_thread_archiving.sql"),
    include_str!("../migrations/015_is_be_identity_and_monitor_prompt.sql"),
    include_str!("../migrations/016_training_runs.sql"),
    include_str!("../migrations/017_chat_thread_conversation_hierarchy.sql"),
    include_str!("../migrations/018_retire_legacy_training_targets.sql"),
    include_str!("../migrations/019_add_blackbox_provider.sql"),
    include_str!("../migrations/020_ai_center_viewer_notes.sql"),
];

const UX_DATA_MIGRATIONS: [&str; 3] = [
    include_str!("../migrations/021_soft_archive_lifecycle.sql"),
    include_str!("../migrations/022_viewer_notes_source_preservation.sql"),
    include_str!("../migrations/023_controlled_purge.sql"),
];

const LEGACY_V20_FIXTURE: &str = r#"
INSERT INTO profiles(id, display_name, created_at, updated_at)
VALUES ('profile-old', 'Legacy Profile', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO workspaces(id, profile_id, name, created_at, updated_at, last_opened_at)
VALUES ('workspace-old', 'profile-old', 'Legacy Workspace', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO chat_thread_groups(id, workspace_id, mode, title, created_at, updated_at)
VALUES ('group-old', 'workspace-old', 'conversation', 'Legacy Thread', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO chat_threads(id, workspace_id, mode, title, created_at, updated_at, thread_group_id)
VALUES ('conversation-old', 'workspace-old', 'conversation', 'Legacy Conversation', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'group-old');
INSERT INTO chat_messages(id, thread_id, role, content, created_at)
VALUES ('message-old', 'conversation-old', 'user', 'preserve me', '2026-01-01T00:00:00Z');
INSERT INTO targets(id, collection, title, reveal_text, created_at, updated_at)
VALUES ('target-old', 'user', 'Legacy Target', 'Reveal', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO rv_sessions(id, workspace_id, profile_id, session_code, state, run_type, target_id, created_at, updated_at)
VALUES ('session-old', 'workspace-old', 'profile-old', 'OLD-001', 'Completed', 'automatic', 'target-old', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO training_runs(id, run_number, status, record_json, created_at, updated_at)
VALUES ('training-old', 1, 'Completed', '{"name":"Legacy Training","sessionIds":["session-old"]}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO research_projects(id, workspace_id, name, template_type, state, config_json, config_hash, locked_at, created_at, updated_at)
VALUES ('research-old', 'workspace-old', 'Legacy Research', 'blind_series', 'Locked', '{}', 'hash', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO research_conditions(id, research_project_id, condition_key, condition_config_json)
VALUES ('condition-old', 'research-old', 'A', '{}');
INSERT INTO research_assignments(id, research_project_id, anonymous_session_id, target_id, execution_order, judge_order, status)
VALUES ('assignment-old', 'research-old', 'anon-old', 'target-old', 1, 1, 'pending');
INSERT INTO ai_identities(id, profile_id, credential_fingerprint, credential_display, provider_config_id, provider, normalized_base_url, model_id, model_route, model_display_name, role, first_used_at, last_used_at, created_at, updated_at)
VALUES ('ai-old', 'profile-old', 'fp', 'key-old', 'provider-config-old', 'openrouter', '', 'model-old', 'route-old', 'Model Old', 'viewer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO ai_note_settings(ai_identity_id, capacity_tokens, default_enabled, active_version_id, updated_at)
VALUES ('ai-old', 1024, 1, NULL, '2026-01-01T00:00:00Z');
INSERT INTO ai_note_reflection_runs(id, ai_identity_id, source_session_id, source_workspace_id, reflection_packet_sha256, packet_json, attempt_count, status, created_at, completed_at)
VALUES ('reflection-old', 'ai-old', 'session-old', 'workspace-old', 'packet-sha', '{"protocolId":"full_rcp","protocolVersion":"1.5a","sessionRunType":"automatic"}', 1, 'UPDATE', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
INSERT INTO ai_note_versions(id, ai_identity_id, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation, source_session_id, source_workspace_id, protocol_id, session_run_type, change_summary, reflection_run_id, reflection_packet_sha256, model_route_snapshot, generation_settings_json, created_at)
VALUES ('note-old', 'ai-old', 1, 'legacy notes', 'note-sha', 10, 'conservative-char-v1', 1024, 'session-old', 'workspace-old', 'full_rcp', 'automatic', 'initial', 'reflection-old', 'packet-sha', 'route-old', '{}', '2026-01-01T00:00:00Z');
UPDATE ai_note_settings SET active_version_id = 'note-old' WHERE ai_identity_id = 'ai-old';
INSERT INTO ai_note_activation_events(id, ai_identity_id, to_version_id, activation_source, workspace_id, source_session_id, created_at)
VALUES ('activation-old', 'ai-old', 'note-old', 'model_update', 'workspace-old', 'session-old', '2026-01-01T00:00:00Z');
"#;

async fn apply_sql(connection: &mut SqliteConnection, sql: &str) {
    sqlx::raw_sql(sql)
        .execute(connection)
        .await
        .expect("migration SQL should execute");
}

async fn foreign_key_violation_count(connection: &mut SqliteConnection) -> usize {
    sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(connection)
        .await
        .expect("foreign_key_check should execute")
        .len()
}

#[tokio::test]
async fn legacy_v20_database_upgrades_through_023_without_losing_data_or_provenance() {
    let mut connection = SqliteConnection::connect("sqlite::memory:")
        .await
        .expect("in-memory SQLite should open");
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut connection)
        .await
        .expect("foreign keys should be enabled");

    for migration in PRE_UX_DATA_MIGRATIONS {
        apply_sql(&mut connection, migration).await;
    }
    apply_sql(&mut connection, LEGACY_V20_FIXTURE).await;
    assert_eq!(foreign_key_violation_count(&mut connection).await, 0);

    for migration in UX_DATA_MIGRATIONS {
        apply_sql(&mut connection, migration).await;
    }

    let conversation = sqlx::query("SELECT title, thread_group_id FROM chat_threads WHERE id = 'conversation-old'")
        .fetch_one(&mut connection)
        .await
        .expect("legacy Conversation should survive the upgrade");
    assert_eq!(conversation.get::<String, _>("title"), "Legacy Conversation");
    assert_eq!(conversation.get::<Option<String>, _>("thread_group_id").as_deref(), Some("group-old"));

    let message = sqlx::query_scalar::<_, String>("SELECT content FROM chat_messages WHERE id = 'message-old'")
        .fetch_one(&mut connection)
        .await
        .expect("legacy message should survive the upgrade");
    assert_eq!(message, "preserve me");

    let target_snapshot = sqlx::query("SELECT target_id, target_id_snapshot, archived_at FROM rv_sessions WHERE id = 'session-old'")
        .fetch_one(&mut connection)
        .await
        .expect("legacy Session should survive the upgrade");
    assert_eq!(target_snapshot.get::<Option<String>, _>("target_id").as_deref(), Some("target-old"));
    assert_eq!(target_snapshot.get::<Option<String>, _>("target_id_snapshot").as_deref(), Some("target-old"));
    assert!(target_snapshot.get::<Option<String>, _>("archived_at").is_none());

    let assignment_snapshot = sqlx::query_scalar::<_, Option<String>>("SELECT target_id_snapshot FROM research_assignments WHERE id = 'assignment-old'")
        .fetch_one(&mut connection)
        .await
        .expect("legacy Research assignment should survive the upgrade");
    assert_eq!(assignment_snapshot.as_deref(), Some("target-old"));

    let source_snapshot = sqlx::query_scalar::<_, String>("SELECT source_snapshot_json FROM ai_note_versions WHERE id = 'note-old'")
        .fetch_one(&mut connection)
        .await
        .expect("legacy Viewer Notes version should survive the upgrade");
    let source_snapshot: Value = serde_json::from_str(&source_snapshot).expect("Viewer Notes source snapshot should be valid JSON");
    assert_eq!(source_snapshot.get("sessionId").and_then(Value::as_str), Some("session-old"));
    assert_eq!(source_snapshot.get("workspaceId").and_then(Value::as_str), Some("workspace-old"));
    assert_eq!(source_snapshot.get("trainingRunId").and_then(Value::as_str), Some("training-old"));
    assert_eq!(source_snapshot.get("trainingRunNumber").and_then(Value::as_i64), Some(1));
    assert_eq!(source_snapshot.get("trainingRunName").and_then(Value::as_str), Some("Legacy Training"));

    let source_refs = sqlx::query("SELECT source_session_id, source_workspace_id FROM ai_note_versions WHERE id = 'note-old'")
        .fetch_one(&mut connection)
        .await
        .expect("Viewer Notes live references should still point to retained source records");
    assert_eq!(source_refs.get::<Option<String>, _>("source_session_id").as_deref(), Some("session-old"));
    assert_eq!(source_refs.get::<Option<String>, _>("source_workspace_id").as_deref(), Some("workspace-old"));

    let purge_context_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM controlled_purge_context")
        .fetch_one(&mut connection)
        .await
        .expect("controlled purge context should exist after migration 023");
    assert_eq!(purge_context_count, 0);
    assert_eq!(foreign_key_violation_count(&mut connection).await, 0);
}
