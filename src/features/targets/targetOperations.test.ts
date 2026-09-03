import { describe, expect, it, vi } from "vitest";

import type { AppRepository } from "../../storage/repository";
import { deleteFeatureTarget, loadTargetLibrary, updateFeatureTarget } from "./targetOperations";

describe("target operations", () => {
  it("loads target usage and every research assignment before exposing lock state", async () => {
    const repository = {
      listTargets: vi.fn(async () => []),
      listTargetUsage: vi.fn(async () => []),
      listResearchProjects: vi.fn(async () => [{ id: "research-1" }, { id: "research-2" }]),
      listResearchAssignments: vi.fn(async (projectId: string) => projectId === "research-1"
        ? [{ targetId: "target-a" }, { targetId: "target-b" }]
        : [{ targetId: "target-b" }]),
    } as unknown as AppRepository;

    const result = await loadTargetLibrary(repository);

    expect(repository.listResearchAssignments).toHaveBeenCalledTimes(2);
    expect(result.researchLockedTargetIds).toEqual(["target-a", "target-b"]);
  });

  it("updates and deletes through the repository-owned target contracts", async () => {
    const base = {
      id: "target-1",
      collection: "user" as const,
      title: "Old",
      revealText: "Old reveal",
      tags: [],
      sourceMetadata: {},
      createdAt: "now",
      updatedAt: "now",
    };
    const repository = {
      updateTarget: vi.fn(async (_id, values) => ({ ...base, ...values })),
      deleteTarget: vi.fn(async () => undefined),
    } as unknown as AppRepository;

    await updateFeatureTarget(repository, base, { title: "New", revealText: "New reveal", tags: ["test"] });
    await deleteFeatureTarget(repository, base.id);

    expect(repository.updateTarget).toHaveBeenCalledWith("target-1", expect.objectContaining({ title: "New", revealText: "New reveal", tags: ["test"] }));
    expect(repository.deleteTarget).toHaveBeenCalledWith("target-1");
  });
});
