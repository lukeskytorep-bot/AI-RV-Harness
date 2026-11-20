// @vitest-environment jsdom
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type { WorkspaceSourcesRepository } from "./contracts/workspaceSourcesRepository";
import type { CustomProtocolsRepository } from "./contracts/customProtocolsRepository";
import { BrowserWorkspaceSourcesRepository } from "./browser/workspaceSourcesRepository";
import { BrowserCustomProtocolsRepository } from "./browser/customProtocolsRepository";
import { SqliteWorkspaceSourcesRepository } from "./sqlite/workspaceSourcesRepository";
import { SqliteCustomProtocolsRepository } from "./sqlite/customProtocolsRepository";

for (const backend of ["browser", "sqlite"] as const) {
it(`${backend} preserves source selection and protocol history across reopening`, async () => {
  localStorage.clear();
  const directory = mkdtempSync(join(tmpdir(), "rvh-sources-protocols-"));
  const path = join(directory, "state.sqlite");
  let db: DatabaseSync | undefined;
  const open = (): { sources: WorkspaceSourcesRepository; protocols: CustomProtocolsRepository } => {
    if (backend === "browser") return {
      sources: new BrowserWorkspaceSourcesRepository(),
      protocols: new BrowserCustomProtocolsRepository(),
    };
    db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys=ON");
    const database = db;
    const prepare = (query: string, values: unknown[] = []) => {
      const ordered: unknown[] = [];
      const statement = database.prepare(query.replace(/\$(\d+)/g, (_, n) => {
        ordered.push(values[Number(n) - 1]);
        return "?";
      }));
      return { statement, ordered: ordered as never[] };
    };
    const dependencies = {
      select: async <T,>(query: string, values?: unknown[]) => {
        const { statement, ordered } = prepare(query, values);
        return statement.all(...ordered) as T;
      },
      executeWrite: async (query: string, values?: unknown[]) => {
        const { statement, ordered } = prepare(query, values);
        return { rowsAffected: Number(statement.run(...ordered).changes) };
      },
    };
    return {
      sources: new SqliteWorkspaceSourcesRepository(dependencies),
      protocols: new SqliteCustomProtocolsRepository(dependencies),
    };
  };
  try {
    let repo = open();
    if (db) {
      const folder = "src-tauri/migrations";
      // This is an empty lifecycle fixture, not a migration-commit test. Avoid
      // autocommitting every DDL statement to disk on contended Windows runners.
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const file of readdirSync(folder).filter(name => name.endsWith(".sql")).sort()) {
          db.exec(readFileSync(join(folder, file), "utf8"));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      db.exec(`
        INSERT INTO profiles(id,display_name,created_at,updated_at) VALUES ('p','P','now','now');
        INSERT INTO workspaces(id,profile_id,name,created_at,updated_at,last_opened_at) VALUES ('w','p','W','now','now','now');
        INSERT INTO chat_threads(id,workspace_id,mode,title,created_at,updated_at) VALUES ('t','w','conversation','T','now','now');
        INSERT INTO chat_threads(id,workspace_id,mode,title,created_at,updated_at) VALUES ('other','w','conversation','Other','now','now');
      `);
    }
    for (const id of ["one", "two"]) {
      await repo.sources.createWorkspaceSource({
        id, workspaceId: "w", sourceType: "markdown", displayName: `  ${id}  `,
        content: "# Preserved source", contentHash: "source-hash", metadata: { origin: "import" },
      });
      await repo.sources.setChatSourceActive("t", id, true);
    }
    await repo.sources.setChatSourceActive("t", "one", true);
    expect((await repo.sources.listActiveChatSourceIds("t")).sort()).toEqual(["one", "two"]);
    await repo.sources.setChatSourceActive("other", "one", true);
    await repo.sources.setChatSourceActive("t", "two", false);
    for (const [version, language] of [["1", "en"], ["2", "en"], ["1", "pl"]] as const) {
      const steps = ["Blind observation", "Sketch"];
      const saved = await repo.protocols.saveCustomProtocolVersion({
        protocolId: "custom", versionId: version + language, displayName: "Custom",
        version, language, steps, systemPrompt: "Blind only", description: "Imported protocol",
        contentHash: "protocol-hash", createdAt: `2026-09-0${version}T12:00:00Z`,
      });
      steps.push("Caller mutation");
      expect(saved.steps).toEqual(["Blind observation", "Sketch"]);
    }
    db?.close();
    repo = open();
    expect(await repo.sources.listWorkspaceSources("other-workspace")).toEqual([]);
    expect(await repo.sources.listWorkspaceSources("w")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "one", displayName: "one", contentHash: "source-hash", metadata: { origin: "import" } }),
    ]));
    expect(await repo.sources.listActiveChatSourceIds("t")).toEqual(["one"]);
    expect((await repo.protocols.listCustomProtocols("en")).map(row => row.version)).toEqual(["2", "1"]);
    expect(await repo.protocols.listCustomProtocols()).toHaveLength(3);
    expect((await repo.protocols.listCustomProtocols("pl"))[0]).toMatchObject({
      systemPrompt: "Blind only", description: "Imported protocol", contentHash: "protocol-hash",
    });
    await repo.sources.deleteWorkspaceSource("one");
    expect(await repo.sources.listActiveChatSourceIds("t")).toEqual([]);
    expect(await repo.sources.listActiveChatSourceIds("other")).toEqual([]);
    expect((await repo.sources.listWorkspaceSources("w")).map(source => source.id)).toEqual(["two"]);
    if (db) expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db?.close();
    localStorage.clear();
    rmSync(directory, { recursive: true, force: true });
  }
}, backend === "sqlite" ? 30_000 : 5_000);
}
