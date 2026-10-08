import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("v0.7.14 shared Profile selector boundary", () => {
  it("uses the same ProfileSelector in AI Center, Conversation, and RV Sessions", () => {
    const selector = read("./components/ProfileSelector.tsx");
    const aiCenter = read("./features/aiCenter/AiCenterScreen.tsx");
    const conversations = read("./features/conversations/ConversationsScreen.tsx");
    const rv = read("./features/rvSessions/RvSessionsScreen.tsx");

    expect(selector).toContain('language === "pl" ? "Aktywny Profil" : "Active Profile"');
    expect(selector).toContain("aiIsBeDisplayName(profile)");
    expect(selector).toContain("<select");
    for (const source of [aiCenter, conversations, rv]) {
      expect(source).toContain("<ProfileSelector");
    }
  });

  it("keeps Conversation and RV Sessions free of the Workspace switcher control", () => {
    const conversations = read("./features/conversations/ConversationsScreen.tsx");
    const rv = read("./features/rvSessions/RvSessionsScreen.tsx");
    for (const source of [conversations, rv]) {
      expect(source).not.toContain("WorkspaceSwitcherDialog");
      expect(source).not.toContain("copy.switchWorkspace");
      expect(source).not.toContain("onOpenWorkspace");
    }
    expect(conversations).toContain("value={workspace.profileId}");
    expect(rv).toContain("value={workspace.profileId}");
  });

  it("routes all three selectors through one App handler without resetting the current page or RV tab", () => {
    const app = read("./App.tsx");
    expect(app).toContain("const handleProfileChange = (profileId: string) =>");
    expect(app.match(/onProfileChange=\{handleProfileChange\}/g)).toHaveLength(3);
    expect(app).toContain('rememberActiveWorkspace("conversation", selection.conversationWorkspaceId)');
    expect(app).toContain('rememberActiveWorkspace("rv", selection.rvWorkspaceId)');
    const handler = app.slice(app.indexOf("const handleProfileChange"), app.indexOf("const navigate"));
    expect(handler).not.toContain("setPage(");
    expect(handler).not.toContain("setRvSessionsView(");
    expect(handler).not.toContain("openWorkspace(");
  });

  it("keeps Profile switching disabled while Conversation or RV work is in flight", () => {
    const conversations = read("./features/conversations/ConversationsScreen.tsx");
    const rv = read("./features/rvSessions/RvSessionsScreen.tsx");
    expect(conversations).toContain("disabled={operationBusy}");
    expect(rv).toContain("disabled={operationBusy}");
  });
});
