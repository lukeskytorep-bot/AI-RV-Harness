import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import type { Profile, Workspace } from "../../types";
import { ProfilesScreen, type ProfilesScreenProps } from "./index";

const now = "2026-09-02T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", humanName: "Luke", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Training Lab", createdAt: now, updatedAt: now, lastOpenedAt: now };

function makeProps(overrides: Partial<ProfilesScreenProps> = {}): ProfilesScreenProps {
  return {
    copy: getCopy("en"),
    profiles: [],
    workspaces: [],
    onCreateProfile: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onOpenWorkspace: vi.fn(),
    repository: null,
    onProfilesChanged: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ProfilesScreen", () => {
  it("renders the empty Profiles state without repository access", () => {
    const props = makeProps();
    const html = renderToStaticMarkup(<ProfilesScreen {...props} />);

    expect(html).toContain(props.copy.profiles);
    expect(html).toContain(props.copy.noProfile);
    expect(html).toContain(props.copy.createProfile);
  });

  it("renders profile identity and owned Workspace through the public entry point", () => {
    const html = renderToStaticMarkup(<ProfilesScreen {...makeProps({ profiles: [profile], workspaces: [workspace] })} />);

    expect(html).toContain("Orion");
    expect(html).toContain("Luke");
    expect(html).toContain("Training Lab");
  });
});
