// SECURITY-IPC-1C: fixed write registry. SQL text stays inside the application bundle;
// only the operation identifier and bound values cross the WebView -> Rust boundary.

export type DatabaseWriteOperation =
  | "ai_center_update_ai_identities_01"
  | "ai_center_insert_ai_identities_01"
  | "ai_center_insert_ai_note_settings_01"
  | "ai_center_update_ai_note_settings_01"
  | "ai_center_update_ai_note_settings_02"
  | "ai_center_insert_ai_note_reflection_runs_01"
  | "ai_center_update_ai_note_reflection_runs_01"
  | "ai_center_update_ai_note_reflection_runs_02"
  | "ai_center_insert_ai_note_versions_01"
  | "ai_center_insert_ai_note_activation_events_01"
  | "ai_center_update_ai_note_settings_03"
  | "ai_center_update_ai_note_reflection_runs_03"
  | "ai_center_update_ai_note_reflection_runs_04"
  | "ai_center_insert_ai_note_activation_events_02"
  | "ai_center_update_ai_note_versions_01"
  | "ai_center_update_ai_note_reflection_runs_05"
  | "ai_center_update_ai_note_activation_events_01"
  | "ai_center_update_ai_note_versions_02"
  | "ai_center_update_ai_note_reflection_runs_06"
  | "ai_center_update_ai_note_activation_events_02"
  | "export_insert_exports_01"
  | "judge_insert_judge_runs_01"
  | "judge_insert_judge_scores_01"
  | "monitor_insert_monitor_runs_01"
  | "monitor_insert_monitor_interventions_01"
  | "profiles_insert_profiles_01"
  | "profiles_update_profiles_01"
  | "profiles_update_profiles_02"
  | "profiles_update_profiles_03"
  | "profiles_update_profiles_04"
  | "research_insert_research_projects_01"
  | "research_update_research_projects_01"
  | "research_update_research_projects_02"
  | "research_update_research_projects_03"
  | "research_insert_research_conditions_01"
  | "research_insert_research_assignments_01"
  | "research_insert_blinding_mappings_01"
  | "research_update_research_projects_04"
  | "research_update_research_assignments_01"
  | "research_insert_research_results_01"
  | "sessions_insert_rv_sessions_01"
  | "sessions_update_rv_sessions_01"
  | "sessions_update_rv_sessions_02"
  | "sessions_insert_session_events_01"
  | "sessions_update_rv_sessions_03"
  | "sessions_insert_session_snapshots_01"
  | "sessions_update_rv_sessions_04"
  | "sessions_insert_reveals_01"
  | "sessions_update_rv_sessions_05"
  | "sessions_update_rv_sessions_06"
  | "sessions_insert_target_clarifications_01"
  | "settings_models_insert_app_settings_01"
  | "settings_models_insert_credentials_metadata_01"
  | "settings_models_insert_provider_configs_01"
  | "settings_models_update_provider_configs_01"
  | "settings_models_update_credentials_metadata_01"
  | "settings_models_update_profiles_01"
  | "settings_models_delete_provider_configs_01"
  | "settings_models_delete_credentials_metadata_01"
  | "settings_models_update_provider_configs_02"
  | "settings_models_delete_model_registry_01"
  | "settings_models_insert_model_registry_01"
  | "settings_models_update_model_registry_01"
  | "settings_models_delete_model_registry_02"
  | "targets_insert_targets_01"
  | "targets_update_targets_01"
  | "targets_update_targets_02"
  | "targets_update_targets_03"
  | "targets_insert_target_usage_01"
  | "training_insert_training_runs_01"
  | "training_update_training_runs_01"
  | "training_update_training_runs_02"
  | "training_update_training_runs_03"
  | "workspaces_conversations_insert_workspaces_01"
  | "workspaces_conversations_update_workspaces_01"
  | "workspaces_conversations_update_workspaces_02"
  | "workspaces_conversations_update_workspaces_03"
  | "workspaces_conversations_update_workspaces_04"
  | "workspaces_conversations_insert_chat_threads_01"
  | "workspaces_conversations_update_chat_threads_01"
  | "workspaces_conversations_update_chat_threads_02"
  | "workspaces_conversations_update_chat_threads_03"
  | "workspaces_conversations_update_chat_threads_04"
  | "workspaces_conversations_update_chat_threads_05"
  | "workspaces_conversations_insert_chat_messages_01"
  | "workspaces_conversations_update_chat_threads_06"
  | "sqlite_update_workspaces_01"
  | "sqlite_update_profiles_01"
  | "sqlite_update_profiles_02"
  | "sqlite_update_workspaces_02"
  | "sqlite_insert_workspace_sources_01"
  | "sqlite_delete_workspace_sources_01"
  | "sqlite_insert_chat_thread_sources_01"
  | "sqlite_insert_protocols_01"
  | "sqlite_insert_protocol_versions_01";

const WRITE_OPERATIONS = new Map<string, DatabaseWriteOperation>([
  ["UPDATE ai_identities SET credential_display = $1, provider_config_id = $2, model_id = $3, model_display_name = $4, route_status = 'available', last_used_at = $5, updated_at = $5 WHERE id = $6", "ai_center_update_ai_identities_01"],
  ["INSERT INTO ai_identities (id, profile_id, credential_fingerprint, credential_display, provider_config_id, provider, normalized_base_url, model_id, model_route, model_display_name, role, route_status, first_used_at, last_used_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'available',$12,$12,$12,$12)", "ai_center_insert_ai_identities_01"],
  ["INSERT INTO ai_note_settings (ai_identity_id, note_type, capacity_tokens, default_enabled, experimental_status, updated_at) VALUES ($1,'viewer_self_notes',1024,1,'experimental',$2)", "ai_center_insert_ai_note_settings_01"],
  ["UPDATE ai_note_settings SET capacity_tokens = $1, updated_at = $2 WHERE ai_identity_id = $3", "ai_center_update_ai_note_settings_01"],
  ["UPDATE ai_note_settings SET default_enabled = $1, updated_at = $2 WHERE ai_identity_id = $3", "ai_center_update_ai_note_settings_02"],
  ["INSERT INTO ai_note_reflection_runs (id, ai_identity_id, note_type, source_session_id, source_workspace_id, source_snapshot_json, base_version_id, base_content_sha256, reflection_packet_sha256, packet_json, attempt_count, status, created_at) VALUES ($1,$2,'viewer_self_notes',$3,$4,$5,$6,$7,$8,$9,0,'PENDING',$10)", "ai_center_insert_ai_note_reflection_runs_01"],
  ["UPDATE ai_note_reflection_runs SET status = $1, failure_message = $2, attempt_count = attempt_count + $3, provider_request_id = COALESCE($4, provider_request_id), raw_final_response_sha256 = COALESCE($5, raw_final_response_sha256), completed_at = $6 WHERE id = $7", "ai_center_update_ai_note_reflection_runs_01"],
  ["UPDATE ai_note_reflection_runs SET status = 'NO_CHANGE', attempt_count = attempt_count + $1, change_summary = $2, provider_request_id = $3, raw_final_response_sha256 = $4, completed_at = $5 WHERE id = $6", "ai_center_update_ai_note_reflection_runs_02"],
  ["INSERT INTO ai_note_versions (id, ai_identity_id, version_number, content, content_sha256, estimated_tokens, estimator_version, capacity_tokens_at_creation, source_session_id, source_workspace_id, source_snapshot_json, protocol_id, session_run_type, change_summary, base_version_id, base_content_sha256, reflection_run_id, reflection_packet_sha256, model_route_snapshot, generation_settings_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,'conservative-char-v1',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)", "ai_center_insert_ai_note_versions_01"],
  ["INSERT INTO ai_note_activation_events (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, source_session_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", "ai_center_insert_ai_note_activation_events_01"],
  ["UPDATE ai_note_settings SET active_version_id = $1, updated_at = $2 WHERE ai_identity_id = $3", "ai_center_update_ai_note_settings_03"],
  ["UPDATE ai_note_reflection_runs SET status = 'UPDATE', attempt_count = attempt_count + $1, change_summary = $2, provider_request_id = $3, raw_final_response_sha256 = $4, completed_at = $5 WHERE id = $6", "ai_center_update_ai_note_reflection_runs_03"],
  ["UPDATE ai_note_reflection_runs SET status = 'STALE_BASE', failure_message = $1, completed_at = $2 WHERE id = $3", "ai_center_update_ai_note_reflection_runs_04"],
  ["INSERT INTO ai_note_activation_events (id, ai_identity_id, from_version_id, to_version_id, activation_source, workspace_id, created_at) VALUES ($1,$2,$3,$4,'human_restore',$5,$6)", "ai_center_insert_ai_note_activation_events_02"],
  ["UPDATE ai_note_versions SET source_session_id = NULL, source_workspace_id = NULL WHERE source_workspace_id = $1", "ai_center_update_ai_note_versions_01"],
  ["UPDATE ai_note_reflection_runs SET source_session_id = NULL, source_workspace_id = NULL WHERE source_workspace_id = $1", "ai_center_update_ai_note_reflection_runs_05"],
  ["UPDATE ai_note_activation_events SET source_session_id = NULL, workspace_id = NULL WHERE workspace_id = $1", "ai_center_update_ai_note_activation_events_01"],
  ["UPDATE ai_note_versions SET source_session_id = NULL WHERE source_session_id = $1", "ai_center_update_ai_note_versions_02"],
  ["UPDATE ai_note_reflection_runs SET source_session_id = NULL WHERE source_session_id = $1", "ai_center_update_ai_note_reflection_runs_06"],
  ["UPDATE ai_note_activation_events SET source_session_id = NULL WHERE source_session_id = $1", "ai_center_update_ai_note_activation_events_02"],
  ["INSERT INTO exports (id, workspace_id, research_project_id, export_type, artifact_path, manifest_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", "export_insert_exports_01"],
  ["INSERT INTO judge_runs (id, session_id, judge_index, model_route, rubric_version, anonymous_session_id, packet_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", "judge_insert_judge_runs_01"],
  ["INSERT INTO judge_scores (id, judge_run_id, gestalt, verifiable_features, activity_function_event, confabulation_control, total, rationale_json, frozen_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)", "judge_insert_judge_scores_01"],
  ["INSERT INTO monitor_runs (id, session_id, model_route, prompt_version_id, library_version, max_interventions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", "monitor_insert_monitor_runs_01"],
  ["INSERT INTO monitor_interventions (id, monitor_run_id, sequence_number, decision, command_id, viewer_evidence, command_text, rationale, created_at) SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7, $8 FROM monitor_interventions WHERE monitor_run_id = $2", "monitor_insert_monitor_interventions_01"],
  ["INSERT INTO profiles ( id, display_name, human_display_name, note, credential_id, default_viewer_model_id, default_viewer_reasoning_effort, default_viewer_temperature, default_viewer_system_prompt, default_monitor_system_prompt, default_monitor_provider_config_id, default_monitor_model_id, default_judge_provider_config_id, default_judge_model_id, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)", "profiles_insert_profiles_01"],
  ["UPDATE profiles SET display_name = $1, human_display_name = $2, note = $3, updated_at = $4 WHERE id = $5 AND archived_at IS NULL", "profiles_update_profiles_01"],
  ["UPDATE profiles SET credential_id = $1, default_viewer_model_id = $2, default_viewer_reasoning_effort = $3, default_viewer_temperature = $4, default_viewer_system_prompt = $5, default_monitor_system_prompt = $6, default_monitor_provider_config_id = $7, default_monitor_model_id = $8, default_judge_provider_config_id = $9, default_judge_model_id = $10, updated_at = $11 WHERE id = $12 AND archived_at IS NULL", "profiles_update_profiles_02"],
  ["UPDATE profiles SET default_monitor_system_prompt = $1, updated_at = $2 WHERE id = $3", "profiles_update_profiles_03"],
  ["UPDATE profiles SET credential_id = $1, default_viewer_model_id = NULL, default_viewer_reasoning_effort = NULL, default_viewer_temperature = NULL, updated_at = $2 WHERE id = $3", "profiles_update_profiles_04"],
  ["INSERT INTO research_projects (id, workspace_id, name, template_type, state, config_json, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, 'Draft', $5, $6, $6, NULL)", "research_insert_research_projects_01"],
  ["UPDATE research_projects SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", "research_update_research_projects_01"],
  ["UPDATE research_projects SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND archived_at IS NOT NULL", "research_update_research_projects_02"],
  ["UPDATE research_projects SET state = $1, updated_at = $2, scores_frozen_at = CASE WHEN $1 = 'ScoresFrozen' THEN COALESCE(scores_frozen_at, $2) ELSE scores_frozen_at END, unblinded_at = CASE WHEN $1 = 'Unblinded' THEN COALESCE(unblinded_at, $2) ELSE unblinded_at END WHERE id = $3 AND archived_at IS NULL", "research_update_research_projects_03"],
  ["INSERT INTO research_conditions (id, research_project_id, condition_key, condition_config_json) VALUES ($1, $2, $3, $4)", "research_insert_research_conditions_01"],
  ["INSERT INTO research_assignments (id, research_project_id, anonymous_session_id, session_id, target_id, target_id_snapshot, execution_order, judge_order, status) VALUES ($1, $2, $3, NULL, $4, $4, $5, $6, $7)", "research_insert_research_assignments_01"],
  ["INSERT INTO blinding_mappings (id, research_project_id, anonymous_session_id, condition_id, pair_key, pair_order, mapping_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", "research_insert_blinding_mappings_01"],
  ["UPDATE research_projects SET state = 'Locked', config_hash = $1, locked_at = $2, updated_at = $2 WHERE id = $3 AND archived_at IS NULL AND state IN ('Draft','Preflight')", "research_update_research_projects_04"],
  ["UPDATE research_assignments SET session_id = $1, status = $2 WHERE id = $3", "research_update_research_assignments_01"],
  ["INSERT INTO research_results (id, research_project_id, results_json, results_hash, created_at) VALUES ($1, $2, $3, $4, $5)", "research_insert_research_results_01"],
  ["INSERT INTO rv_sessions (id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript, post_reveal_transcript, target_id, target_id_snapshot, research_project_id, created_at, updated_at) VALUES ($1, $2, $3, $4, 'Draft', $5, '', '', $6, $6, $7, $8, $8)", "sessions_insert_rv_sessions_01"],
  ["UPDATE rv_sessions SET state = $1, updated_at = $2, completed_at = CASE WHEN $1 = 'Completed' THEN $2 ELSE completed_at END WHERE id = $3", "sessions_update_rv_sessions_01"],
  ["UPDATE rv_sessions SET post_reveal_transcript = $1, updated_at = $2 WHERE id = $3", "sessions_update_rv_sessions_02"],
  ["INSERT INTO session_events (id, session_id, sequence_number, event_type, role, content, metadata_json, created_at) SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7 FROM session_events WHERE session_id = $2", "sessions_insert_session_events_01"],
  ["UPDATE rv_sessions SET pre_reveal_transcript = $1, updated_at = $2 WHERE id = $3", "sessions_update_rv_sessions_03"],
  ["INSERT INTO session_snapshots (id, session_id, snapshot_json, snapshot_hash, created_at) VALUES ($1, $2, $3, $4, $5)", "sessions_insert_session_snapshots_01"],
  ["UPDATE rv_sessions SET pre_reveal_transcript = $1, pre_reveal_hash = $2, pre_reveal_sealed_at = $3, state = 'AwaitingReveal', updated_at = $3 WHERE id = $4", "sessions_update_rv_sessions_04"],
  ["INSERT INTO reveals (id, session_id, reveal_source, reveal_text, artifact_manifest_json, reveal_hash, accepted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", "sessions_insert_reveals_01"],
  ["UPDATE rv_sessions SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", "sessions_update_rv_sessions_05"],
  ["UPDATE rv_sessions SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND archived_at IS NOT NULL", "sessions_update_rv_sessions_06"],
  ["INSERT INTO target_clarifications (id, session_id, content, created_at) VALUES ($1, $2, $3, $4)", "sessions_insert_target_clarifications_01"],
  ["INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", "settings_models_insert_app_settings_01"],
  ["INSERT INTO credentials_metadata (id, provider, label, fingerprint, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)", "settings_models_insert_credentials_metadata_01"],
  ["INSERT INTO provider_configs (id, provider, label, credential_id, credential_hint, base_url, enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)", "settings_models_insert_provider_configs_01"],
  ["UPDATE provider_configs SET credential_hint = $1, last_status = NULL, last_error = NULL, last_tested_at = NULL, updated_at = $2 WHERE id = $3", "settings_models_update_provider_configs_01"],
  ["UPDATE credentials_metadata SET fingerprint = $1, updated_at = $2 WHERE id = $3", "settings_models_update_credentials_metadata_01"],
  ["UPDATE profiles SET credential_id = CASE WHEN credential_id = $1 THEN NULL ELSE credential_id END, default_viewer_model_id = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_model_id END, default_viewer_reasoning_effort = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_reasoning_effort END, default_viewer_temperature = CASE WHEN credential_id = $1 THEN NULL ELSE default_viewer_temperature END, default_monitor_provider_config_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_provider_config_id END, default_monitor_model_id = CASE WHEN default_monitor_provider_config_id = $2 THEN NULL ELSE default_monitor_model_id END, default_judge_provider_config_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_provider_config_id END, default_judge_model_id = CASE WHEN default_judge_provider_config_id = $2 THEN NULL ELSE default_judge_model_id END, updated_at = $3 WHERE credential_id = $1 OR default_monitor_provider_config_id = $2 OR default_judge_provider_config_id = $2", "settings_models_update_profiles_01"],
  ["DELETE FROM provider_configs WHERE id = $1", "settings_models_delete_provider_configs_01"],
  ["DELETE FROM credentials_metadata WHERE id = $1", "settings_models_delete_credentials_metadata_01"],
  ["UPDATE provider_configs SET last_tested_at = $1, last_status = $2, last_error = $3, updated_at = $1 WHERE id = $4", "settings_models_update_provider_configs_02"],
  ["DELETE FROM model_registry WHERE provider_config_id = $1", "settings_models_delete_model_registry_01"],
  ["INSERT INTO model_registry (provider_config_id, provider, model_id, display_name, route, capability_json, pricing_json, recommended, favorite, raw_metadata_json, refreshed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", "settings_models_insert_model_registry_01"],
  ["UPDATE model_registry SET favorite = $1 WHERE provider_config_id = $2 AND model_id = $3", "settings_models_update_model_registry_01"],
  ["DELETE FROM model_registry", "settings_models_delete_model_registry_02"],
  ["INSERT INTO targets (id, collection, title, reveal_text, reveal_artifact_path, reveal_artifact_manifest_json, tags_json, source_metadata_json, content_hash, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NULL)", "targets_insert_targets_01"],
  ["UPDATE targets SET title = $1, reveal_text = $2, tags_json = $3, content_hash = $4, updated_at = $5 WHERE id = $6 AND collection = 'user' AND archived_at IS NULL", "targets_update_targets_01"],
  ["UPDATE targets SET archived_at = $1, updated_at = $1 WHERE id = $2 AND collection = 'user' AND archived_at IS NULL", "targets_update_targets_02"],
  ["UPDATE targets SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND collection = 'user' AND archived_at IS NOT NULL", "targets_update_targets_03"],
  ["INSERT INTO target_usage (id, target_id, profile_id, research_project_id, session_id, used_at) VALUES ($1, $2, $3, $4, $5, $6)", "targets_insert_target_usage_01"],
  ["INSERT INTO training_runs (id, run_number, status, record_json, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, $5, $5, NULL)", "training_insert_training_runs_01"],
  ["UPDATE training_runs SET status = $1, record_json = $2, updated_at = $3 WHERE id = $4 AND archived_at IS NULL", "training_update_training_runs_01"],
  ["UPDATE training_runs SET record_json = $1, archived_at = $2, updated_at = $2 WHERE id = $3 AND archived_at IS NULL", "training_update_training_runs_02"],
  ["UPDATE training_runs SET record_json = $1, archived_at = NULL, updated_at = $2 WHERE id = $3 AND archived_at IS NOT NULL", "training_update_training_runs_03"],
  ["INSERT INTO workspaces (id, profile_id, name, description, created_at, updated_at, last_opened_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", "workspaces_conversations_insert_workspaces_01"],
  ["UPDATE workspaces SET name = $1, updated_at = $2 WHERE id = $3", "workspaces_conversations_update_workspaces_01"],
  ["UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL AND (SELECT COUNT(*) FROM workspaces sibling WHERE sibling.profile_id = workspaces.profile_id AND sibling.archived_at IS NULL) > 1", "workspaces_conversations_update_workspaces_02"],
  ["UPDATE workspaces SET name = $1, archived_at = NULL, updated_at = $2 WHERE id = $3", "workspaces_conversations_update_workspaces_03"],
  ["UPDATE workspaces SET updated_at = $1, last_opened_at = $1 WHERE id = $2", "workspaces_conversations_update_workspaces_04"],
  ["INSERT INTO chat_threads (id, workspace_id, mode, thread_group_id, title, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $5, $5)", "workspaces_conversations_insert_chat_threads_01"],
  ["UPDATE chat_threads SET updated_at = $1 WHERE id = $2 AND archived_at IS NULL", "workspaces_conversations_update_chat_threads_01"],
  ["UPDATE chat_threads SET title = $1, updated_at = $2 WHERE id = $3", "workspaces_conversations_update_chat_threads_02"],
  ["UPDATE chat_threads SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", "workspaces_conversations_update_chat_threads_03"],
  ["UPDATE chat_threads SET archived_at = NULL, updated_at = $1 WHERE id = $2", "workspaces_conversations_update_chat_threads_04"],
  ["UPDATE chat_threads SET formal_rv_state = $1, updated_at = $2 WHERE id = $3 AND mode = 'manual_rv'", "workspaces_conversations_update_chat_threads_05"],
  ["INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)", "workspaces_conversations_insert_chat_messages_01"],
  ["UPDATE chat_threads SET updated_at = $1 WHERE id = $2", "workspaces_conversations_update_chat_threads_06"],
  ["UPDATE workspaces SET archived_at = $1, updated_at = $1 WHERE profile_id = $2 AND archived_at IS NULL", "sqlite_update_workspaces_01"],
  ["UPDATE profiles SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL", "sqlite_update_profiles_01"],
  ["UPDATE profiles SET archived_at = NULL, updated_at = $1 WHERE id = $2", "sqlite_update_profiles_02"],
  ["UPDATE workspaces SET archived_at = NULL, updated_at = $1 WHERE profile_id = $2 AND archived_at = $3", "sqlite_update_workspaces_02"],
  ["INSERT INTO workspace_sources (id, workspace_id, source_type, display_name, content_hash, metadata_json, content_text, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", "sqlite_insert_workspace_sources_01"],
  ["DELETE FROM workspace_sources WHERE id = $1", "sqlite_delete_workspace_sources_01"],
  ["INSERT INTO chat_thread_sources (thread_id, source_id, active, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(thread_id, source_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at", "sqlite_insert_chat_thread_sources_01"],
  ["INSERT INTO protocols (id, family, display_name, built_in, created_at) VALUES ($1, 'custom', $2, 0, $3)", "sqlite_insert_protocols_01"],
  ["INSERT INTO protocol_versions (id, protocol_id, version, language, content, ordered_steps_json, reveal_policy_json, content_hash, source_metadata_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", "sqlite_insert_protocol_versions_01"],
]);

export function normalizeWriteSql(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function operationForWriteQuery(query: string): DatabaseWriteOperation {
  const normalized = normalizeWriteSql(query);
  const operation = WRITE_OPERATIONS.get(normalized);
  if (!operation) throw new Error("Unregistered SQLite write operation.");
  return operation;
}

export function registeredWriteOperationCount(): number {
  return WRITE_OPERATIONS.size;
}
