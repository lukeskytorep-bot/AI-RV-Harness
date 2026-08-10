import { invoke } from "@tauri-apps/api/core";

export interface DatabaseTransactionStatement {
  query: string;
  values?: unknown[];
}

export async function executeDatabaseTransaction(statements: DatabaseTransactionStatement[]): Promise<number[]> {
  if (statements.length === 0) return [];
  return invoke<number[]>("database_execute_transaction", {
    statements: statements.map((statement) => ({
      query: statement.query,
      values: statement.values ?? [],
    })),
  });
}
