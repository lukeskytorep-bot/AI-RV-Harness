import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/011_profile_ai_defaults.sql?raw";
import migrationRegistry from "../../src-tauri/src/migrations.rs?raw";

describe("Profile AI defaults migration", () => {
  it("adds persistent Viewer, Monitor and Judge defaults and registers migration 11", () => {
    expect(migration).toMatch(/default_viewer_model_id/i);
    expect(migration).toMatch(/default_monitor_provider_config_id/i);
    expect(migration).toMatch(/default_monitor_model_id/i);
    expect(migration).toMatch(/default_judge_provider_config_id/i);
    expect(migration).toMatch(/default_judge_model_id/i);
    expect(migrationRegistry).toMatch(/version:\s*11/);
    expect(migrationRegistry).toContain("011_profile_ai_defaults.sql");
  });
});
