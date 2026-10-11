import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { TrainingScreen } from "./index";
import { acquireTrainingOperation, computeTrainingTooltipPosition, factoryPackAllowsTrainingMode, TrainingRunHistoryCard, type TrainingRunHistoryCardText } from "./TrainingScreen";
import type { TrainingRunRecord } from "../../training/types";

const historyText: TrainingRunHistoryCardText = {
  resume: "Resume", endTraining: "End training", endedByUser: "Ended by user",
  showSessions: "Show sessions", hideSessions: "Hide sessions", saveTraining: "Save complete training",
  archiveTraining: "Archive training", session: "Session",
};


function walkElements(node: ReactNode, visit: (props: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walkElements(child, visit));
    return;
  }
  if (!isValidElement(node)) return;
  visit(node.props as Record<string, unknown>);
  walkElements((node.props as { children?: ReactNode }).children, visit);
}

function trainingRun(overrides: Partial<TrainingRunRecord> = {}): TrainingRunRecord {
  return {
    id: "run-1", runNumber: 1, name: "A very long training name", status: "Interrupted", mode: "partial",
    profileId: "p", workspaceId: "w", modelRoute: "route", protocolVariant: "extended",
    targetIds: ["t1", "t2"], completedTargetIds: ["t1"], sessionIds: ["s1"], currentIndex: 1,
    categories: ["mixed_targets"], judgeModelRoutes: [], pauseAfterBlock: false, errors: [],
    createdAt: "now", updatedAt: "now", ...overrides,
  };
}

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
    expect(html).toContain('aria-controls="training-help-panel"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Number of rounds");
    expect(html).toContain("1–10 rounds");
    expect(html).toContain("Viewer model");
    expect(html).toContain("Use Viewer Notes");
    expect(html).toContain("Enabled by default");
    expect(html).not.toContain("Experimental");
    expect(html).toContain("Recent training runs");
    expect(html).toContain('aria-label="Collapse training history"');
    expect(html).toContain('aria-expanded="true"');
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

    const source = fs.readFileSync(path.join(process.cwd(), "src/features/training/TrainingScreen.tsx"), "utf8");
    expect(en).toContain("How does AI Training work?");
    expect(en).toContain('aria-expanded="false"');
    expect(pl).toContain("Jak działa AI Training?");
    expect(source).toContain("One Full Training round consists of 8 sessions");
    expect(source).toContain("5 of 10 remaining");
    expect(source).toContain("Pause and Resume");
    expect(source).toContain("Jeden przebieg Full Training składa się z 8 sesji");
    expect(source).toContain("Pozostało 5 z 10");
    expect(source).toContain("Pauza i Resume");
    expect(source).toContain("{packTotal}/94");
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

  it("renders history cards with header icons and a separate Resume / End training row", () => {
    const run = trainingRun();
    const html = renderToStaticMarkup(
      <TrainingRunHistoryCard
        run={run}
        expanded={false}
        selectedSessionId={null}
        operationUnavailable={false}
        archiveDisabled={false}
        text={historyText}
        onToggleSessions={() => undefined}
        onExport={() => undefined}
        onArchive={() => undefined}
        onResume={() => undefined}
        onEnd={() => undefined}
        onSelectSession={() => undefined}
      />,
    );
    expect(html).toContain('class="training-run-header"');
    expect(html).toContain('class="training-run-icon-actions"');
    expect(html).toContain('aria-label="Show sessions"');
    expect(html).toContain('aria-label="Save complete training"');
    expect(html).toContain('aria-label="Archive training"');
    expect(html).toContain('class="training-run-recovery-actions"');
    expect(html).toContain("Resume");
    expect(html).toContain("End training");
    expect(html.indexOf('training-run-icon-actions')).toBeLessThan(html.indexOf('training-run-recovery-actions'));
  });

  it("keeps sessions/history actions but removes Resume and End after the user ends a run", () => {
    const html = renderToStaticMarkup(
      <TrainingRunHistoryCard
        run={trainingRun({ termination: { reason: "user_finished", endedAt: "2026-10-10T12:00:00.000Z" } })}
        expanded={true}
        selectedSessionId={null}
        operationUnavailable={false}
        archiveDisabled={false}
        text={historyText}
        onToggleSessions={() => undefined}
        onExport={() => undefined}
        onArchive={() => undefined}
        onResume={() => undefined}
        onEnd={() => undefined}
        onSelectSession={() => undefined}
      />,
    );
    expect(html).toContain("Ended by user");
    expect(html).toContain('aria-label="Hide sessions"');
    expect(html).toContain('aria-label="Save complete training"');
    expect(html).toContain('aria-label="Archive training"');
    expect(html).toContain("Session 1");
    expect(html).not.toContain("Resume");
    expect(html).not.toContain("End training");
  });

  it("does not offer End training for a completed run and uses RV Sessions typography classes", () => {
    const html = renderToStaticMarkup(
      <TrainingRunHistoryCard
        run={trainingRun({ status: "Completed", currentIndex: 2, completedTargetIds: ["t1", "t2"], completedAt: "done" })}
        expanded={true}
        selectedSessionId="s1"
        operationUnavailable={false}
        archiveDisabled={false}
        text={historyText}
        onToggleSessions={() => undefined}
        onExport={() => undefined}
        onArchive={() => undefined}
        onResume={() => undefined}
        onEnd={() => undefined}
        onSelectSession={() => undefined}
      />,
    );
    expect(html).toContain('class="training-history-title"');
    expect(html).toContain('class="training-session-id"');
    expect(html).not.toContain("Resume");
    expect(html).not.toContain("End training");
  });

  it("wires the history card actions to the existing session/export/archive/resume/end callbacks", () => {
    const calls: string[] = [];
    const tree = TrainingRunHistoryCard({
      run: trainingRun(), expanded: false, selectedSessionId: null, operationUnavailable: false, archiveDisabled: false, text: historyText,
      onToggleSessions: () => calls.push("sessions"), onExport: () => calls.push("export"), onArchive: () => calls.push("archive"),
      onResume: () => calls.push("resume"), onEnd: () => calls.push("end"), onSelectSession: () => calls.push("select"),
    });
    const actions = new Map<string, () => void>();
    walkElements(tree, (props) => {
      const childText = Children.toArray(props.children as ReactNode)
        .filter((child): child is string | number => typeof child === "string" || typeof child === "number")
        .map(String)
        .join("")
        .trim();
      const label = typeof props.label === "string" ? props.label : childText || null;
      if (label && typeof props.onClick === "function") actions.set(label, props.onClick as () => void);
    });
    const required = ["Show sessions", "Save complete training", "Archive training", "Resume", "End training"] as const;
    required.forEach((label) => expect(actions.has(label), `missing action: ${label}`).toBe(true));
    required.forEach((label) => actions.get(label)!());
    expect(calls).toEqual(["sessions", "export", "archive", "resume", "end"]);
  });

  it("uses grid/flex layout constraints for history card actions and RV Sessions font", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles/training-research.css"), "utf8");
    expect(css).toMatch(/\.training-run-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto[^}]*\}/s);
    expect(css).toMatch(/\.training-run-icon-actions\s*\{[^}]*display:\s*flex[^}]*gap:/s);
    expect(css).toMatch(/\.training-run-recovery-actions\s*\{[^}]*flex-wrap:\s*wrap[^}]*\}/s);
    expect(css).toContain('font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    expect(css).toMatch(/\.training-history-title, \.training-session-id\s*\{[^}]*font-weight:\s*400/s);
    expect(css).not.toMatch(/\.training-run-header[^}]*position:\s*absolute/s);
  });

  it("does not expose a Workspace selector when an AI Profile has a valid technical Workspace", () => {
    const now = "2026-09-15T12:00:00.000Z";
    const html = renderToStaticMarkup(
      <TrainingScreen
        copy={getCopy("en")}
        settings={createDefaultSettings()}
        profiles={[{ id: "profile-a", name: "Orion", createdAt: now, updatedAt: now }]}
        workspaces={[{ id: "workspace-a", profileId: "profile-a", name: "Workspace 1", kind: "legacy_combined", createdAt: now, updatedAt: now, lastOpenedAt: now }]}
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
        workspaces={[{ id: "workspace-b", profileId: "profile-b", name: "Workspace 1", kind: "rv", createdAt: now, updatedAt: now, lastOpenedAt: now }]}
        repository={null}
      />,
    );

    expect(html).toContain("The selected Profile has no active RV Workspace or legacy combined Workspace");
    expect(html).not.toContain(">Workspace<");
  });

  it("serializes Start / Resume / End / Archive through one synchronous operation guard", () => {
    const guard = { current: false };
    const pending: boolean[] = [];
    const releaseFirst = acquireTrainingOperation(guard, (value) => pending.push(value));
    expect(releaseFirst).not.toBeNull();
    expect(guard.current).toBe(true);
    expect(acquireTrainingOperation(guard, (value) => pending.push(value))).toBeNull();
    releaseFirst?.();
    expect(guard.current).toBe(false);
    expect(pending).toEqual([true, false]);
    const releaseSecond = acquireTrainingOperation(guard, (value) => pending.push(value));
    expect(releaseSecond).not.toBeNull();
    releaseSecond?.();
    expect(pending).toEqual([true, false, true, false]);
  });

  it("keeps the shared guard held across an awaited dialog and releases it after cancel/error", async () => {
    const guard = { current: false };
    const pending: boolean[] = [];
    let resolveDialog!: (value: boolean) => void;
    const dialog = new Promise<boolean>((resolve) => { resolveDialog = resolve; });
    const release = acquireTrainingOperation(guard, (value) => pending.push(value));
    expect(release).not.toBeNull();
    const operation = (async () => {
      try {
        await dialog;
      } finally {
        release?.();
      }
    })();
    expect(guard.current).toBe(true);
    expect(acquireTrainingOperation(guard, () => undefined)).toBeNull();
    resolveDialog(false);
    await operation;
    expect(guard.current).toBe(false);
    expect(pending).toEqual([true, false]);

    const releaseAfterError = acquireTrainingOperation(guard, (value) => pending.push(value));
    expect(releaseAfterError).not.toBeNull();
    try {
      throw new Error("dialog failed");
    } catch {
      // mirrors handler catch
    } finally {
      releaseAfterError?.();
    }
    expect(guard.current).toBe(false);
    expect(pending).toEqual([true, false, true, false]);
  });

  it("keeps aria-controls target mounted while a run session list is collapsed", () => {
    const html = renderToStaticMarkup(
      <TrainingRunHistoryCard
        run={trainingRun()} expanded={false} selectedSessionId={null}
        operationUnavailable={false} archiveDisabled={false} text={historyText}
        onToggleSessions={() => undefined} onExport={() => undefined} onArchive={() => undefined}
        onResume={() => undefined} onEnd={() => undefined} onSelectSession={() => undefined}
      />,
    );
    expect(html).toContain('aria-controls="training-run-sessions-run-1"');
    expect(html).toContain('id="training-run-sessions-run-1"');
    expect(html).toContain('hidden=""');
  });


  it("keeps tooltips inside the viewport and flips below near the top edge", () => {
    expect(computeTrainingTooltipPosition({
      button: { left: 288, top: 80, right: 312, bottom: 104, width: 24, height: 24 },
      tooltip: { width: 150, height: 30 }, viewportWidth: 320, viewportHeight: 240,
    })).toEqual({ left: 160, top: 42, placement: "above" });

    expect(computeTrainingTooltipPosition({
      button: { left: 288, top: 10, right: 312, bottom: 34, width: 24, height: 24 },
      tooltip: { width: 150, height: 30 }, viewportWidth: 320, viewportHeight: 100,
    })).toEqual({ left: 160, top: 42, placement: "below" });
  });

  it("keeps a collapsed sessions container truly hidden despite the grid rule", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles/training-research.css"), "utf8");
    expect(css).toMatch(/\.training-session-links\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
  });

  it("uses the common guard for archive and portal tooltips for hover/focus help", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/features/training/TrainingScreen.tsx"), "utf8");
    expect(source).toContain("const releaseTrainingOperation = acquireTrainingOperation(trainingOperationGuard, setTrainingOperationPending)");
    expect(source).toContain("const fresh = (await repository.listTrainingRuns()).find((item) => item.id === run.id)");
    expect(source).toContain('disabled={busy || trainingOperationPending}');
    const tooltip = fs.readFileSync(path.join(process.cwd(), "src/components/TooltipButton.tsx"), "utf8");
    expect(tooltip).toContain('onFocus={() => setOpen(true)}');
    expect(tooltip).toContain('onMouseEnter={() => setOpen(true)}');
    expect(tooltip).toContain('createPortal(');
    expect(tooltip).toContain('role="tooltip"');
    expect(tooltip).toContain('tooltipRef.current?.getBoundingClientRect()');
    expect(tooltip).toContain('window.addEventListener("resize", update)');
    expect(tooltip).toContain('window.addEventListener("scroll", update, true)');
  });

});
