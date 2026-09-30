import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/012_target_mutation_guards.sql?raw";
import migrationRegistry from "../../src-tauri/src/migrations.rs?raw";

describe("target mutation guards migration", () => {
  it("keeps training and already-used targets immutable and registers migration 12", () => {
    expect(migration).toMatch(/prevent_training_target_update/i);
    expect(migration).toMatch(/prevent_training_target_delete/i);
    expect(migration).toMatch(/prevent_used_target_update/i);
    expect(migration).toMatch(/prevent_used_target_delete/i);
    expect(migration).toMatch(/target_usage[\s\S]*rv_sessions[\s\S]*research_assignments/i);
    expect(migrationRegistry).toMatch(/version:\s*12/);
    expect(migrationRegistry).toContain("012_target_mutation_guards.sql");
  });
});
