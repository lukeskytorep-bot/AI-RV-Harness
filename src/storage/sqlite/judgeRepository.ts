import type { CreateJudgeRunInput, FrozenJudgeResultInput, FrozenJudgeScoreInput, JudgeNarrative, JudgeScoreRecord } from "../../judge/types";
import { computeJudgeTotal } from "../../domain/scoring";
import type { DatabaseTransactionStatement } from "../databaseNative";
import type { JudgeRepository } from "../contracts/judgeRepository";
import { nowIso } from "../repository";

type JudgeScoreRow = {
  id: string;
  judge_run_id: string;
  judge_index: number;
  model_route: string;
  gestalt: number;
  verifiable_features: number;
  activity_function_event: number;
  confabulation_control: number;
  total: number;
  rationale_json: string;
  frozen_at: string;
  created_at: string;
};

export interface SqliteJudgeRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>;
  now?: typeof nowIso;
}

export class SqliteJudgeRepository implements JudgeRepository {
  constructor(private readonly dependencies: SqliteJudgeRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async recordFrozenJudgeResult(run: CreateJudgeRunInput, score: FrozenJudgeScoreInput): Promise<JudgeScoreRecord> {
    return (await this.recordFrozenJudgeResults([{ run, score }]))[0];
  }

  async recordFrozenJudgeResults(results: FrozenJudgeResultInput[]): Promise<JudgeScoreRecord[]> {
    if (!results.length) return [];
    const timestamp = this.now();
    const statements: DatabaseTransactionStatement[] = [];
    const records = results.map(({ run, score }) => {
      const total = computeJudgeTotal(score);
      statements.push({
        query: `INSERT INTO judge_runs
         (id, session_id, judge_index, model_route, rubric_version, anonymous_session_id, packet_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values: [run.id, run.sessionId, run.judgeIndex, run.modelRoute, run.rubricVersion, run.anonymousSessionId, run.packetHash, timestamp],
      });
      statements.push({
        query: `INSERT INTO judge_scores
         (id, judge_run_id, gestalt, verifiable_features, activity_function_event, confabulation_control,
          total, rationale_json, frozen_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        values: [score.id, score.judgeRunId, score.gestalt, score.verifiableFeatures, score.activityFunctionEvent, score.confabulationControl, total, JSON.stringify(score.narrative), timestamp],
      });
      return { ...score, judgeIndex: run.judgeIndex, modelRoute: run.modelRoute, total, frozenAt: timestamp, createdAt: timestamp };
    });
    await this.dependencies.executeTransaction(statements);
    return records;
  }

  async listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]> {
    const rows = await this.dependencies.select<JudgeScoreRow[]>(
      `SELECT s.id, s.judge_run_id, r.judge_index, r.model_route, s.gestalt, s.verifiable_features,
              s.activity_function_event, s.confabulation_control, s.total, s.rationale_json,
              s.frozen_at, s.created_at
         FROM judge_scores s JOIN judge_runs r ON r.id = s.judge_run_id
        WHERE r.session_id = $1 ORDER BY r.judge_index`,
      [sessionId],
    );
    return rows.map((row) => ({
      id: row.id,
      judgeRunId: row.judge_run_id,
      judgeIndex: row.judge_index,
      modelRoute: row.model_route,
      gestalt: row.gestalt,
      verifiableFeatures: row.verifiable_features,
      activityFunctionEvent: row.activity_function_event,
      confabulationControl: row.confabulation_control,
      total: row.total,
      narrative: JSON.parse(row.rationale_json) as JudgeNarrative,
      frozenAt: row.frozen_at,
      createdAt: row.created_at,
    }));
  }
}
