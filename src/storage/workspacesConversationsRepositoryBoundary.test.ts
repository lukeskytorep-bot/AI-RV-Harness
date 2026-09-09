import { describe, expect, it } from "vitest";
import browserAdapter from "./browser/workspacesConversationsRepository.ts?raw";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteAdapter from "./sqlite/workspacesConversationsRepository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = [
  "listWorkspaces", "listArchivedWorkspaces", "createWorkspace", "renameWorkspace", "archiveWorkspace", "restoreWorkspace", "touchWorkspace",
  "listChatThreads", "createChatThread", "getOrCreateChatThread", "touchChatThread", "renameChatThread", "archiveChatThread", "listArchivedChatThreads",
  "restoreChatThread", "setChatThreadFormalRvState", "listChatMessages", "appendChatMessage",
] as const;

describe("Workspaces and Conversations repository boundary", () => {
  it("delegates the flat Workspace -> Conversation persistence surface", () => {
    expect(contract).toContain("listWorkspaces(profileId?");
    expect(contract).toContain("createChatThread(workspaceId: string, mode: ChatMode, title?: string)");
    expect(contract).toContain("appendChatMessage(threadId");
    expect(browserFacade).toContain("new BrowserWorkspacesConversationsRepository()");
    expect(sqliteFacade).toContain("new SqliteWorkspacesConversationsRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository["${method}"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository["${method}"]`);
    }
  });

  it("removes ChatThreadGroup from the product repository contract while retaining legacy row compatibility", () => {
    for (const legacyMethod of [
      "listChatThreadGroups", "createChatThreadGroup", "renameChatThreadGroup",
      "archiveChatThreadGroup", "listArchivedChatThreadGroups", "restoreChatThreadGroup",
    ]) {
      expect(contract).not.toContain(`${legacyMethod}(`);
      expect(browserFacade).not.toContain(`${legacyMethod}: AppRepository`);
      expect(sqliteFacade).not.toContain(`${legacyMethod}: AppRepository`);
    }
    expect(browserAdapter).not.toContain("rvh.dev.chat_thread_groups");
    expect(sqliteAdapter).not.toMatch(/(?:FROM|INSERT INTO|UPDATE|DELETE FROM) chat_thread_groups/i);
    expect(sqliteAdapter).toContain("thread_group_id");
  });

  it("keeps Workspace sources outside this focused split", () => {
    expect(browserFacade).toContain("async listWorkspaceSources(");
    expect(sqliteFacade).toContain("async listWorkspaceSources(");
  });
});
