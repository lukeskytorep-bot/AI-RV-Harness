/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCopy } from "./i18n";

const root = path.resolve(process.cwd(), "src");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("UX-DATA-5 flat Conversation boundary", () => {
  it("removes ThreadGroup controls and persistence calls from product UI", () => {
    const chatPanel = read("features/conversations/ChatPanel.tsx");
    const settings = read("features/settings/SettingsScreen.tsx");

    for (const forbidden of [
      "listChatThreadGroups",
      "createChatThreadGroup",
      "renameChatThreadGroup",
      "archiveChatThreadGroup",
      "restoreChatThreadGroup",
      "threadGroupId",
    ]) {
      expect(chatPanel).not.toContain(forbidden);
      expect(settings).not.toContain(forbidden);
    }
    expect(chatPanel).not.toContain("Thread 1");
    expect(settings).not.toContain("archivedGroups");
  });

  it("keeps new Conversation creation flat and leaves legacy group metadata read-only", () => {
    const contract = read("storage/repository.ts");
    const browser = read("storage/browser/workspacesConversationsRepository.ts");
    const sqlite = read("storage/sqlite/workspacesConversationsRepository.ts");

    expect(contract).toContain("createChatThread(workspaceId: string, mode: ChatMode, title?: string)");
    expect(contract).not.toContain("ChatThreadGroup");
    expect(browser).not.toContain("rvh.dev.chat_thread_groups");
    expect(sqlite).toContain("thread_group_id");
    expect(sqlite).toContain("VALUES ($1, $2, $3, NULL");
    expect(sqlite).not.toMatch(/(?:FROM|INSERT INTO|UPDATE|DELETE FROM) chat_thread_groups/i);
  });

  it("removes Thread terminology and keeps legacy grouping types local to compatibility fixtures", () => {
    const en = getCopy("en");
    const pl = getCopy("pl");
    const types = read("types.ts");
    const legacyFixture = read("storage/fixtures/legacyThreadHierarchy.ts");

    for (const copy of [en, pl]) {
      expect(copy).not.toHaveProperty("threadGroupTitle");
      expect(copy).not.toHaveProperty("threadGroups");
      expect(copy).not.toHaveProperty("newThread");
      expect(copy).not.toHaveProperty("archiveThreadGroup");
      expect(copy).not.toHaveProperty("renameThreadGroup");
    }
    expect(en.chatThreads).toBe("Conversations");
    expect(pl.chatThreads).toBe("Rozmowy");
    expect(types).not.toContain("ChatThreadGroup");
    expect(legacyFixture).toContain("interface LegacyThreadGroupRecord");
  });
});
