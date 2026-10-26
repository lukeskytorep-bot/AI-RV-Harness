import { describe, expect, it } from "vitest";

import type { Profile, Workspace, WorkspaceKind } from "../types";
import { resolveOpenedWorkspaceSelection, resolveProfileWorkspaceSelection } from "./profileSelection";

const now = "2026-10-08T12:00:00.000Z";
const profile = (id: string): Profile => ({ id, name: id, createdAt: now, updatedAt: now });
const workspace = (id: string, profileId: string, kind: WorkspaceKind, lastOpenedAt: string, archivedAt?: string): Workspace => ({
  id,
  profileId,
  name: id,
  kind,
  createdAt: now,
  updatedAt: lastOpenedAt,
  lastOpenedAt,
  ...(archivedAt ? { archivedAt } : {}),
});

describe("shared Profile selection", () => {
  it("switches both Conversation and RV contexts to the selected Profile using latest compatible Workspaces", () => {
    const workspaces = [
      workspace("a-conversation", "a", "conversation", "2026-10-01T10:00:00.000Z"),
      workspace("a-rv", "a", "rv", "2026-10-01T11:00:00.000Z"),
      workspace("b-conversation-old", "b", "conversation", "2026-10-02T10:00:00.000Z"),
      workspace("b-conversation-new", "b", "conversation", "2026-10-04T10:00:00.000Z"),
      workspace("b-rv", "b", "rv", "2026-10-03T10:00:00.000Z"),
    ];

    expect(resolveProfileWorkspaceSelection({
      profiles: [profile("a"), profile("b")],
      workspaces,
      activeProfileId: "a",
      activeConversationWorkspaceId: "a-conversation",
      activeRvWorkspaceId: "a-rv",
      selectedProfileId: "b",
    })).toEqual({
      profileId: "b",
      conversationWorkspaceId: "b-conversation-new",
      rvWorkspaceId: "b-rv",
      changed: true,
    });
  });

  it("supports legacy_combined, ignores archived/foreign Workspaces, and never silently crosses Profile ownership", () => {
    const workspaces = [
      workspace("b-legacy", "b", "legacy_combined", "2026-10-04T10:00:00.000Z"),
      workspace("b-archived-conversation", "b", "conversation", "2026-10-05T10:00:00.000Z", now),
      workspace("c-newer-rv", "c", "rv", "2026-10-06T10:00:00.000Z"),
    ];

    const result = resolveProfileWorkspaceSelection({
      profiles: [profile("a"), profile("b"), profile("c")],
      workspaces,
      activeProfileId: "a",
      activeConversationWorkspaceId: null,
      activeRvWorkspaceId: null,
      selectedProfileId: "b",
    });

    expect(result?.conversationWorkspaceId).toBe("b-legacy");
    expect(result?.rvWorkspaceId).toBe("b-legacy");
  });

  it("preserves manually opened Workspaces when the already active Profile is selected again", () => {
    expect(resolveProfileWorkspaceSelection({
      profiles: [profile("a")],
      workspaces: [
        workspace("conversation-manual", "a", "conversation", "2026-10-01T10:00:00.000Z"),
        workspace("conversation-newer", "a", "conversation", "2026-10-07T10:00:00.000Z"),
        workspace("rv-manual", "a", "rv", "2026-10-01T10:00:00.000Z"),
        workspace("rv-newer", "a", "rv", "2026-10-07T10:00:00.000Z"),
      ],
      activeProfileId: "a",
      activeConversationWorkspaceId: "conversation-manual",
      activeRvWorkspaceId: "rv-manual",
      selectedProfileId: "a",
    })).toEqual({
      profileId: "a",
      conversationWorkspaceId: "conversation-manual",
      rvWorkspaceId: "rv-manual",
      changed: false,
    });
  });

  it("returns null for an unknown Profile instead of selecting another Profile's Workspace", () => {
    expect(resolveProfileWorkspaceSelection({
      profiles: [profile("a")],
      workspaces: [],
      activeProfileId: "a",
      activeConversationWorkspaceId: null,
      activeRvWorkspaceId: null,
      selectedProfileId: "missing",
    })).toBeNull();
  });

  it("synchronizes the other context when a Workspace from another Profile is opened while preserving the explicitly opened Workspace", () => {
    const workspaces = [
      workspace("a-conversation", "a", "conversation", "2026-10-01T10:00:00.000Z"),
      workspace("a-rv", "a", "rv", "2026-10-01T11:00:00.000Z"),
      workspace("b-conversation", "b", "conversation", "2026-10-02T10:00:00.000Z"),
      workspace("b-rv-old", "b", "rv", "2026-10-02T11:00:00.000Z"),
      workspace("b-rv-new", "b", "rv", "2026-10-04T11:00:00.000Z"),
    ];

    expect(resolveOpenedWorkspaceSelection({
      workspaces,
      activeProfileId: "a",
      activeConversationWorkspaceId: "a-conversation",
      activeRvWorkspaceId: "a-rv",
      workspace: workspaces[2],
      requiredKind: "conversation",
    })).toEqual({
      profileId: "b",
      conversationWorkspaceId: "b-conversation",
      rvWorkspaceId: "b-rv-new",
    });
  });

  it("keeps the other manually selected Workspace when another Workspace of the already active Profile is opened", () => {
    const workspaces = [
      workspace("b-conversation", "b", "conversation", "2026-10-04T10:00:00.000Z"),
      workspace("b-rv-manual", "b", "rv", "2026-10-01T11:00:00.000Z"),
      workspace("b-rv-newer", "b", "rv", "2026-10-07T11:00:00.000Z"),
    ];

    expect(resolveOpenedWorkspaceSelection({
      workspaces,
      activeProfileId: "b",
      activeConversationWorkspaceId: "b-conversation",
      activeRvWorkspaceId: "b-rv-manual",
      workspace: workspaces[0],
      requiredKind: "conversation",
    })).toEqual({
      profileId: "b",
      conversationWorkspaceId: "b-conversation",
      rvWorkspaceId: "b-rv-manual",
    });
  });

});
