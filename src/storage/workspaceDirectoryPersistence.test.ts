import { beforeEach, describe, expect, it } from "vitest";
import { filterWorkspaceDirectory } from "../domain/workspaceDirectory";
import { BrowserRepository } from "./browserRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("workspace directory persistence", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  });

  it("finds every workspace after restart and supports switching across Profiles", async () => {
    const repository = new BrowserRepository();
    const profileA = await repository.createProfile({ name: "Edward" });
    const profileB = await repository.createProfile({ name: "Badania" });
    const created = [
      await repository.createWorkspace({ profileId: profileA.id, name: "Sesje sierpniowe" }),
      await repository.createWorkspace({ profileId: profileA.id, name: "Kalibracja" }),
      await repository.createWorkspace({ profileId: profileB.id, name: "Archiwum prób" }),
    ];

    const restarted = new BrowserRepository();
    const profiles = await restarted.listProfiles();
    const workspaces = await restarted.listWorkspaces();
    expect(new Set(workspaces.map((workspace) => workspace.id))).toEqual(new Set(created.map((workspace) => workspace.id)));
    expect(filterWorkspaceDirectory(workspaces, profiles, "Edward").flatMap((group) => group.workspaces)).toHaveLength(2);
    expect(filterWorkspaceDirectory(workspaces, profiles, "archiwum")[0]?.profile.id).toBe(profileB.id);

    await restarted.touchWorkspace(created[0].id);
    expect((await restarted.listWorkspaces())[0]?.id).toBe(created[0].id);
  });

  it("renames, archives and restores a Workspace without deleting its conversations", async () => {
    const repository = new BrowserRepository();
    const profile = await repository.createProfile({ name: "Edward" });
    const workspace = await repository.createWorkspace({ profileId: profile.id, name: "Original" });
    const group = await repository.createChatThreadGroup(workspace.id, "conversation", "Long conversation");
    const thread = await repository.createChatThread(workspace.id, "conversation", "Part 1", group.id);
    await repository.appendChatMessage(thread.id, "user", "Preserve me");

    await repository.renameWorkspace(workspace.id, "Renamed");
    expect((await repository.listWorkspaces())[0]?.name).toBe("Renamed");
    await repository.archiveWorkspace(workspace.id);
    expect(await repository.listWorkspaces()).toHaveLength(0);
    expect((await repository.listArchivedWorkspaces())[0]?.name).toBe("Renamed");
    await repository.restoreWorkspace(workspace.id);

    expect((await repository.listWorkspaces())[0]?.name).toBe("Renamed");
    expect((await repository.listChatThreadGroups(workspace.id, "conversation"))[0]?.id).toBe(group.id);
    expect((await repository.listChatMessages(thread.id))[0]?.content).toBe("Preserve me");
  });

  it("restores only descendants archived together with a conversation", async () => {
    const repository = new BrowserRepository();
    const profile = await repository.createProfile({ name: "Edward" });
    const workspace = await repository.createWorkspace({ profileId: profile.id, name: "W" });
    const group = await repository.createChatThreadGroup(workspace.id, "conversation", "Conversation");
    const previouslyArchived = await repository.createChatThread(workspace.id, "conversation", "Old", group.id);
    const active = await repository.createChatThread(workspace.id, "conversation", "Active", group.id);
    await repository.archiveChatThread(previouslyArchived.id);
    await repository.archiveChatThreadGroup(group.id);
    await repository.restoreChatThreadGroup(group.id);

    const restored = await repository.listChatThreads(workspace.id, "conversation");
    expect(restored.map((item) => item.id)).toContain(active.id);
    expect(restored.map((item) => item.id)).not.toContain(previouslyArchived.id);
  });
});
