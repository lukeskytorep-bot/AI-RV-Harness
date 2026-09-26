import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import { ChatPanel } from "./index";

const now = "2026-09-05T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Conversation Lab", kind: "conversation", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("Conversations feature", () => {
  it("renders Conversation and Manual RV boundaries through the public entry point", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(<ChatPanel copy={copy} settings={createDefaultSettings()} profile={profile} workspace={workspace} repository={null} />);

    expect(html).toContain("Conversation Lab");
    expect(html).toContain(copy.conversation);
    expect(html).toContain(copy.manualRv);
    expect(html).toContain(copy.systemActive);
    expect(html).toContain(copy.chatThreads);
    expect(html).not.toContain("Thread");
  });

  it("supports a fixed Conversation surface without exposing the Manual RV mode switch", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(<ChatPanel copy={copy} settings={createDefaultSettings()} profile={profile} workspace={workspace} repository={null} fixedMode="conversation" />);

    expect(html).toContain(copy.systemActive);
    expect(html).toContain(copy.conversationTitle);
    expect(html).not.toContain(copy.manualTitle);
    expect(html).not.toContain('class="segmented large-segmented"');
  });

  it("supports a fixed Manual RV surface without exposing the Conversation mode switch", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(<ChatPanel copy={copy} settings={createDefaultSettings()} profile={profile} workspace={workspace} repository={null} fixedMode="manual_rv" />);

    expect(html).toContain(copy.viewerSystemActive);
    expect(html).toContain(copy.manualTitle);
    expect(html).not.toContain(copy.conversationTitle);
    expect(html).not.toContain('class="segmented large-segmented"');
  });

});
