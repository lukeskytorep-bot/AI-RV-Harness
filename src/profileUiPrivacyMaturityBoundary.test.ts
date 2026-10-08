import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("PROFILE-UI-PRIVACY-MATURITY-1 boundary", () => {
  it("moves output-token controls to Settings without local Conversation/RV controls", () => {
    const settings = read("./features/settings/SettingsScreen.tsx");
    const chat = read("./features/conversations/ChatPanel.tsx");
    const rv = read("./features/rvSessions/RvSessionPanel.tsx");
    expect(settings).toContain("conversationMaxOutputTokens");
    expect(settings).toContain("rvSessionMaxOutputTokens");
    expect(chat).not.toContain('className="chat-output-limit"');
    expect(rv).not.toContain("setMaxOutputTokens");
    expect(chat).toContain('mode === "conversation" ? settings.conversationMaxOutputTokens : settings.rvSessionMaxOutputTokens');
    expect(rv).toContain("settings.rvSessionMaxOutputTokens");
  });

  it("preserves the previous single output setting as the upgrade seed", () => {
    const app = read("./App.tsx");
    expect(app).toContain("outputSettingsNeedUpgrade");
    expect(app).toContain("storedSettings.defaultMaxOutputTokens ?? nextSettings.defaultMaxOutputTokens");
  });

  it("keeps Research experimental wording while removing Viewer Learning experimental labels", () => {
    const aiCenter = read("./features/aiCenter/AiCenterScreen.tsx");
    const research = read("./i18n/research.ts");
    const rv = read("./features/rvSessions/RvSessionPanel.tsx");
    expect(aiCenter).toContain("Role, historia i pamięć uczenia AI");
    expect(aiCenter).not.toContain("Viewer Notes są eksperymentalne");
    expect(aiCenter).not.toContain(">EXPERIMENTAL<");
    expect(rv).not.toContain("Eksperymentalne · domyślnie włączone");
    expect(research).toContain("experimental prompts");
  });

  it("bundles exact offline privacy resources with pinned SHA-256 values", () => {
    const en = read("./resources/privacy/privacy.en.md");
    const pl = read("./resources/privacy/privacy.pl.md");
    const registry = read("./resources/privacy/privacyRegistry.ts");
    expect(read("../PRIVACY.md")).toBe(en);
    expect(registry).toContain(sha256(en));
    expect(registry).toContain(sha256(pl));
    expect(registry).toContain("https://lukeskytorep-bot.github.io/AI-RV-Harness/privacy.html");
    const settings = read("./features/settings/SettingsScreen.tsx");
    expect(settings).toContain("openProjectUrl(PRIVACY_POLICY_URL)");
    expect(settings).not.toContain("href={PRIVACY_POLICY_URL}");
  });

  it("keeps Workspace tiles bounded while Profile selection uses the shared accessible native select", () => {
    const profiles = read("./features/profiles/ProfilesScreen.tsx");
    const selector = read("./components/ProfileSelector.tsx");
    const styles = read("./styles/shared.css");
    expect(profiles).toContain("workspace-add-button");
    expect(profiles).toContain("Add Conversation Workspace");
    expect(selector).toContain("<select");
    expect(selector).toContain("aria-label=");
    expect(selector).toContain("aiIsBeDisplayName(profile)");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("container-type: inline-size");
    expect(styles).toContain("@container (max-width: 640px)");
    expect(styles).toContain(".workspace-open-button:focus-visible { outline: 2px solid var(--violet); outline-offset: -2px; }");
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(235px, 1fr))");
    expect(styles).toContain(".workspace-directory-tile.active");
  });
});
