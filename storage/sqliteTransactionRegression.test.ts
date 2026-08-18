import { describe, expect, it } from "vitest";
import repositorySource from "./sqliteRepository.ts?raw";
import nativeTransactionSource from "../../src-tauri/src/database.rs?raw";

describe("SQLite transaction regression", () => {
  it("does not send transaction control statements as separate pooled frontend calls", () => {
    expect(repositorySource).not.toMatch(/executeWrite\s*\(\s*["'`]BEGIN\b/i);
    expect(repositorySource).not.toMatch(/executeWrite\s*\(\s*["'`](?:COMMIT|ROLLBACK)\b/i);
    expect(repositorySource.match(/this\.db\.execute/g)).toHaveLength(1);
  });

  it("runs grouped statements through one native SQLx transaction", () => {
    expect(nativeTransactionSource).toContain("pool.begin().await");
    expect(nativeTransactionSource).toContain("transaction.commit().await");
    expect(nativeTransactionSource).toContain("execute(&mut *transaction)");
  });
});
