import { describe, expect, it } from "vitest";
import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { BrowserTargetsRepository } from "./browser/targetsRepository";
import type { TargetsRepository } from "./contracts/targetsRepository";
import { SqliteTargetsRepository, type SqliteTargetsRepositoryDependencies } from "./sqlite/targetsRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

type TargetRow = {
  id: string;
  collection: TargetRecord["collection"];
  title: string;
  reveal_text: string | null;
  reveal_artifact_path: string | null;
  reveal_artifact_manifest_json: string;
  tags_json: string;
  source_metadata_json: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
};

interface ContractHarness {
  repository: TargetsRepository;
  seedTargets(targets: TargetRecord[]): void;
  seedUsage(usage: TargetUsageRecord[]): void;
}

function sequenceClock() {
  let tick = 0;
  return () => `2026-09-07T00:00:0${tick++}.000Z`;
}

function toRow(target: TargetRecord): TargetRow {
  return {
    id: target.id,
    collection: target.collection,
    title: target.title,
    reveal_text: target.revealText ?? null,
    reveal_artifact_path: target.revealArtifactPath ?? null,
    reveal_artifact_manifest_json: JSON.stringify(target.revealArtifacts ?? []),
    tags_json: JSON.stringify(target.tags),
    source_metadata_json: JSON.stringify(target.sourceMetadata),
    content_hash: target.contentHash ?? null,
    created_at: target.createdAt,
    updated_at: target.updatedAt,
    retired_at: null,
  };
}

function browserHarness(): ContractHarness {
  const storage = new MemoryStorage();
  let id = 0;
  const used = new Set<string>();
  const repository = new BrowserTargetsRepository({
    storage,
    createId: () => `target-usage-${++id}`,
    now: sequenceClock(),
    hasRecordedUse: (targetId) => used.has(targetId),
  });
  return {
    repository,
    seedTargets: (targets) => storage.setItem("rvh.dev.targets", JSON.stringify(targets)),
    seedUsage: (usage) => {
      storage.setItem("rvh.dev.target_usage", JSON.stringify(usage));
      usage.forEach((item) => used.add(item.targetId));
    },
  };
}

function sqliteHarness(): ContractHarness {
  let targets: TargetRow[] = [];
  let usage: TargetUsageRecord[] = [];
  let id = 0;
  const clock = sequenceClock();
  const dependencies: SqliteTargetsRepositoryDependencies = {
    createId: () => `target-usage-${++id}`,
    now: clock,
    select: async <T>(query: string, values: unknown[] = []) => {
      if (query.includes("FROM target_usage")) return [...usage].sort((a, b) => b.usedAt.localeCompare(a.usedAt)).map((item) => ({ id: item.id, target_id: item.targetId, profile_id: item.profileId ?? null, research_project_id: item.researchProjectId ?? null, session_id: item.sessionId ?? null, used_at: item.usedAt })) as T;
      const collection = query.includes("collection = $1") ? values[0] : undefined;
      return targets.filter((row) => row.retired_at === null && (!collection || row.collection === collection)).sort((a, b) => query.includes("ORDER BY collection") ? a.collection.localeCompare(b.collection) || b.updated_at.localeCompare(a.updated_at) : b.updated_at.localeCompare(a.updated_at)) as T;
    },
    executeWrite: async (query: string, values: unknown[] = []) => {
      if (query.startsWith("INSERT INTO targets")) {
        targets.push({ id: String(values[0]), collection: values[1] as TargetRecord["collection"], title: String(values[2]), reveal_text: values[3] as string | null, reveal_artifact_path: values[4] as string | null, reveal_artifact_manifest_json: String(values[5]), tags_json: String(values[6]), source_metadata_json: String(values[7]), content_hash: values[8] as string | null, created_at: String(values[9]), updated_at: String(values[9]), retired_at: null });
        return { rowsAffected: 1 };
      }
      if (query.startsWith("UPDATE targets")) {
        const row = targets.find((item) => item.id === values[5] && item.collection === "user");
        if (!row) return { rowsAffected: 0 };
        Object.assign(row, { title: values[0], reveal_text: values[1], tags_json: values[2], content_hash: values[3], updated_at: values[4] });
        return { rowsAffected: 1 };
      }
      if (query.startsWith("DELETE FROM targets")) {
        const index = targets.findIndex((item) => item.id === values[0] && item.collection === "user");
        if (index < 0) return { rowsAffected: 0 };
        targets.splice(index, 1);
        return { rowsAffected: 1 };
      }
      if (query.startsWith("INSERT INTO target_usage")) {
        usage.push({ id: String(values[0]), targetId: String(values[1]), profileId: values[2] as string | undefined, researchProjectId: values[3] as string | undefined, sessionId: values[4] as string | undefined, usedAt: String(values[5]) });
        return { rowsAffected: 1 };
      }
      throw new Error(`Unexpected write: ${query}`);
    },
  };
  return {
    repository: new SqliteTargetsRepository(dependencies),
    seedTargets: (items) => { targets = items.map(toRow); },
    seedUsage: (items) => { usage = [...items]; },
  };
}

function target(id: string, collection: TargetRecord["collection"], updatedAt = "2026-09-06T00:00:00.000Z"): TargetRecord {
  return { id, collection, title: id, tags: [], sourceMetadata: {}, createdAt: updatedAt, updatedAt };
}

for (const [name, makeHarness] of [["browser", browserHarness], ["sqlite", sqliteHarness]] as const) {
  describe(`${name} Targets repository contract`, () => {
    it("lists all targets by collection and newest first within each collection", async () => {
      const harness = makeHarness();
      harness.seedTargets([
        target("user-old", "user", "2026-09-05T00:00:00.000Z"),
        target("training-old", "training", "2026-09-04T00:00:00.000Z"),
        target("user-new", "user", "2026-09-07T00:00:00.000Z"),
        target("training-new", "training", "2026-09-06T00:00:00.000Z"),
      ]);
      expect((await harness.repository.listTargets()).map((item) => item.id)).toEqual([
        "training-new",
        "training-old",
        "user-new",
        "user-old",
      ]);
    });

    it("lists a selected collection newest first", async () => {
      const harness = makeHarness();
      harness.seedTargets([
        target("user-old", "user", "2026-09-05T00:00:00.000Z"),
        target("training-a", "training", "2026-09-07T00:00:00.000Z"),
        target("user-new", "user", "2026-09-06T00:00:00.000Z"),
      ]);
      expect((await harness.repository.listTargets("user")).map((item) => item.id)).toEqual(["user-new", "user-old"]);
    });

    it("creates and updates a normalized user target without changing its immutable fields", async () => {
      const harness = makeHarness();
      const created = await harness.repository.createTarget({ id: "user-a", collection: "user", title: "  Title  ", revealText: "  Reveal  ", tags: ["one"], sourceMetadata: { targetKind: "general" }, contentHash: "hash-1" });
      expect(created).toMatchObject({ id: "user-a", title: "Title", revealText: "Reveal", tags: ["one"] });
      const updated = await harness.repository.updateTarget("user-a", { title: "  New  ", revealText: "  Text  ", tags: ["two"], contentHash: "hash-2" });
      expect(updated).toMatchObject({ id: "user-a", collection: "user", title: "New", revealText: "Text", tags: ["two"], contentHash: "hash-2", createdAt: created.createdAt });
    });

    it("records and returns usage newest first", async () => {
      const harness = makeHarness();
      harness.seedUsage([]);
      await harness.repository.recordTargetUsage({ targetId: "target-a", profileId: "profile-a" });
      await harness.repository.recordTargetUsage({ targetId: "target-b", sessionId: "session-b" });
      expect((await harness.repository.listTargetUsage()).map((item) => item.targetId)).toEqual(["target-b", "target-a"]);
    });

    it("deletes only user targets", async () => {
      const harness = makeHarness();
      harness.seedTargets([target("user-a", "user"), target("training-a", "training")]);
      await harness.repository.deleteTarget("user-a");
      await expect(harness.repository.deleteTarget("training-a")).rejects.toThrow();
    });
  });
}

describe("browser Targets cross-domain mutation guard", () => {
  it("keeps a used user target immutable through the facade-owned guard", async () => {
    const harness = browserHarness();
    harness.seedTargets([target("user-a", "user")]);
    harness.seedUsage([{ id: "usage-a", targetId: "user-a", usedAt: "2026-09-07T00:00:00.000Z" }]);
    await expect(harness.repository.updateTarget("user-a", { title: "Changed", tags: [], contentHash: "hash" })).rejects.toThrow("Used targets are locked");
    await expect(harness.repository.deleteTarget("user-a")).rejects.toThrow("Used targets are locked");
  });
});
