import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/018_retire_legacy_training_targets.sql?raw";

describe("legacy Training Target retirement migration", () => {
  it("retains historical rows while hiding exactly the old ten-target pack", () => {
    expect(migration).toContain("ADD COLUMN retired_at TEXT");
    expect(migration).toContain("SET retired_at");
    expect(migration).toContain("'training_1'");
    expect(migration).toContain("'training_10'");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+targets/i);
  });
});
