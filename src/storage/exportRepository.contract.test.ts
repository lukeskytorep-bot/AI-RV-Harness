import { describe, expect, it } from "vitest";
import { BrowserExportRepository } from "./browser/exportRepository";
import { SqliteExportRepository } from "./sqlite/exportRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("Export repository contract", () => {
  it("preserves the browser export ledger key and optional Research relation", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserExportRepository({ storage, now: () => "now", createId: () => "export-1" });
    await repository.recordExport("workspace-a", undefined, "training_run", "/tmp/training", "hash-a");
    await repository.recordExport("workspace-a", "research-a", "research_package", "/tmp/research", "hash-b");
    const records = JSON.parse(storage.getItem("rvh.dev.exports")!) as Array<Record<string, unknown>>;
    expect(records).toEqual([
      expect.objectContaining({ id: "export-1", workspaceId: "workspace-a", exportType: "training_run", artifactPath: "/tmp/training", manifestHash: "hash-a" }),
      expect.objectContaining({ id: "export-1", workspaceId: "workspace-a", researchProjectId: "research-a", exportType: "research_package" }),
    ]);
  });

  it("preserves the SQLite exports INSERT shape", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteExportRepository({ now: () => "now", createId: () => "export-1", executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; } });
    await repository.recordExport("workspace-a", undefined, "complete_session", "/tmp/session", "hash");
    expect(writes[0].query).toContain("INSERT INTO exports");
    expect(writes[0].values).toEqual(["export-1", "workspace-a", null, "complete_session", "/tmp/session", "hash", "now"]);
  });
});
