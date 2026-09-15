import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { TrainingScreen } from "./index";

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
    expect(html).toContain("84");
    expect(html).toContain("Viewer Notes");
    expect(html).toContain("Recent training runs");
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
