// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import { workflowTestRepository } from "../../testing/workflowRepository";
import type { ResearchResults, UnblindedSessionResult } from "../../research/types";
import type { AppRepository } from "../../storage/repository";
import { ResearchResultsView } from "./ResearchBuilder";

function session(index: number): UnblindedSessionResult {
  return {
    anonymousSessionId: `Blind_${index}`, sessionId: `s-${index}`, targetId: `t-${index % 10}`, pairKey: `p-${index % 10}`,
    conditionKey: "c0", conditionLabel: "Condition 0", total: 6, judgeCount: 1, judgeTotalRange: 0, judgeTotalStdDev: 0,
    gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1,
  };
}

describe("Research results pagination", () => {
  it("renders and loads Judge details in 100-row pages instead of querying every large-grid session at once", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const results: ResearchResults = {
      schemaVersion: 1, projectId: "r", templateType: "sampling", computedAt: "now",
      sessions: Array.from({ length: 250 }, (_, index) => session(index)),
      conditions: [{ conditionKey: "c0", label: "Condition 0", n: 250, meanTotal: 6, medianTotal: 6, stdDevTotal: 0, minTotal: 6, maxTotal: 6, meanComponents: { gestalt: 2, verifiableFeatures: 2, activityFunctionEvent: 1, confabulationControl: 1 } }],
      pairwise: Array.from({ length: 150 }, (_, index) => ({ conditionA: `c${index}`, conditionB: `d${index}`, pairedN: 10, winsA: 5, ties: 0, winsB: 5, meanPairedDifference: 0 })),
    };
    const listJudgeScores = vi.fn(async () => []);
    const repository = workflowTestRepository({ listJudgeScores } as unknown as AppRepository);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(<ResearchResultsView copy={getCopy("en")} results={results} repository={repository} />); await Promise.resolve(); });
      expect(listJudgeScores).toHaveBeenCalledTimes(100);
      expect(host.textContent).toContain("Page 1/3");
      expect(host.textContent).toContain("Page 1/2");
      expect(host.textContent).toContain("c0 ↔ d0");
      expect(host.textContent).not.toContain("c149 ↔ d149");
      const nextButtons = [...host.querySelectorAll("button")].filter((button) => button.textContent === "Next");
      await act(async () => { (nextButtons.at(-1) as HTMLButtonElement).click(); await Promise.resolve(); });
      expect(listJudgeScores).toHaveBeenCalledTimes(200);
      expect(host.textContent).toContain("Page 2/3");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
