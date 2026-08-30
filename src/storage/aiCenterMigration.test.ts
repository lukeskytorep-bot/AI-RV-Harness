import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/020_ai_center_viewer_notes.sql?raw";

describe("AI Center migration integrity guards", () => {
  it("keeps note versions and activation history append-only", () => {
    expect(migration).toContain("CREATE TRIGGER ai_note_versions_append_only_update");
    expect(migration).toContain("CREATE TRIGGER ai_note_versions_append_only_delete");
    expect(migration).toContain("CREATE TRIGGER ai_note_activation_append_only_update");
    expect(migration).toContain("CREATE TRIGGER ai_note_activation_append_only_delete");
  });

  it("rejects stale bases and cross-identity active or activation versions", () => {
    expect(migration).toContain("CREATE TRIGGER ai_note_versions_stale_base_guard");
    expect(migration).toContain("CREATE TRIGGER ai_note_settings_active_identity_guard_insert");
    expect(migration).toContain("CREATE TRIGGER ai_note_settings_active_identity_guard");
    expect(migration).toContain("CREATE TRIGGER ai_note_activation_identity_guard");
  });
});
