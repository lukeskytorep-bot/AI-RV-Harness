import { describe, expect, it } from "vitest";
import { BrowserWorkspacesConversationsRepository } from "./browser/workspacesConversationsRepository";
import { SqliteWorkspacesConversationsRepository } from "./sqlite/workspacesConversationsRepository";
import type { DatabaseTransactionStatement } from "./databaseNative";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const timestamp = "2026-09-08T12:00:00.000Z";

describe("browser Workspaces and Conversations repository contract", () => {
  it("preserves Workspace keys, ordering, normalization and duplicate protection", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const first = await repository.createWorkspace({ profileId: "profile-a", name: "  First  ", description: "  Notes  " });
    const second = await repository.createWorkspace({ profileId: "profile-a", name: "Second" });

    expect(first).toMatchObject({ name: "First", description: "Notes", lastOpenedAt: timestamp });
    expect((await repository.listWorkspaces("profile-a")).map((item) => item.id)).toEqual([second.id, first.id]);
    await expect(repository.renameWorkspace(second.id, " first ")).rejects.toThrow("already exists");
    expect(JSON.parse(storage.getItem("rvh.dev.workspaces") ?? "[]")).toHaveLength(2);
  });

  it("preserves group cascade archive/restore without restoring children archived earlier", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const workspace = await repository.createWorkspace({ profileId: "profile-a", name: "Workspace" });
    const group = await repository.createChatThreadGroup(workspace.id, "conversation", "Thread");
    const old = await repository.createChatThread(workspace.id, "conversation", "Old", group.id);
    const active = await repository.createChatThread(workspace.id, "conversation", "Active", group.id);
    await repository.appendChatMessage(active.id, "user", "Preserve me");
    await repository.archiveChatThread(old.id);
    await repository.archiveChatThreadGroup(group.id);
    await repository.restoreChatThreadGroup(group.id);

    expect((await repository.listChatThreads(workspace.id, "conversation")).map((item) => item.id)).toEqual([active.id]);
    expect((await repository.listChatMessages(active.id)).map((item) => item.content)).toEqual(["Preserve me"]);
    expect(JSON.parse(storage.getItem("rvh.dev.chat_thread_groups") ?? "[]")).toHaveLength(1);
    expect(JSON.parse(storage.getItem("rvh.dev.chat_threads") ?? "[]")).toHaveLength(2);
    expect(JSON.parse(storage.getItem("rvh.dev.chat_messages") ?? "[]")).toHaveLength(1);
  });

  it("migrates legacy ungrouped conversations through the unchanged lazy compatibility path", async () => {
    const storage = new MemoryStorage();
    storage.setItem("rvh.dev.chat_threads", JSON.stringify([{ id: "legacy", workspaceId: "workspace-a", mode: "conversation", title: "Old", createdAt: timestamp, updatedAt: timestamp }]));
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });

    const groups = await repository.listChatThreadGroups("workspace-a", "conversation");
    expect(groups[0]?.id).toBe("legacy_group_workspace-a_conversation");
    expect((await repository.listChatThreads("workspace-a", "conversation"))[0]?.threadGroupId).toBe(groups[0]?.id);
  });
});

describe("SQLite Workspaces and Conversations repository contract", () => {
  it("keeps Workspace filtering and row mapping stable", async () => {
    const queries: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>(query: string, values?: unknown[]) => {
        queries.push({ query, values });
        return [{ id: "workspace-a", profile_id: "profile-a", name: "Workspace", description: null, created_at: timestamp, updated_at: timestamp, last_opened_at: timestamp, archived_at: null }] as T;
      },
      executeWrite: async () => ({ rowsAffected: 1 }), executeTransaction: async () => [], now: () => timestamp,
    });

    expect(await repository.listWorkspaces("profile-a")).toEqual([{ id: "workspace-a", profileId: "profile-a", name: "Workspace", description: undefined, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp }]);
    expect(queries[0]?.query).toContain("profile_id = $1 AND archived_at IS NULL");
    expect(queries[0]?.values).toEqual(["profile-a"]);
  });

  it("archives and restores a group and only its jointly archived children in transactions", async () => {
    const transactions: DatabaseTransactionStatement[][] = [];
    let selectIndex = 0;
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => {
        const responses = [[{ latest: null }], [{ archived_at: timestamp, workspace_id: "workspace-a" }], [{ archived_at: null }]];
        return responses[selectIndex++] as T;
      },
      executeWrite: async () => ({ rowsAffected: 1 }),
      executeTransaction: async (statements) => { transactions.push(statements); return []; },
      now: () => timestamp,
    });

    await repository.archiveChatThreadGroup("group-a");
    await repository.restoreChatThreadGroup("group-a");
    expect(transactions[0]?.map((item) => item.query)).toEqual([
      expect.stringContaining("UPDATE chat_thread_groups SET archived_at"),
      expect.stringContaining("UPDATE chat_threads SET archived_at"),
    ]);
    expect(transactions[1]?.[1].query).toContain("archived_at = $3");
    expect(transactions[1]?.[1].values?.[2]).toBe(timestamp);
  });

  it("preserves the two writes used for a persisted message and thread timestamp", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [] as T,
      executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; },
      executeTransaction: async () => [], now: () => timestamp,
    });

    const message = await repository.appendChatMessage("thread-a", "assistant", "Answer");
    expect(message).toMatchObject({ threadId: "thread-a", role: "assistant", content: "Answer", createdAt: timestamp });
    expect(writes.map((item) => item.query)).toEqual([
      expect.stringContaining("INSERT INTO chat_messages"),
      expect.stringContaining("UPDATE chat_threads SET updated_at"),
    ]);
  });
});
