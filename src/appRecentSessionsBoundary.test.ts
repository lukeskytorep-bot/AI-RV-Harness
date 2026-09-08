import { describe, expect, it } from "vitest";
import appSource from "./App.tsx?raw";

describe("Home recent-session bootstrap", () => {
  it("uses one bounded repository query instead of one listRvSessions call per Workspace", () => {
    expect(appSource).toContain("await repo.listRecentRvSessions(8)");
    expect(appSource).not.toContain("storedWorkspaces.map((workspace) => repo.listRvSessions(workspace.id))");
  });
});
