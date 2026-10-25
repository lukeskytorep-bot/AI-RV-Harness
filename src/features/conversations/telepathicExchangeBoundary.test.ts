import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const conversations = readFileSync(new URL("./ConversationsScreen.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./TelepathicExchangePanel.tsx", import.meta.url), "utf8");

function compact(value: string): string { return value.replace(/\s+/g, " "); }

describe("TELEPATHIC-EXCHANGE-STEP3B Conversation boundary", () => {
  it("keeps normal Conversation separate and mounts telepathic exchange per Workspace", () => {
    expect(conversations).toContain('surface === "conversation"');
    expect(conversations).toContain('surface === "telepathic"');
    expect(conversations).toContain('<TelepathicExchangePanel key={workspace.id}');
    expect(conversations).toContain("operationBusyRef.current");
    expect(conversations).toContain('fixedMode="conversation"');
  });

  it("requires explicit participant routes, shows the frozen schedule, and supports both human roles", () => {
    const source = compact(panel);
    expect(source).toContain("seriesWorkspaceId: workspace.id");
    expect(source).toContain("workspaceId: aiWorkspace.id");
    expect(source).toContain("aiIdentityId: eligible.identity.id");
    expect(source).toContain("credentialFingerprint: eligible.identity.credentialFingerprint");
    expect(source).toContain("Harmonogram przed startem");
    expect(source).toContain("saveHumanTelepathicTarget");
    expect(source).toContain("saveHumanTelepathicFirstBlind");
    expect(source).toContain("sealHumanTelepathicBlind");
    expect(source).toContain("cancelCurrentTelepathicRoundBeforeReveal");
    expect(source).toContain("runTelepathicFinalReflections");
  });

  it("uses an immediate UI run guard so double clicks cannot create duplicate series or target writes", () => {
    expect(panel).toContain("runGuardRef.current");
    expect(panel).toContain("if (runGuardRef.current) return false");
  });
});
