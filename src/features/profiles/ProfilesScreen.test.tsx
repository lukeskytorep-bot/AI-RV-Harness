import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import type { Profile, Workspace } from "../../types";
import { ProfilesScreen, type ProfilesScreenProps } from "./index";

const now = "2026-09-02T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", humanName: "Luke", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "Training Lab", kind: "conversation", createdAt: now, updatedAt: now, lastOpenedAt: now };

function makeProps(overrides: Partial<ProfilesScreenProps> = {}): ProfilesScreenProps {
  return {
    copy: getCopy("en"),
    profiles: [],
    workspaces: [],
    onCreateProfile: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onOpenWorkspace: vi.fn(),
    activeConversationWorkspaceId: null,
    activeRvWorkspaceId: null,
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

  it("renders every active Workspace owned by the Profile and exposes its action menu", () => {
    const second: Workspace = { ...workspace, id: "workspace-2", name: "Research Lab", kind: "rv" };
    const html = renderToStaticMarkup(<ProfilesScreen {...makeProps({ profiles: [profile], workspaces: [workspace, second] })} />);

    expect(html).toContain("Orion");
    expect(html).toContain("Luke");
    expect(html).toContain("Training Lab");
    expect(html).toContain("Research Lab");
    expect(html.match(/Workspace actions:/g)).toHaveLength(2);
    expect(html).toContain(">Rename<");
    expect(html).toContain(">Archive<");
  });

  it("keeps a foreign Profile Workspace inside its own Profile card", () => {
    const foreignProfile: Profile = { ...profile, id: "profile-2", name: "Nemo" };
    const foreignWorkspace: Workspace = { ...workspace, id: "workspace-foreign", profileId: foreignProfile.id, name: "Foreign Lab", kind: "legacy_combined" };
    const html = renderToStaticMarkup(<ProfilesScreen {...makeProps({ profiles: [profile, foreignProfile], workspaces: [workspace, foreignWorkspace] })} />);

    const orionCard = html.slice(html.indexOf("Orion"), html.indexOf("Nemo"));
    expect(orionCard).toContain("Training Lab");
    expect(orionCard).not.toContain("Foreign Lab");
  });

  it("disables Archive for the last active Workspace of a Profile", () => {
    const props = makeProps({ profiles: [profile], workspaces: [workspace] });
    const html = renderToStaticMarkup(<ProfilesScreen {...props} />);

    expect(html).toContain(`title="${props.copy.lastCompatibleWorkspaceRequired}"`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive/s);
  });
});
