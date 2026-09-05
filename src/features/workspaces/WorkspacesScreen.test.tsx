import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import type { Profile, Workspace } from "../../types";
import { WorkspacesScreen, WorkspaceSwitcherDialog } from "./index";

const now = "2026-09-05T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Research Lab", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("Workspaces feature", () => {
  it("renders the directory through its public entry point", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(<WorkspacesScreen copy={copy} profiles={[profile]} workspaces={[workspace]} repository={null} activeWorkspaceId={null} onChanged={vi.fn(async () => undefined)} onActiveArchived={vi.fn()} onOpenWorkspace={vi.fn()} onCreateWorkspace={vi.fn()} onCreateProfile={vi.fn()} />);

    expect(html).toContain(copy.allWorkspaces);
    expect(html).toContain("Research Lab");
    expect(html).toContain("Orion");
  });

  it("renders the shared Workspace switcher without owning navigation", () => {
    const copy = getCopy("pl");
    const html = renderToStaticMarkup(<WorkspaceSwitcherDialog copy={copy} profiles={[profile]} workspaces={[workspace]} onOpenWorkspace={vi.fn()} onClose={vi.fn()} />);

    expect(html).toContain(copy.switchWorkspace);
    expect(html).toContain("Research Lab");
  });
});
