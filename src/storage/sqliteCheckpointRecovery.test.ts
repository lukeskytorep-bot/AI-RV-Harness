import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class {} }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: async () => ({ close: async () => undefined }) } }));
import { SqliteRepository } from "./sqliteRepository";
import { createTelepathicSeriesState } from "../telepathicExchange/engine";
import type { TelepathicSeriesState } from "../telepathicExchange/types";
import type { AppSettings } from "../types";

const registry = readFileSync(new URL("./databaseWriteOperations.ts", import.meta.url), "utf8");
const writes = new Map([...registry.matchAll(/\["((?:\\.|[^"\\])*)", "([a-z0-9_]+)"\]/g)].map(match => [match[2], JSON.parse('"' + match[1] + '"') as string]));
let db: DatabaseSync; let directory: string;
let beforeFenced: undefined | (() => Promise<void>);
function bind(query: string, values: unknown[] = []) {
  const bound: unknown[] = [];
  return { query: query.replace(/\$(\d+)/g, (_all, index) => { bound.push(values[Number(index) - 1] ?? null); return "?"; }), bound };
}
function select(query: string, values: unknown[] = []) {
  const prepared = bind(query, values); return db.prepare(prepared.query).all(...prepared.bound as never[]);
}
function write(statement: { operation: string; values: unknown[] }) {
  const query = writes.get(statement.operation); if (!query) throw new Error(statement.operation);
  const prepared = bind(query, statement.values); return Number(db.prepare(prepared.query).run(...prepared.bound as never[]).changes);
}
// File-backed setup/cleanup can be slow on Windows release runners. Keep this
// allowance local to hooks; application and test-body deadlines are unchanged.
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "rvh-checkpoint-")); db = new DatabaseSync(join(directory, "database.sqlite"));
  // Enable foreign keys before BEGIN: migration PRAGMAs cannot enable them
  // inside a transaction. One commit avoids repeated durable DDL writes on Windows.
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('w'); CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);");
    for (const migration of ["028_telepathic_exchange_series.sql", "029_telepathic_series_run_lease.sql"]) db.exec(readFileSync(new URL(`../../src-tauri/migrations/${migration}`, import.meta.url), "utf8"));
    db.exec("COMMIT");
  } catch (cause) { db.exec("ROLLBACK"); throw cause; }
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  beforeFenced = undefined;
  bridge.invoke.mockImplementation(async (command: string, args: any) => {
    if (command === "database_initialize") return;
    if (command === "database_select_readonly") return select(args.query, args.values);
    if (command === "database_execute_write") return { rowsAffected: write(args.statement) };
    if (command === "database_execute_telepathic_fenced_write_batch") await beforeFenced?.();
    if (command === "database_execute_write_batch" || command === "database_execute_telepathic_fenced_write_batch") {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (command === "database_execute_telepathic_fenced_write_batch" && !select("SELECT id FROM telepathic_series WHERE id=$1 AND run_lease_owner=$2 AND run_lease_version=$3 AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')", [args.seriesId, args.leaseOwner, args.leaseVersion]).length) throw new Error("telepathic series lease lost before fenced checkpoint");
        const result = args.statements.map(write); db.exec("COMMIT"); return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    throw new Error(command);
  });
}, 60_000);
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); }, 60_000);
function state(): TelepathicSeriesState {
  return createTelepathicSeriesState({ schemaVersion: 1, seriesId: "s", seriesWorkspaceId: "w", mode: "conversation_exchange", language: "en", roundCount: 1, topic: "any", discloseTopicToReceivers: false, senderPolicy: { kind: "rotate" }, participants: [{ id: "a", kind: "human", displayName: "A" }, { id: "b", kind: "human", displayName: "B" }] });
}
it("serializes a fenced checkpoint with another repository's batch and restores the saved result after reconnect", async () => {
  const first = await SqliteRepository.connect(), second = await SqliteRepository.connect();
  const series = state(); await first.saveTelepathicSeries(series);
  let ready!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  await first.withTelepathicSeriesLease("s", async () => {
    beforeFenced = async () => { ready(); await held; };
    series.providerCalls.push({ id: "call", seriesId: "s", roundId: series.rounds[0].assignment.roundId, participantId: "a", callStage: "sender_target", technicalAttempt: 1, status: "succeeded", scopeKey: "scope", requestSha256: "hash", responseText: "accepted target", providerRequestId: "generation", finishReason: "stop", usage: { totalTokens: 17 }, createdAt: "t", updatedAt: "t" });
    const checkpoint = first.saveTelepathicSeries(series); await entered;
    const other = second.saveSettings({ language: "pl" } as unknown as AppSettings);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(select("SELECT * FROM app_settings")).toEqual([]);
    release(); await Promise.all([checkpoint, other]);
  });
  expect(select("SELECT value FROM app_settings WHERE key='language'")).toEqual([{ value: "pl" }]);
  db.close(); db = new DatabaseSync(join(directory, "database.sqlite"));
  const restored = await (await SqliteRepository.connect()).getTelepathicSeries("s");
  expect(restored!.providerCalls).toHaveLength(1);
  expect(restored!.providerCalls[0]).toMatchObject({ status: "succeeded", responseText: "accepted target", providerRequestId: "generation", finishReason: "stop", usage: { totalTokens: 17 } });
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
it("retries the fenced transaction after BUSY and rechecks ownership", async () => {
  const repository = await SqliteRepository.connect(), series = state(); await repository.saveTelepathicSeries(series);
  let attempts = 0;
  await repository.withTelepathicSeriesLease("s", async () => {
    beforeFenced = async () => { if (++attempts === 1) throw new Error("SQLITE_BUSY"); };
    series.status = "paused"; await repository.saveTelepathicSeries(series);
  });
  expect(attempts).toBe(2); expect((await repository.getTelepathicSeries("s"))!.status).toBe("paused");
});
it("refuses a stale runner if the owner changes during BUSY backoff", async () => {
  const repository = await SqliteRepository.connect(), series = state(); await repository.saveTelepathicSeries(series);
  let attempts = 0;
  await expect(repository.withTelepathicSeriesLease("s", async () => {
    beforeFenced = async () => { if (++attempts === 1) { db.exec("UPDATE telepathic_series SET run_lease_version=run_lease_version+1"); throw new Error("database is locked"); } };
    series.status = "paused"; await repository.saveTelepathicSeries(series);
  })).rejects.toThrow("lease lost");
  expect(attempts).toBe(2); expect((await repository.getTelepathicSeries("s"))!.status).not.toBe("paused");
});

it("preserves the recovery policy, parent link and response evidence after file-backed SQLite restart", async () => {
  const repository = await SqliteRepository.connect(), series = state();
  series.config.recoveryPolicy = { version: 1, mode: "automatic", maxTransportRetriesPerScope: 1 };
  const parent = { id: "transport-parent", seriesId: "s", roundId: series.rounds[0].assignment.roundId, participantId: "a", callStage: "sender_target", technicalAttempt: 1, status: "failed" as const, scopeKey: "same-scope", requestSha256: "same-hash", createdAt: "t", updatedAt: "t", transportFailure: { code: "response_body_read" as const, phase: "reading_body" as const, retryable: true }, recovery: { action: "transport_retry" as const, originalStatus: "uncertain" as const, at: "t" } };
  const child = { ...parent, id: "transport-child", status: "succeeded" as const, retryOfCallId: parent.id, recovery: undefined, transportFailure: undefined, responseText: "accepted", finishReason: "stop", usage: { totalTokens: 17 }, responseEvidence: { version: 1 as const, transportOutcome: "response_finished" as const, boundary: "sse_done" as const, finishReason: "stop", generationId: "generation-child" } };
  series.providerCalls = [parent, child]; await repository.saveTelepathicSeries(series);
  db.close(); db = new DatabaseSync(join(directory, "database.sqlite"));
  const restored = (await (await SqliteRepository.connect()).getTelepathicSeries("s"))!;
  expect(restored.config.recoveryPolicy).toEqual(series.config.recoveryPolicy);
  expect(restored.providerCalls.find(call => call.id === parent.id)).toMatchObject(parent);
  expect(restored.providerCalls.find(call => call.id === child.id)).toMatchObject(JSON.parse(JSON.stringify(child)));
  expect(restored.providerCalls.filter(call => call.recovery?.action === "transport_retry")).toHaveLength(1);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
});
