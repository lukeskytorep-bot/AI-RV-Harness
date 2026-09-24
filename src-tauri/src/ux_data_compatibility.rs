use serde_json::Value;
use sqlx::{Connection, Row, SqliteConnection};

use crate::migrations::{CURRENT_MIGRATION_VERSION, MIGRATION_SPECS};

// This fixture is intentionally inserted into the exact v0.7.13 schema-23 shape.
// It is NOT a public-v0.7.12 migration test. DATABASE-COMPATIBILITY-EPOCH-1 keeps
// migration versions 1..=20 behind the legacy compatibility gate.
const GREEN_V23_FIXTURE: &str = r#"
INSERT INTO profiles(id, display_name, default_viewer_system_prompt, created_at, updated_at)
VALUES ('profile-green', 'Green Profile', 'CUSTOM GREEN V23 VIEWER PROMPT', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO workspaces(id, profile_id, name, created_at, updated_at, last_opened_at)
VALUES ('workspace-green', 'profile-green', 'Green Workspace', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO chat_thread_groups(id, workspace_id, mode, title, created_at, updated_at)
VALUES ('group-green', 'workspace-green', 'conversation', 'Green Thread', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO chat_threads(id, workspace_id, mode, title, created_at, updated_at, thread_group_id)
VALUES ('conversation-green', 'workspace-green', 'conversation', 'Green Conversation', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z', 'group-green');
INSERT INTO chat_messages(id, thread_id, role, content, created_at)
VALUES ('message-green', 'conversation-green', 'user', 'preserve me', '2026-09-16T00:00:00Z');
INSERT INTO targets(id, collection, title, reveal_text, created_at, updated_at)
VALUES ('target-green', 'user', 'Green Target', 'Reveal', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO rv_sessions(id, workspace_id, profile_id, session_code, state, run_type, target_id, target_id_snapshot, created_at, updated_at)
VALUES ('session-green', 'workspace-green', 'profile-green', 'GREEN-001', 'Completed', 'automatic', 'target-green', 'target-green', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO training_runs(id, run_number, status, record_json, created_at, updated_at)
VALUES ('training-green', 1, 'Completed', '{"name":"Green Training","sessionIds":["session-green"]}', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO research_projects(id, workspace_id, name, template_type, state, config_json, config_hash, locked_at, created_at, updated_at)
VALUES ('research-green', 'workspace-green', 'Green Research', 'blind_series', 'Locked', '{}', 'hash', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO research_conditions(id, research_project_id, condition_key, condition_config_json)
VALUES ('condition-green', 'research-green', 'A', '{}');
INSERT INTO research_assignments(id, research_project_id, anonymous_session_id, target_id, target_id_snapshot, execution_order, judge_order, status)
VALUES ('assignment-green', 'research-green', 'anon-green', 'target-green', 'target-green', 1, 1, 'pending');
INSERT INTO ai_identities(id, profile_id, credential_fingerprint, credential_display, provider_config_id, provider, normalized_base_url, model_id, model_route, model_display_name, role, first_used_at, last_used_at, created_at, updated_at)
VALUES ('ai-green', 'profile-green', 'fp', 'key-green', 'provider-config-green', 'openrouter', 'https://openrouter.ai/api/v1', 'model-green', 'openrouter:model-green', 'Model Green', 'viewer', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO ai_note_settings(ai_identity_id, capacity_tokens, default_enabled, active_version_id, updated_at)
VALUES ('ai-green', 1024, 1, NULL, '2026-09-16T00:00:00Z');
INSERT INTO ai_note_reflection_runs(id, ai_identity_id, source_session_id, source_workspace_id, source_snapshot_json, reflection_packet_sha256, packet_json, attempt_count, status, created_at, completed_at)
VALUES ('reflection-green', 'ai-green', 'session-green', 'workspace-green', '{"schemaVersion":1,"sessionId":"session-green","sessionCode":"GREEN-001","workspaceId":"workspace-green","workspaceName":"Green Workspace","profileId":"profile-green","protocolId":"full_rcp","protocolVersion":"1.5a","sessionRunType":"automatic","capturedAt":"2026-09-16T00:00:00Z","trainingRunId":"training-green","trainingRunNumber":1,"trainingRunName":"Green Training"}', 'packet-sha', '{"protocolId":"full_rcp","protocolVersion":"1.5a","sessionRunType":"automatic"}', 1, 'UPDATE', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z');
INSERT INTO ai_note_versions(id, ai_identity_id, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation, source_session_id, source_workspace_id, source_snapshot_json, protocol_id, session_run_type, change_summary, reflection_run_id, reflection_packet_sha256, model_route_snapshot, generation_settings_json, created_at)
VALUES ('note-green', 'ai-green', 1, 'green notes', 'note-sha', 10, 'conservative-char-v1', 1024, 'session-green', 'workspace-green', '{"schemaVersion":1,"sessionId":"session-green","sessionCode":"GREEN-001","workspaceId":"workspace-green","workspaceName":"Green Workspace","profileId":"profile-green","protocolId":"full_rcp","protocolVersion":"1.5a","sessionRunType":"automatic","capturedAt":"2026-09-16T00:00:00Z","trainingRunId":"training-green","trainingRunNumber":1,"trainingRunName":"Green Training"}', 'full_rcp', 'automatic', 'initial', 'reflection-green', 'packet-sha', 'openrouter:model-green', '{}', '2026-09-16T00:00:00Z');
UPDATE ai_note_settings SET active_version_id = 'note-green' WHERE ai_identity_id = 'ai-green';
INSERT INTO ai_note_activation_events(id, ai_identity_id, to_version_id, activation_source, workspace_id, source_session_id, created_at)
VALUES ('activation-green', 'ai-green', 'note-green', 'model_update', 'workspace-green', 'session-green', '2026-09-16T00:00:00Z');
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
async fn exact_green_v23_to_v24_preserves_existing_data_and_provenance() {
    let mut connection = SqliteConnection::connect("sqlite::memory:")
        .await
        .expect("in-memory SQLite should open");
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut connection)
        .await
        .expect("foreign keys should be enabled");

    // Build the exact current-epoch schema used by the accepted green baseline.
    for migration in &MIGRATION_SPECS[..23] {
        apply_sql(&mut connection, migration.sql).await;
    }
    apply_sql(&mut connection, GREEN_V23_FIXTURE).await;
    assert_eq!(foreign_key_violation_count(&mut connection).await, 0);

    // VIEWER-LEARNING-1 upgrades only the accepted v0.7.13 schema 23 to 24.
    apply_sql(&mut connection, MIGRATION_SPECS[23].sql).await;

    let conversation = sqlx::query("SELECT title, thread_group_id FROM chat_threads WHERE id = 'conversation-green'")
        .fetch_one(&mut connection)
        .await
        .expect("green Conversation should survive the upgrade");
    assert_eq!(conversation.get::<String, _>("title"), "Green Conversation");
    assert_eq!(conversation.get::<Option<String>, _>("thread_group_id").as_deref(), Some("group-green"));

    let message = sqlx::query_scalar::<_, String>("SELECT content FROM chat_messages WHERE id = 'message-green'")
        .fetch_one(&mut connection)
        .await
        .expect("green message should survive the upgrade");
    assert_eq!(message, "preserve me");

    let note_snapshot = sqlx::query_scalar::<_, String>("SELECT source_snapshot_json FROM ai_note_versions WHERE id = 'note-green'")
        .fetch_one(&mut connection)
        .await
        .expect("Viewer Notes source snapshot should survive migration 024");
    let note_snapshot: Value = serde_json::from_str(&note_snapshot).expect("Viewer Notes source snapshot should be valid JSON");
    assert_eq!(note_snapshot.get("sessionId").and_then(Value::as_str), Some("session-green"));
    assert_eq!(note_snapshot.get("trainingRunId").and_then(Value::as_str), Some("training-green"));

    let legacy_baseline = sqlx::query("SELECT original_content, resolution_status, resolved_ai_identity_id, resolved_language FROM field_guide_legacy_baselines WHERE profile_id = 'profile-green'")
        .fetch_one(&mut connection)
        .await
        .expect("custom green v23 Viewer prompt should be preserved as a Field Guide legacy baseline");
    assert_eq!(legacy_baseline.get::<String, _>("original_content"), "CUSTOM GREEN V23 VIEWER PROMPT");
    assert_eq!(legacy_baseline.get::<String, _>("resolution_status"), "unresolved");
    assert!(legacy_baseline.get::<Option<String>, _>("resolved_ai_identity_id").is_none());
    assert!(legacy_baseline.get::<Option<String>, _>("resolved_language").is_none());

    let field_guide_versions = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM field_guide_versions")
        .fetch_one(&mut connection)
        .await
        .expect("Field Guide versions should be queryable");
    assert_eq!(field_guide_versions, 0, "migration 024 must not guess a Viewer identity or language");

    let purge_context_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM controlled_purge_context")
        .fetch_one(&mut connection)
        .await
        .expect("controlled purge context should remain available after migration 024");
    assert_eq!(purge_context_count, 0);

    let integrity = sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
        .fetch_one(&mut connection)
        .await
        .expect("integrity_check should execute");
    assert_eq!(integrity, "ok");
    assert_eq!(foreign_key_violation_count(&mut connection).await, 0);
    assert_eq!(CURRENT_MIGRATION_VERSION, 25);
    assert_eq!(MIGRATION_SPECS.last().map(|migration| migration.version), Some(25));
}

#[tokio::test]
async fn exact_green_v24_to_v25_adds_provider_state_storage_without_mutating_existing_data() {
    let mut connection = SqliteConnection::connect("sqlite::memory:")
        .await
        .expect("in-memory SQLite should open");
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut connection)
        .await
        .expect("foreign keys should be enabled");

    for migration in &MIGRATION_SPECS[..23] {
        apply_sql(&mut connection, migration.sql).await;
    }
    apply_sql(&mut connection, GREEN_V23_FIXTURE).await;
    apply_sql(&mut connection, MIGRATION_SPECS[23].sql).await;
    assert_eq!(foreign_key_violation_count(&mut connection).await, 0);

    let message_before = sqlx::query_scalar::<_, String>("SELECT content FROM chat_messages WHERE id = 'message-green'")
        .fetch_one(&mut connection)
        .await
        .expect("green message should exist before migration 025");
    apply_sql(&mut connection, MIGRATION_SPECS[24].sql).await;
    let message_after = sqlx::query_scalar::<_, String>("SELECT content FROM chat_messages WHERE id = 'message-green'")
        .fetch_one(&mut connection)
        .await
        .expect("green message should survive migration 025");
    assert_eq!(message_after, message_before);

    for table in ["chat_message_provider_state", "session_event_provider_state"] {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&mut connection)
        .await
        .expect("migration 025 table lookup should execute");
        assert_eq!(exists, 1, "migration 025 should create {table}");
    }

    sqlx::query("INSERT INTO chat_messages(id, thread_id, role, content, created_at) VALUES ('assistant-green', 'conversation-green', 'assistant', 'answer', '2026-09-24T00:00:00Z')")
        .execute(&mut connection)
        .await
        .expect("assistant message fixture should insert");
    sqlx::query("INSERT INTO session_events(id, session_id, sequence_number, event_type, role, content, metadata_json, created_at) VALUES ('event-green', 'session-green', 1, 'VIEWER_RESPONSE', 'assistant', 'answer', '{}', '2026-09-24T00:00:00Z')")
        .execute(&mut connection)
        .await
        .expect("session event fixture should insert");
    let payload = r#"{"schemaVersion":1,"transport":"openrouter","format":"openrouter-reasoning-details","replayFingerprint":{"transport":"openrouter"},"reasoningDetails":[]}"#;
    let fingerprint = r#"{"transport":"openrouter"}"#;
    let sha = "0".repeat(64);
    sqlx::query("INSERT INTO chat_message_provider_state(message_id, format, format_version, transport, replay_fingerprint_json, payload_json, payload_sha256, payload_size_bytes, created_at) VALUES ('assistant-green','openrouter-reasoning-details',1,'openrouter',?,?,?,?,'2026-09-24T00:00:00Z')")
        .bind(fingerprint)
        .bind(payload)
        .bind(&sha)
        .bind(payload.len() as i64)
        .execute(&mut connection)
        .await
        .expect("Conversation provider state fixture should insert");
    sqlx::query("INSERT INTO session_event_provider_state(session_event_id, format, format_version, transport, replay_fingerprint_json, payload_json, payload_sha256, payload_size_bytes, created_at) VALUES ('event-green','openrouter-reasoning-details',1,'openrouter',?,?,?,?,'2026-09-24T00:00:00Z')")
        .bind(fingerprint)
        .bind(payload)
        .bind(&sha)
        .bind(payload.len() as i64)
        .execute(&mut connection)
        .await
        .expect("Session provider state fixture should insert");

    sqlx::query("DELETE FROM chat_messages WHERE id = 'assistant-green'")
        .execute(&mut connection)
        .await
        .expect("assistant message should delete");
    sqlx::query("DELETE FROM session_events WHERE id = 'event-green'")
        .execute(&mut connection)
        .await
        .expect("session event should delete");
    let chat_state = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM chat_message_provider_state")
        .fetch_one(&mut connection)
        .await
        .expect("Conversation state count should query");
    let session_state = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_event_provider_state")
        .fetch_one(&mut connection)
        .await
        .expect("Session state count should query");
    assert_eq!(chat_state, 0, "Conversation provider state should cascade with its message");
    assert_eq!(session_state, 0, "Session provider state should cascade with its event");
    assert_eq!(foreign_key_violation_count(&mut connection).await, 0);
    assert_eq!(CURRENT_MIGRATION_VERSION, 25);
    assert_eq!(MIGRATION_SPECS.last().map(|migration| migration.version), Some(25));
}
