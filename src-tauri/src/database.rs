use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteConnection, SqliteRow},
    Column, Connection, Row, Sqlite, Transaction, TypeInfo, ValueRef,
};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DATABASE_URL: &str = "sqlite:rv_harness.db";
const MAX_TRANSACTION_STATEMENTS: usize = 5_000;

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum DatabaseWriteOperation {
    #[serde(rename = "ai_center_update_ai_identities_01")]
    AiCenterUpdateAiIdentities01,
    #[serde(rename = "ai_center_insert_ai_identities_01")]
    AiCenterInsertAiIdentities01,
    #[serde(rename = "ai_center_insert_ai_note_settings_01")]
    AiCenterInsertAiNoteSettings01,
    #[serde(rename = "ai_center_update_ai_note_settings_01")]
    AiCenterUpdateAiNoteSettings01,
    #[serde(rename = "ai_center_update_ai_note_settings_02")]
    AiCenterUpdateAiNoteSettings02,
    #[serde(rename = "ai_center_insert_ai_note_reflection_runs_01")]
    AiCenterInsertAiNoteReflectionRuns01,
    #[serde(rename = "ai_center_update_ai_note_reflection_runs_01")]
    AiCenterUpdateAiNoteReflectionRuns01,
    #[serde(rename = "ai_center_update_ai_note_reflection_runs_02")]
    AiCenterUpdateAiNoteReflectionRuns02,
    #[serde(rename = "ai_center_insert_ai_note_versions_01")]
    AiCenterInsertAiNoteVersions01,
    #[serde(rename = "ai_center_insert_ai_note_activation_events_01")]
    AiCenterInsertAiNoteActivationEvents01,
    #[serde(rename = "ai_center_update_ai_note_settings_03")]
    AiCenterUpdateAiNoteSettings03,
    #[serde(rename = "ai_center_update_ai_note_reflection_runs_03")]
    AiCenterUpdateAiNoteReflectionRuns03,
    #[serde(rename = "ai_center_update_ai_note_reflection_runs_04")]
    AiCenterUpdateAiNoteReflectionRuns04,
    #[serde(rename = "ai_center_insert_ai_note_activation_events_02")]
    AiCenterInsertAiNoteActivationEvents02,
    #[serde(rename = "ai_center_update_ai_note_versions_01")]
    AiCenterUpdateAiNoteVersions01,
    #[serde(rename = "ai_center_update_ai_note_reflection_runs_05")]
    AiCenterUpdateAiNoteReflectionRuns05,
    #[serde(rename = "ai_center_update_ai_note_activation_events_01")]
    AiCenterUpdateAiNoteActivationEvents01,
    #[serde(rename = "ai_center_update_ai_note_versions_02")]
    AiCenterUpdateAiNoteVersions02,
    #[serde(rename = "ai_center_update_ai_note_reflection_runs_06")]
    AiCenterUpdateAiNoteReflectionRuns06,
    #[serde(rename = "ai_center_update_ai_note_activation_events_02")]
    AiCenterUpdateAiNoteActivationEvents02,
    #[serde(rename = "export_insert_exports_01")]
    ExportInsertExports01,
    #[serde(rename = "judge_insert_judge_runs_01")]
    JudgeInsertJudgeRuns01,
    #[serde(rename = "judge_insert_judge_scores_01")]
    JudgeInsertJudgeScores01,
    #[serde(rename = "monitor_insert_monitor_runs_01")]
    MonitorInsertMonitorRuns01,
    #[serde(rename = "monitor_insert_monitor_interventions_01")]
    MonitorInsertMonitorInterventions01,
    #[serde(rename = "profiles_insert_profiles_01")]
    ProfilesInsertProfiles01,
    #[serde(rename = "profiles_update_profiles_01")]
    ProfilesUpdateProfiles01,
    #[serde(rename = "profiles_update_profiles_02")]
    ProfilesUpdateProfiles02,
    #[serde(rename = "profiles_update_profiles_03")]
    ProfilesUpdateProfiles03,
    #[serde(rename = "profiles_update_profiles_04")]
    ProfilesUpdateProfiles04,
    #[serde(rename = "research_insert_research_projects_01")]
    ResearchInsertResearchProjects01,
    #[serde(rename = "research_update_research_projects_01")]
    ResearchUpdateResearchProjects01,
    #[serde(rename = "research_update_research_projects_02")]
    ResearchUpdateResearchProjects02,
    #[serde(rename = "research_update_research_projects_03")]
    ResearchUpdateResearchProjects03,
    #[serde(rename = "research_insert_research_conditions_01")]
    ResearchInsertResearchConditions01,
    #[serde(rename = "research_insert_research_assignments_01")]
    ResearchInsertResearchAssignments01,
    #[serde(rename = "research_insert_blinding_mappings_01")]
    ResearchInsertBlindingMappings01,
    #[serde(rename = "research_update_research_projects_04")]
    ResearchUpdateResearchProjects04,
    #[serde(rename = "research_update_research_assignments_01")]
    ResearchUpdateResearchAssignments01,
    #[serde(rename = "research_insert_research_results_01")]
    ResearchInsertResearchResults01,
    #[serde(rename = "sessions_insert_rv_sessions_01")]
    SessionsInsertRvSessions01,
    #[serde(rename = "sessions_update_rv_sessions_01")]
    SessionsUpdateRvSessions01,
    #[serde(rename = "sessions_update_rv_sessions_02")]
    SessionsUpdateRvSessions02,
    #[serde(rename = "sessions_insert_session_events_01")]
    SessionsInsertSessionEvents01,
    #[serde(rename = "sessions_update_rv_sessions_03")]
    SessionsUpdateRvSessions03,
    #[serde(rename = "sessions_insert_session_snapshots_01")]
    SessionsInsertSessionSnapshots01,
    #[serde(rename = "sessions_update_rv_sessions_04")]
    SessionsUpdateRvSessions04,
    #[serde(rename = "sessions_insert_reveals_01")]
    SessionsInsertReveals01,
    #[serde(rename = "sessions_update_rv_sessions_05")]
    SessionsUpdateRvSessions05,
    #[serde(rename = "sessions_update_rv_sessions_06")]
    SessionsUpdateRvSessions06,
    #[serde(rename = "sessions_insert_target_clarifications_01")]
    SessionsInsertTargetClarifications01,
    #[serde(rename = "settings_models_insert_app_settings_01")]
    SettingsModelsInsertAppSettings01,
    #[serde(rename = "settings_models_insert_credentials_metadata_01")]
    SettingsModelsInsertCredentialsMetadata01,
    #[serde(rename = "settings_models_insert_provider_configs_01")]
    SettingsModelsInsertProviderConfigs01,
    #[serde(rename = "settings_models_update_provider_configs_01")]
    SettingsModelsUpdateProviderConfigs01,
    #[serde(rename = "settings_models_update_credentials_metadata_01")]
    SettingsModelsUpdateCredentialsMetadata01,
    #[serde(rename = "settings_models_update_profiles_01")]
    SettingsModelsUpdateProfiles01,
    #[serde(rename = "settings_models_delete_provider_configs_01")]
    SettingsModelsDeleteProviderConfigs01,
    #[serde(rename = "settings_models_delete_credentials_metadata_01")]
    SettingsModelsDeleteCredentialsMetadata01,
    #[serde(rename = "settings_models_update_provider_configs_02")]
    SettingsModelsUpdateProviderConfigs02,
    #[serde(rename = "settings_models_delete_model_registry_01")]
    SettingsModelsDeleteModelRegistry01,
    #[serde(rename = "settings_models_insert_model_registry_01")]
    SettingsModelsInsertModelRegistry01,
    #[serde(rename = "settings_models_update_model_registry_01")]
    SettingsModelsUpdateModelRegistry01,
    #[serde(rename = "settings_models_delete_model_registry_02")]
    SettingsModelsDeleteModelRegistry02,
    #[serde(rename = "targets_insert_targets_01")]
    TargetsInsertTargets01,
    #[serde(rename = "targets_update_targets_01")]
    TargetsUpdateTargets01,
    #[serde(rename = "targets_update_targets_02")]
    TargetsUpdateTargets02,
    #[serde(rename = "targets_update_targets_03")]
    TargetsUpdateTargets03,
    #[serde(rename = "targets_insert_target_usage_01")]
    TargetsInsertTargetUsage01,
    #[serde(rename = "training_insert_training_runs_01")]
    TrainingInsertTrainingRuns01,
    #[serde(rename = "training_update_training_runs_01")]
    TrainingUpdateTrainingRuns01,
    #[serde(rename = "training_update_training_runs_02")]
    TrainingUpdateTrainingRuns02,
    #[serde(rename = "training_update_training_runs_03")]
    TrainingUpdateTrainingRuns03,
    #[serde(rename = "workspaces_conversations_insert_workspaces_01")]
    WorkspacesConversationsInsertWorkspaces01,
    #[serde(rename = "workspaces_conversations_update_workspaces_01")]
    WorkspacesConversationsUpdateWorkspaces01,
    #[serde(rename = "workspaces_conversations_update_workspaces_02")]
    WorkspacesConversationsUpdateWorkspaces02,
    #[serde(rename = "workspaces_conversations_update_workspaces_03")]
    WorkspacesConversationsUpdateWorkspaces03,
    #[serde(rename = "workspaces_conversations_update_workspaces_04")]
    WorkspacesConversationsUpdateWorkspaces04,
    #[serde(rename = "workspaces_conversations_insert_chat_threads_01")]
    WorkspacesConversationsInsertChatThreads01,
    #[serde(rename = "workspaces_conversations_update_chat_threads_01")]
    WorkspacesConversationsUpdateChatThreads01,
    #[serde(rename = "workspaces_conversations_update_chat_threads_02")]
    WorkspacesConversationsUpdateChatThreads02,
    #[serde(rename = "workspaces_conversations_update_chat_threads_03")]
    WorkspacesConversationsUpdateChatThreads03,
    #[serde(rename = "workspaces_conversations_update_chat_threads_04")]
    WorkspacesConversationsUpdateChatThreads04,
    #[serde(rename = "workspaces_conversations_update_chat_threads_05")]
    WorkspacesConversationsUpdateChatThreads05,
    #[serde(rename = "workspaces_conversations_insert_chat_messages_01")]
    WorkspacesConversationsInsertChatMessages01,
    #[serde(rename = "workspaces_conversations_update_chat_threads_06")]
    WorkspacesConversationsUpdateChatThreads06,
    #[serde(rename = "sqlite_update_workspaces_01")]
    SqliteUpdateWorkspaces01,
    #[serde(rename = "sqlite_update_profiles_01")]
    SqliteUpdateProfiles01,
    #[serde(rename = "sqlite_update_profiles_02")]
    SqliteUpdateProfiles02,
    #[serde(rename = "sqlite_update_workspaces_02")]
    SqliteUpdateWorkspaces02,
    #[serde(rename = "sqlite_insert_workspace_sources_01")]
    SqliteInsertWorkspaceSources01,
    #[serde(rename = "sqlite_delete_workspace_sources_01")]
    SqliteDeleteWorkspaceSources01,
    #[serde(rename = "sqlite_insert_chat_thread_sources_01")]
    SqliteInsertChatThreadSources01,
    #[serde(rename = "sqlite_insert_protocols_01")]
    SqliteInsertProtocols01,
    #[serde(rename = "sqlite_insert_protocol_versions_01")]
    SqliteInsertProtocolVersions01,
}

impl DatabaseWriteOperation {
    fn sql(self) -> &'static str {
        match self {
            Self::AiCenterUpdateAiIdentities01 => "UPDATE ai_identities SET credential_display = $1, provider_config_id = $2, model_id = $3, model_display_name = $4, route_status = 'available', last_used_at = $5, updated_at = $5 WHERE id = $6",
            Self::AiCenterInsertAiIdentities01 => "INSERT INTO ai_identities (id, profile_id, credential_fingerprint, credential_display, provider_config_id, provider, normalized_base_url, model_id, model_route, model_display_name, role, route_status, first_used_at, last_used_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'available',$12,$12,$12,$12)",
            Self::AiCenterInsertAiNoteSettings01 => "INSERT INTO ai_note_settings (ai_identity_id, note_type, capacity_tokens, default_enabled, experimental_status, updated_at) VALUES ($1,'viewer_self_notes',1024,1,'experimental',$2)",
            Self::AiCenterUpdateAiNoteSettings01 => "UPDATE ai_note_settings SET capacity_tokens = $1, updated_at = $2 WHERE ai_identity_id = $3",
            Self::AiCenterUpdateAiNoteSettings02 => "UPDATE ai_note_settings SET default_enabled = $1, updated_at = $2 WHERE ai_identity_id = $3",
            Self::AiCenterInsertAiNoteReflectionRuns01 => "INSERT INTO ai_note_reflection_runs (id, ai_identity_id, note_type, source_session_id, source_workspace_id, source_snapshot_json, base_version_id, base_content_sha256, reflection_packet_sha256, packet_json, attempt_count, status, created_at) VALUES ($1,$2,'viewer_self_notes',$3,$4,$5,$6,$7,$8,$9,0,'PENDING',$10)",
            Self::AiCenterUpdateAiNoteReflectionRuns01 => "UPDATE ai_note_reflection_runs SET status = $1, failure_message = $2, attempt_count = attempt_count + $3, provider_request_id = COALESCE($4, provider_request_id), raw_final_response_sha256 = COALESCE($5, raw_final_response_sha256), completed_at = $6 WHERE id = $7",
            Self::AiCenterUpdateAiNoteReflectionRuns02 => "UPDATE ai_note_reflection_runs SET status = 'NO_CHANGE', attempt_count = attempt_count + $1, change_summary = $2, provider_request_id = $3, raw_final_response_sha256 = $4, completed_at = $5 WHERE id = $6",
            Self::AiCenterInsertAiNoteVersions01 => "INSERT INTO ai_note_versions (id, ai_identity_id, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation, source_session_id, source_workspace_id, source_snapshot_json, protocol_id, session_run_type, change_summary, base_version_id, base_content_sha256, reflection_run_id, reflection_packet_sha256, model_route_snapshot, generation_settings_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,'conservative-char-v1',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
            Self::AiCenterInsertAiNoteActivationEvents01 => "INSERT INTO ai_note_activation_events (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, source_session_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            Self::AiCenterUpdateAiNoteSettings03 => "UPDATE ai_note_settings SET active_version_id = $1, updated_at = $2 WHERE ai_identity_id = $3",
            Self::AiCenterUpdateAiNoteReflectionRuns03 => "UPDATE ai_note_reflection_runs SET status = 'UPDATE', attempt_count = attempt_count + $1, change_summary = $2, provider_request_id = $3, raw_final_response_sha256 = $4, completed_at = $5 WHERE id = $6",
            Self::AiCenterUpdateAiNoteReflectionRuns04 => "UPDATE ai_note_reflection_runs SET status = 'STALE_BASE', failure_message = $1, completed_at = $2 WHERE id = $3",
            Self::AiCenterInsertAiNoteActivationEvents02 => "INSERT INTO ai_note_activation_events (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, created_at) VALUES ($1,$2,$3,$4,'human_restore',$5,$6)",
            Self::AiCenterUpdateAiNoteVersions01 => "UPDATE ai_note_versions SET source_session_id = NULL, source_workspace_id = NULL WHERE source_workspace_id = $1",
            Self::AiCenterUpdateAiNoteReflectionRuns05 => "UPDATE ai_note_reflection_runs SET source_session_id = NULL, source_workspace_id = NULL WHERE source_workspace_id = $1",
            Self::AiCenterUpdateAiNoteActivationEvents01 => "UPDATE ai_note_activation_events SET source_session_id = NULL, workspace_id = NULL WHERE workspace_id = $1",
            Self::AiCenterUpdateAiNoteVersions02 => "UPDATE ai_note_versions SET source_session_id = NULL WHERE source_session_id = $1",
            Self::AiCenterUpdateAiNoteReflectionRuns06 => "UPDATE ai_note_reflection_runs SET source_session_id = NULL WHERE source_session_id = $1",
            Self::AiCenterUpdateAiNoteActivationEvents02 => "UPDATE ai_note_activation_events SET source_session_id = NULL WHERE source_session_id = $1",
            Self::ExportInsertExports01 => "INSERT INTO exports (id, workspace_id, research_project_id, export_type, artifact_path, manifest_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            Self::JudgeInsertJudgeRuns01 => "INSERT INTO judge_runs (id, session_id, judge_index, model_route, rubric_version, anonymous_session_id, packet_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            Self::JudgeInsertJudgeScores01 => "INSERT INTO judge_scores (id, judge_run_id, gestalt, verifiable_features, activity_function_event, confabulation_control, total, rationale_json, frozen_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
            Self::MonitorInsertMonitorRuns01 => "INSERT INTO monitor_runs (id, session_id, model_route, prompt_version_id, library_version, max_interventions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            Self::MonitorInsertMonitorInterventions01 => "INSERT INTO monitor_interventions (id, monitor_run_id, sequence_number, decision, command_id, viewer_evidence, command_text, rationale, created_at) SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7, $8 FROM monitor_interventions WHERE monitor_run_id = $2",
            Self::ProfilesInsertProfiles01 => "INSERT INTO profiles ( id, display_name, human_display_name, note, credential_id, default_viewer_model_id, default_viewer_reasoning_effort, default_viewer_temperature, default_viewer_system_prompt, default_monitor_system_prompt, default_monitor_provider_config_id, default_monitor_model_id, default_judge_provider_config_id, default_judge_model_id, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
            Self::ProfilesUpdateProfiles01 => "UPDATE profiles SET display_name = $1, human_display_name = $2, note = $3, updated_at = $4 WHERE id = $5 AND archived_at IS NULL",
            Self::ProfilesUpdateProfiles02 => "UPDATE profiles SET credential_id = $1, default_viewer_model_id = $2, default_viewer_reasoning_effort = $3, default_viewer_temperature = $4, default_viewer_system_prompt = $5, default_monitor_system_prompt = $6, default_monitor_provider_config_id = $7, default_monitor_model_id = $8, default_judge_provider_config_id = $9, default_judge_model_id = $10, updated_at = $11 WHERE id = $12 AND archived_at IS NULL",
            Self::ProfilesUpdateProfiles03 => "UPDATE profiles SET default_monitor_system_prompt = $1, updated_at = $2 WHERE id = $3",
            Self::ProfilesUpdateProfiles04 => "UPDATE profiles SET credential_id = $1, default_viewer_model_id = NULL, default_viewer_reasoning_effort = NULL, default_viewer_temperature = NULL, updated_at = $2 WHERE id = $3",
            Self::ResearchInsertResearchProjects01 => "INSERT INTO research_projects (id, workspace_id, name, template_type, state, config_json, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $6, NULL)",
            Self::ResearchUpdateResearchProjects01 => "UPDATE research_projects SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL",
            Self::ResearchUpdateResearchProjects02 => "UPDATE research_projects SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND archived_at IS NOT NULL",
            Self::ResearchUpdateResearchProjects03 => "UPDATE research_projects SET state = $1, updated_at = $2, scores_frozen_at = CASE WHEN $1 = 'ScoresFrozen' THEN COALESCE(scores_frozen_at, $2) ELSE scores_frozen_at END, unblinded_at = CASE WHEN $1 = 'Unblinded' THEN COALESCE(unblinded_at, $2) ELSE unblinded_at END WHERE id = $3 AND archived_at IS NULL",
            Self::ResearchInsertResearchConditions01 => "INSERT INTO research_conditions (id, research_project_id, condition_key, condition_config_json) VALUES ($1, $2, $3, $4)",
            Self::ResearchInsertResearchAssignments01 => "INSERT INTO research_assignments (id, research_project_id, anonymous_session_id, session_id, target_id, target_id_snapshot, execution_order, judge_order, status) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6, $7)",
            Self::ResearchInsertBlindingMappings01 => "INSERT INTO blinding_mappings (id, research_project_id, anonymous_session_id, condition_id, pair_key, pair_order, mapping_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            Self::ResearchUpdateResearchProjects04 => "UPDATE research_projects SET state = 'Locked', config_hash = $1, locked_at = $2, updated_at = $2 WHERE id = $3 AND archived_at IS NULL AND state IN ('Draft','Preflight')",
            Self::ResearchUpdateResearchAssignments01 => "UPDATE research_assignments SET session_id = $1, status = $2 WHERE id = $3",
            Self::ResearchInsertResearchResults01 => "INSERT INTO research_results (id, research_project_id, results_json, results_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
            Self::SessionsInsertRvSessions01 => "INSERT INTO rv_sessions (id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript, post_reveal_transcript, target_id, target_id_snapshot, research_project_id, created_at, updated_at) VALUES ($1, $2, $3, $4, 'Draft', $5, '', '', $6, $6, $7, $8, $8)",
            Self::SessionsUpdateRvSessions01 => "UPDATE rv_sessions SET state = $1, updated_at = $2, completed_at = CASE WHEN $1 = 'Completed' THEN $2 ELSE completed_at END WHERE id = $3",
            Self::SessionsUpdateRvSessions02 => "UPDATE rv_sessions SET post_reveal_transcript = $1, updated_at = $2 WHERE id = $3",
            Self::SessionsInsertSessionEvents01 => "INSERT INTO session_events (id, session_id, sequence_number, event_type, role, content, metadata_json, created_at) SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7 FROM session_events WHERE session_id = $2",
            Self::SessionsUpdateRvSessions03 => "UPDATE rv_sessions SET pre_reveal_transcript = $1, updated_at = $2 WHERE id = $3",
            Self::SessionsInsertSessionSnapshots01 => "INSERT INTO session_snapshots (id, session_id, snapshot_json, snapshot_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
            Self::SessionsUpdateRvSessions04 => "UPDATE rv_sessions SET pre_reveal_transcript = $1, pre_reveal_hash = $2, pre_reveal_sealed_at = $3, state = 'AwaitingReveal', updated_at = $3 WHERE id = $4",
            Self::SessionsInsertReveals01 => "INSERT INTO reveals (id, session_id, reveal_source, reveal_text, artifact_manifest_json, reveal_hash, accepted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            Self::SessionsUpdateRvSessions05 => "UPDATE rv_sessions SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL",
            Self::SessionsUpdateRvSessions06 => "UPDATE rv_sessions SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND archived_at IS NOT NULL",
            Self::SessionsInsertTargetClarifications01 => "INSERT INTO target_clarifications (id, session_id, content, created_at) VALUES ($1, $2, $3, $4)",
            Self::SettingsModelsInsertAppSettings01 => "INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            Self::SettingsModelsInsertCredentialsMetadata01 => "INSERT INTO credentials_metadata (id, provider, label, fingerprint, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
            Self::SettingsModelsInsertProviderConfigs01 => "INSERT INTO provider_configs (id, provider, label, credential_id, credential_hint, base_url, enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)",
            Self::SettingsModelsUpdateProviderConfigs01 => "UPDATE provider_configs SET credential_hint = $1, last_status = NULL, last_error = NULL, last_tested_at = NULL, updated_at = $2 WHERE id = $3",
            Self::SettingsModelsUpdateCredentialsMetadata01 => "UPDATE credentials_metadata SET fingerprint = $1, updated_at = $2 WHERE id = $3",
            Self::SettingsModelsUpdateProfiles01 => "UPDATE profiles SET credential_id = CASE WHEN credential_id = $1 THEN NULL ELSE credential_id END, default_viewer_model_id = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_model_id END, default_viewer_reasoning_effort = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_reasoning_effort END, default_viewer_temperature = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_temperature END, default_monitor_provider_config_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_provider_config_id END, default_monitor_model_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_model_id END, default_judge_provider_config_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_provider_config_id END, default_judge_model_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_model_id END, updated_at = $3 WHERE credential_id = $1 OR default_monitor_provider_config_id = $2 OR default_judge_provider_config_id = $2",
            Self::SettingsModelsDeleteProviderConfigs01 => "DELETE FROM provider_configs WHERE id = $1",
            Self::SettingsModelsDeleteCredentialsMetadata01 => "DELETE FROM credentials_metadata WHERE id = $1",
            Self::SettingsModelsUpdateProviderConfigs02 => "UPDATE provider_configs SET last_tested_at = $1, last_status = $2, last_error = $3, updated_at = $1 WHERE id = $4",
            Self::SettingsModelsDeleteModelRegistry01 => "DELETE FROM model_registry WHERE provider_config_id = $1",
            Self::SettingsModelsInsertModelRegistry01 => "INSERT INTO model_registry (provider_config_id, provider, model_id, display_name, route, capability_json, pricing_json, recommended, favorite, raw_metadata_json, refreshed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
            Self::SettingsModelsUpdateModelRegistry01 => "UPDATE model_registry SET favorite = $1 WHERE provider_config_id = $2 AND model_id = $3",
            Self::SettingsModelsDeleteModelRegistry02 => "DELETE FROM model_registry",
            Self::TargetsInsertTargets01 => "INSERT INTO targets (id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NULL)",
            Self::TargetsUpdateTargets01 => "UPDATE targets SET title = $1, reveal_text = $2, tags_json = $3, content_hash = $4, updated_at = $5 WHERE id = $6 AND collection = 'user' AND archived_at IS NULL",
            Self::TargetsUpdateTargets02 => "UPDATE targets SET archived_at = $1, updated_at = $1 WHERE id = $2 AND collection = 'user' AND archived_at IS NULL",
            Self::TargetsUpdateTargets03 => "UPDATE targets SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND collection = 'user' AND archived_at IS NOT NULL",
            Self::TargetsInsertTargetUsage01 => "INSERT INTO target_usage (id, target_id, profile_id, research_project_id, session_id, used_at) VALUES ($1, $2, $3, $4, $5, $6)",
            Self::TrainingInsertTrainingRuns01 => "INSERT INTO training_runs (id, run_number, status, record_json, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, $5, $5, NULL)",
            Self::TrainingUpdateTrainingRuns01 => "UPDATE training_runs SET status = $1, record_json = $2, updated_at = $3 WHERE id = $4 AND archived_at IS NULL",
            Self::TrainingUpdateTrainingRuns02 => "UPDATE training_runs SET record_json = $1, archived_at = $2, updated_at = $2 WHERE id = $3 AND archived_at IS NULL",
            Self::TrainingUpdateTrainingRuns03 => "UPDATE training_runs SET record_json = $1, archived_at = NULL, updated_at = $2 WHERE id = $3 AND archived_at IS NOT NULL",
            Self::WorkspacesConversationsInsertWorkspaces01 => "INSERT INTO workspaces (id, profile_id, name, description, created_at, updated_at, last_opened_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            Self::WorkspacesConversationsUpdateWorkspaces01 => "UPDATE workspaces SET name = $1, updated_at = $2 WHERE id = $3",
            Self::WorkspacesConversationsUpdateWorkspaces02 => "UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL AND (SELECT COUNT(*) FROM workspaces sibling WHERE sibling.profile_id = workspaces.profile_id AND sibling.archived_at IS NULL) > 1",
            Self::WorkspacesConversationsUpdateWorkspaces03 => "UPDATE workspaces SET name = $1, archived_at = NULL, updated_at = $2 WHERE id = $3",
            Self::WorkspacesConversationsUpdateWorkspaces04 => "UPDATE workspaces SET updated_at = $1, last_opened_at = $1 WHERE id = $2",
            Self::WorkspacesConversationsInsertChatThreads01 => "INSERT INTO chat_threads (id, workspace_id, mode, thread_group_id, title, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $5, $5)",
            Self::WorkspacesConversationsUpdateChatThreads01 => "UPDATE chat_threads SET updated_at = $1 WHERE id = $2 AND archived_at IS NULL",
            Self::WorkspacesConversationsUpdateChatThreads02 => "UPDATE chat_threads SET title = $1, updated_at = $2 WHERE id = $3",
            Self::WorkspacesConversationsUpdateChatThreads03 => "UPDATE chat_threads SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL",
            Self::WorkspacesConversationsUpdateChatThreads04 => "UPDATE chat_threads SET archived_at = NULL, updated_at = $1 WHERE id = $2",
            Self::WorkspacesConversationsUpdateChatThreads05 => "UPDATE chat_threads SET formal_rv_state = $1, updated_at = $2 WHERE id = $3 AND mode = 'manual_rv'",
            Self::WorkspacesConversationsInsertChatMessages01 => "INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
            Self::WorkspacesConversationsUpdateChatThreads06 => "UPDATE chat_threads SET updated_at = $1 WHERE id = $2",
            Self::SqliteUpdateWorkspaces01 => "UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE profile_id = $2 AND archived_at IS NULL",
            Self::SqliteUpdateProfiles01 => "UPDATE profiles SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL",
            Self::SqliteUpdateProfiles02 => "UPDATE profiles SET archived_at = NULL, updated_at = $1 WHERE id = $2",
            Self::SqliteUpdateWorkspaces02 => "UPDATE workspaces SET archived_at = NULL, updated_at = $1 WHERE profile_id = $2 AND archived_at = $3",
            Self::SqliteInsertWorkspaceSources01 => "INSERT INTO workspace_sources (id, workspace_id, source_type, display_name, content_hash, metadata_json, content_text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            Self::SqliteDeleteWorkspaceSources01 => "DELETE FROM workspace_sources WHERE id = $1",
            Self::SqliteInsertChatThreadSources01 => "INSERT INTO chat_thread_sources (thread_id, source_id, active, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(thread_id, source_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at",
            Self::SqliteInsertProtocols01 => "INSERT INTO protocols (id, family, display_name, built_in, created_at) VALUES ($1, 'custom', $2, 0, $3)",
            Self::SqliteInsertProtocolVersions01 => "INSERT INTO protocol_versions (id, protocol_id, version, language, content, ordered_steps_json, reveal_policy_json, content_hash, source_metadata_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        }
    }

    fn expected_values(self) -> usize {
        match self {
            Self::AiCenterUpdateAiIdentities01 => 6,
            Self::AiCenterInsertAiIdentities01 => 12,
            Self::AiCenterInsertAiNoteSettings01 => 2,
            Self::AiCenterUpdateAiNoteSettings01 => 3,
            Self::AiCenterUpdateAiNoteSettings02 => 3,
            Self::AiCenterInsertAiNoteReflectionRuns01 => 10,
            Self::AiCenterUpdateAiNoteReflectionRuns01 => 7,
            Self::AiCenterUpdateAiNoteReflectionRuns02 => 6,
            Self::AiCenterInsertAiNoteVersions01 => 20,
            Self::AiCenterInsertAiNoteActivationEvents01 => 8,
            Self::AiCenterUpdateAiNoteSettings03 => 3,
            Self::AiCenterUpdateAiNoteReflectionRuns03 => 6,
            Self::AiCenterUpdateAiNoteReflectionRuns04 => 3,
            Self::AiCenterInsertAiNoteActivationEvents02 => 6,
            Self::AiCenterUpdateAiNoteVersions01 => 1,
            Self::AiCenterUpdateAiNoteReflectionRuns05 => 1,
            Self::AiCenterUpdateAiNoteActivationEvents01 => 1,
            Self::AiCenterUpdateAiNoteVersions02 => 1,
            Self::AiCenterUpdateAiNoteReflectionRuns06 => 1,
            Self::AiCenterUpdateAiNoteActivationEvents02 => 1,
            Self::ExportInsertExports01 => 7,
            Self::JudgeInsertJudgeRuns01 => 8,
            Self::JudgeInsertJudgeScores01 => 9,
            Self::MonitorInsertMonitorRuns01 => 7,
            Self::MonitorInsertMonitorInterventions01 => 8,
            Self::ProfilesInsertProfiles01 => 16,
            Self::ProfilesUpdateProfiles01 => 5,
            Self::ProfilesUpdateProfiles02 => 12,
            Self::ProfilesUpdateProfiles03 => 3,
            Self::ProfilesUpdateProfiles04 => 3,
            Self::ResearchInsertResearchProjects01 => 6,
            Self::ResearchUpdateResearchProjects01 => 2,
            Self::ResearchUpdateResearchProjects02 => 2,
            Self::ResearchUpdateResearchProjects03 => 3,
            Self::ResearchInsertResearchConditions01 => 4,
            Self::ResearchInsertResearchAssignments01 => 7,
            Self::ResearchInsertBlindingMappings01 => 8,
            Self::ResearchUpdateResearchProjects04 => 3,
            Self::ResearchUpdateResearchAssignments01 => 3,
            Self::ResearchInsertResearchResults01 => 5,
            Self::SessionsInsertRvSessions01 => 8,
            Self::SessionsUpdateRvSessions01 => 3,
            Self::SessionsUpdateRvSessions02 => 3,
            Self::SessionsInsertSessionEvents01 => 7,
            Self::SessionsUpdateRvSessions03 => 3,
            Self::SessionsInsertSessionSnapshots01 => 5,
            Self::SessionsUpdateRvSessions04 => 4,
            Self::SessionsInsertReveals01 => 7,
            Self::SessionsUpdateRvSessions05 => 2,
            Self::SessionsUpdateRvSessions06 => 2,
            Self::SessionsInsertTargetClarifications01 => 4,
            Self::SettingsModelsInsertAppSettings01 => 3,
            Self::SettingsModelsInsertCredentialsMetadata01 => 5,
            Self::SettingsModelsInsertProviderConfigs01 => 7,
            Self::SettingsModelsUpdateProviderConfigs01 => 3,
            Self::SettingsModelsUpdateCredentialsMetadata01 => 3,
            Self::SettingsModelsUpdateProfiles01 => 3,
            Self::SettingsModelsDeleteProviderConfigs01 => 1,
            Self::SettingsModelsDeleteCredentialsMetadata01 => 1,
            Self::SettingsModelsUpdateProviderConfigs02 => 4,
            Self::SettingsModelsDeleteModelRegistry01 => 1,
            Self::SettingsModelsInsertModelRegistry01 => 11,
            Self::SettingsModelsUpdateModelRegistry01 => 3,
            Self::SettingsModelsDeleteModelRegistry02 => 0,
            Self::TargetsInsertTargets01 => 10,
            Self::TargetsUpdateTargets01 => 6,
            Self::TargetsUpdateTargets02 => 2,
            Self::TargetsUpdateTargets03 => 2,
            Self::TargetsInsertTargetUsage01 => 6,
            Self::TrainingInsertTrainingRuns01 => 5,
            Self::TrainingUpdateTrainingRuns01 => 4,
            Self::TrainingUpdateTrainingRuns02 => 3,
            Self::TrainingUpdateTrainingRuns03 => 3,
            Self::WorkspacesConversationsInsertWorkspaces01 => 7,
            Self::WorkspacesConversationsUpdateWorkspaces01 => 3,
            Self::WorkspacesConversationsUpdateWorkspaces02 => 2,
            Self::WorkspacesConversationsUpdateWorkspaces03 => 3,
            Self::WorkspacesConversationsUpdateWorkspaces04 => 2,
            Self::WorkspacesConversationsInsertChatThreads01 => 5,
            Self::WorkspacesConversationsUpdateChatThreads01 => 2,
            Self::WorkspacesConversationsUpdateChatThreads02 => 3,
            Self::WorkspacesConversationsUpdateChatThreads03 => 2,
            Self::WorkspacesConversationsUpdateChatThreads04 => 2,
            Self::WorkspacesConversationsUpdateChatThreads05 => 3,
            Self::WorkspacesConversationsInsertChatMessages01 => 5,
            Self::WorkspacesConversationsUpdateChatThreads06 => 2,
            Self::SqliteUpdateWorkspaces01 => 2,
            Self::SqliteUpdateProfiles01 => 2,
            Self::SqliteUpdateProfiles02 => 2,
            Self::SqliteUpdateWorkspaces02 => 3,
            Self::SqliteInsertWorkspaceSources01 => 8,
            Self::SqliteDeleteWorkspaceSources01 => 1,
            Self::SqliteInsertChatThreadSources01 => 4,
            Self::SqliteInsertProtocols01 => 3,
            Self::SqliteInsertProtocolVersions01 => 10,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseWriteStatement {
    operation: DatabaseWriteOperation,
    #[serde(default)]
    values: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseWriteResult {
    rows_affected: u64,
}

async fn execute_statement(
    transaction: &mut Transaction<'_, Sqlite>,
    statement: DatabaseWriteStatement,
) -> Result<u64, String> {
    if statement.values.len() != statement.operation.expected_values() {
        return Err("database write operation received an invalid value count".to_string());
    }
    let mut query = sqlx::query(statement.operation.sql());
    for value in statement.values {
        query = match value {
            JsonValue::Null => query.bind(Option::<String>::None),
            JsonValue::Bool(value) => query.bind(value),
            JsonValue::Number(value) => {
                if let Some(value) = value.as_i64() {
                    query.bind(value)
                } else if let Some(value) = value.as_u64() {
                    if value <= i64::MAX as u64 { query.bind(value as i64) } else { query.bind(value as f64) }
                } else {
                    query.bind(value.as_f64().unwrap_or_default())
                }
            }
            JsonValue::String(value) => query.bind(value),
            structured @ (JsonValue::Array(_) | JsonValue::Object(_)) => query.bind(structured.to_string()),
        };
    }
    query.execute(&mut **transaction).await.map(|result| result.rows_affected()).map_err(|error| error.to_string())
}

async fn sqlite_pool(db_instances: &State<'_, DbInstances>) -> Result<sqlx::SqlitePool, String> {
    let instances = db_instances.0.read().await;
    match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err("RV Harness database is not loaded".to_string()),
    }
}

fn validate_read_query_shape(query: &str) -> Result<(), String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("database read query is empty".to_string());
    }
    if trimmed.contains(';') {
        return Err("database read channel accepts exactly one statement".to_string());
    }
    let keyword = trimmed
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if keyword != "SELECT" && keyword != "WITH" {
        return Err("database read channel accepts SELECT/WITH statements only".to_string());
    }
    Ok(())
}

async fn open_read_only_connection(path: &std::path::Path) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("read-only database cannot be opened: {error}"))?;
    sqlx::query("PRAGMA query_only = ON")
        .execute(&mut connection)
        .await
        .map_err(|error| format!("read-only database guard cannot be enabled: {error}"))?;
    Ok(connection)
}

fn row_to_json(row: &SqliteRow) -> Result<JsonValue, String> {
    let mut object = JsonMap::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(|error| error.to_string())?;
        let value = if raw.is_null() {
            JsonValue::Null
        } else {
            let type_info = raw.type_info();
            match type_info.name() {
                "INTEGER" | "NUMERIC" => row
                    .try_get::<i64, _>(index)
                    .map(JsonValue::from)
                    .unwrap_or(JsonValue::Null),
                "REAL" => row
                    .try_get::<f64, _>(index)
                    .map(JsonValue::from)
                    .unwrap_or(JsonValue::Null),
                "TEXT" => row
                    .try_get::<String, _>(index)
                    .map(JsonValue::from)
                    .unwrap_or(JsonValue::Null),
                "BOOLEAN" => row
                    .try_get::<bool, _>(index)
                    .map(JsonValue::from)
                    .unwrap_or(JsonValue::Null),
                "BLOB" => row
                    .try_get::<Vec<u8>, _>(index)
                    .map(|value| JsonValue::Array(value.into_iter().map(JsonValue::from).collect()))
                    .unwrap_or(JsonValue::Null),
                "NULL" => JsonValue::Null,
                other => return Err(format!("unsupported SQLite result type: {other}")),
            }
        };
        object.insert(column.name().to_string(), value);
    }
    Ok(JsonValue::Object(object))
}

async fn execute_read_only_query(
    path: &std::path::Path,
    query: &str,
    values: Vec<JsonValue>,
) -> Result<Vec<JsonValue>, String> {
    validate_read_query_shape(query)?;
    let mut connection = open_read_only_connection(path).await?;
    let mut statement = sqlx::query(query);
    for value in values {
        if value.is_null() {
            statement = statement.bind(None::<JsonValue>);
        } else if value.is_string() {
            statement = statement.bind(value.as_str().unwrap_or_default().to_owned());
        } else if let Some(number) = value.as_number() {
            statement = statement.bind(number.as_f64().unwrap_or_default());
        } else {
            statement = statement.bind(value);
        }
    }
    let rows = statement
        .fetch_all(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    let output = rows.iter().map(row_to_json).collect::<Result<Vec<_>, _>>()?;
    connection.close().await.map_err(|error| error.to_string())?;
    Ok(output)
}

#[tauri::command]
pub async fn database_initialize(db_instances: State<'_, DbInstances>) -> Result<(), String> {
    let pool = sqlite_pool(&db_instances).await?;
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode = WAL")
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string())?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err(format!("database journal mode initialization returned {mode}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn database_select_readonly(
    app: tauri::AppHandle,
    query: String,
    values: Vec<JsonValue>,
) -> Result<Vec<JsonValue>, String> {
    let path = crate::storage::database_path(&app)?;
    execute_read_only_query(&path, &query, values).await
}

#[tauri::command]
pub async fn database_execute_write(
    db_instances: State<'_, DbInstances>,
    statement: DatabaseWriteStatement,
) -> Result<DatabaseWriteResult, String> {
    let pool = sqlite_pool(&db_instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let rows_affected = execute_statement(&mut transaction, statement).await?;
    transaction.commit().await.map_err(|error| error.to_string())?;
    Ok(DatabaseWriteResult { rows_affected })
}

#[tauri::command]
pub async fn database_execute_write_batch(
    db_instances: State<'_, DbInstances>,
    statements: Vec<DatabaseWriteStatement>,
) -> Result<Vec<u64>, String> {
    if statements.is_empty() { return Ok(Vec::new()); }
    if statements.len() > MAX_TRANSACTION_STATEMENTS {
        return Err("database transaction contains too many statements".to_string());
    }
    let pool = sqlite_pool(&db_instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let mut rows_affected = Vec::with_capacity(statements.len());
    for statement in statements {
        match execute_statement(&mut transaction, statement).await {
            Ok(rows) => rows_affected.push(rows),
            Err(message) => {
                transaction.rollback().await.map_err(|rollback_error| format!("{message}; rollback failed: {rollback_error}"))?;
                return Err(message);
            }
        }
    }
    transaction.commit().await.map_err(|error| error.to_string())?;
    Ok(rows_affected)
}

#[tauri::command]
pub async fn database_snapshot(
    app: tauri::AppHandle,
    db_instances: State<'_, DbInstances>,
    destination_path: String,
) -> Result<(), String> {
    if destination_path.trim().is_empty() { return Err("snapshot destination is empty".to_string()); }
    let destination = crate::storage::validate_database_snapshot_destination(&app, &destination_path)?;
    let pool = sqlite_pool(&db_instances).await?;
    sqlx::query("VACUUM INTO $1")
        .bind(destination.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlledPurgeKind {
    Profile,
    Workspace,
    Conversation,
    RvSession,
    Training,
    Research,
    Target,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlledPurgeRequest {
    kind: ControlledPurgeKind,
    id: String,
}

async fn purge_exec(transaction: &mut Transaction<'_, Sqlite>, sql: &'static str, id: &str) -> Result<u64, String> {
    sqlx::query(sql).bind(id).execute(&mut **transaction).await.map(|r| r.rows_affected()).map_err(|e| e.to_string())
}

async fn ensure_archived(transaction: &mut Transaction<'_, Sqlite>, table: &'static str, id: &str) -> Result<(), String> {
    let sql = match table {
        "profiles" => "SELECT COUNT(*) FROM profiles WHERE id = $1 AND archived_at IS NOT NULL",
        "workspaces" => "SELECT COUNT(*) FROM workspaces WHERE id = $1 AND archived_at IS NOT NULL",
        "chat_threads" => "SELECT COUNT(*) FROM chat_threads WHERE id = $1 AND archived_at IS NOT NULL",
        "rv_sessions" => "SELECT COUNT(*) FROM rv_sessions WHERE id = $1 AND archived_at IS NOT NULL",
        "training_runs" => "SELECT COUNT(*) FROM training_runs WHERE id = $1 AND archived_at IS NOT NULL",
        "research_projects" => "SELECT COUNT(*) FROM research_projects WHERE id = $1 AND archived_at IS NOT NULL",
        "targets" => "SELECT COUNT(*) FROM targets WHERE id = $1 AND collection = 'user' AND archived_at IS NOT NULL",
        _ => return Err("unsupported purge entity".to_string()),
    };
    let count: i64 = sqlx::query_scalar(sql).bind(id).fetch_one(&mut **transaction).await.map_err(|e| e.to_string())?;
    if count != 1 { return Err("Permanent Delete is available only for an archived record.".to_string()); }
    Ok(())
}

#[tauri::command]
pub async fn database_controlled_purge(
    db_instances: State<'_, DbInstances>,
    request: ControlledPurgeRequest,
) -> Result<(), String> {
    if request.id.trim().is_empty() { return Err("purge id is empty".to_string()); }
    let pool = sqlite_pool(&db_instances).await?;
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;

    let table = match request.kind {
        ControlledPurgeKind::Profile => "profiles",
        ControlledPurgeKind::Workspace => "workspaces",
        ControlledPurgeKind::Conversation => "chat_threads",
        ControlledPurgeKind::RvSession => "rv_sessions",
        ControlledPurgeKind::Training => "training_runs",
        ControlledPurgeKind::Research => "research_projects",
        ControlledPurgeKind::Target => "targets",
    };
    ensure_archived(&mut tx, table, &request.id).await?;

    if matches!(request.kind, ControlledPurgeKind::RvSession) {
        let research_owned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rv_sessions WHERE id = $1 AND research_project_id IS NOT NULL")
            .bind(&request.id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        let training_owned: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM training_runs t WHERE json_valid(t.record_json) AND (EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(t.record_json, '$.sessionIds'), '[]')) WHERE value = $1) OR json_extract(t.record_json, '$.activeTargetCheckpoint.sessionId') = $1)"
        ).bind(&request.id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        if research_owned > 0 { return Err("Research-owned sessions are deleted with their Research project.".to_string()); }
        if training_owned > 0 { return Err("Training-owned sessions are deleted with their Training run.".to_string()); }
    }

    if matches!(request.kind, ControlledPurgeKind::Target) {
        let unfinished_training: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM training_runs t WHERE json_valid(t.record_json) AND COALESCE(json_extract(t.record_json, '$.status'), '') != 'Completed' AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(t.record_json, '$.targetIds'), '[]')) WHERE value = $1)"
        ).bind(&request.id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        let unfinished_research: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM research_projects r WHERE r.state NOT IN ('Complete','Interrupted','Failed') AND json_valid(r.config_json) AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.config_json, '$.targetIds'), '[]')) WHERE value = $1)"
        ).bind(&request.id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        if unfinished_training > 0 || unfinished_research > 0 {
            return Err("Target is still required by unfinished work.".to_string());
        }
    }

    sqlx::query("DELETE FROM controlled_purge_context").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO controlled_purge_context (id, reason, started_at) VALUES (1, 'SECURITY-IPC-1C controlled purge', datetime('now'))")
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;

    let result: Result<(), String> = async {
        match request.kind {
            ControlledPurgeKind::Profile => {
                purge_exec(&mut tx, "DELETE FROM target_usage WHERE profile_id = $1 OR session_id IN (SELECT id FROM rv_sessions WHERE profile_id = $1) OR research_project_id IN (SELECT id FROM research_projects WHERE workspace_id IN (SELECT id FROM workspaces WHERE profile_id = $1))", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM ai_note_activation_events WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "UPDATE ai_note_settings SET active_version_id = NULL WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "UPDATE ai_note_versions SET base_version_id = NULL WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM ai_note_versions WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM ai_note_reflection_runs WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM ai_note_settings WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM ai_identities WHERE profile_id = $1", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM rv_sessions WHERE profile_id = $1", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM training_runs WHERE json_valid(record_json) AND (json_extract(record_json, '$.profileId') = $1 OR json_extract(record_json, '$.workspaceId') IN (SELECT id FROM workspaces WHERE profile_id = $1))", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM profiles WHERE id = $1 AND archived_at IS NOT NULL", &request.id).await?;
            }
            ControlledPurgeKind::Workspace => {
                purge_exec(&mut tx, "DELETE FROM target_usage WHERE session_id IN (SELECT id FROM rv_sessions WHERE workspace_id = $1) OR research_project_id IN (SELECT id FROM research_projects WHERE workspace_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM training_runs WHERE json_valid(record_json) AND json_extract(record_json, '$.workspaceId') = $1", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM workspaces WHERE id = $1 AND archived_at IS NOT NULL", &request.id).await?;
            }
            ControlledPurgeKind::Conversation => { purge_exec(&mut tx, "DELETE FROM chat_threads WHERE id = $1 AND archived_at IS NOT NULL", &request.id).await?; }
            ControlledPurgeKind::RvSession => {
                purge_exec(&mut tx, "DELETE FROM target_usage WHERE session_id = $1", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM rv_sessions WHERE id = $1 AND archived_at IS NOT NULL", &request.id).await?;
            }
            ControlledPurgeKind::Training => {
                purge_exec(&mut tx, "DELETE FROM target_usage WHERE session_id IN (SELECT value FROM training_runs t, json_each(COALESCE(json_extract(t.record_json, '$.sessionIds'), '[]')) WHERE t.id = $1) OR session_id = (SELECT json_extract(record_json, '$.activeTargetCheckpoint.sessionId') FROM training_runs WHERE id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM rv_sessions WHERE id IN (SELECT value FROM training_runs t, json_each(COALESCE(json_extract(t.record_json, '$.sessionIds'), '[]')) WHERE t.id = $1) OR id = (SELECT json_extract(record_json, '$.activeTargetCheckpoint.sessionId') FROM training_runs WHERE id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM training_runs WHERE id = $1 AND archived_at IS NOT NULL", &request.id).await?;
            }
            ControlledPurgeKind::Research => {
                purge_exec(&mut tx, "DELETE FROM target_usage WHERE research_project_id = $1 OR session_id IN (SELECT id FROM rv_sessions WHERE research_project_id = $1)", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM exports WHERE research_project_id = $1", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM rv_sessions WHERE research_project_id = $1", &request.id).await?;
                purge_exec(&mut tx, "DELETE FROM research_projects WHERE id = $1 AND archived_at IS NOT NULL", &request.id).await?;
            }
            ControlledPurgeKind::Target => { purge_exec(&mut tx, "DELETE FROM targets WHERE id = $1 AND collection = 'user' AND archived_at IS NOT NULL", &request.id).await?; }
        }
        Ok(())
    }.await;

    if let Err(message) = result {
        let _ = tx.rollback().await;
        return Err(message);
    }
    sqlx::query("DELETE FROM controlled_purge_context WHERE id = 1").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_read_case(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "ai-rv-harness-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    async fn create_read_boundary_fixture(path: &std::path::Path) {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .expect("fixture database should open");
        sqlx::query("CREATE TABLE guarded_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&mut connection)
            .await
            .expect("fixture table should be created");
        sqlx::query("INSERT INTO guarded_rows (id, value) VALUES (1, 'original')")
            .execute(&mut connection)
            .await
            .expect("fixture row should be inserted");
        connection.close().await.expect("fixture database should close");
    }

    async fn fixture_value(path: &std::path::Path) -> String {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .read_only(true)
            .create_if_missing(false);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .expect("fixture database should reopen read-only");
        let value: String = sqlx::query_scalar("SELECT value FROM guarded_rows WHERE id = 1")
            .fetch_one(&mut connection)
            .await
            .expect("fixture value should be readable");
        connection.close().await.expect("fixture database should close");
        value
    }

    #[tokio::test]
    async fn read_channel_returns_select_rows() {
        let directory = temp_read_case("readonly-select");
        let database = directory.join("read-boundary.db");
        create_read_boundary_fixture(&database).await;

        let rows = execute_read_only_query(
            &database,
            "SELECT id, value FROM guarded_rows WHERE id = $1",
            vec![JsonValue::from(1)],
        )
        .await
        .expect("read channel should return rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], JsonValue::from(1));
        assert_eq!(rows[0]["value"], JsonValue::from("original"));

        std::fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn read_channel_preserves_sqlite_result_shapes() {
        let directory = temp_read_case("readonly-shapes");
        let database = directory.join("read-boundary.db");
        let options = SqliteConnectOptions::new()
            .filename(&database)
            .create_if_missing(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .expect("shape fixture database should open");
        sqlx::query(
            "CREATE TABLE shape_rows (i INTEGER, r REAL, t TEXT, b BLOB, n TEXT)",
        )
        .execute(&mut connection)
        .await
        .expect("shape fixture table should be created");
        sqlx::query("INSERT INTO shape_rows (i, r, t, b, n) VALUES (7, 1.5, 'text', X'0102FF', NULL)")
            .execute(&mut connection)
            .await
            .expect("shape fixture row should be inserted");
        connection
            .close()
            .await
            .expect("shape fixture database should close");

        let rows = execute_read_only_query(
            &database,
            "SELECT i, r, t, b, n FROM shape_rows WHERE i = $1",
            vec![JsonValue::from(7)],
        )
        .await
        .expect("shape fixture should be readable");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["i"], JsonValue::from(7));
        assert_eq!(rows[0]["r"], JsonValue::from(1.5));
        assert_eq!(rows[0]["t"], JsonValue::from("text"));
        assert_eq!(rows[0]["b"], serde_json::json!([1, 2, 255]));
        assert_eq!(rows[0]["n"], JsonValue::Null);

        std::fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn read_channel_rejects_mutating_returning_statements_without_changes() {
        let directory = temp_read_case("readonly-returning");
        let database = directory.join("read-boundary.db");
        create_read_boundary_fixture(&database).await;

        for query in [
            "DELETE FROM guarded_rows WHERE id = 1 RETURNING id",
            "UPDATE guarded_rows SET value = 'changed' WHERE id = 1 RETURNING id",
            "INSERT INTO guarded_rows (id, value) VALUES (2, 'new') RETURNING id",
        ] {
            assert!(execute_read_only_query(&database, query, Vec::new()).await.is_err());
            assert_eq!(fixture_value(&database).await, "original");
        }

        std::fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[tokio::test]
    async fn read_channel_rejects_pragma_attach_and_multiple_statements() {
        let directory = temp_read_case("readonly-shape");
        let database = directory.join("read-boundary.db");
        create_read_boundary_fixture(&database).await;
        let attached = directory.join("attached.db");

        let attempts = [
            "PRAGMA journal_mode = DELETE".to_string(),
            format!("ATTACH DATABASE '{}' AS escaped", attached.to_string_lossy()),
            "SELECT id FROM guarded_rows; DELETE FROM guarded_rows WHERE id = 1 RETURNING id".to_string(),
            "VACUUM INTO 'escaped.db'".to_string(),
        ];
        for query in attempts {
            assert!(execute_read_only_query(&database, &query, Vec::new()).await.is_err());
        }
        assert_eq!(fixture_value(&database).await, "original");
        assert!(!attached.exists(), "ATTACH must not create a file through the read channel");
        assert!(!directory.join("escaped.db").exists(), "VACUUM INTO must not create a file through the read channel");

        std::fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn every_named_write_has_static_sql_and_expected_arity() {
        let operations = [
            DatabaseWriteOperation::AiCenterUpdateAiIdentities01,            DatabaseWriteOperation::AiCenterInsertAiIdentities01,            DatabaseWriteOperation::AiCenterInsertAiNoteSettings01,            DatabaseWriteOperation::AiCenterUpdateAiNoteSettings01,            DatabaseWriteOperation::AiCenterUpdateAiNoteSettings02,            DatabaseWriteOperation::AiCenterInsertAiNoteReflectionRuns01,            DatabaseWriteOperation::AiCenterUpdateAiNoteReflectionRuns01,            DatabaseWriteOperation::AiCenterUpdateAiNoteReflectionRuns02,            DatabaseWriteOperation::AiCenterInsertAiNoteVersions01,            DatabaseWriteOperation::AiCenterInsertAiNoteActivationEvents01,            DatabaseWriteOperation::AiCenterUpdateAiNoteSettings03,            DatabaseWriteOperation::AiCenterUpdateAiNoteReflectionRuns03,            DatabaseWriteOperation::AiCenterUpdateAiNoteReflectionRuns04,            DatabaseWriteOperation::AiCenterInsertAiNoteActivationEvents02,            DatabaseWriteOperation::AiCenterUpdateAiNoteVersions01,            DatabaseWriteOperation::AiCenterUpdateAiNoteReflectionRuns05,            DatabaseWriteOperation::AiCenterUpdateAiNoteActivationEvents01,            DatabaseWriteOperation::AiCenterUpdateAiNoteVersions02,            DatabaseWriteOperation::AiCenterUpdateAiNoteReflectionRuns06,            DatabaseWriteOperation::AiCenterUpdateAiNoteActivationEvents02,            DatabaseWriteOperation::ExportInsertExports01,            DatabaseWriteOperation::JudgeInsertJudgeRuns01,            DatabaseWriteOperation::JudgeInsertJudgeScores01,            DatabaseWriteOperation::MonitorInsertMonitorRuns01,            DatabaseWriteOperation::MonitorInsertMonitorInterventions01,            DatabaseWriteOperation::ProfilesInsertProfiles01,            DatabaseWriteOperation::ProfilesUpdateProfiles01,            DatabaseWriteOperation::ProfilesUpdateProfiles02,            DatabaseWriteOperation::ProfilesUpdateProfiles03,            DatabaseWriteOperation::ProfilesUpdateProfiles04,            DatabaseWriteOperation::ResearchInsertResearchProjects01,            DatabaseWriteOperation::ResearchUpdateResearchProjects01,            DatabaseWriteOperation::ResearchUpdateResearchProjects02,            DatabaseWriteOperation::ResearchUpdateResearchProjects03,            DatabaseWriteOperation::ResearchInsertResearchConditions01,            DatabaseWriteOperation::ResearchInsertResearchAssignments01,            DatabaseWriteOperation::ResearchInsertBlindingMappings01,            DatabaseWriteOperation::ResearchUpdateResearchProjects04,            DatabaseWriteOperation::ResearchUpdateResearchAssignments01,            DatabaseWriteOperation::ResearchInsertResearchResults01,            DatabaseWriteOperation::SessionsInsertRvSessions01,            DatabaseWriteOperation::SessionsUpdateRvSessions01,            DatabaseWriteOperation::SessionsUpdateRvSessions02,            DatabaseWriteOperation::SessionsInsertSessionEvents01,            DatabaseWriteOperation::SessionsUpdateRvSessions03,            DatabaseWriteOperation::SessionsInsertSessionSnapshots01,            DatabaseWriteOperation::SessionsUpdateRvSessions04,            DatabaseWriteOperation::SessionsInsertReveals01,            DatabaseWriteOperation::SessionsUpdateRvSessions05,            DatabaseWriteOperation::SessionsUpdateRvSessions06,            DatabaseWriteOperation::SessionsInsertTargetClarifications01,            DatabaseWriteOperation::SettingsModelsInsertAppSettings01,            DatabaseWriteOperation::SettingsModelsInsertCredentialsMetadata01,            DatabaseWriteOperation::SettingsModelsInsertProviderConfigs01,            DatabaseWriteOperation::SettingsModelsUpdateProviderConfigs01,            DatabaseWriteOperation::SettingsModelsUpdateCredentialsMetadata01,            DatabaseWriteOperation::SettingsModelsUpdateProfiles01,            DatabaseWriteOperation::SettingsModelsDeleteProviderConfigs01,            DatabaseWriteOperation::SettingsModelsDeleteCredentialsMetadata01,            DatabaseWriteOperation::SettingsModelsUpdateProviderConfigs02,            DatabaseWriteOperation::SettingsModelsDeleteModelRegistry01,            DatabaseWriteOperation::SettingsModelsInsertModelRegistry01,            DatabaseWriteOperation::SettingsModelsUpdateModelRegistry01,            DatabaseWriteOperation::SettingsModelsDeleteModelRegistry02,            DatabaseWriteOperation::TargetsInsertTargets01,            DatabaseWriteOperation::TargetsUpdateTargets01,            DatabaseWriteOperation::TargetsUpdateTargets02,            DatabaseWriteOperation::TargetsUpdateTargets03,            DatabaseWriteOperation::TargetsInsertTargetUsage01,            DatabaseWriteOperation::TrainingInsertTrainingRuns01,            DatabaseWriteOperation::TrainingUpdateTrainingRuns01,            DatabaseWriteOperation::TrainingUpdateTrainingRuns02,            DatabaseWriteOperation::TrainingUpdateTrainingRuns03,            DatabaseWriteOperation::WorkspacesConversationsInsertWorkspaces01,            DatabaseWriteOperation::WorkspacesConversationsUpdateWorkspaces01,            DatabaseWriteOperation::WorkspacesConversationsUpdateWorkspaces02,            DatabaseWriteOperation::WorkspacesConversationsUpdateWorkspaces03,            DatabaseWriteOperation::WorkspacesConversationsUpdateWorkspaces04,            DatabaseWriteOperation::WorkspacesConversationsInsertChatThreads01,            DatabaseWriteOperation::WorkspacesConversationsUpdateChatThreads01,            DatabaseWriteOperation::WorkspacesConversationsUpdateChatThreads02,            DatabaseWriteOperation::WorkspacesConversationsUpdateChatThreads03,            DatabaseWriteOperation::WorkspacesConversationsUpdateChatThreads04,            DatabaseWriteOperation::WorkspacesConversationsUpdateChatThreads05,            DatabaseWriteOperation::WorkspacesConversationsInsertChatMessages01,            DatabaseWriteOperation::WorkspacesConversationsUpdateChatThreads06,            DatabaseWriteOperation::SqliteUpdateWorkspaces01,            DatabaseWriteOperation::SqliteUpdateProfiles01,            DatabaseWriteOperation::SqliteUpdateProfiles02,            DatabaseWriteOperation::SqliteUpdateWorkspaces02,            DatabaseWriteOperation::SqliteInsertWorkspaceSources01,            DatabaseWriteOperation::SqliteDeleteWorkspaceSources01,            DatabaseWriteOperation::SqliteInsertChatThreadSources01,            DatabaseWriteOperation::SqliteInsertProtocols01,            DatabaseWriteOperation::SqliteInsertProtocolVersions01
        ];
        assert_eq!(operations.len(), 95);
        for operation in operations {
            assert!(!operation.sql().trim().is_empty());
            assert!(!operation.sql().contains("{"));
        }
    }
}
