import { describe, expect, it } from "vitest";
import { BrowserWorkspacesConversationsRepository } from "./browser/workspacesConversationsRepository";
import { legacyThreadHierarchyFixture } from "./fixtures/legacyThreadHierarchy";
import { SqliteWorkspacesConversationsRepository } from "./sqlite/workspacesConversationsRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const timestamp = "2026-09-09T12:00:00.000Z";

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

  it("protects the last active Workspace of a Profile and allows archive when another remains", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const first = await repository.createWorkspace({ profileId: "profile-a", name: "First" });

    await expect(repository.archiveWorkspace(first.id)).rejects.toThrow("at least one active Workspace");
    const second = await repository.createWorkspace({ profileId: "profile-a", name: "Second" });
    await repository.archiveWorkspace(first.id);
    expect((await repository.listWorkspaces("profile-a")).map((item) => item.id)).toEqual([second.id]);
  });

  it("creates, archives and restores Conversations directly under Workspace", async () => {
    const storage = new MemoryStorage();
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });
    const workspace = await repository.createWorkspace({ profileId: "profile-a", name: "Workspace" });
    const conversation = await repository.createChatThread(workspace.id, "conversation", "Conversation A");
    await repository.appendChatMessage(conversation.id, "user", "Preserve me");

    expect(conversation.threadGroupId).toBeUndefined();
    await repository.archiveChatThread(conversation.id);
    expect(await repository.listChatThreads(workspace.id, "conversation")).toEqual([]);
    await repository.restoreChatThread(conversation.id);

    expect((await repository.listChatThreads(workspace.id, "conversation"))[0]?.id).toBe(conversation.id);
    expect((await repository.listChatMessages(conversation.id)).map((item) => item.content)).toEqual(["Preserve me"]);
  });

  it("opens the legacy Thread-group fixture without data loss and restores a child directly", async () => {
    const storage = new MemoryStorage();
    storage.setItem("rvh.dev.workspaces", JSON.stringify(legacyThreadHierarchyFixture.workspaces));
    storage.setItem("rvh.dev.chat_thread_groups", JSON.stringify(legacyThreadHierarchyFixture.groups));
    storage.setItem("rvh.dev.chat_threads", JSON.stringify(legacyThreadHierarchyFixture.threads));
    storage.setItem("rvh.dev.chat_messages", JSON.stringify(legacyThreadHierarchyFixture.messages));
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });

    expect((await repository.listChatThreads("workspace-legacy", "conversation")).map((item) => item.id)).toEqual(["conversation-active"]);
    expect((await repository.listChatMessages("conversation-active"))[0]?.content).toBe("Preserved legacy message");

    await repository.restoreChatThread("conversation-archived-with-group");
    const active = await repository.listChatThreads("workspace-legacy", "conversation");
    expect(new Set(active.map((item) => item.id))).toEqual(new Set(["conversation-active", "conversation-archived-with-group"]));
    expect((await repository.listChatMessages("conversation-archived-with-group"))[0]?.content).toBe("Preserved archived message");

    const created = await repository.createChatThread("workspace-legacy", "conversation", "Flat Conversation");
    expect(created.threadGroupId).toBeUndefined();
    expect(JSON.parse(storage.getItem("rvh.dev.chat_thread_groups") ?? "[]")).toEqual(legacyThreadHierarchyFixture.groups);
  });

  it("does not restore an orphaned Conversation when its Workspace is missing", async () => {
    const storage = new MemoryStorage();
    storage.setItem("rvh.dev.chat_threads", JSON.stringify([legacyThreadHierarchyFixture.threads[1]]));
    const repository = new BrowserWorkspacesConversationsRepository({ storage, now: () => timestamp });

    await expect(repository.restoreChatThread("conversation-archived-with-group")).rejects.toThrow("Restore the parent Workspace first");
    expect((await repository.listArchivedChatThreads())[0]?.id).toBe("conversation-archived-with-group");
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
      executeWrite: async () => ({ rowsAffected: 1 }), now: () => timestamp,
    });

    expect(await repository.listWorkspaces("profile-a")).toEqual([{ id: "workspace-a", profileId: "profile-a", name: "Workspace", description: undefined, createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp }]);
    expect(queries[0]?.query).toContain("profile_id = $1 AND archived_at IS NULL");
    expect(queries[0]?.values).toEqual(["profile-a"]);
  });

  it("enforces the last-active-Workspace guard below the UI with an atomic conditional write", async () => {
    const writes: string[] = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [{ id: "workspace-a" }] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 0 }; },
      now: () => timestamp,
    });

    await expect(repository.archiveWorkspace("workspace-a")).rejects.toThrow("at least one active Workspace");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("SELECT COUNT(*) FROM workspaces sibling");
  });

  it("allows SQLite Workspace archive when the atomic guard reports a remaining sibling", async () => {
    const writes: string[] = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [{ id: "workspace-a" }] as T,
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      now: () => timestamp,
    });

    await repository.archiveWorkspace("workspace-a");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("UPDATE workspaces");
    expect(writes[0]).toContain(") > 1");
  });

  it("persists new Conversations with a NULL legacy group reference", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [] as T,
      executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; },
      now: () => timestamp,
    });

    const thread = await repository.createChatThread("workspace-a", "conversation", "Flat");
    expect(thread.threadGroupId).toBeUndefined();
    expect(writes[0]?.query).toContain("thread_group_id");
    expect(writes[0]?.query).toContain("NULL");
    expect(writes[0]?.values).toEqual([thread.id, "workspace-a", "conversation", "Flat", timestamp]);
  });

  it("maps legacy group metadata but restores the Conversation without a Thread parent check", async () => {
    const queries: string[] = [];
    const writes: string[] = [];
    let selectIndex = 0;
    const legacyRow = {
      id: "conversation-old",
      workspace_id: "workspace-a",
      mode: "conversation" as const,
      thread_group_id: "group-old",
      title: "Legacy",
      formal_rv_state: null,
      created_at: timestamp,
      updated_at: timestamp,
      archived_at: null,
    };
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>(query: string) => {
        queries.push(query);
        const responses = [
          [legacyRow],
          [{ workspace_id: "workspace-a" }],
          [{ archived_at: null }],
        ];
        return responses[selectIndex++] as T;
      },
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      now: () => timestamp,
    });

    expect((await repository.listChatThreads("workspace-a", "conversation"))[0]?.threadGroupId).toBe("group-old");
    await repository.restoreChatThread("conversation-old");
    expect(queries.some((query) => query.includes("chat_thread_groups"))).toBe(false);
    expect(writes.at(-1)).toContain("UPDATE chat_threads SET archived_at = NULL");
  });

  it("does not restore an orphaned SQLite Conversation when its Workspace is missing", async () => {
    const writes: string[] = [];
    let selectIndex = 0;
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => {
        const responses = [[{ workspace_id: "workspace-missing" }], []];
        return responses[selectIndex++] as T;
      },
      executeWrite: async (query) => { writes.push(query); return { rowsAffected: 1 }; },
      now: () => timestamp,
    });

    await expect(repository.restoreChatThread("conversation-orphaned")).rejects.toThrow("Restore the parent Workspace first");
    expect(writes).toEqual([]);
  });

  it("preserves the two writes used for a persisted message and thread timestamp", async () => {
    const writes: Array<{ query: string; values?: unknown[] }> = [];
    const repository = new SqliteWorkspacesConversationsRepository({
      select: async <T>() => [] as T,
      executeWrite: async (query, values) => { writes.push({ query, values }); return { rowsAffected: 1 }; },
      now: () => timestamp,
    });

    const message = await repository.appendChatMessage("thread-a", "assistant", "Answer");
    expect(message).toMatchObject({ threadId: "thread-a", role: "assistant", content: "Answer", createdAt: timestamp });
    expect(writes.map((item) => item.query)).toEqual([
      expect.stringContaining("INSERT INTO chat_messages"),
      expect.stringContaining("UPDATE chat_threads SET updated_at"),
    ]);
  });
});
