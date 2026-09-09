import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/022_viewer_notes_source_preservation.sql?raw";
import tauriLib from "../../src-tauri/src/lib.rs?raw";


describe("Viewer Notes source preservation migration", () => {
  it("registers migration 022 after the soft-archive migration", () => {
    expect(tauriLib).toContain('version: 22');
    expect(tauriLib).toContain('include_str!("../migrations/022_viewer_notes_source_preservation.sql")');
  });

  it("rebuilds live source references as nullable SET NULL links and stores immutable source snapshots", () => {
    expect(migration).toContain("source_session_id TEXT REFERENCES rv_sessions(id) ON DELETE SET NULL");
    expect(migration).toContain("source_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL");
    expect(migration).toContain("source_snapshot_json TEXT NOT NULL");
    expect(migration).toContain("'sessionCode', COALESCE(s.session_code, '')");
    expect(migration).toContain("'workspaceName', COALESCE(w.name, '')");
    expect(migration).toContain("'trainingRunId', t.id");
    expect(migration).toContain("'trainingRunNumber', t.run_number");
    expect(migration).toContain("'trainingRunName', COALESCE(json_extract(t.record_json, '$.name'), '')");
    expect(migration).toContain("json_extract(t.record_json, '$.activeTargetCheckpoint.sessionId') = r.source_session_id");
  });

  it("preserves append-only content while allowing only live-source detachment", () => {
    expect(migration).toContain("CREATE TRIGGER ai_note_versions_append_only_update");
    expect(migration).toContain("OLD.source_session_id IS NOT NULL AND NEW.source_session_id IS NULL");
    expect(migration).toContain("NEW.source_snapshot_json IS OLD.source_snapshot_json");
    expect(migration).toContain("CREATE TRIGGER ai_note_versions_append_only_delete");
  });

  it("keeps activation history immutable except for automatic source detachment", () => {
    expect(migration).toContain("CREATE TRIGGER ai_note_activation_append_only_update");
    expect(migration).toContain("OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS NULL");
    expect(migration).toContain("CREATE TRIGGER ai_note_activation_append_only_delete");
  });
});
