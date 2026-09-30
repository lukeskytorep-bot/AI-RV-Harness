import { invoke } from "@tauri-apps/api/core";
import { operationForWriteQuery, type DatabaseWriteOperation } from "./databaseWriteOperations";
import type { PurgeEntityKind } from "./controlledPurge";

export interface DatabaseTransactionStatement {
  query: string;
  values?: unknown[];
}

interface NativeWriteStatement {
  operation: DatabaseWriteOperation;
  values: unknown[];
}

export interface DatabaseWriteResult {
  rowsAffected: number;
}

export async function initializeDatabaseNative(): Promise<void> {
  await invoke("database_initialize");
}

export async function selectDatabaseReadonly<T>(query: string, values: unknown[] = []): Promise<T> {
  return invoke<T>("database_select_readonly", { query, values });
}

export async function executeDatabaseWrite(query: string, values: unknown[] = []): Promise<DatabaseWriteResult> {
  return invoke<DatabaseWriteResult>("database_execute_write", {
    statement: { operation: operationForWriteQuery(query), values },
  });
}

export async function executeDatabaseTransaction(statements: DatabaseTransactionStatement[]): Promise<number[]> {
  if (statements.length === 0) return [];
  const nativeStatements: NativeWriteStatement[] = statements.map((statement) => ({
    operation: operationForWriteQuery(statement.query),
    values: statement.values ?? [],
  }));
  return invoke<number[]>("database_execute_write_batch", { statements: nativeStatements });
}

export async function createDatabaseSnapshotNative(destinationPath: string): Promise<void> {
  await invoke("database_snapshot", { destinationPath });
}

export async function executeControlledPurgeNative(kind: PurgeEntityKind, id: string): Promise<void> {
  await invoke("database_controlled_purge", { request: { kind, id } });
}
