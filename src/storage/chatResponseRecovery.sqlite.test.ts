import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { endChatResponse, hasUnfinishedChatResponse } from "../chat/responseRecovery";
import { retryChatTurn } from "../chat/engine";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { SqliteWorkspacesConversationsRepository } from "./sqlite/workspacesConversationsRepository";

function repository(db: DatabaseSync) {
  const bind = (query: string) => query.replace(/\$\d+/g, "?");
  return new SqliteWorkspacesConversationsRepository({
    select: async <T>(query: string, values: unknown[] = []) => db.prepare(bind(query)).all(...values as never[]) as T,
    executeWrite: async (query, values = []) => ({ rowsAffected: Number(db.prepare(bind(query)).run(...values as never[]).changes) }),
    executeTransaction: async () => { throw new Error("Unused transaction in recovery-only fixture"); },
  });
}
it("S1 SQLite End retains ledger across backup/restore and blocks direct retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rvh-chat-stop-"));
  const db = new DatabaseSync(join(dir, "source.sqlite")); let restored: DatabaseSync | undefined;
  try {
    // Existing metadata_json contract; no new schema or migration is required.
    db.exec("CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT,role TEXT,content TEXT,metadata_json TEXT,created_at TEXT)");
    const attempts = [{ id: "old-attempt", startedAt: "old", dispatched: true, outcome: "uncertain", lateResponse: { content: "late", usage: { totalTokens: 9 } } }];
    db.prepare("INSERT INTO chat_messages VALUES(?,?,?,?,?,?)").run("user", "thread", "user", "Question", JSON.stringify({ responseRecovery: { state: "uncertain", attempts } }), "old");
    await endChatResponse(repository(db), "thread");
    await backup(db, join(dir, "backup.sqlite"));
    restored = new DatabaseSync(join(dir, "backup.sqlite"));
    const fresh = repository(restored); const messages = await fresh.listChatMessages("thread");
    expect(messages[0].metadata?.responseRecovery).toMatchObject({ state: "ended", attempts });
    await expect(retryChatTurn({ repository: fresh, threadId: "thread", providerConfig: {} as ProviderConfig, model: {} as ProviderModel, mode: "conversation", language: "en" })).rejects.toThrow(/ended/);
    expect(restored.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
    expect(await fresh.listChatMessages("thread")).toEqual(messages);
  } finally { restored?.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("P1 restored SQLite preserves an unfinished response that can be ended without cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rvh-chat-cacheless-"));
  const db = new DatabaseSync(join(dir, "source.sqlite")); let restored: DatabaseSync | undefined;
  try {
    db.exec("CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT,role TEXT,content TEXT,metadata_json TEXT,created_at TEXT)");
    const metadata = { responseRecovery: { state: "uncertain", attempts: [{ id: "paid-attempt", startedAt: "old", dispatched: true, outcome: "uncertain" }] } };
    db.prepare("INSERT INTO chat_messages VALUES(?,?,?,?,?,?)").run("user", "thread", "user", "Question", JSON.stringify(metadata), "old");
    await backup(db, join(dir, "backup.sqlite"));
    restored = new DatabaseSync(join(dir, "backup.sqlite"));
    const fresh = repository(restored); const before = (await fresh.listChatMessages("thread"))[0];
    expect(hasUnfinishedChatResponse(before)).toBe(true);
    await endChatResponse(fresh, "thread");
    const after = (await fresh.listChatMessages("thread"))[0];
    expect(hasUnfinishedChatResponse(after)).toBe(false);
    expect(after.metadata?.responseRecovery?.state).toBe("ended");
    expect(after.metadata?.responseRecovery?.attempts).toEqual(before.metadata?.responseRecovery?.attempts);
    expect(restored.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  } finally { restored?.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
