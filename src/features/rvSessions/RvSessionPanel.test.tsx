import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { Profile, Workspace } from "../../types";
import { RvSessionPanel } from "./index";

const now = "2026-09-06T10:00:00.000Z";
const profile: Profile = { id: "profile-1", name: "Orion", createdAt: now, updatedAt: now };
const workspace: Workspace = { id: "workspace-1", profileId: profile.id, name: "RV Lab", createdAt: now, updatedAt: now, lastOpenedAt: now };

describe("RV Sessions feature", () => {
  it("renders the protected session choices through the public entry point without repository access", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(
      <RvSessionPanel
        copy={copy}
        settings={createDefaultSettings()}
        profile={profile}
        workspace={workspace}
        repository={null}
      />,
    );

    expect(html).toContain(copy.newAutomaticSession);
    expect(html).toContain(copy.singleSession);
    expect(html).toContain(copy.ordinaryBatch);
    expect(html).toContain(copy.automatic);
    expect(html).toContain(copy.automaticMonitor);
    expect(html).toContain(copy.fullRcp);
    expect(html).toContain(copy.rvLite);
    expect(html).toContain("Telepathic Protocol");
    expect(html).toContain(copy.automaticTarget);
    expect(html).toContain(copy.externalBlind);
  });
});
