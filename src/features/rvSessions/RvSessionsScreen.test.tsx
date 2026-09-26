import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import { RvSessionsScreen } from "./index";

const now = "2026-09-26T18:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Shared Workspace", kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now };

function render(view: "manual" | "automatic") {
  const copy = getCopy("en");
  return {
    copy,
    html: renderToStaticMarkup(
      <RvSessionsScreen
        copy={copy}
        settings={createDefaultSettings()}
        profile={profile}
        workspace={workspace}
        repository={null}
        profiles={[profile]}
        workspaces={[workspace]}
        view={view}
        onViewChange={vi.fn()}
        onOpenWorkspace={vi.fn()}
        createdNotice={null}
        onDismissCreatedNotice={vi.fn()}
      />,
    ),
  };
}

describe("RvSessionsScreen", () => {
  it("places Manual RV under RV Sessions without the Conversation mode switch", () => {
    const { copy, html } = render("manual");
    expect(html).toContain(copy.rvSessionsNav);
    expect(html).toContain(copy.manualRvTab);
    expect(html).toContain(copy.automaticRvTab);
    expect(html).toContain(copy.manualTitle);
    expect(html).not.toContain(copy.conversationTitle);
    expect(html).not.toContain('class="segmented large-segmented"');
  });

  it("uses the existing automatic RV panel for Automatic RV", () => {
    const { copy, html } = render("automatic");
    expect(html).toContain(copy.rvSessionsNav);
    expect(html).toContain(copy.newAutomaticSession);
    expect(html).toContain(copy.singleSession);
    expect(html).not.toContain(copy.manualTitle);
  });
});
