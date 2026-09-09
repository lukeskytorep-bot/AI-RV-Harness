import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import { createProfileWithInitialWorkspace, INITIAL_WORKSPACE_NAME } from "./profileWorkspace";

const now = "2026-09-09T10:00:00.000Z";
const profile: Profile = { id: "profile-a", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-a", profileId: profile.id, name: INITIAL_WORKSPACE_NAME, createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("createProfileWithInitialWorkspace", () => {
  it("creates exactly one initial Workspace after the Profile", async () => {
    const order: string[] = [];
    const repository = {
      createProfile: vi.fn(async () => { order.push("profile"); return profile; }),
      createWorkspace: vi.fn(async () => { order.push("workspace"); return workspace; }),
      archiveProfile: vi.fn(async () => undefined),
    } as unknown as AppRepository;

    const result = await createProfileWithInitialWorkspace(repository, { name: "Orion" });

    expect(order).toEqual(["profile", "workspace"]);
    expect(repository.createWorkspace).toHaveBeenCalledOnce();
    expect(repository.createWorkspace).toHaveBeenCalledWith({ profileId: profile.id, name: INITIAL_WORKSPACE_NAME });
    expect(repository.archiveProfile).not.toHaveBeenCalled();
    expect(result).toEqual({ profile, workspace });
  });

  it("archives the just-created Profile when initial Workspace creation fails", async () => {
    const failure = new Error("workspace write failed");
    const repository = {
      createProfile: vi.fn(async () => profile),
      createWorkspace: vi.fn(async () => { throw failure; }),
      archiveProfile: vi.fn(async () => undefined),
    } as unknown as AppRepository;

    await expect(createProfileWithInitialWorkspace(repository, { name: "Orion" })).rejects.toBe(failure);
    expect(repository.archiveProfile).toHaveBeenCalledWith(profile.id);
  });

  it("surfaces both failures when recovery cannot archive the partial Profile", async () => {
    const repository = {
      createProfile: vi.fn(async () => profile),
      createWorkspace: vi.fn(async () => { throw new Error("workspace failed"); }),
      archiveProfile: vi.fn(async () => { throw new Error("archive failed"); }),
    } as unknown as AppRepository;

    await expect(createProfileWithInitialWorkspace(repository, { name: "Orion" })).rejects.toThrow("Profile recovery also failed");
  });
});
