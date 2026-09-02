import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import type { RvSession } from "../../sessions/types";
import type { Profile, Workspace } from "../../types";
import { HomeScreen, type HomeScreenProps } from "./HomeScreen";

const now = "2026-09-02T10:00:00.000Z";

const profile: Profile = {
  id: "profile-1",
  name: "Orion",
  createdAt: now,
  updatedAt: now,
};

const workspace: Workspace = {
  id: "workspace-1",
  profileId: profile.id,
  name: "Training Lab",
  createdAt: now,
  updatedAt: now,
  lastOpenedAt: now,
};

const session: RvSession = {
  id: "session-1",
  workspaceId: workspace.id,
  profileId: profile.id,
  sessionCode: "RV-TEST-001",
  state: "Completed",
  runType: "automatic",
  preRevealTranscript: "blind",
  postRevealTranscript: "reveal",
  createdAt: now,
  updatedAt: now,
};

function makeProps(overrides: Partial<HomeScreenProps> = {}): HomeScreenProps {
  return {
    copy: getCopy("en"),
    profile: null,
    workspace: null,
    recent: [],
    recentSessions: [],
    profiles: [],
    onCreateProfile: vi.fn(),
    onOpenProfiles: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onOpenSession: vi.fn(),
    ...overrides,
  };
}

interface ButtonRecord {
  className?: string;
  onClick?: () => void;
}

function collectButtons(node: ReactNode, buttons: ButtonRecord[] = []): ButtonRecord[] {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<Record<string, unknown>>;
    if (typeof element.type === "function") {
      const Component = element.type as (props: Record<string, unknown>) => ReactNode;
      collectButtons(Component(element.props), buttons);
      return;
    }
    if (element.type === "button") {
      buttons.push({
        className: typeof element.props.className === "string" ? element.props.className : undefined,
        onClick: typeof element.props.onClick === "function" ? element.props.onClick as () => void : undefined,
      });
    }
    collectButtons(element.props.children as ReactNode, buttons);
  });
  return buttons;
}

describe("HomeScreen", () => {
  it("renders the empty Home state without requiring application state", () => {
    const props = makeProps();
    const html = renderToStaticMarkup(<HomeScreen {...props} />);

    expect(html).toContain("Welcome back");
    expect(html).toContain("AI IS-BE");
    expect(html).toContain("No workspace yet");
    expect(html.match(/Your recent workspaces will appear here\./g)).toHaveLength(2);
  });

  it("renders current and recent entities through the public feature entry point", () => {
    const props = makeProps({
      profile,
      workspace,
      recent: [workspace],
      recentSessions: [session],
      profiles: [profile],
    });
    const html = renderToStaticMarkup(<HomeScreen {...props} />);

    expect(html).toContain("Orion");
    expect(html).toContain("Training Lab");
    expect(html).toContain("RV-TEST-001");
    expect(html).toContain("Completed");
  });

  it("keeps navigation callbacks owned by the application shell", () => {
    const onOpenProfiles = vi.fn();
    const onOpenWorkspace = vi.fn();
    const onOpenSession = vi.fn();
    const props = makeProps({
      profile,
      workspace,
      recent: [workspace],
      recentSessions: [session],
      profiles: [profile],
      onOpenProfiles,
      onOpenWorkspace,
      onOpenSession,
    });

    const buttons = collectButtons(<HomeScreen {...props} />);
    const resumeButtons = buttons.filter((button) => button.className === "resume-card");
    const recentButtons = buttons.filter((button) => button.className === "recent-row");

    resumeButtons[0]?.onClick?.();
    resumeButtons[1]?.onClick?.();
    recentButtons[0]?.onClick?.();
    recentButtons[1]?.onClick?.();

    expect(onOpenProfiles).toHaveBeenCalledTimes(1);
    expect(onOpenWorkspace).toHaveBeenCalledTimes(2);
    expect(onOpenWorkspace).toHaveBeenNthCalledWith(1, workspace);
    expect(onOpenWorkspace).toHaveBeenNthCalledWith(2, workspace);
    expect(onOpenSession).toHaveBeenCalledWith(session);
  });
});
