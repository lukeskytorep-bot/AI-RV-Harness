import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../storage/repository";
import type { Workspace } from "../types";
import { archiveWorkspaceAndRefresh, renameWorkspaceAndRefresh } from "./workspaceManagement";

const now = "2026-09-15T10:00:00.000Z";
const first: Workspace = { id: "workspace-1", profileId: "profile-1", name: "First", createdAt: now, updatedAt: now, lastOpenedAt: now };
const second: Workspace = { id: "workspace-2", profileId: "profile-1", name: "Second", createdAt: now, updatedAt: now, lastOpenedAt: now };

function repositoryMock() {
  return {
    renameWorkspace: vi.fn(async () => undefined),
    archiveWorkspace: vi.fn(async () => undefined),
  } as unknown as AppRepository;
}

describe("Workspace management application use cases", () => {
  it("renames before refreshing the application-owned list", async () => {
    const order: string[] = [];
    const repository = repositoryMock();
    vi.mocked(repository.renameWorkspace).mockImplementation(async () => { order.push("rename"); });

    await renameWorkspaceAndRefresh(repository, first, first.profileId, "Renamed", async () => { order.push("refresh"); });

    expect(repository.renameWorkspace).toHaveBeenCalledWith(first.id, "Renamed");
    expect(order).toEqual(["rename", "refresh"]);
  });

  it("selects another Workspace of the same Profile when the active one is archived", async () => {
    const repository = repositoryMock();
    const onActiveArchived = vi.fn();
    const refresh = vi.fn(async () => undefined);

    await archiveWorkspaceAndRefresh(repository, first, first.profileId, [first, second], first.id, onActiveArchived, refresh);

    expect(repository.archiveWorkspace).toHaveBeenCalledWith(first.id);
    expect(onActiveArchived).toHaveBeenCalledWith(second.id);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not change the active selection when another Workspace is archived", async () => {
    const repository = repositoryMock();
    const onActiveArchived = vi.fn();

    await archiveWorkspaceAndRefresh(repository, second, second.profileId, [first, second], first.id, onActiveArchived, vi.fn(async () => undefined));

    expect(onActiveArchived).not.toHaveBeenCalled();
  });

  it("refuses to mutate a Workspace owned by another Profile", async () => {
    const repository = repositoryMock();

    await expect(renameWorkspaceAndRefresh(repository, first, "profile-2", "Wrong", vi.fn(async () => undefined))).rejects.toThrow("does not belong");
    await expect(archiveWorkspaceAndRefresh(repository, first, "profile-2", [first, second], null, vi.fn(), vi.fn(async () => undefined))).rejects.toThrow("does not belong");

    expect(repository.renameWorkspace).not.toHaveBeenCalled();
    expect(repository.archiveWorkspace).not.toHaveBeenCalled();
  });
});
