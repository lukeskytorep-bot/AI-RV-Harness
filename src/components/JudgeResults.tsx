import { LockKeyhole } from "lucide-react";

import { SafeMarkdown } from "./SafeMarkdown";
import { aggregateJudgeScores } from "../domain/scoring";
import type { getCopy } from "../i18n";
import type { JudgeScoreRecord } from "../judge/types";

export interface JudgeResultsProps {
  copy: ReturnType<typeof getCopy>;
  scores: JudgeScoreRecord[];
  showFrozenLabel?: boolean;
}

export function JudgeResults({ copy, scores, showFrozenLabel = true }: JudgeResultsProps) {
  if (!scores.length) return null;
  const aggregate = aggregateJudgeScores(scores);

  return <div className="judge-results">
    {scores.length > 1 && <div className="judge-aggregate">
      <span><small>{copy.meanScore}</small><strong>{aggregate.mean.total.toFixed(2)} / 10</strong></span>
      <span><small>{copy.medianScore}</small><strong>{aggregate.medianTotal.toFixed(2)}</strong></span>
      <span><small>{copy.scoreSpread}</small><strong>{aggregate.totalRange.toFixed(2)} · σ {aggregate.totalStdDev.toFixed(2)}</strong></span>
    </div>}
    {showFrozenLabel && <strong className="judge-frozen-label"><LockKeyhole size={14} />{copy.frozenScores}</strong>}
    <div className="judge-score-list">{scores.map((score) => <article key={score.id} className="judge-score-card">
      <div className="judge-score-head"><span>Judge {score.judgeIndex}<small>{score.modelRoute}</small></span><strong>{score.total.toFixed(1)} / 10</strong></div>
      <div className="judge-components"><span>{copy.scoreGestalt}<b>{score.gestalt.toFixed(1)}/3</b></span><span>{copy.scoreFeatures}<b>{score.verifiableFeatures.toFixed(1)}/3</b></span><span>{copy.scoreActivity}<b>{score.activityFunctionEvent.toFixed(1)}/2</b></span><span>{copy.scoreConfab}<b>{score.confabulationControl.toFixed(1)}/2</b></span></div>
      <JudgeNarrativeRow label={copy.strongestMatches} values={score.narrative.strongestMatches} />
      <JudgeNarrativeRow label={copy.majorMisses} values={score.narrative.majorMissesContradictions} />
      <JudgeNarrativeRow label={copy.confabNotes} values={score.narrative.confabulationObservations} />
      <div className="judge-rationale"><small>{copy.rationale}</small><SafeMarkdown content={score.narrative.conciseRationale} /></div>
    </article>)}</div>
  </div>;
}

function JudgeNarrativeRow({ label, values }: { label: string; values: string[] }) {
  return <div className="judge-narrative"><small>{label}</small>{values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value}`}><SafeMarkdown content={value} /></li>)}</ul> : <p>—</p>}</div>;
}
