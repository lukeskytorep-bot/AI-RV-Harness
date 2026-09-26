import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { TrainingScreen } from "./index";
import { factoryPackAllowsTrainingMode } from "./TrainingScreen";

describe("TrainingScreen", () => {
  it("renders Training through its public feature entry point without repository access", () => {
    const html = renderToStaticMarkup(
      <TrainingScreen
        copy={getCopy("en")}
        settings={createDefaultSettings()}
        profiles={[]}
        workspaces={[]}
        repository={null}
      />,
    );

    expect(html).toContain("AI Training");
    expect(html).toContain("How does AI Training work?");
    expect(html).toContain("94/94");
    expect(html).toContain("Number of rounds");
    expect(html).toContain("1–10 rounds");
    expect(html).toContain("Viewer model");
    expect(html).toContain("Use Viewer Notes");
    expect(html).toContain("Enabled by default");
    expect(html).not.toContain("Experimental");
    expect(html).toContain("Recent training runs");
  });



  it("keeps Partial Training available when the factory pack is invalid", () => {
    expect(factoryPackAllowsTrainingMode("partial", false)).toBe(true);
    expect(factoryPackAllowsTrainingMode("full", false)).toBe(false);
    expect(factoryPackAllowsTrainingMode("full", true)).toBe(true);
  });

  it("renders the canonical Stage 3 educational panel in both UI languages", () => {
    const en = renderToStaticMarkup(
      <TrainingScreen copy={getCopy("en")} settings={createDefaultSettings()} profiles={[]} workspaces={[]} repository={null} />,
    );
    const plSettings = { ...createDefaultSettings(), interfaceLanguage: "pl" as const };
    const pl = renderToStaticMarkup(
      <TrainingScreen copy={getCopy("pl")} settings={plSettings} profiles={[]} workspaces={[]} repository={null} />,
    );

    expect(en).toContain('<details class="training-help-panel">');
    expect(en).toContain("How does AI Training work?");
    expect(en).toContain("One Full Training round consists of 8 sessions");
    expect(en).toContain("5 of 10 remaining");
    expect(en).toContain("Pause and Resume");
    expect(pl).toContain("Jak działa AI Training?");
    expect(pl).toContain("Jeden przebieg Full Training składa się z 8 sesji");
    expect(pl).toContain("Pozostało 5 z 10");
    expect(pl).toContain("Pauza i Resume");
    expect(pl).not.toContain("Eksperymentalne");
  });

  it("keeps the read-only Viewer route and Viewer Notes control in one desktop row and stacks it on small screens", () => {
    const screenSource = fs.readFileSync(path.join(process.cwd(), "src/features/training/TrainingScreen.tsx"), "utf8");
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles/training-research.css"), "utf8");

    expect(screenSource).toContain('className="training-viewer-row"');
    expect(screenSource).toContain('className="training-viewer-model-card"');
    expect(screenSource).toContain('className="training-viewer-notes-card"');
    expect(screenSource).not.toContain("Experimental · enabled by default");
    expect(screenSource).not.toContain("Eksperymentalne · domyślnie włączone");
    expect(css).toMatch(/\.training-viewer-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*\}/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)\s*\{[\s\S]*?\.training-viewer-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*\}/);
  });

  it("keeps Show sessions, Save training and Archive in one non-wrapping desktop action container", () => {
    const screenSource = fs.readFileSync(path.join(process.cwd(), "src/features/training/TrainingScreen.tsx"), "utf8");
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles/training-research.css"), "utf8");
    const actionContainer = screenSource.match(/<div className="training-run-actions">([\s\S]*?)<\/div>/)?.[1] ?? "";

    expect(actionContainer).toContain("{text.showSessions}");
    expect(actionContainer).toContain("{text.saveTraining}");
    expect(actionContainer).toContain("{text.archive}");
    expect(actionContainer.indexOf("{text.saveTraining}")).toBeLessThan(actionContainer.indexOf("{text.archive}"));
    expect(css).toMatch(/\.training-run-actions\s*\{[^}]*flex-wrap:\s*nowrap[^}]*\}/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.training-run-actions\s*\{[^}]*flex-wrap:\s*wrap[^}]*\}/);
  });
  it("does not expose a Workspace selector when an AI Profile has a valid technical Workspace", () => {
    const now = "2026-09-15T12:00:00.000Z";
    const html = renderToStaticMarkup(
      <TrainingScreen
        copy={getCopy("en")}
        settings={createDefaultSettings()}
        profiles={[{ id: "profile-a", name: "Orion", createdAt: now, updatedAt: now }]}
        workspaces={[{ id: "workspace-a", profileId: "profile-a", name: "Workspace 1", createdAt: now, updatedAt: now, lastOpenedAt: now }]}
        repository={null}
      />,
    );

    expect(html).toContain("AI IS-BE");
    expect(html).not.toContain(">Workspace<");
    expect(html).not.toContain("create and select a Workspace");
  });

  it("shows a controlled requirement instead of borrowing another Profile's Workspace", () => {
    const now = "2026-09-15T12:00:00.000Z";
    const html = renderToStaticMarkup(
      <TrainingScreen
        copy={getCopy("en")}
        settings={createDefaultSettings()}
        profiles={[{ id: "profile-a", name: "Orion", createdAt: now, updatedAt: now }]}
        workspaces={[{ id: "workspace-b", profileId: "profile-b", name: "Workspace 1", createdAt: now, updatedAt: now, lastOpenedAt: now }]}
        repository={null}
      />,
    );

    expect(html).toContain("The selected Profile has no active Workspace");
    expect(html).not.toContain(">Workspace<");
  });

});
