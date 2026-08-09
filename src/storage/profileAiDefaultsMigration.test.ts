import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/011_profile_ai_defaults.sql?raw";
import nativeBootstrap from "../../src-tauri/src/lib.rs?raw";

describe("Profile AI defaults migration", () => {
  it("adds persistent Viewer, Monitor and Judge defaults and registers migration 11", () => {
    expect(migration).toMatch(/default_viewer_model_id/i);
    expect(migration).toMatch(/default_monitor_provider_config_id/i);
    expect(migration).toMatch(/default_monitor_model_id/i);
    expect(migration).toMatch(/default_judge_provider_config_id/i);
    expect(migration).toMatch(/default_judge_model_id/i);
    expect(nativeBootstrap).toMatch(/version:\s*11/);
    expect(nativeBootstrap).toContain("011_profile_ai_defaults.sql");
  });
});
