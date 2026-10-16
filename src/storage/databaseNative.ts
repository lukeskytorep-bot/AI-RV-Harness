import { Channel, invoke } from "@tauri-apps/api/core";
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


export async function executePostRevealReviewFencedDatabaseTransaction(input: {
  sessionId: string;
  leaseOwner: string;
  leaseVersion: number;
  statements: DatabaseTransactionStatement[];
}): Promise<number[]> {
  if (input.statements.length === 0) return [];
  const nativeStatements: NativeWriteStatement[] = input.statements.map((statement) => ({
    operation: operationForWriteQuery(statement.query),
    values: statement.values ?? [],
  }));
  return invoke<number[]>("database_execute_post_reveal_review_fenced_write_batch", {
    sessionId: input.sessionId,
    leaseOwner: input.leaseOwner,
    leaseVersion: input.leaseVersion,
    statements: nativeStatements,
  });
}

export async function executeTelepathicFencedDatabaseTransaction(input: {
  seriesId: string;
  leaseOwner: string;
  leaseVersion: number;
  statements: DatabaseTransactionStatement[];
}): Promise<number[]> {
  if (input.statements.length === 0) return [];
  const nativeStatements: NativeWriteStatement[] = input.statements.map((statement) => ({
    operation: operationForWriteQuery(statement.query),
    values: statement.values ?? [],
  }));
  return invoke<number[]>("database_execute_telepathic_fenced_write_batch", {
    seriesId: input.seriesId,
    leaseOwner: input.leaseOwner,
    leaseVersion: input.leaseVersion,
    statements: nativeStatements,
  });
}

export async function createDatabaseSnapshotNative(destinationPath: string): Promise<void> {
  await invoke("database_snapshot", { destinationPath });
}

export async function executeControlledPurgeNative(kind: PurgeEntityKind, id: string, expectedArchiveRevision?:number): Promise<void> {
  await invoke("database_controlled_purge", { request: { kind, id, ...(expectedArchiveRevision===undefined?{}:{expectedArchiveRevision}) } });
}

export async function workflowOwnershipNative<T>(request: Record<string, unknown>, onFailure?: (failure: { kind: import("../application/abortOwnership").WorkflowAbortKind; message: string }) => void): Promise<T> {
  const onLost = new Channel<{ kind: import("../application/abortOwnership").WorkflowAbortKind; message: string }>();
  if (onLost && onFailure) onLost.onmessage = onFailure;
  return invoke<T>("database_workflow_ownership", { request, onLost });
}
export async function executeWorkflowOwnedDatabaseTransaction(context: import("../application/workflowOwnership").WorkflowContext, statements: DatabaseTransactionStatement[], postRevealFence?: { sessionId: string; leaseOwner: string; leaseVersion: number }): Promise<number[]> {
  if (context.closed) throw new Error("Workflow ownership has settled; late writes are refused.");
  return workflowOwnershipNative<number[]>({ action: "write", profileId: context.profileId, owner: context.owner, version: context.version, entities: context.entities, statements: statements.map(statement=>({ operation:operationForWriteQuery(statement.query), values:statement.values??[] })), ...(postRevealFence ? { postRevealFence } : {}) });
}
