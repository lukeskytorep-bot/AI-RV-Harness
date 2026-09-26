import { describe, expect, it } from "vitest";

import { normalizePage } from "./App";

const sourceFiles = import.meta.glob<string>("./**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

describe("Stage 4 top-level Conversations / RV Sessions boundary", () => {
  it("normalizes retired workspace routes without keeping the combined screen", () => {
    expect(normalizePage("workspaces")).toBe("profiles");
    expect(normalizePage("workspace")).toBe("conversations");

    const app = sourceFiles["./App.tsx"] ?? "";
    expect(app).not.toContain("WorkspaceScreen");
    expect(app).not.toContain("workspaceTab");
    expect(app).not.toContain('setPage("workspace")');

    const legacyWorkspaceComparisons = app.match(/page === "workspace"/g) ?? [];
    expect(legacyWorkspaceComparisons).toHaveLength(1);
    expect(app).toContain(
      'if (page === "workspace") return "conversations";',
    );
  });

  it("keeps the required top-level navigation order", () => {
    const app = sourceFiles["./App.tsx"] ?? "";
    const expected = [
      '{ id: "home"',
      '{ id: "profiles"',
      '{ id: "conversations"',
      '{ id: "rv-sessions"',
      '{ id: "training"',
      '{ id: "research"',
      '{ id: "ai-center"',
      '{ id: "targets"',
      '{ id: "settings"',
    ];
    let cursor = -1;
    for (const token of expected) {
      const next = app.indexOf(token);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
  });

  it("routes Workspace, RV Session and Manual RV surfaces to their intended screens", () => {
    const app = sourceFiles["./App.tsx"] ?? "";
    const conversations = sourceFiles["./features/conversations/ConversationsScreen.tsx"] ?? "";
    const rvSessions = sourceFiles["./features/rvSessions/RvSessionsScreen.tsx"] ?? "";

    expect(app).toContain('openWorkspace(workspace, "conversations")');
    expect(app).toContain('openWorkspace(owner, "rv-sessions", "automatic")');
    expect(conversations).toContain('fixedMode="conversation"');
    expect(conversations).not.toContain('fixedMode="manual_rv"');
    expect(rvSessions).toContain('fixedMode="manual_rv"');
    expect(rvSessions).toContain("<RvSessionPanel");
  });

  it("preserves Stage 4 routing while Stage 5 adds typed Workspace data", () => {
    const types = sourceFiles["./types.ts"] ?? "";
    expect(types).toContain('export type WorkspaceKind = "conversation" | "rv" | "legacy_combined"');
    expect(types).toContain("kind: WorkspaceKind");
    expect(types).not.toContain('purpose: "conversation"');
  });
});
