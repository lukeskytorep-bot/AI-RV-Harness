import type { CreateJudgeRunInput, FrozenJudgeResultInput, FrozenJudgeScoreInput, JudgeScoreRecord } from "../../judge/types";

/** Internal persistence contract for immutable/frozen AI Judge results. */
export interface JudgeRepository {
  recordFrozenJudgeResult(run: CreateJudgeRunInput, score: FrozenJudgeScoreInput): Promise<JudgeScoreRecord>;
  recordFrozenJudgeResults(results: FrozenJudgeResultInput[]): Promise<JudgeScoreRecord[]>;
  listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]>;
}
