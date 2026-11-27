import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BrowserTrainingRepository } from "./browser/trainingRepository";
import { SqliteTrainingRepository } from "./sqlite/trainingRepository";
import { BrowserResearchRepository } from "./browser/researchRepository";
import { SqliteResearchRepository } from "./sqlite/researchRepository";
import { targetCodePolicy } from "../resources/rvLiteTargetCode";
import { targetCodeConfig } from "../testing/targetCodeFixture";
import { captureResearchTargetCodeContract } from "../research/targetCodeContract";
import type { CreateTrainingRunInput, TrainingRunRecord } from "../training/types";

class MemoryStorage implements Storage {
  data = new Map<string, string>(); get length() { return this.data.size; } clear() { this.data.clear(); }
  key(i: number) { return [...this.data.keys()][i] ?? null; } getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); }
}
function setup(backend: "browser" | "sqlite") {
  if (backend === "browser") {
    const storage = new MemoryStorage(); const training = () => new BrowserTrainingRepository({ storage });
    const research = () => new BrowserResearchRepository({ storage });
    return { training, research, close() {}, corruptTraining(run: TrainingRunRecord) { storage.setItem("rvh.dev.training_runs", JSON.stringify([run])); },
      corruptResearch(config: unknown) { for (const [k, v] of storage.data) { const data = JSON.parse(v); if (Array.isArray(data) && data[0]?.config) { for (const row of data) row.config = config; storage.setItem(k, JSON.stringify(data)); } } } };
  }
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE training_runs(id TEXT PRIMARY KEY,run_number INTEGER,status TEXT,record_json TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT); CREATE TABLE research_projects(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,template_type TEXT,state TEXT,config_json TEXT,config_hash TEXT,locked_at TEXT,scores_frozen_at TEXT,unblinded_at TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT)");
  const write = async (q: string, values: unknown[] = []) => ({ rowsAffected: Number(db.prepare(q.replace(/\$\d+/g, "?")).run(...values as never[]).changes) });
  const deps = { select: async <T>(q: string, values: unknown[] = []) => db.prepare(q.replace(/\$\d+/g, "?")).all(...values as never[]) as T,
    executeWrite: write, executeTransaction: async () => { throw new Error("unexpected transaction"); } };
  return { training: () => new SqliteTrainingRepository(deps), research: () => new SqliteResearchRepository(deps), close() { db.close(); },
    corruptTraining(run: TrainingRunRecord) { db.prepare("UPDATE training_runs SET record_json=? WHERE id=?").run(JSON.stringify(run), run.id); },
    corruptResearch(config: unknown) { db.prepare("UPDATE research_projects SET config_json=?").run(JSON.stringify(config)); } };
}
function input(mode: "full" | "partial"): CreateTrainingRunInput {
  return { name: "Series", status: "Planned", mode, profileId: "p", workspaceId: "w", modelRoute: "m", protocolVariant: "extended",
    targetIds: ["a"], categories: [], judgeModelRoutes: [], pauseAfterBlock: false, viewerNotesEnabled: false,
    executionSnapshot: { language: "en", targetCodePolicy: targetCodePolicy("without_code"), generationSettings: {}, transport: { maxRetries: 0, requestTimeoutMs: 30000, sessionCodePrefix: "RV" } } };
}
for (const backend of ["browser", "sqlite"] as const) describe(`${backend} frozen series contracts`, () => {
  it.each(["full", "partial"] as const)("preserves %s Training policy across reopen and rejects its deletion", async mode => {
    const h = setup(backend);
    try {
      const run = await h.training().createTrainingRun(input(mode));
      expect(run.targetCodeContractVersion).toBe(1); expect((await h.training().listTrainingRuns())[0]).toEqual(run);
      const damaged = structuredClone(run); delete damaged.executionSnapshot!.targetCodePolicy; h.corruptTraining(damaged);
      await expect(h.training().listTrainingRuns()).rejects.toThrow(/contract/);
      await expect(h.training().updateTrainingRun(run.id, { status: "Running" })).rejects.toThrow(/contract/);
    } finally { h.close(); }
  });
  it("refuses overwriting a frozen Training policy and retains its prior record", async () => {
    const h = setup(backend);
    try {
      const run = await h.training().createTrainingRun(input("partial"));
      await expect(h.training().updateTrainingRun(run.id, { executionSnapshot: { ...run.executionSnapshot!, targetCodePolicy: undefined } })).rejects.toThrow(/contract/);
      expect((await h.training().listTrainingRuns())[0]).toEqual(run);
    } finally { h.close(); }
  });
  it("preserves legacy Training without inventing a new preference", async () => {
    const h = setup(backend);
    try { const i = input("partial"); delete i.executionSnapshot!.targetCodePolicy; const r = await h.training().createTrainingRun(i); expect(r.targetCodeContract).toBeUndefined(); expect((await h.training().listTrainingRuns())[0]).toEqual(r); }
    finally { h.close(); }
  });
  it.each(["same", "other"])("refuses a complete valid Research config from another project/workspace (%s)", async workspace => {
    const h = setup(backend);
    try {
      const a = targetCodeConfig(); captureResearchTargetCodeContract(a);
      const first = await h.research().createResearchProject(a);
      const b = targetCodeConfig(); if (workspace === "other") b.workspaceId = "other";
      captureResearchTargetCodeContract(b); const second = await h.research().createResearchProject(b);
      h.corruptResearch(second.config);
      await expect(h.research().getResearchProject(first.id)).rejects.toThrow(/binding mismatch/);
    } finally { h.close(); }
  });
  it("preserves explicit Research conditions and refuses their loss after reopen", async () => {
    const h = setup(backend);
    try {
      const config = targetCodeConfig(); captureResearchTargetCodeContract(config);
      const project = await h.research().createResearchProject(config);
      expect((await h.research().getResearchProject(project.id))?.config).toEqual(project.config);
      const damaged = structuredClone(project.config); delete damaged.conditions[0].targetCode; h.corruptResearch(damaged);
      await expect(h.research().getResearchProject(project.id)).rejects.toThrow(/contract/);
    } finally { h.close(); }
  });
});
