export interface JudgeComponentScores {
  gestalt: number;
  verifiableFeatures: number;
  activityFunctionEvent: number;
  confabulationControl: number;
}

export interface JudgeScoreSummary {
  judgeCount: number;
  mean: JudgeComponentScores & { total: number };
  medianTotal: number;
  minTotal: number;
  maxTotal: number;
  totalRange: number;
  totalStdDev: number;
}

const MAXIMA: JudgeComponentScores = {
  gestalt: 3,
  verifiableFeatures: 3,
  activityFunctionEvent: 2,
  confabulationControl: 2,
};

export function validateJudgeScores(scores: JudgeComponentScores): void {
  for (const key of Object.keys(MAXIMA) as (keyof JudgeComponentScores)[]) {
    const value = scores[key];
    if (!Number.isFinite(value) || value < 0 || value > MAXIMA[key]) {
      throw new RangeError(`${key} must be between 0 and ${MAXIMA[key]}`);
    }
    if (Math.round(value * 10) !== value * 10) {
      throw new RangeError(`${key} may use at most one decimal place`);
    }
  }
}

export function computeJudgeTotal(scores: JudgeComponentScores): number {
  validateJudgeScores(scores);
  return Math.round(
    (scores.gestalt + scores.verifiableFeatures + scores.activityFunctionEvent + scores.confabulationControl) * 10,
  ) / 10;
}

export function aggregateJudgeScores(scores: JudgeComponentScores[]): JudgeScoreSummary {
  if (scores.length < 1 || scores.length > 3) throw new RangeError("Judge aggregation requires 1 to 3 scores");
  const totals = scores.map((score) => computeJudgeTotal(score));
  const meanComponent = (key: keyof JudgeComponentScores) => round2(scores.reduce((sum, score) => sum + score[key], 0) / scores.length);
  const meanTotal = round2(totals.reduce((sum, total) => sum + total, 0) / totals.length);
  const sortedTotals = [...totals].sort((a, b) => a - b);
  const middle = Math.floor(sortedTotals.length / 2);
  const medianTotal = sortedTotals.length % 2
    ? sortedTotals[middle]
    : round2((sortedTotals[middle - 1] + sortedTotals[middle]) / 2);
  const minTotal = sortedTotals[0];
  const maxTotal = sortedTotals[sortedTotals.length - 1];
  const variance = totals.reduce((sum, total) => sum + ((total - meanTotal) ** 2), 0) / totals.length;

  return {
    judgeCount: scores.length,
    mean: {
      gestalt: meanComponent("gestalt"),
      verifiableFeatures: meanComponent("verifiableFeatures"),
      activityFunctionEvent: meanComponent("activityFunctionEvent"),
      confabulationControl: meanComponent("confabulationControl"),
      total: meanTotal,
    },
    medianTotal,
    minTotal,
    maxTotal,
    totalRange: round2(maxTotal - minTotal),
    totalStdDev: round2(Math.sqrt(variance)),
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
