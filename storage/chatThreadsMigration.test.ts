import { describe, expect, it } from "vitest";
import migration from "../../src-tauri/migrations/014_chat_thread_archiving.sql?raw";
import nativeBootstrap from "../../src-tauri/src/lib.rs?raw";

describe("chat thread archiving migration", () => {
  it("adds non-destructive archiving and registers migration 14", () => {
    expect(migration).toMatch(/ALTER TABLE chat_threads ADD COLUMN archived_at/i);
    expect(migration).toMatch(/updated_at DESC/i);
    expect(nativeBootstrap).toMatch(/version:\s*14/);
    expect(nativeBootstrap).toContain("014_chat_thread_archiving.sql");
  });
});
