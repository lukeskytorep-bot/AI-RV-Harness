import type { AppRepository } from "./repository";
import {
  discardStorageBackup,
  exportStorageBackup,
  finalizeStorageBackup,
  prepareStorageBackup,
  restoreStorageBackupNative,
  type RestoreResult,
  type StorageBackupRecord,
  type StorageExportResult,
} from "./native";

export async function createStorageBackup(repository: AppRepository): Promise<StorageBackupRecord> {
  const prepared = await prepareStorageBackup();
  try {
    await repository.createDatabaseSnapshot(prepared.databasePath);
    return await finalizeStorageBackup(prepared.backupId);
  } catch (cause) {
    await discardStorageBackup(prepared.backupId).catch(() => undefined);
    throw cause;
  }
}

export async function restoreStorageBackup(repository: AppRepository, backupId: string): Promise<{ safetyBackup: StorageBackupRecord; restored: RestoreResult }> {
  // A fresh, verified backup is mandatory before the live database connection is closed.
  const safetyBackup = await createStorageBackup(repository);
  await repository.closeForRestore();
  const restored = await restoreStorageBackupNative(backupId);
  return { safetyBackup, restored };
}

export async function createStorageExport(repository: AppRepository): Promise<StorageExportResult> {
  const backup = await createStorageBackup(repository);
  return exportStorageBackup(backup.backupId);
}
