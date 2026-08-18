import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/012_target_mutation_guards.sql?raw";
import nativeBootstrap from "../../src-tauri/src/lib.rs?raw";

describe("target mutation guards migration", () => {
  it("keeps training and already-used targets immutable and registers migration 12", () => {
    expect(migration).toMatch(/prevent_training_target_update/i);
    expect(migration).toMatch(/prevent_training_target_delete/i);
    expect(migration).toMatch(/prevent_used_target_update/i);
    expect(migration).toMatch(/prevent_used_target_delete/i);
    expect(migration).toMatch(/target_usage[\s\S]*rv_sessions[\s\S]*research_assignments/i);
    expect(nativeBootstrap).toMatch(/version:\s*12/);
    expect(nativeBootstrap).toContain("012_target_mutation_guards.sql");
  });
});
