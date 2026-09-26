import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import { ConversationsScreen } from "./index";

const now = "2026-09-26T18:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Shared Workspace", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("ConversationsScreen", () => {
  it("renders only the Conversation surface for the active Workspace", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(
      <ConversationsScreen
        copy={copy}
        settings={createDefaultSettings()}
        profile={profile}
        workspace={workspace}
        repository={null}
        profiles={[profile]}
        workspaces={[workspace]}
        onOpenWorkspace={vi.fn()}
        createdNotice={null}
        onDismissCreatedNotice={vi.fn()}
      />,
    );

    expect(html).toContain(copy.conversationsNav);
    expect(html).toContain(copy.conversationTitle);
    expect(html).not.toContain(copy.manualTitle);
    expect(html).not.toContain(copy.manualRvTab);
    expect(html).not.toContain(copy.automaticRvTab);
  });
});
