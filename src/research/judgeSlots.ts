import type { JudgeSelection } from "../judge/engine";
import type { JudgeScoreRecord } from "../judge/types";

/** Unlike ordinary RV's append-only prefix, Research keeps the frozen panel's
 * original slot identity when an independent Judge fails. Never infer by route. */
export function selectMissingResearchJudges(existing: JudgeScoreRecord[], selected: JudgeSelection[]): JudgeSelection[] {
  const occupied = new Set<number>();
  for (const score of existing) {
    const index = score.judgeIndex;
    if (!Number.isInteger(index) || index < 1 || index > selected.length || occupied.has(index)
      || !score.frozenAt || score.modelRoute !== selected[index - 1].model.route) throw new Error("Frozen Research Judge slot does not match the locked panel.");
    occupied.add(index);
  }
  return selected.filter((_, index) => !occupied.has(index + 1));
}
