import { describe, expect, it } from "vitest";
import browserFacade from "./browserRepository.ts?raw";
import contract from "./repository.ts?raw";
import sqliteFacade from "./sqliteRepository.ts?raw";

const methods = [
  "listWorkspaces", "listArchivedWorkspaces", "createWorkspace", "renameWorkspace", "archiveWorkspace", "restoreWorkspace", "touchWorkspace",
  "listChatThreadGroups", "createChatThreadGroup", "renameChatThreadGroup", "archiveChatThreadGroup", "listArchivedChatThreadGroups", "restoreChatThreadGroup",
  "listChatThreads", "createChatThread", "getOrCreateChatThread", "touchChatThread", "renameChatThread", "archiveChatThread", "listArchivedChatThreads",
  "restoreChatThread", "setChatThreadFormalRvState", "listChatMessages", "appendChatMessage",
] as const;

describe("Workspaces and Conversations repository boundary", () => {
  it("keeps AppRepository stable and delegates the complete persistence surface", () => {
    expect(contract).toContain("listWorkspaces(profileId?");
    expect(contract).toContain("appendChatMessage(threadId");
    expect(browserFacade).toContain("new BrowserWorkspacesConversationsRepository()");
    expect(sqliteFacade).toContain("new SqliteWorkspacesConversationsRepository({");
    for (const method of methods) {
      expect(browserFacade).toContain(`${method}: AppRepository["${method}"]`);
      expect(sqliteFacade).toContain(`${method}: AppRepository["${method}"]`);
    }
    expect(sqliteFacade).toContain("executeTransaction: (statements)");
  });

  it("keeps Workspace sources outside this focused split", () => {
    expect(browserFacade).toContain("async listWorkspaceSources(");
    expect(sqliteFacade).toContain("async listWorkspaceSources(");
  });
});
