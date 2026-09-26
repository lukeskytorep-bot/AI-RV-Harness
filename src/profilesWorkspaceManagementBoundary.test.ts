import { describe, expect, it } from "vitest";

import { normalizePage } from "./App";

const sourceFiles = import.meta.glob<string>("./**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

describe("Profiles Workspace management boundary", () => {
  it("maps the retired Workspaces view id safely to Profiles", () => {
    expect(normalizePage("workspaces")).toBe("profiles");
    expect(normalizePage("workspace")).toBe("conversations");
  });

  it("removes Workspaces from the main navigation and leaves no production screen", () => {
    const app = sourceFiles["./App.tsx"] ?? "";
    expect(app).not.toContain('{ id: "workspaces"');
    expect(app).not.toContain("<WorkspacesScreen");
    expect(sourceFiles["./features/workspaces/WorkspacesScreen.tsx"]).toBeUndefined();
  });

  it("keeps Workspace action clicks isolated from the open button", () => {
    const profiles = sourceFiles["./features/profiles/ProfilesScreen.tsx"] ?? "";
    expect(profiles).toContain('className="workspace-actions profile-workspace-actions"');
    expect(profiles).toContain("event.stopPropagation()");
    expect(profiles).toContain("aria-label=");
    expect(profiles).toContain('querySelector<HTMLElement>("summary")?.focus()');
    expect(profiles).toContain("details.open = false");
  });

  it("keeps Workspace creation bound to the selected Profile", () => {
    const app = sourceFiles["./App.tsx"] ?? "";
    expect(app).toContain("repository.createWorkspace({ profileId, kind, name, description })");
    expect(app).toContain("setWorkspaceDialogFor({ profileId, kind })");
  });

  it("uses application use cases instead of cross-feature private imports", () => {
    const profiles = sourceFiles["./features/profiles/ProfilesScreen.tsx"] ?? "";
    expect(profiles).toContain('from "../../application/workspaceManagement"');
    expect(profiles).not.toMatch(/from\s+["'][^"']*features\/workspaces\//);
  });
});
