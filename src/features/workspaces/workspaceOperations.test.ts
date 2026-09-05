import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../../storage/repository";
import type { Workspace } from "../../types";
import { archiveWorkspaceAndRefresh, renameWorkspaceAndRefresh } from "./workspaceOperations";

const now = "2026-09-05T10:00:00.000Z";
const first: Workspace = { id: "workspace-1", profileId: "profile-1", name: "First", createdAt: now, updatedAt: now, lastOpenedAt: now };
const second: Workspace = { id: "workspace-2", profileId: "profile-1", name: "Second", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("Workspace operations", () => {
  it("renames before refreshing the application-owned list", async () => {
    const order: string[] = [];
    const repository = { renameWorkspace: vi.fn(async () => { order.push("rename"); }) } as unknown as AppRepository;
    await renameWorkspaceAndRefresh(repository, first.id, "Renamed", async () => { order.push("refresh"); });

    expect(repository.renameWorkspace).toHaveBeenCalledWith(first.id, "Renamed");
    expect(order).toEqual(["rename", "refresh"]);
  });

  it("selects another Workspace of the same Profile when the active one is archived", async () => {
    const repository = { archiveWorkspace: vi.fn(async () => undefined) } as unknown as AppRepository;
    const onActiveArchived = vi.fn();
    const refresh = vi.fn(async () => undefined);
    await archiveWorkspaceAndRefresh(repository, first, [first, second], first.id, onActiveArchived, refresh);

    expect(repository.archiveWorkspace).toHaveBeenCalledWith(first.id);
    expect(onActiveArchived).toHaveBeenCalledWith(second.id);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not change the active selection when another Workspace is archived", async () => {
    const repository = { archiveWorkspace: vi.fn(async () => undefined) } as unknown as AppRepository;
    const onActiveArchived = vi.fn();
    await archiveWorkspaceAndRefresh(repository, second, [first, second], first.id, onActiveArchived, vi.fn(async () => undefined));

    expect(onActiveArchived).not.toHaveBeenCalled();
  });
});
