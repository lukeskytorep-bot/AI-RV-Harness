import { describe, expect, it } from "vitest";

import type { JudgeScoreRecord } from "../judge/types";
import type { RvSession } from "../sessions/types";
import { renderCompleteSessionMarkdown, renderJudgeEvaluationMarkdown } from "./sessionDocument";

const session: RvSession = {
  id: "session", workspaceId: "workspace", profileId: "profile", sessionCode: "RVH-1", state: "Completed", runType: "automatic",
  preRevealTranscript: "blind evidence", postRevealTranscript: "viewer review", createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:10:00Z",
};

const scores: JudgeScoreRecord[] = [
  score("one", 1, "openrouter:judge-a", 2.5, 2, 1.5, 1),
  score("two", 2, "openrouter:judge-b", 2, 2.5, 1, 1.5),
];

describe("canonical complete session Markdown", () => {
  it("renders every frozen Judge field and aggregate in Polish", () => {
    const markdown = renderJudgeEvaluationMarkdown(scores, "pl");

    expect(markdown).toContain("Podsumowanie wielu Judge’ów");
    expect(markdown).toContain("Średnia suma: 7.00 / 10");
    expect(markdown).toContain("Judge 1 — 7.0/10");
    expect(markdown).toContain("Model: openrouter:judge-a");
    expect(markdown).toContain("Gestalt: 2.5/3");
    expect(markdown).toContain("Sprawdzalne cechy: 2.0/3");
    expect(markdown).toContain("Aktywność / funkcja / zdarzenie: 1.5/2");
    expect(markdown).toContain("Kontrola konfabulacji: 1.0/2");
    expect(markdown).toContain("- strong match one");
    expect(markdown).toContain("- confab one");
    expect(markdown).toContain("rationale one");
  });

  it("uses the same complete-session section order with or without standard metadata", () => {
    const base = { title: "RVH-1 — pełny zapis sesji", language: "pl" as const, session, revealText: "target", revealFilesMarkdown: "- image.png", scores, clarifications: [] };
    const anonymous = renderCompleteSessionMarkdown(base);
    const standard = renderCompleteSessionMarkdown({ ...base, metadata: { mode: "Training — sesja RV", exportedAt: new Date("2026-09-05T11:00:00Z") } });
    const headings = ["Zapieczętowana część ślepa", "Target Reveal", "Opinia Viewera", "Ocena AI Judge", "Późniejsze doprecyzowania celu"];

    for (const heading of headings) {
      expect(anonymous).toContain(heading);
      expect(standard).toContain(heading);
    }
    expect(standard).toContain("Tryb: Training — sesja RV");
  });
});

function score(id: string, judgeIndex: number, modelRoute: string, gestalt: number, verifiableFeatures: number, activityFunctionEvent: number, confabulationControl: number): JudgeScoreRecord {
  return {
    id, judgeRunId: `run-${id}`, judgeIndex, modelRoute, gestalt, verifiableFeatures, activityFunctionEvent, confabulationControl,
    total: gestalt + verifiableFeatures + activityFunctionEvent + confabulationControl,
    narrative: { strongestMatches: [`strong match ${id}`], majorMissesContradictions: [`miss ${id}`], confabulationObservations: [`confab ${id}`], conciseRationale: `rationale ${id}` },
    frozenAt: "2026-09-05T10:10:00Z", createdAt: "2026-09-05T10:10:00Z",
  };
}
