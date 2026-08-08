import type { JudgeComponentScores, JudgeScoreSummary } from "../domain/scoring";

export const JUDGE_RUBRIC_VERSION = "3-3-2-2/v1";

export interface JudgeNarrative {
  strongestMatches: string[];
  majorMissesContradictions: string[];
  confabulationObservations: string[];
  conciseRationale: string;
}

export interface CreateJudgeRunInput {
  id: string;
  sessionId: string;
  judgeIndex: number;
  modelRoute: string;
  rubricVersion: string;
  anonymousSessionId: string;
  packetHash: string;
}

export interface FrozenJudgeScoreInput extends JudgeComponentScores {
  id: string;
  judgeRunId: string;
  narrative: JudgeNarrative;
}

export interface JudgeScoreRecord extends JudgeComponentScores {
  id: string;
  judgeRunId: string;
  judgeIndex: number;
  modelRoute: string;
  total: number;
  narrative: JudgeNarrative;
  frozenAt: string;
  createdAt: string;
}

export interface JudgingResult {
  anonymousSessionId: string;
  scores: JudgeScoreRecord[];
  aggregate: JudgeScoreSummary;
}
