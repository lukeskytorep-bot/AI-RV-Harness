import { TARGET_GEOGRAPHY_POOL } from "../telepathicExchange/geography";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { SqliteTelepathicExchangeRepository } from "./sqlite/telepathicExchangeRepository";
import { BrowserTelepathicExchangeRepository } from "./browser/telepathicExchangeRepository";
import { createTelepathicSeriesState } from "../telepathicExchange/engine";
import type { TelepathicSeriesState } from "../telepathicExchange/types";
import type { TelepathicHistoryQuery } from "../telepathicExchange/historySummaries";
class MemoryStorage implements Storage {
  data = new Map<string, string>(); get length() { return this.data.size; } clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; } setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); } key(index: number) { return [...this.data.keys()][index] ?? null; }
}
function fixture(index: number, heavy = false) {
  const id = `series-${String(index).padStart(5, "0")}`;
  const ai = (id: string) => ({ id, kind: "ai" as const, displayName: id, ai: { profileId: id, profileName: id, workspaceId: "w", aiIdentityId: id, providerConfigId: "c", credentialId: "SECRET_CREDENTIAL", credentialFingerprint: "SECRET_BINDING", modelId: "m", route: "m" } });
  const state = createTelepathicSeriesState({ schemaVersion: 1, seriesId: id, seriesWorkspaceId: index % 3 === 0 ? "other" : "w", mode: index % 4 === 0 ? "conversation_exchange" : "ai_ai_training", language: "en", protocolVersion: "fixed_lead_v1", leadInstructionVersion: "v1", maxGuidanceCycles: 3, participants: [ai("z-lead"), ai("a-receiver")], senderPolicy: { kind: "fixed_ai", participantId: "z-lead" }, roundCount: 1, topic: "person", discloseTopicToReceivers: false }, "2026-10-13T01:00:00Z");
  state.plan.rounds[0].targetGeography = TARGET_GEOGRAPHY_POOL[index % TARGET_GEOGRAPHY_POOL.length];
  state.updatedAt = `2026-10-13T${String(Math.floor(index / 100) % 20).padStart(2, "0")}:00:00Z`;
  state.status = index % 2 === 0 ? "paused" : "blocked";
  if (index % 5 === 0) { state.archivedAt = "2026-10-13T00:00:00Z"; state.archiveRevision = 1; }
  const text = "SECRET_EVIDENCE" + (heavy ? " Synthetic fixture only.".repeat(450) : "");
  state.transcript = [{ id: "t", seriesId: id, sequence: 1, stage: "receiver_first", kind: "response", authorId: "a-receiver", recipientIds: [], text, createdAt: "t" }];
  state.rounds[0].target = { schemaVersion: 1, roundId: state.rounds[0].assignment.roundId, senderParticipantId: "z-lead", content: text, contentSha256: "h", status: "locked", assets: [], lockedAt: "t" };
  state.providerCalls = [{ id: `${id}:call`, seriesId: id, roundId: state.rounds[0].assignment.roundId, participantId: "a-receiver", callStage: "receiver_first", technicalAttempt: 2, status: "uncertain", scopeKey: "k", requestSha256: "h", createdAt: "t", updatedAt: "t", responseText: text, requestMessages: [{ role: "user", content: text }] }];
  return state;
}
function database() {
  const db = new DatabaseSync(":memory:"); const migrations = new URL("../../src-tauri/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  db.exec("INSERT INTO profiles(id,display_name,created_at,updated_at) VALUES ('u','U','t','t'); INSERT INTO workspaces(id,profile_id,name,created_at,updated_at,last_opened_at) VALUES ('w','u','W','t','t','t'),('other','u','Other','t','t','t'); PRAGMA user_version=31;");
  let selects = 0; let resultBytes = 0;
  const bind = (sql: string) => sql.replace(/\$\d+/g, "?");
  const write = async (query: string, values: unknown[] = []) => ({ rowsAffected: Number(db.prepare(bind(query)).run(...values as never[]).changes) });
  const repository = new SqliteTelepathicExchangeRepository({ select: async <T>(query: string, values: unknown[] = []) => {
    selects++; const rows = db.prepare(bind(query)).all(...values as never[]); resultBytes += Buffer.byteLength(JSON.stringify(rows)); return rows as T;
  }, executeWrite: write, executeTransaction: async statements => { db.exec("BEGIN"); try { for (const statement of statements) await write(statement.query, statement.values); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } }, executeFencedTransaction: async () => { throw new Error("No leased writes in read-only history fixture"); } });
  return { db, repository, reset() { selects = 0; resultBytes = 0; }, counts() { return { selects, resultBytes }; } };
}
for (const mode of ["ai_ai_training", "conversation_exchange"] as const) for (const archive of ["all", "active", "archived"] as const) it(`Browser/real schema31 SQLite pages agree: ${mode}/${archive}, ties and stable participant order`, async () => {
  const native = database(); const storage = new MemoryStorage(); const browser = new BrowserTelepathicExchangeRepository({ storage });
  try {
    for (let index = 0; index < 121; index++) { const state = fixture(index); await native.repository.saveTelepathicSeries(state); await browser.saveTelepathicSeries(state); }
    const full = vi.spyOn(native.repository, "getTelepathicSeries"); const all: string[] = [];
    let cursor: TelepathicHistoryQuery["cursor"];
    do {
      const query: TelepathicHistoryQuery = { mode, seriesWorkspaceId: "w", archive, limit: 7, cursor };
      native.reset(); const page = await native.repository.listTelepathicSeriesSummaries(query);
      expect(native.counts().selects).toBeLessThanOrEqual(2); expect(page).toEqual(await browser.listTelepathicSeriesSummaries(query));
      for (const item of page.items) expect(item.participantNames).toEqual(["z-lead", "a-receiver"]);
      expect(JSON.stringify(page)).not.toMatch(/SECRET|target|transcript|requestMessages|credential|route_snapshot|topic/);
      all.push(...page.items.map(item => item.seriesId)); cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(all).size).toBe(all.length);
    const expected = (await browser.listTelepathicSeries("w")).filter(state => state.config.mode === mode && (archive === "all" || Boolean(state.archivedAt) === (archive === "archived")));
    expect(all.length).toBe(expected.length); expect(full).not.toHaveBeenCalled();
  } finally { native.db.close(); }
});
it("validates queries before SQL, handles empty and legacy plans, and exposes corrupt records", async () => {
  const native = database(); const storage = new MemoryStorage(); const browser = new BrowserTelepathicExchangeRepository({ storage });
  try {
    for (const limit of [0, 101, 1.5]) {
      await expect(native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all", limit })).rejects.toThrow("Invalid");
      await expect(browser.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all", limit })).rejects.toThrow("Invalid");
    }
    native.reset(); expect(await native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all" })).toEqual({ items: [] }); expect(native.counts().selects).toBe(1);
    const state = fixture(1); await native.repository.saveTelepathicSeries(state); await browser.saveTelepathicSeries(state);
    native.db.prepare("UPDATE telepathic_series SET plan_json=? WHERE id=?").run(JSON.stringify(state.plan), state.config.seriesId);
    expect((await native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "active" })).items).toHaveLength(1);
    native.db.exec("UPDATE telepathic_series SET plan_json='broken'");
    await expect(native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all" })).rejects.toThrow();
    storage.setItem("rvh.dev.telepathic_series_v1", "broken"); await expect(browser.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all" })).rejects.toThrow();
    storage.setItem("rvh.dev.telepathic_series_v1", JSON.stringify([{ config: {} }])); await expect(browser.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all" })).rejects.toThrow("Invalid telepathic history record");
  } finally { native.db.close(); }
});
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
it("reproducible history benchmark: 100/500/1000 synthetic heavy series, five repetitions; bounded query gate", async () => {
  expect(fixture(1, true)).toEqual(fixture(1, true));
  const results: unknown[] = [];
  for (const count of [100, 500, 1000]) {
    const native = database();
    try {
      const generationStart = performance.now();
      for (let index = 0; index < count; index++) await native.repository.saveTelepathicSeries(fixture(index, true));
      const generationMs = performance.now() - generationStart;
      const samples: Record<string, number>[] = [];
      for (let repetition = 0; repetition < 5; repetition++) {
        native.reset(); let started = performance.now(); const old = await native.repository.listTelepathicSeries(); const oldMs = performance.now() - started; const oldQueries = native.counts().selects; const oldBytes = native.counts().resultBytes;
        expect(oldQueries).toBe(1 + 7 * count);
        // Baseline screen: old full list plus in-memory Training filter; it reuses the detail already loaded.
        const oldActive = old.filter(state => state.config.mode === "ai_ai_training").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find(state => !state.archivedAt);
        expect(oldActive).toBeTruthy();
        native.reset(); started = performance.now(); const page = await native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all", limit: 50 });
        const newMs = performance.now() - started; const listQueries = native.counts().selects; const newBytes = native.counts().resultBytes;
        expect(listQueries).toBe(2); expect(page.items.length).toBe(50);
        const active = page.items.find(item => !item.archivedAt) ?? (await native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "active", limit: 1 })).items[0];
        started = performance.now(); await native.repository.getTelepathicSeries(active.seriesId); const detailMs = performance.now() - started;
        const entryQueries = native.counts().selects;
        expect(entryQueries).toBe(9);
        native.reset(); started = performance.now(); await native.repository.getTelepathicSeries(active.seriesId); const oldDetailMs = performance.now() - started;
        samples.push({ oldMs, newMs, detailMs, oldDetailMs, oldQueries, listQueries, entryQueries, oldBytes, newBytes, oldPayloadBytes: Buffer.byteLength(JSON.stringify(old)), newPayloadBytes: Buffer.byteLength(JSON.stringify(page)), oldFirstViewMs: oldMs, newFirstViewMs: newMs + detailMs });
      }
      results.push({ series: count, generationMs, samples, medians: Object.fromEntries(Object.keys(samples[0]).map(key => [key, median(samples.map(sample => sample[key]))])) });
      expect(native.db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { native.db.close(); }
  }
  if (process.env.RVH_HISTORY_BENCHMARK_OUTPUT) writeFileSync(process.env.RVH_HISTORY_BENCHMARK_OUTPUT, JSON.stringify({ runtime: process.version, sqlite: "node:sqlite DatabaseSync; all migrations 001-031", machine: { platform: platform(), cpu: cpus()[0]?.model }, fixture: { repetitions: 5, roundCount: 1, participants: 2, transcriptCharacters: fixture(1, true).transcript![0].text.length, calls: 1, modes: "3/4 Training, 1/4 exchange", workspace: "2/3 w, 1/3 other", archived: "1/5" }, results }, null, 2));
}, 120000);
it("Unicode ID ties have identical SQLite binary/Browser order and cursor semantics", async () => {
  const native = database(); const browser = new BrowserTelepathicExchangeRepository({ storage: new MemoryStorage() });
  try {
    for (const [index, id] of ["a", "\uE000", "😀"].entries()) {
      const state = fixture(index + 1); state.config.seriesId = id; state.providerCalls.forEach(call => { call.seriesId = id; }); state.config.mode = "ai_ai_training"; state.updatedAt = "tie";
      await native.repository.saveTelepathicSeries(state); await browser.saveTelepathicSeries(state);
    }
    let cursor: TelepathicHistoryQuery["cursor"]; const ids: string[] = [];
    do {
      const query: TelepathicHistoryQuery = { mode: "ai_ai_training", archive: "all", limit: 1, cursor };
      const page = await native.repository.listTelepathicSeriesSummaries(query); expect(page).toEqual(await browser.listTelepathicSeriesSummaries(query));
      ids.push(...page.items.map(item => item.seriesId)); cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(["😀", "\uE000", "a"]);
  } finally { native.db.close(); }
});
it("limits 1/100, parameterized filters and invalid archive JSON keep a controlled read-only contract", async () => {
  const native = database(); const storage = new MemoryStorage(); const browser = new BrowserTelepathicExchangeRepository({ storage });
  try {
    for (let index = 1; index <= 6; index++) { const state = fixture(index); await native.repository.saveTelepathicSeries(state); await browser.saveTelepathicSeries(state); }
    for (const limit of [1, 100]) {
      const query = { mode: "ai_ai_training" as const, archive: "all" as const, limit };
      expect(await native.repository.listTelepathicSeriesSummaries(query)).toEqual(await browser.listTelepathicSeriesSummaries(query));
    }
    expect((await native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive: "all", seriesWorkspaceId: "w' OR 1=1 --" })).items).toHaveLength(0);
    native.db.exec("UPDATE telepathic_series SET plan_json=json_set(plan_json,'$._runtime.archivedAt',json('{}'))");
    for (const archive of ["all", "active", "archived"] as const) await expect(native.repository.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive })).rejects.toThrow("Invalid telepathic archive");
    const state = fixture(1) as unknown as { archivedAt: unknown }; state.archivedAt = {};
    storage.setItem("rvh.dev.telepathic_series_v1", JSON.stringify([state]));
    for (const archive of ["all", "active", "archived"] as const) await expect(browser.listTelepathicSeriesSummaries({ mode: "ai_ai_training", archive })).rejects.toThrow("Invalid telepathic archive");
  } finally { native.db.close(); }
});
