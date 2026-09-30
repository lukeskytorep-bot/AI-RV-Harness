import { describe, expect, it } from "vitest";
import chatPanel from "./features/conversations/ChatPanel.tsx?raw";
import rvPanel from "./features/rvSessions/RvSessionPanel.tsx?raw";
import fieldGuide from "./aiCenter/fieldGuide.ts?raw";
import viewerNotes from "./aiCenter/viewerNotes.ts?raw";
import pendingTurn from "./chat/pendingTurn.ts?raw";
import app from "./App.tsx?raw";

describe("PROFILE-IDENTITY-ROUTE-SELECTION-1 boundaries", () => {
  it("selects Viewer identities instead of arbitrary provider models in Conversation and RV Sessions", () => {
    expect(chatPanel).toContain("listEligibleViewerIdentities");
    expect(chatPanel).toContain("value={viewerIdentityId}");
    expect(chatPanel).toContain("viewerIdentityLabel(item, settings.interfaceLanguage)");
    expect(chatPanel).not.toContain("onChange={(event) => setModelId(event.target.value)}");
    expect(rvPanel).toContain("listEligibleViewerIdentities");
    expect(rvPanel).toContain("value={viewerIdentityId}");
    expect(rvPanel).not.toContain("onChange={(event) => setModelId(event.target.value)}");
  });

  it("passes the exact selected identity into Field Guide and Viewer Notes preparation", () => {
    expect(chatPanel).toContain("aiIdentityId: selectedIdentity.identity.id");
    expect(rvPanel).toContain("aiIdentityId: selectedIdentity.identity.id");
    expect(fieldGuide).toContain("input.aiIdentityId");
    expect(fieldGuide).toContain("requireExistingViewerIdentity");
    expect(viewerNotes).toContain("input.aiIdentityId");
    expect(viewerNotes).toContain("requireExistingViewerIdentity");
  });

  it("freezes identity and exact model route for a pending Conversation retry", () => {
    expect(pendingTurn).toContain("aiIdentityId?: string");
    expect(pendingTurn).toContain("modelRoute?: string");
    expect(chatPanel).toContain("aiIdentityId: selectedIdentity?.identity.id");
    expect(chatPanel).toContain("!pendingRetry.modelRoute || item.route === pendingRetry.modelRoute");
    expect(chatPanel).toContain("identityId: pendingRetry.aiIdentityId");
  });

  it("bootstraps the selected Viewer identity during First Run before completing setup", () => {
    const firstRunStart = app.indexOf("function FirstRunSetup");
    const firstRunSource = app.slice(firstRunStart);
    const bootstrap = firstRunSource.indexOf("const viewerIdentity = await ensureProfileViewerIdentity");
    const completion = firstRunSource.indexOf("await onComplete(profile, initialConversationWorkspace, initialRvWorkspace)");
    expect(firstRunStart).toBeGreaterThanOrEqual(0);
    expect(bootstrap).toBeGreaterThanOrEqual(0);
    expect(completion).toBeGreaterThan(bootstrap);
    expect(firstRunSource).toContain('if (!viewerIdentity) throw new Error("Viewer identity could not be created for the selected Profile setup route.")');
  });

  it("keeps RV resume bound to the frozen session route rather than the newly selected identity", () => {
    expect(rvPanel).toContain("snapshot.providerConfigId");
    expect(rvPanel).toContain("snapshot.modelId");
    expect(rvPanel).toContain("item.route === snapshot.modelRoute");
  });
});
