import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import { ChatPanel } from "./index";

const now = "2026-09-05T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Conversation Lab", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("Conversations feature", () => {
  it("renders Conversation and Manual RV boundaries through the public entry point", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(<ChatPanel copy={copy} settings={createDefaultSettings()} profile={profile} workspace={workspace} repository={null} />);

    expect(html).toContain("Conversation Lab");
    expect(html).toContain(copy.conversation);
    expect(html).toContain(copy.manualRv);
    expect(html).toContain(copy.systemActive);
  });
});
