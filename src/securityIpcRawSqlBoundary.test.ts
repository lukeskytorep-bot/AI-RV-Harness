import { describe, expect, it } from "vitest";

import capabilities from "../src-tauri/capabilities/default.json";
import nativeDatabase from "../src-tauri/src/database.rs?raw";
import nativeLib from "../src-tauri/src/lib.rs?raw";
import databaseNative from "./storage/databaseNative.ts?raw";
import writeRegistry from "./storage/databaseWriteOperations.ts?raw";
import storageNative from "./storage/native.ts?raw";
import storageMaintenance from "./storage/maintenance.ts?raw";
import nativeStorage from "../src-tauri/src/storage.rs?raw";
import { operationForWriteQuery } from "./storage/databaseWriteOperations";

const storageSources = import.meta.glob<string>("./storage/**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

describe("SECURITY-IPC-1C-R1 SQLite IPC boundary", () => {
  it("removes raw plugin SQL read/write permissions and direct plugin select/execute calls", () => {
    expect(capabilities.permissions).not.toContain("sql:default");
    expect(capabilities.permissions).not.toContain("sql:allow-select");
    expect(capabilities.permissions).not.toContain("sql:allow-execute");
    expect(capabilities.permissions).toEqual(expect.arrayContaining(["sql:allow-load", "sql:allow-close"]));
    const offenders = Object.entries(storageSources)
      .filter(([path]) => !/\.(?:test|spec)\.tsx?$/.test(path))
      .filter(([, source]) => /(?:this\.)?db\.(?:select|execute)\s*\(/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("sends named writes and routes reads through the native read-only command", () => {
    expect(databaseNative).toContain('operation: operationForWriteQuery(statement.query)');
    expect(databaseNative).toContain('"database_execute_write"');
    expect(databaseNative).toContain('"database_execute_write_batch"');
    expect(databaseNative).toContain('"database_execute_telepathic_fenced_write_batch"');
    expect(databaseNative).toContain('"database_execute_post_reveal_review_fenced_write_batch"');
    expect(databaseNative).toContain('"database_select_readonly"');
    expect(databaseNative).toContain('"database_initialize"');
    expect(databaseNative).not.toContain('"database_execute_transaction"');
    expect(nativeLib).toContain("database_execute_telepathic_fenced_write_batch");
    expect(nativeLib).toContain("database_execute_post_reveal_review_fenced_write_batch");
    expect(nativeLib).not.toContain("database_execute_transaction");
    expect(nativeDatabase).toContain("read_only(true)");
    expect(nativeDatabase).toContain('sqlx::query("PRAGMA query_only = ON")');
    expect(nativeDatabase).toContain('sqlx::query_scalar("PRAGMA journal_mode = WAL")');
    expect(nativeDatabase).toContain('database read channel accepts SELECT/WITH statements only');
  });

  it("keeps the fixed Rust write registry explicit and complete", () => {
    expect(writeRegistry).toContain("registeredWriteOperationCount");
    expect(writeRegistry.match(/\["(?:INSERT|UPDATE|DELETE)/g)?.length).toBe(124);
    expect(nativeDatabase.match(/#\[serde\(rename = "/g)?.length).toBeGreaterThanOrEqual(124);
    const atomicTrainingArchive = "UPDATE training_runs SET record_json = json_set(record_json, '$.archivedAt', $1, '$.updatedAt', $1), archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL";
    const guardedTrainingTermination = "UPDATE training_runs SET status = 'Interrupted', record_json = json_set(record_json, '$.status', 'Interrupted', '$.termination', json($1), '$.updatedAt', $2), updated_at = $2 WHERE id = $3 AND archived_at IS NULL AND status IN ('Paused', 'Interrupted', 'Running') AND COALESCE(json_extract(record_json, '$.currentIndex'), 0) < json_array_length(COALESCE(json_extract(record_json, '$.targetIds'), '[]')) AND COALESCE(json_extract(record_json, '$.termination.reason'), '') = ''";
    expect(writeRegistry).toContain(atomicTrainingArchive);
    expect(nativeDatabase).toContain(atomicTrainingArchive);
    expect(writeRegistry).toContain(guardedTrainingTermination);
    expect(nativeDatabase).toContain(guardedTrainingTermination);
  });


  it("covers every production repository write literal with a registered native operation", () => {
    const writeLiterals: string[] = [];
    for (const [path, source] of Object.entries(storageSources)) {
      if (/\.(?:test|spec)\.tsx?$/.test(path) || path.endsWith("databaseWriteOperations.ts")) continue;
      const patterns = [
        /executeWrite\(\s*([`"'])([\s\S]*?)\1/g,
        /query:\s*([`"'])([\s\S]*?)\1/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(match[2])) writeLiterals.push(match[2]);
        }
      }
    }
    expect(writeLiterals.length).toBeGreaterThan(90);
    for (const query of writeLiterals) expect(() => operationForWriteQuery(query)).not.toThrow();
  });

  it("keeps restore safety and snapshot path validation inside native code", () => {
    expect(storageMaintenance).toContain("await repository.closeForRestore()");
    expect(storageMaintenance).not.toContain("const safetyBackup = await createStorageBackup(repository)");
    expect(storageNative).toContain("safetyBackup: StorageBackupRecord");
    expect(nativeStorage).toContain("create_closed_database_safety_backup");
    expect(nativeStorage).toContain("validate_database_snapshot_destination");
    expect(nativeStorage).toContain("completed backup directory cannot be overwritten");
  });

  it("blocks mutating SQL shapes at the native read boundary", () => {
    expect(nativeDatabase).toContain("read_channel_rejects_mutating_returning_statements_without_changes");
    expect(nativeDatabase).toContain("DELETE FROM guarded_rows WHERE id = 1 RETURNING id");
    expect(nativeDatabase).toContain("UPDATE guarded_rows SET value = 'changed' WHERE id = 1 RETURNING id");
    expect(nativeDatabase).toContain("INSERT INTO guarded_rows (id, value) VALUES (2, 'new') RETURNING id");
    expect(nativeDatabase).toContain("read_channel_rejects_pragma_attach_and_multiple_statements");
    expect(nativeDatabase).toContain("read_channel_preserves_sqlite_result_shapes");
  });

  it("uses dedicated native commands for snapshot and controlled purge", () => {
    expect(nativeLib).toContain("database::database_snapshot");
    expect(nativeLib).toContain("database::database_controlled_purge");
    expect(nativeDatabase).toContain('sqlx::query("VACUUM INTO $1")');
    expect(nativeDatabase).toContain("SECURITY-IPC-1C controlled purge");
  });

  it("does not allow telepathic series heartbeat renewal after lease expiry", () => {
    const expiryGuard = "run_lease_expires_at IS NOT NULL AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    expect(writeRegistry).toContain(expiryGuard);
    expect(nativeDatabase).toContain(expiryGuard);
  });

});
