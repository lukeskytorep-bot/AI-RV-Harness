import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/013_profile_viewer_defaults.sql?raw";
import migrationRegistry from "../../src-tauri/src/migrations.rs?raw";

describe("Profile Viewer defaults migration", () => {
  it("persists reasoning, temperature and System Prompt and registers migration 13", () => {
    expect(migration).toMatch(/default_viewer_reasoning_effort/i);
    expect(migration).toMatch(/default_viewer_temperature/i);
    expect(migration).toMatch(/default_viewer_system_prompt/i);
    expect(migration).toMatch(/'xhigh'/i);
    expect(migration).toMatch(/'max'/i);
    expect(migrationRegistry).toMatch(/version:\s*13/);
    expect(migrationRegistry).toContain("013_profile_viewer_defaults.sql");
  });
});
