PRAGMA foreign_keys = ON;

CREATE TABLE chat_message_provider_state (
  message_id TEXT NOT NULL,
  format TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK(format_version > 0),
  transport TEXT NOT NULL CHECK(transport IN ('openrouter','google-native','anthropic-native')),
  replay_fingerprint_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  payload_size_bytes INTEGER NOT NULL CHECK(payload_size_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, format, format_version),
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_message_provider_state_message
ON chat_message_provider_state(message_id);

CREATE TABLE session_event_provider_state (
  session_event_id TEXT NOT NULL,
  format TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK(format_version > 0),
  transport TEXT NOT NULL CHECK(transport IN ('openrouter','google-native','anthropic-native')),
  replay_fingerprint_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  payload_size_bytes INTEGER NOT NULL CHECK(payload_size_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_event_id, format, format_version),
  FOREIGN KEY (session_event_id) REFERENCES session_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_event_provider_state_event
ON session_event_provider_state(session_event_id);
