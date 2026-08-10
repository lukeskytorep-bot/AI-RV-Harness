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
});
