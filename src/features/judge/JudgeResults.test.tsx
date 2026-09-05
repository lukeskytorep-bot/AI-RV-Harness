import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import type { JudgeScoreRecord } from "../../judge/types";
import { JudgeEvaluation, JudgeResults } from "./index";

const scores: JudgeScoreRecord[] = [
  {
    id: "score-1", judgeRunId: "run-1", judgeIndex: 1, modelRoute: "openrouter:judge-one",
    gestalt: 2.5, verifiableFeatures: 2, activityFunctionEvent: 1.5, confabulationControl: 1, total: 7,
    narrative: { strongestMatches: ["angular structure"], majorMissesContradictions: ["color mismatch"], confabulationObservations: ["unsupported label"], conciseRationale: "Substantial correspondence." },
    frozenAt: "now", createdAt: "now",
  },
  {
    id: "score-2", judgeRunId: "run-2", judgeIndex: 2, modelRoute: "openrouter:judge-two",
    gestalt: 2, verifiableFeatures: 2.5, activityFunctionEvent: 1, confabulationControl: 1.5, total: 7,
    narrative: { strongestMatches: ["hard edges"], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "Consistent evidence." },
    frozenAt: "now", createdAt: "now",
  },
];

describe("JudgeResults", () => {
  it("renders the canonical complete result through the public Judge entry point", () => {
    const html = renderToStaticMarkup(<JudgeResults copy={getCopy("en")} scores={scores} />);

    expect(html).toContain("Mean total");
    expect(html).toContain("Median total");
    expect(html).toContain("Total spread");
    expect(html).toContain("openrouter:judge-one");
    expect(html).toContain("2.5/3");
    expect(html).toContain("1.5/2");
    expect(html).toContain("angular structure");
    expect(html).toContain("color mismatch");
    expect(html).toContain("unsupported label");
    expect(html).toContain("Substantial correspondence.");
  });

  it("omits multi-Judge aggregate statistics for one score", () => {
    const html = renderToStaticMarkup(<JudgeResults copy={getCopy("pl")} scores={[scores[0]]} />);
    expect(html).not.toContain("Średnia suma");
    expect(html).toContain("Zamrożone wyniki Judge");
  });

  it("renders the interactive Judge workflow through the public feature entry point", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(<JudgeEvaluation copy={copy} repository={null} sessionId="session" language="en" models={[]} providerConfigs={[]} />);

    expect(html).toContain(copy.judgeEvaluation);
    expect(html).toContain(copy.judgeCount);
    expect(html).toContain(copy.runJudges);
  });
});
