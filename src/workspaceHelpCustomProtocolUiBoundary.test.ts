import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("WORKSPACE-HELP-CUSTOM-PROTOCOL-UI-1 boundaries", () => {
  it("keeps Workspace switcher tiles visible in a wrapping grid with vertical scrolling", () => {
    const css = read("./styles/shared.css");
    expect(css).toContain("grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr))");
    expect(css).toContain(".workspace-directory-groups { display: grid; gap: 12px; max-height: 62vh; overflow: auto; }");
    expect(css).toContain(".workspace-open-button:focus-visible");
    expect(css).not.toContain(".workspace-directory-groups > section > div { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); }");
  });

  it("adds collapsed accessible help controls without changing Viewer Learning semantics", () => {
    const conversation = read("./features/conversations/ConversationsScreen.tsx");
    const rvSessions = read("./features/rvSessions/RvSessionsScreen.tsx");
    expect(conversation).toContain('const [helpOpen, setHelpOpen] = useState(false)');
    expect(conversation).toContain('aria-controls="conversation-help-panel"');
    expect(conversation).toContain('aria-expanded={helpOpen}');
    expect(conversation).toContain("Jak działa rozmowa?");
    expect(conversation).toContain("How does Conversation work?");
    expect(conversation).toContain("Użyj Viewer Learning");
    expect(conversation).toContain("Use Viewer Learning");
    expect(rvSessions).toContain('const [helpOpen, setHelpOpen] = useState(false)');
    expect(rvSessions).toContain('aria-controls="rv-sessions-help-panel"');
    expect(rvSessions).toContain('aria-expanded={helpOpen}');
    expect(rvSessions).toContain("Jak działają sesje RV?");
    expect(rvSessions).toContain("How do RV Sessions work?");
    expect(rvSessions).toContain("does not run a saved Custom Protocol as an automatic sequence");
  });

  it("uses Radar for RV Sessions while Targets keeps Crosshair", () => {
    const app = read("./App.tsx");
    expect(app).toContain('{ id: "rv-sessions", icon: Radar, label: copy.rvSessionsNav }');
    expect(app).toContain('{ id: "targets", icon: Crosshair, label: copy.targets }');
  });

  it("stacks Credits above Privacy beside the Protocol Library", () => {
    const settings = read("./features/settings/SettingsScreen.tsx");
    const stack = settings.indexOf('className="about-side-stack"');
    const credits = settings.indexOf("<CreditsCard copy={copy} />", stack);
    const privacy = settings.indexOf('className="panel about-protocol-card privacy-policy-card"', stack);
    expect(stack).toBeGreaterThan(-1);
    expect(credits).toBeGreaterThan(stack);
    expect(privacy).toBeGreaterThan(credits);
    expect(read("./styles/settings.css")).toContain(".about-side-stack { min-width: 0; display: grid; gap: 14px; align-content: start; }");
  });

  it("makes Custom Protocol preview layout state-aware and keeps actions outside the scroll region", () => {
    const panel = read("./features/rvSessions/RvSessionPanel.tsx");
    const css = read("./styles/monitor.css");
    expect(panel).toContain('custom-protocol-modal ${preview ? "preview-open" : "preview-closed"}');
    expect(css).toContain(".custom-protocol-modal.preview-closed .custom-protocol-body { grid-template-columns: minmax(0, 1fr); }");
    expect(css).toContain(".custom-protocol-modal.preview-open .custom-protocol-body { grid-template-columns: minmax(0, 1.2fr) minmax(300px, .8fr); }");
    expect(css).toContain("max-height: calc(100dvh - 24px)");
    expect(css).toContain("scrollbar-gutter: stable");
    expect(css).toContain("overscroll-behavior: contain");
    expect(css).toContain(".custom-protocol-actions { flex: 0 0 auto;");
    expect(css).toContain("@media (max-width: 760px) { .custom-protocol-modal.preview-open .custom-protocol-body { grid-template-columns: minmax(0, 1fr); }");
  });
});
