PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telepathic_series (
  id TEXT PRIMARY KEY NOT NULL,
  series_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('conversation_exchange','ai_ai_training')),
  language TEXT NOT NULL CHECK (language IN ('pl','en')),
  status TEXT NOT NULL CHECK (status IN ('ready','running','paused','completed','cancelled','blocked')),
  current_round_index INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telepathic_participants (
  series_id TEXT NOT NULL REFERENCES telepathic_series(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('human','ai')),
  display_name TEXT NOT NULL,
  profile_id TEXT,
  workspace_id TEXT,
  ai_identity_id TEXT,
  provider_config_id TEXT,
  credential_id TEXT,
  model_id TEXT,
  model_route TEXT,
  route_snapshot_json TEXT,
  field_guide_snapshot_json TEXT,
  viewer_notes_snapshot_json TEXT,
  final_reflection_text TEXT,
  PRIMARY KEY (series_id, participant_id)
);

CREATE TABLE IF NOT EXISTS telepathic_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  series_id TEXT NOT NULL REFERENCES telepathic_series(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  sender_participant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','preparing_target','blind','revealed','reflections','sharing','completed','cancelled','blocked')),
  revealed_at TEXT,
  completed_at TEXT,
  blocked_reason TEXT,
  UNIQUE(series_id, round_number)
);

CREATE TABLE IF NOT EXISTS telepathic_targets (
  round_id TEXT PRIMARY KEY NOT NULL REFERENCES telepathic_rounds(id) ON DELETE CASCADE,
  sender_participant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  assets_manifest_json TEXT NOT NULL DEFAULT '[]',
  content_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('locked','transmission_ready')),
  locked_at TEXT NOT NULL,
  transmission_ready_at TEXT
);

CREATE TABLE IF NOT EXISTS telepathic_blind_submissions (
  round_id TEXT NOT NULL REFERENCES telepathic_rounds(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','first_complete','second_complete','no_submission','sealed')),
  first_text TEXT,
  second_text TEXT,
  provider_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_attempt_count BETWEEN 0 AND 2),
  content_sha256 TEXT,
  sealed_at TEXT,
  PRIMARY KEY (round_id, participant_id)
);

CREATE TABLE IF NOT EXISTS telepathic_reflections (
  round_id TEXT NOT NULL REFERENCES telepathic_rounds(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sender','receiver')),
  reflection_text TEXT,
  share_others_consent TEXT CHECK (share_others_consent IN ('yes','no')),
  shared_answers_comment TEXT,
  PRIMARY KEY (round_id, participant_id)
);

CREATE TABLE IF NOT EXISTS telepathic_provider_calls (
  id TEXT PRIMARY KEY NOT NULL,
  series_id TEXT NOT NULL REFERENCES telepathic_series(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  call_stage TEXT NOT NULL,
  technical_attempt INTEGER NOT NULL CHECK (technical_attempt BETWEEN 1 AND 2),
  status TEXT NOT NULL CHECK (status IN ('prepared','dispatched','succeeded','failed','uncertain')),
  scope_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  provider_request_id TEXT,
  response_text TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telepathic_series_workspace ON telepathic_series(series_workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_telepathic_rounds_series ON telepathic_rounds(series_id, round_number);
CREATE INDEX IF NOT EXISTS idx_telepathic_calls_scope ON telepathic_provider_calls(series_id, round_id, participant_id, call_stage, technical_attempt);

CREATE TRIGGER IF NOT EXISTS telepathic_target_content_immutable
BEFORE UPDATE OF sender_participant_id, content, assets_manifest_json, content_sha256, locked_at ON telepathic_targets
BEGIN
  SELECT RAISE(ABORT, 'locked telepathic target content is immutable');
END;

CREATE TRIGGER IF NOT EXISTS telepathic_target_status_forward_only
BEFORE UPDATE OF status ON telepathic_targets
WHEN OLD.status = 'transmission_ready' OR NEW.status <> 'transmission_ready'
BEGIN
  SELECT RAISE(ABORT, 'telepathic target status can only advance from locked to transmission_ready');
END;
