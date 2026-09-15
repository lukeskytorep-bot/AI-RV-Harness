import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { resolveTechnicalWorkspaceForProfile } from "./technicalWorkspace";

const workspace = (id: string, profileId: string, createdAt: string, archivedAt?: string): Workspace => ({
  id,
  profileId,
  name: id,
  createdAt,
  updatedAt: createdAt,
  lastOpenedAt: createdAt,
  ...(archivedAt ? { archivedAt } : {}),
});

describe("technical Workspace resolution", () => {
  it("selects the first active Workspace of the selected Profile deterministically", () => {
    const resolved = resolveTechnicalWorkspaceForProfile([
      workspace("newer", "profile-a", "2026-02-01T00:00:00.000Z"),
      workspace("foreign", "profile-b", "2025-01-01T00:00:00.000Z"),
      workspace("first", "profile-a", "2026-01-01T00:00:00.000Z"),
    ], "profile-a");
    expect(resolved?.id).toBe("first");
  });

  it("never falls through to another Profile and ignores archived Workspaces", () => {
    const resolved = resolveTechnicalWorkspaceForProfile([
      workspace("archived", "profile-a", "2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      workspace("foreign", "profile-b", "2025-01-01T00:00:00.000Z"),
    ], "profile-a");
    expect(resolved).toBeNull();
  });
});
