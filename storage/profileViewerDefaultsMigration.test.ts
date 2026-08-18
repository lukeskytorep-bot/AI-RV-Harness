import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/013_profile_viewer_defaults.sql?raw";
import nativeBootstrap from "../../src-tauri/src/lib.rs?raw";

describe("Profile Viewer defaults migration", () => {
  it("persists reasoning, temperature and System Prompt and registers migration 13", () => {
    expect(migration).toMatch(/default_viewer_reasoning_effort/i);
    expect(migration).toMatch(/default_viewer_temperature/i);
    expect(migration).toMatch(/default_viewer_system_prompt/i);
    expect(migration).toMatch(/'xhigh'/i);
    expect(migration).toMatch(/'max'/i);
    expect(nativeBootstrap).toMatch(/version:\s*13/);
    expect(nativeBootstrap).toContain("013_profile_viewer_defaults.sql");
  });
});
