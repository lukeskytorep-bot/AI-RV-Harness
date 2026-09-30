import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { Workspace } from "../types";
import { archiveWorkspaceAndRefresh, renameWorkspaceAndRefresh } from "./workspaceManagement";
const now = "2026-09-15T10:00:00.000Z";
const first: Workspace = { id: "workspace-1", profileId: "profile-1", name: "First", kind: "conversation", createdAt: now, updatedAt: now, lastOpenedAt: now };
function repositoryMock() { return { renameWorkspace: vi.fn(async () => undefined), archiveWorkspace: vi.fn(async () => undefined) } as unknown as AppRepository; }
describe("Workspace management application use cases", () => {
  it("renames before refreshing", async () => { const order:string[]=[]; const repository=repositoryMock(); vi.mocked(repository.renameWorkspace).mockImplementation(async()=>{order.push("rename")}); await renameWorkspaceAndRefresh(repository, first, first.profileId, "Renamed", async()=>{order.push("refresh")}); expect(order).toEqual(["rename","refresh"]); });
  it("archives before refreshing", async () => { const order:string[]=[]; const repository=repositoryMock(); vi.mocked(repository.archiveWorkspace).mockImplementation(async()=>{order.push("archive")}); await archiveWorkspaceAndRefresh(repository, first, first.profileId, async()=>{order.push("refresh")}); expect(order).toEqual(["archive","refresh"]); });
  it("refuses a foreign Workspace", async () => { const repository=repositoryMock(); await expect(renameWorkspaceAndRefresh(repository, first, "profile-2", "Wrong", vi.fn(async()=>undefined))).rejects.toThrow("does not belong"); await expect(archiveWorkspaceAndRefresh(repository, first, "profile-2", vi.fn(async()=>undefined))).rejects.toThrow("does not belong"); });
});
