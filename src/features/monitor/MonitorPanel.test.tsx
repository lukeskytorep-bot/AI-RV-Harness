import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";
import type { Profile, Workspace } from "../../types";
import { MonitorPanel } from "./index";

const now = "2026-09-05T10:00:00.000Z";
const profile: Profile = { id: "profile", name: "Nemo", credentialId: "credential", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace", profileId: profile.id, name: "Lab", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("MonitorPanel", () => {
  it("renders through the public feature entry point without repository work during render", () => {
    const repository = {
      listMonitorRuns: vi.fn(),
      listRvSessions: vi.fn(),
      listResearchProjects: vi.fn(),
    } as unknown as AppRepository;

    const html = renderToStaticMarkup(<MonitorPanel
      copy={getCopy("en")}
      settings={createDefaultSettings()}
      profile={profile}
      workspace={workspace}
      repository={repository}
    />);

    expect(html).toContain("AI Monitor system prompt");
    expect(html).toContain("Show the complete effective prompt");
    expect(repository.listMonitorRuns).not.toHaveBeenCalled();
  });
});
