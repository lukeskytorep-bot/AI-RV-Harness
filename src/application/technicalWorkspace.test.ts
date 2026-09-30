import { describe, expect, it } from "vitest";
import type { Workspace, WorkspaceKind } from "../types";
import { resolveTechnicalWorkspaceForProfile } from "./technicalWorkspace";

const workspace = (id: string, profileId: string, createdAt: string, kind: WorkspaceKind, archivedAt?: string): Workspace => ({ id, profileId, name: id, kind, createdAt, updatedAt: createdAt, lastOpenedAt: createdAt, ...(archivedAt ? { archivedAt } : {}) });

describe("technical Workspace resolution", () => {
  it("selects the earliest active RV-compatible Workspace deterministically", () => {
    const resolved = resolveTechnicalWorkspaceForProfile([
      workspace("conversation", "profile-a", "2025-01-01T00:00:00.000Z", "conversation"),
      workspace("rv-newer", "profile-a", "2026-02-01T00:00:00.000Z", "rv"),
      workspace("legacy-first", "profile-a", "2026-01-01T00:00:00.000Z", "legacy_combined"),
    ], "profile-a");
    expect(resolved?.id).toBe("legacy-first");
  });

  it("never selects a Conversation-only, archived, or foreign Workspace", () => {
    const resolved = resolveTechnicalWorkspaceForProfile([
      workspace("conversation", "profile-a", "2026-01-01T00:00:00.000Z", "conversation"),
      workspace("archived-rv", "profile-a", "2026-01-02T00:00:00.000Z", "rv", "2026-09-01T00:00:00.000Z"),
      workspace("foreign-rv", "profile-b", "2025-01-01T00:00:00.000Z", "rv"),
    ], "profile-a");
    expect(resolved).toBeNull();
  });
});
