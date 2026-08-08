PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials_metadata (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT,
  note TEXT,
  credential_id TEXT REFERENCES credentials_metadata(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspaces_profile ON workspaces(profile_id, last_opened_at DESC);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('conversation', 'manual_rv')),
  title TEXT NOT NULL,
  formal_rv_state TEXT CHECK(formal_rv_state IS NULL OR formal_rv_state IN ('BLIND', 'REVEALED', 'INTERRUPTED', 'FAILED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_sources (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  artifact_path TEXT,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models_cache (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capability_json TEXT NOT NULL DEFAULT '{}',
  pricing_json TEXT NOT NULL DEFAULT '{}',
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY(provider, model_id)
);

CREATE TABLE IF NOT EXISTS capability_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capability_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_prompts (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_class TEXT NOT NULL,
  display_name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0 CHECK(built_in IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_prompt_versions (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_id TEXT NOT NULL REFERENCES system_prompts(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('pl','en')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(prompt_id, version, language)
);

CREATE TABLE IF NOT EXISTS protocols (
  id TEXT PRIMARY KEY NOT NULL,
  family TEXT NOT NULL,
  display_name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0 CHECK(built_in IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protocol_versions (
  id TEXT PRIMARY KEY NOT NULL,
  protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('pl','en')),
  content TEXT NOT NULL,
  ordered_steps_json TEXT NOT NULL DEFAULT '[]',
  reveal_policy_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(protocol_id, version, language)
);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY NOT NULL,
  collection TEXT NOT NULL CHECK(collection IN ('training','user')),
  title TEXT NOT NULL,
  reveal_text TEXT,
  reveal_artifact_path TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS target_usage (
  id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  research_project_id TEXT,
  session_id TEXT,
  used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rv_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  session_code TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('Draft','Preflight','BlindRunning','AwaitingReveal','Revealed','Completed','Interrupted','Failed')),
  run_type TEXT NOT NULL CHECK(run_type IN ('automatic','automatic_monitor','manual')),
  pre_reveal_transcript TEXT NOT NULL DEFAULT '',
  pre_reveal_hash TEXT,
  pre_reveal_sealed_at TEXT,
  post_reveal_transcript TEXT NOT NULL DEFAULT '',
  target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
  research_project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rv_sessions_workspace ON rv_sessions(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES rv_sessions(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  role TEXT,
  content TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS session_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES rv_sessions(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reveals (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES rv_sessions(id) ON DELETE CASCADE,
  reveal_source TEXT NOT NULL,
  reveal_text TEXT,
  artifact_manifest_json TEXT NOT NULL DEFAULT '[]',
  reveal_hash TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES rv_sessions(id) ON DELETE CASCADE,
  model_route TEXT NOT NULL,
  prompt_version_id TEXT,
  library_version TEXT NOT NULL,
  max_interventions INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_interventions (
  id TEXT PRIMARY KEY NOT NULL,
  monitor_run_id TEXT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('INTERVENE','CONTINUE_PROTOCOL')),
  command_id TEXT,
  viewer_evidence TEXT,
  command_text TEXT,
  rationale TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(monitor_run_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS judge_runs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES rv_sessions(id) ON DELETE CASCADE,
  judge_index INTEGER NOT NULL CHECK(judge_index BETWEEN 1 AND 3),
  model_route TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  anonymous_session_id TEXT NOT NULL,
  packet_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, judge_index)
);

CREATE TABLE IF NOT EXISTS judge_scores (
  id TEXT PRIMARY KEY NOT NULL,
  judge_run_id TEXT NOT NULL UNIQUE REFERENCES judge_runs(id) ON DELETE CASCADE,
  gestalt REAL NOT NULL CHECK(gestalt BETWEEN 0 AND 3),
  verifiable_features REAL NOT NULL CHECK(verifiable_features BETWEEN 0 AND 3),
  activity_function_event REAL NOT NULL CHECK(activity_function_event BETWEEN 0 AND 2),
  confabulation_control REAL NOT NULL CHECK(confabulation_control BETWEEN 0 AND 2),
  total REAL NOT NULL CHECK(total BETWEEN 0 AND 10),
  rationale_json TEXT NOT NULL DEFAULT '{}',
  frozen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('Draft','Preflight','Locked','Running','SessionsComplete','Judging','ScoresFrozen','Unblinded','Complete','Interrupted','Failed')),
  config_json TEXT NOT NULL,
  config_hash TEXT,
  locked_at TEXT,
  scores_frozen_at TEXT,
  unblinded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_conditions (
  id TEXT PRIMARY KEY NOT NULL,
  research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  condition_key TEXT NOT NULL,
  condition_config_json TEXT NOT NULL,
  UNIQUE(research_project_id, condition_key)
);

CREATE TABLE IF NOT EXISTS research_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  anonymous_session_id TEXT NOT NULL,
  session_id TEXT REFERENCES rv_sessions(id) ON DELETE SET NULL,
  target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
  execution_order INTEGER NOT NULL,
  judge_order INTEGER,
  status TEXT NOT NULL,
  UNIQUE(research_project_id, anonymous_session_id)
);

CREATE TABLE IF NOT EXISTS blinding_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  anonymous_session_id TEXT NOT NULL,
  condition_id TEXT NOT NULL REFERENCES research_conditions(id) ON DELETE CASCADE,
  pair_key TEXT,
  pair_order TEXT,
  mapping_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(research_project_id, anonymous_session_id)
);

CREATE TABLE IF NOT EXISTS research_results (
  id TEXT PRIMARY KEY NOT NULL,
  research_project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  results_json TEXT NOT NULL,
  results_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  research_project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
  export_type TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS prevent_snapshot_update
BEFORE UPDATE ON session_snapshots
BEGIN
  SELECT RAISE(ABORT, 'session snapshots are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_snapshot_delete
BEFORE DELETE ON session_snapshots
BEGIN
  SELECT RAISE(ABORT, 'session snapshots are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_sealed_pre_reveal_update
BEFORE UPDATE OF pre_reveal_transcript, pre_reveal_hash ON rv_sessions
WHEN OLD.pre_reveal_sealed_at IS NOT NULL
 AND (NEW.pre_reveal_transcript <> OLD.pre_reveal_transcript OR COALESCE(NEW.pre_reveal_hash, '') <> COALESCE(OLD.pre_reveal_hash, ''))
BEGIN
  SELECT RAISE(ABORT, 'sealed pre-reveal evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_frozen_score_update
BEFORE UPDATE OF gestalt, verifiable_features, activity_function_event, confabulation_control, total ON judge_scores
WHEN OLD.frozen_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'frozen Judge scores are immutable');
END;
