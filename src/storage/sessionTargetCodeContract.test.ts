import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BrowserSessionsRepository } from "./browser/sessionsRepository";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";
import { captureSessionTargetCodeContract } from "../sessions/targetCodeContract";
import type { SessionSnapshot } from "../sessions/types";

function setup(backend: "browser" | "sqlite") {
  if (backend === "sqlite") {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE session_snapshots(id TEXT PRIMARY KEY,session_id TEXT UNIQUE,snapshot_json TEXT,snapshot_hash TEXT,created_at TEXT)");
    const repo = new SqliteSessionsRepository({
      select: async <T>(sql: string, values: unknown[] = []) => db.prepare(sql.replace(/\$\d+/g, "?")).all(...values as never[]) as T,
      executeWrite: async (sql, values = []) => ({ rowsAffected: Number(db.prepare(sql.replace(/\$\d+/g, "?")).run(...values as never[]).changes) }),
      executeTransaction: async () => { throw new Error("unexpected transaction"); }, isResearchScoresFrozen: async () => false,
    });
    return { repo, close: () => db.close(), replace: (snapshot: unknown) => { db.prepare("UPDATE session_snapshots SET snapshot_json=? WHERE session_id='a'").run(JSON.stringify(snapshot)); } };
  }
  const data = new Map<string, string>();
  const storage: Storage = { get length() { return data.size; }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null,
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
  const repo = new BrowserSessionsRepository({ storage, isResearchScoresFrozen: () => false });
  return { repo, close: () => {}, replace: (snapshot: unknown) => {
    for (const [key, raw] of data) {
      const rows = JSON.parse(raw) as { sessionId: string; snapshot: unknown }[];
      if (Array.isArray(rows) && rows.some(x => x.sessionId === "a" && x.snapshot)) {
        rows.find(x => x.sessionId === "a")!.snapshot = snapshot; storage.setItem(key, JSON.stringify(rows));
      }
    }
  } };
}
function fixture(version: unknown): SessionSnapshot {
  return { schemaVersion: version, sessionId: "a", sessionCode: "RV-A", sessionLanguage: "en", protocol: { id: "rv-lite" } } as SessionSnapshot;
}
for (const backend of ["browser", "sqlite"] as const) describe(`${backend} durable target-code boundary`, () => {
  it.each([0, 6, 99, "5", null, undefined])("refuses unknown version %s on write and read", async version => {
    const { repo, close, replace } = setup(backend);
    try {
      await expect(repo.saveSessionSnapshot("a", fixture(version), "h")).rejects.toThrow("contract");
      expect(await repo.getSessionSnapshot("a")).toBeNull();
      await repo.saveSessionSnapshot("a", fixture(4), "h"); replace(fixture(version));
      await expect(repo.getSessionSnapshot("a")).rejects.toThrow("contract");
    } finally { close(); }
  });
  it.each([1, 2, 3, 4])("preserves historical version %s", async version => {
    const { repo, close } = setup(backend);
    try { const snapshot = fixture(version); await repo.saveSessionSnapshot("a", snapshot, "legacy-hash"); expect(await repo.getSessionSnapshot("a")).toEqual(snapshot); }
    finally { close(); }
  });
  it("refuses a valid complete v5 snapshot of another session on write and read", async () => {
    const { repo, close, replace } = setup(backend);
    try {
      const other = fixture(4); other.sessionId = "b"; other.sessionCode = "RV-B"; await captureSessionTargetCodeContract(other);
      await expect(repo.saveSessionSnapshot("a", other, "h")).rejects.toThrow("contract");
      expect(await repo.getSessionSnapshot("a")).toBeNull();
      const own = fixture(4); await captureSessionTargetCodeContract(own); await repo.saveSessionSnapshot("a", own, "h");
      replace(other); await expect(repo.getSessionSnapshot("a")).rejects.toThrow("contract");
    } finally { close(); }
  });
  it("refuses a missing v5 contract before any snapshot is persisted", async () => {
    const { repo, close } = setup(backend);
    try { await expect(repo.saveSessionSnapshot("a", fixture(5), "h")).rejects.toThrow("contract"); expect(await repo.getSessionSnapshot("a")).toBeNull(); }
    finally { close(); }
  });
});
