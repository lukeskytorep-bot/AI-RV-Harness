import { describe, expect, it } from "vitest";
import migration026 from "../src-tauri/migrations/026_typed_workspaces.sql?raw";

const sources = import.meta.glob<string>("./**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});
describe("Stage 5 typed Workspace boundary", () => {
  it("defines one canonical Workspace kind contract and migrates old rows to legacy_combined", () => {
    const types = sources["./types.ts"] ?? "";
    expect(types).toContain('export type WorkspaceKind = "conversation" | "rv" | "legacy_combined"');
    expect(types).toContain('export type NewWorkspaceKind = Exclude<WorkspaceKind, "legacy_combined">');
    expect(types).toContain("kind: WorkspaceKind");
    expect(types).toContain("kind: NewWorkspaceKind");
    expect(migration026).toContain("ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy_combined'");
    expect(migration026).toContain("CHECK (kind IN ('conversation', 'rv', 'legacy_combined'))");
  });

  it("keeps Conversation and RV active Workspace state independent", () => {
    const app = sources["./App.tsx"] ?? "";
    expect(app).toContain("activeConversationWorkspaceId");
    expect(app).toContain("activeRvWorkspaceId");
    expect(app).not.toContain("const [activeWorkspaceId");
    expect(app).toContain('nextSettings.activeConversationWorkspaceId');
    expect(app).toContain('nextSettings.activeRvWorkspaceId');
    expect(app).toContain('activeConversationWorkspaceId: workspaceId ?? ""');
    expect(app).toContain('activeRvWorkspaceId: workspaceId ?? ""');
    expect(app).toContain('latestCompatibleWorkspace(storedWorkspaces, "conversation"');
    expect(app).toContain('latestCompatibleWorkspace(storedWorkspaces, "rv"');
    expect(app).toContain('if (target) setActiveProfileId(target.profileId)');
    expect(app).toContain('activeProfileStillExists');
  });

  it("creates two typed Workspaces for every new Profile through the shared application use case", () => {
    const profileWorkspace = sources["./application/profileWorkspace.ts"] ?? "";
    const app = sources["./App.tsx"] ?? "";
    expect(profileWorkspace).toContain('kind: "conversation"');
    expect(profileWorkspace).toContain('kind: "rv"');
    expect(profileWorkspace).toContain("archiveProfile(profile.id)");
    expect(app.match(/createProfileWithInitialWorkspaces/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps typed screens isolated while allowing legacy_combined on both", () => {
    const kind = sources["./domain/workspaceKind.ts"] ?? "";
    const conversations = sources["./features/conversations/ConversationsScreen.tsx"] ?? "";
    const rv = sources["./features/rvSessions/RvSessionsScreen.tsx"] ?? "";
    expect(kind).toContain('workspace.kind === "legacy_combined"');
    expect(conversations).toContain('kind="conversation"');
    expect(rv).toContain('kind="rv"');
  });

  it("never selects a Conversation-only Workspace for Training or Research", () => {
    const technical = sources["./application/technicalWorkspace.ts"] ?? "";
    expect(technical).toContain('isWorkspaceCompatible(workspace, "rv")');
    expect(technical).not.toContain('isWorkspaceCompatible(workspace, "conversation")');
  });

  it("keeps Profile Workspace sections and the action menu accessible", () => {
    const profiles = sources["./features/profiles/ProfilesScreen.tsx"] ?? "";
    expect(profiles).toContain("copy.conversationWorkspaces");
    expect(profiles).toContain("copy.rvWorkspaces");
    expect(profiles).toContain("event.stopPropagation()");
    expect(profiles).toContain("aria-label=");
    expect(profiles).toContain('querySelector<HTMLElement>("summary")?.focus()');
    expect(profiles).not.toContain("lastOpenedAt");
  });
});
