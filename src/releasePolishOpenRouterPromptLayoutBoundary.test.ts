import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import profileControls from "./features/profiles/ProfileViewerControls.tsx?raw";
import profileDialogs from "./features/profiles/ProfileDialogs.tsx?raw";
import monitorCss from "./styles/monitor.css?raw";
import openRouterAdapter from "../src-tauri/src/providers/adapters.rs?raw";

describe("release polish: OpenRouter attribution and Profile prompt containment", () => {
  it("attributes OpenRouter traffic to the public AI RV Harness project page without changing the title", () => {
    expect(openRouterAdapter).toContain(
      'OPENROUTER_APP_REFERER: &str = "https://lukeskytorep-bot.github.io/AI-RV-Harness/"',
    );
    expect(openRouterAdapter).toContain('OPENROUTER_APP_TITLE: &str = "AI RV Harness"');
    expect(openRouterAdapter).toContain('.header("HTTP-Referer", OPENROUTER_APP_REFERER)');
    expect(openRouterAdapter).toContain('.header("X-OpenRouter-Title", OPENROUTER_APP_TITLE)');
  });

  it("uses the same ProfileViewerControls in First Run and Profile editing", () => {
    expect(appSource).toContain("<ProfileViewerControls");
    expect(profileDialogs).toContain("<ProfileViewerControls");
    expect(profileControls).toContain("viewer-field-guide-readonly");
    expect(profileControls).toContain("effective-prompt-preview");
  });

  it("contains Field Guide and prompt pre blocks without a global pre rule", () => {
    expect(monitorCss).toContain(".profile-viewer-controls .viewer-field-guide-readonly pre");
    expect(monitorCss).toContain("white-space: pre-wrap");
    expect(monitorCss).toContain("overflow-wrap: anywhere");
    expect(monitorCss).toContain("word-break: break-word");
    expect(monitorCss).toContain("max-width: 100%");
    expect(monitorCss).toContain("min-width: 0");
    expect(monitorCss).toContain("max-height: 320px");
    expect(monitorCss).toContain("overflow: auto");
    expect(monitorCss).toContain("box-sizing: border-box");
    expect(monitorCss).toContain(".profile-viewer-controls .locked-prompt-block {");
    expect(monitorCss).toContain(".profile-viewer-controls .locked-prompt-block p, .profile-viewer-controls .locked-prompt-block pre {");
    expect(monitorCss).toContain(".profile-viewer-controls .effective-prompt-preview {");
    expect(monitorCss).toContain(".profile-viewer-controls .effective-prompt-preview pre {");
    expect(monitorCss).not.toContain(".locked-prompt-block { min-width: 0");
    expect(monitorCss).not.toContain(".effective-prompt-preview { min-width: 0");
    expect(monitorCss).not.toMatch(/(^|\n)pre\s*\{/);
  });
});
