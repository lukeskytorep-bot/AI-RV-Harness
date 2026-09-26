import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../storage/repository";
import type { Profile, Workspace } from "../types";
import { createProfileWithInitialWorkspaces, INITIAL_CONVERSATION_WORKSPACE_NAME, INITIAL_RV_WORKSPACE_NAME } from "./profileWorkspace";

const now = "2026-09-09T10:00:00.000Z";
const profile: Profile = { id: "profile-a", name: "Orion", createdAt: now, updatedAt: now };
const conversationWorkspace: Workspace = { id: "workspace-c", profileId: profile.id, name: INITIAL_CONVERSATION_WORKSPACE_NAME, kind: "conversation", createdAt: now, updatedAt: now, lastOpenedAt: now };
const rvWorkspace: Workspace = { id: "workspace-r", profileId: profile.id, name: INITIAL_RV_WORKSPACE_NAME, kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("createProfileWithInitialWorkspaces", () => {
  it("creates Conversation and RV Workspaces after the Profile", async () => {
    const order: string[] = [];
    const repository = {
      createProfile: vi.fn(async () => { order.push("profile"); return profile; }),
      createWorkspace: vi.fn(async (input: { kind: string }) => { order.push(input.kind); return input.kind === "conversation" ? conversationWorkspace : rvWorkspace; }),
      archiveProfile: vi.fn(async () => undefined),
    } as unknown as AppRepository;
    const result = await createProfileWithInitialWorkspaces(repository, { name: "Orion" });
    expect(order).toEqual(["profile", "conversation", "rv"]);
    expect(repository.createWorkspace).toHaveBeenNthCalledWith(1, { profileId: profile.id, name: INITIAL_CONVERSATION_WORKSPACE_NAME, kind: "conversation" });
    expect(repository.createWorkspace).toHaveBeenNthCalledWith(2, { profileId: profile.id, name: INITIAL_RV_WORKSPACE_NAME, kind: "rv" });
    expect(repository.archiveProfile).not.toHaveBeenCalled();
    expect(result).toEqual({ profile, conversationWorkspace, rvWorkspace });
  });

  it("archives the partial Profile when either typed Workspace creation fails", async () => {
    const failure = new Error("rv workspace write failed");
    const repository = {
      createProfile: vi.fn(async () => profile),
      createWorkspace: vi.fn(async (input: { kind: string }) => input.kind === "conversation" ? conversationWorkspace : Promise.reject(failure)),
      archiveProfile: vi.fn(async () => undefined),
    } as unknown as AppRepository;
    await expect(createProfileWithInitialWorkspaces(repository, { name: "Orion" })).rejects.toBe(failure);
    expect(repository.archiveProfile).toHaveBeenCalledWith(profile.id);
  });

  it("surfaces both failures when recovery cannot archive the partial Profile", async () => {
    const repository = {
      createProfile: vi.fn(async () => profile),
      createWorkspace: vi.fn(async () => { throw new Error("workspace failed"); }),
      archiveProfile: vi.fn(async () => { throw new Error("archive failed"); }),
    } as unknown as AppRepository;
    await expect(createProfileWithInitialWorkspaces(repository, { name: "Orion" })).rejects.toThrow("Profile recovery also failed");
  });
});
