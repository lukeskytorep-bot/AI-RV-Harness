import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRepository } from "./repository";
import * as native from "./native";
import { createStorageBackup, restorePortableStorageBackup, restoreStorageBackup } from "./maintenance";

vi.mock("./native", () => ({
  prepareStorageBackup: vi.fn(),
  finalizeStorageBackup: vi.fn(),
  discardStorageBackup: vi.fn(),
  restoreStorageBackupNative: vi.fn(),
  exportStorageBackup: vi.fn(),
  inspectPortableStorageBackup: vi.fn(),
  restorePortableStorageBackupNative: vi.fn(),
  preparePortableStorageBackup: vi.fn(),
  finalizePortableStorageBackup: vi.fn(),
  discardPortableStorageBackup: vi.fn(),
}));

describe("storage maintenance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the SQLite snapshot before finalizing the backup", async () => {
    vi.mocked(native.prepareStorageBackup).mockResolvedValue({ backupId: "backup_1", directory: "/backup", databasePath: "/backup/rv_harness.db" });
    vi.mocked(native.finalizeStorageBackup).mockResolvedValue({ backupId: "backup_1", directory: "/backup", createdAtUnixMs: 1, databaseSha256: "abc", sizeBytes: 10 });
    const createDatabaseSnapshot = vi.fn().mockResolvedValue(undefined);
    const repository = { createDatabaseSnapshot } as unknown as AppRepository;
    const result = await createStorageBackup(repository);
    expect(createDatabaseSnapshot).toHaveBeenCalledWith("/backup/rv_harness.db");
    expect(native.finalizeStorageBackup).toHaveBeenCalledWith("backup_1");
    expect(result.databaseSha256).toBe("abc");
  });

  it("delegates restore safety backup creation to the native restore command after closing SQLite", async () => {
    const order: string[] = [];
    const safetyBackup = { backupId: "backup_safety", directory: "/safety", createdAtUnixMs: 2, databaseSha256: "safe", sizeBytes: 10 };
    const repository = {
      closeForRestore: vi.fn(async () => { order.push("close"); }),
    } as unknown as AppRepository;
    vi.mocked(native.restoreStorageBackupNative).mockImplementation(async () => {
      order.push("restore");
      return { backupId: "backup_target", safetyBackup };
    });
    const result = await restoreStorageBackup(repository, "backup_target");
    expect(order).toEqual(["close", "restore"]);
    expect(result.safetyBackup).toEqual(safetyBackup);
  });

  it("validates a portable backup before snapshotting or closing the live database", async () => {
    const order: string[] = [];
    vi.mocked(native.inspectPortableStorageBackup).mockImplementation(async () => {
      order.push("validate");
      return { backupId: "backup_external", directory: "/external", createdAtUnixMs: 1, databaseSha256: "external", sizeBytes: 10 };
    });
    const safetyBackup = { backupId: "backup_safety", directory: "/safety", createdAtUnixMs: 2, databaseSha256: "safe", sizeBytes: 10 };
    vi.mocked(native.restorePortableStorageBackupNative).mockImplementation(async () => {
      order.push("restore");
      return { backupId: "backup_external", safetyBackup };
    });
    const repository = {
      closeForRestore: vi.fn(async () => { order.push("close"); }),
    } as unknown as AppRepository;
    const result = await restorePortableStorageBackup(repository, "/external");
    expect(order).toEqual(["validate", "close", "restore"]);
    expect(result.safetyBackup).toEqual(safetyBackup);
  });
});
