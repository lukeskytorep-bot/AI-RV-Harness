import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("STEP-2 Profile/Workspace route boundary", () => {
  it("invalidates stale Viewer selection while Conversation and RV Sessions reload the new Workspace/Profile route", () => {
    const chat = read("./features/conversations/ChatPanel.tsx");
    const rv = read("./features/rvSessions/RvSessionPanel.tsx");
    for (const source of [chat, rv]) {
      expect(source).toContain("setViewerRouteReadyKey(null)");
      expect(source).toContain('setViewerIdentityId("")');
      expect(source).toContain("setViewerIdentities([])");
      expect(source).toContain("workspace.profileId !== profile.id");
      expect(source).toContain("requireWorkspaceViewerRoute");
    }
  });

  it("blocks Profile switching and sidebar navigation while a Conversation send or automatic RV run is in flight", () => {
    const conversations = read("./features/conversations/ConversationsScreen.tsx");
    const rv = read("./features/rvSessions/RvSessionsScreen.tsx");
    const app = read("./App.tsx");
    expect(conversations).toContain("disabled={operationBusy}");
    expect(conversations).toContain("onBusyChange={handleBusyChange}");
    expect(rv).toContain("disabled={operationBusy}");
    expect(rv).toContain("onBusyChange={handleBusyChange}");
    expect(app).toContain("if (criticalOperationBusyRef.current) return;");
    expect(app).toContain("onOperationBusyChange={setCriticalOperationBusy}");
  });

  it("acquires an immediate Conversation operation guard before async route validation and rejects legacy retry records without an identity", () => {
    const chat = read("./features/conversations/ChatPanel.tsx");
    expect(chat).toContain("operationGuardRef.current.tryAcquire()");
    expect(chat).toContain("setSending(true);");
    expect(chat).toContain("await requireWorkspaceViewerRoute");
    expect(chat).toContain("if (!pendingRetry.aiIdentityId)");
    expect(chat).toContain("cannot be safely bound to the current Viewer identity");
  });

  it("clears visible RV session state when Workspace/Profile changes and refuses to open a stored session owned by another context", () => {
    const rv = read("./features/rvSessions/RvSessionPanel.tsx");
    expect(rv).toContain("setProgress(null)");
    expect(rv).toContain("setRecentSessions([])");
    expect(rv).toContain("[workspace.id, profile?.id]");
    expect(rv).toContain("session.workspaceId !== workspace.id || session.profileId !== profile.id");
    expect(rv).toContain("cannot be opened in the current view");
  });

  it("keeps Conversation and RV Workspace ownership explicit while shared Profile selection synchronizes both contexts", () => {
    const app = read("./App.tsx");
    expect(app).toContain('profile={profiles.find((item) => item.id === activeConversationWorkspace.profileId) ?? null}');
    expect(app).toContain('profile={profiles.find((item) => item.id === activeRvWorkspace.profileId) ?? null}');
    expect(app).toContain('rememberActiveWorkspace("conversation"');
    expect(app).toContain('rememberActiveWorkspace("rv"');
  });
});
