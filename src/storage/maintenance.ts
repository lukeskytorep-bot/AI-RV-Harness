import type { AppRepository } from "./repository";
import {
  discardStorageBackup,
  discardPortableStorageBackup,
  exportStorageBackup,
  finalizePortableStorageBackup,
  finalizeStorageBackup,
  inspectPortableStorageBackup,
  preparePortableStorageBackup,
  prepareStorageBackup,
  restorePortableStorageBackupNative,
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

export async function createPortableStorageBackup(repository: AppRepository, destinationRoot: string): Promise<StorageBackupRecord> {
  const prepared = await preparePortableStorageBackup(destinationRoot);
  try {
    await repository.createDatabaseSnapshot(prepared.databasePath);
    return await finalizePortableStorageBackup(prepared.backupId, prepared.directory);
  } catch (cause) {
    await discardPortableStorageBackup(prepared.backupId, prepared.directory).catch(() => undefined);
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

export async function restorePortableStorageBackup(repository: AppRepository, directory: string): Promise<{ safetyBackup: StorageBackupRecord; restored: RestoreResult }> {
  // Validate the external package before touching the live connection.
  await inspectPortableStorageBackup(directory);
  // The current state is snapshotted before the live connection is closed.
  const safetyBackup = await createStorageBackup(repository);
  await repository.closeForRestore();
  const restored = await restorePortableStorageBackupNative(directory);
  return { safetyBackup, restored };
}

export async function createStorageExport(repository: AppRepository): Promise<StorageExportResult> {
  const backup = await createStorageBackup(repository);
  return exportStorageBackup(backup.backupId);
}
