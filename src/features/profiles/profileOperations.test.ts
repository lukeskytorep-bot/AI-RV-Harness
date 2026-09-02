import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../../storage/repository";
import { archiveProfileAndRefresh, saveProfileAndRefresh } from "./profileOperations";

describe("profile operations", () => {
  it("archives before refreshing the application-owned profile list", async () => {
    const order: string[] = [];
    const repository = { archiveProfile: vi.fn(async () => { order.push("archive"); }) } as unknown as AppRepository;
    const refresh = vi.fn(async () => { order.push("refresh"); });

    await archiveProfileAndRefresh(repository, "profile-1", refresh);

    expect(repository.archiveProfile).toHaveBeenCalledWith("profile-1");
    expect(order).toEqual(["archive", "refresh"]);
  });

  it("persists identity and optional AI defaults before closing and refreshing", async () => {
    const order: string[] = [];
    const repository = {
      updateProfile: vi.fn(async () => { order.push("profile"); }),
      setProfileAiConfiguration: vi.fn(async () => { order.push("ai"); }),
    } as unknown as AppRepository;
    const close = vi.fn(() => { order.push("close"); });
    const refresh = vi.fn(async () => { order.push("refresh"); });
    const aiConfiguration = { credentialId: "credential-1", defaultViewerModelId: "model-1" };

    await saveProfileAndRefresh(repository, "profile-1", { name: "Orion", humanName: "Luke", note: "note", aiConfiguration }, refresh, close);

    expect(repository.updateProfile).toHaveBeenCalledWith("profile-1", { name: "Orion", humanName: "Luke", note: "note" });
    expect(repository.setProfileAiConfiguration).toHaveBeenCalledWith("profile-1", aiConfiguration);
    expect(order).toEqual(["profile", "ai", "close", "refresh"]);
  });
});
