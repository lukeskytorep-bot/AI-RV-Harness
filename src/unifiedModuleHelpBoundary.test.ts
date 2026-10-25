/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("UNIFIED-MODULE-HELP boundaries", () => {
  it("uses one shared help control and panel implementation", () => {
    const shared = read("./components/ModuleHelp.tsx");
    expect(shared).toContain('className="module-help-button"');
    expect(shared).toContain('aria-expanded={expanded}');
    expect(shared).toContain('aria-controls={controlsId}');
    expect(shared).toContain('role="region"');
  });

  it("places module help in the proper headers and keeps the shared profile/action order", () => {
    const conversation = read("./features/conversations/ConversationsScreen.tsx");
    const rv = read("./features/rvSessions/RvSessionsScreen.tsx");
    const ai = read("./features/aiCenter/AiCenterScreen.tsx");
    const training = read("./features/training/TrainingScreen.tsx");
    const telepathicTraining = read("./features/training/TelepathicTrainingPanel.tsx");
    const research = read("./features/research/ResearchScreen.tsx");
    const builder = read("./features/research/ResearchBuilder.tsx");

    for (const source of [conversation, rv, ai]) {
      expect(source).toContain('className="module-header-actions"');
      expect(source.indexOf("<ProfileSelector")).toBeLessThan(source.indexOf("<ModuleHelpButton"));
    }
    expect(training).toContain('controlsId="training-help-panel"');
    expect(telepathicTraining).not.toContain("CircleHelp");
    expect(telepathicTraining).not.toContain("Jak to działa?");
    expect(research).toContain('controlsId="research-help-panel"');
    expect(builder).not.toContain('className="panel research-help-panel"');
  });

  it("uses module icons instead of CircleHelp and the common green help styling", () => {
    const conversation = read("./features/conversations/ConversationsScreen.tsx");
    const rv = read("./features/rvSessions/RvSessionsScreen.tsx");
    const sharedCss = read("./styles/shared.css");
    expect(conversation).not.toContain("CircleHelp");
    expect(rv).not.toContain("CircleHelp");
    expect(sharedCss).toContain("--module-help-accent: var(--green)");
    expect(sharedCss).toContain(".module-help-button");
    expect(sharedCss).toContain(".module-help-panel");
  });
});
