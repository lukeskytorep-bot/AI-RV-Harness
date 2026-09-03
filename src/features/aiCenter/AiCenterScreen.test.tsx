import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import type { Profile, Workspace } from "../../types";
import { AiCenterScreen } from "./index";

const now = "2026-09-02T10:00:00.000Z";
const profile: Profile = { id: "profile", name: "Nemo", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace", profileId: profile.id, name: "Lab", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("AiCenterScreen", () => {
  it("renders the AI Center presentation through its public feature entry point without repository work during render", () => {
    const html = renderToStaticMarkup(<AiCenterScreen
      settings={createDefaultSettings()}
      profiles={[profile]}
      workspaces={[workspace]}
      activeProfileId={profile.id}
      workspaceFilterId={workspace.id}
      repository={{} as AppRepository}
      initialView="overview"
      monitorPanel={<div>Monitor panel</div>}
      onProfileChange={vi.fn()}
    />);

    expect(html).toContain("AI Center");
    expect(html).toContain("Viewer Notes are experimental");
    expect(html).toContain("How AI Center works");
  });
});
