import { describe, expect, it } from "vitest";

import type { Workspace, WorkspaceKind } from "../types";
import { canArchiveWorkspace, isWorkspaceCompatible, latestCompatibleWorkspace, normalizeWorkspaceKind } from "./workspaceKind";

const now = "2026-09-26T12:00:00.000Z";
const workspace = (id: string, kind: WorkspaceKind, lastOpenedAt = now, profileId = "profile-a"): Workspace => ({
  id,
  profileId,
  name: id,
  kind,
  createdAt: now,
  updatedAt: now,
  lastOpenedAt,
});

describe("typed Workspace domain rules", () => {
  it("treats missing or unknown legacy Browser data as legacy_combined", () => {
    expect(normalizeWorkspaceKind(undefined)).toBe("legacy_combined");
    expect(normalizeWorkspaceKind("unknown")).toBe("legacy_combined");
    expect(normalizeWorkspaceKind("conversation")).toBe("conversation");
    expect(normalizeWorkspaceKind("rv")).toBe("rv");
  });

  it("allows legacy_combined on both surfaces but keeps typed Workspaces isolated", () => {
    expect(isWorkspaceCompatible(workspace("legacy", "legacy_combined"), "conversation")).toBe(true);
    expect(isWorkspaceCompatible(workspace("legacy", "legacy_combined"), "rv")).toBe(true);
    expect(isWorkspaceCompatible(workspace("conversation", "conversation"), "rv")).toBe(false);
    expect(isWorkspaceCompatible(workspace("rv", "rv"), "conversation")).toBe(false);
  });

  it("keeps at least one compatible Workspace of each required type when archiving", () => {
    const conversation = workspace("conversation", "conversation");
    const rv = workspace("rv", "rv");
    const legacy = workspace("legacy", "legacy_combined");

    expect(canArchiveWorkspace(conversation, [conversation, rv])).toBe(false);
    expect(canArchiveWorkspace(rv, [conversation, rv])).toBe(false);
    expect(canArchiveWorkspace(conversation, [conversation, rv, legacy])).toBe(true);
    expect(canArchiveWorkspace(rv, [conversation, rv, legacy])).toBe(true);
    expect(canArchiveWorkspace(legacy, [legacy, conversation, rv])).toBe(true);
    expect(canArchiveWorkspace(legacy, [legacy, conversation])).toBe(false);
    expect(canArchiveWorkspace(legacy, [legacy, rv])).toBe(false);
  });

  it("restores the most recently opened compatible Workspace independently per type", () => {
    const items = [
      workspace("conversation-old", "conversation", "2026-09-20T10:00:00.000Z"),
      workspace("conversation-new", "conversation", "2026-09-22T10:00:00.000Z"),
      workspace("rv-new", "rv", "2026-09-23T10:00:00.000Z"),
      workspace("legacy", "legacy_combined", "2026-09-21T10:00:00.000Z"),
    ];
    expect(latestCompatibleWorkspace(items, "conversation", "profile-a")?.id).toBe("conversation-new");
    expect(latestCompatibleWorkspace(items, "rv", "profile-a")?.id).toBe("rv-new");
  });
});
