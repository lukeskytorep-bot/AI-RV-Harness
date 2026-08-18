import { invoke } from "@tauri-apps/api/core";

export interface StoragePaths {
  databasePath: string;
  artifactsPath: string;
  backupsPath: string;
}

export interface PreparedBackup {
  backupId: string;
  directory: string;
  databasePath: string;
}

export interface StorageBackupRecord {
  backupId: string;
  directory: string;
  createdAtUnixMs: number;
  databaseSha256: string;
  sizeBytes: number;
}

export interface RestoreResult {
  backupId: string;
  previousDatabasePath?: string;
}

export interface StorageExportResult {
  directory: string;
}

export async function getStoragePaths(): Promise<StoragePaths> {
  return invoke<StoragePaths>("storage_paths");
}

export async function prepareStorageBackup(): Promise<PreparedBackup> {
  return invoke<PreparedBackup>("prepare_backup");
}

export async function finalizeStorageBackup(backupId: string): Promise<StorageBackupRecord> {
  return invoke<StorageBackupRecord>("finalize_backup", { request: { backupId } });
}

export async function discardStorageBackup(backupId: string): Promise<void> {
  await invoke("discard_backup", { request: { backupId } });
}

export async function listStorageBackups(): Promise<StorageBackupRecord[]> {
  return invoke<StorageBackupRecord[]>("list_storage_backups");
}

export async function exportStorageBackup(backupId: string): Promise<StorageExportResult> {
  return invoke<StorageExportResult>("export_storage_backup", { request: { backupId } });
}

export async function restoreStorageBackupNative(backupId: string): Promise<RestoreResult> {
  return invoke<RestoreResult>("restore_backup", { request: { backupId } });
}

export async function openDataFolder(): Promise<void> {
  await invoke("open_data_folder");
}

export async function openFolder(path: string): Promise<void> {
  await invoke("open_folder", { path });
}
