import type { ChatMessage, ChatMode, ChatThread, Workspace } from "../../types";

interface LegacyThreadGroupRecord {
  id: string;
  workspaceId: string;
  mode: ChatMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export const legacyThreadHierarchyFixture: {
  workspaces: Workspace[];
  groups: LegacyThreadGroupRecord[];
  threads: ChatThread[];
  messages: ChatMessage[];
} = {
  workspaces: [
    {
      id: "workspace-legacy",
      profileId: "profile-legacy",
      name: "Legacy Workspace",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z",
      lastOpenedAt: "2026-08-03T10:00:00.000Z",
    },
  ],
  groups: [
    {
      id: "group-active",
      workspaceId: "workspace-legacy",
      mode: "conversation",
      title: "Old active Thread",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-02T10:00:00.000Z",
    },
    {
      id: "group-archived",
      workspaceId: "workspace-legacy",
      mode: "conversation",
      title: "Old archived Thread",
      createdAt: "2026-08-01T11:00:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z",
      archivedAt: "2026-08-03T10:00:00.000Z",
    },
  ],
  threads: [
    {
      id: "conversation-active",
      workspaceId: "workspace-legacy",
      mode: "conversation",
      threadGroupId: "group-active",
      title: "Legacy Conversation",
      createdAt: "2026-08-01T10:05:00.000Z",
      updatedAt: "2026-08-02T10:05:00.000Z",
    },
    {
      id: "conversation-archived-with-group",
      workspaceId: "workspace-legacy",
      mode: "conversation",
      threadGroupId: "group-archived",
      title: "Archived Legacy Conversation",
      createdAt: "2026-08-01T11:05:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z",
      archivedAt: "2026-08-03T10:00:00.000Z",
    },
  ],
  messages: [
    {
      id: "message-legacy",
      threadId: "conversation-active",
      role: "user",
      content: "Preserved legacy message",
      createdAt: "2026-08-01T10:06:00.000Z",
    },
    {
      id: "message-archived",
      threadId: "conversation-archived-with-group",
      role: "assistant",
      content: "Preserved archived message",
      createdAt: "2026-08-01T11:06:00.000Z",
    },
  ],
};
