import type { CreateJudgeRunInput, FrozenJudgeResultInput, FrozenJudgeScoreInput, JudgeScoreRecord } from "../../judge/types";
import { computeJudgeTotal } from "../../domain/scoring";
import type { JudgeRepository } from "../contracts/judgeRepository";
import { nowIso } from "../repository";

const JUDGE_RUNS_KEY = "rvh.dev.judge_runs";
const JUDGE_SCORES_KEY = "rvh.dev.judge_scores";

type JudgeStorage = Pick<Storage, "getItem" | "setItem">;

export interface BrowserJudgeRepositoryDependencies {
  storage?: JudgeStorage;
  now?: typeof nowIso;
}

export class BrowserJudgeRepository implements JudgeRepository {
  constructor(private readonly dependencies: BrowserJudgeRepositoryDependencies = {}) {}

  private get storage(): JudgeStorage {
    return this.dependencies.storage ?? localStorage;
  }

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write<T>(key: string, value: T): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async recordFrozenJudgeResult(run: CreateJudgeRunInput, score: FrozenJudgeScoreInput): Promise<JudgeScoreRecord> {
    return (await this.recordFrozenJudgeResults([{ run, score }]))[0];
  }

  async recordFrozenJudgeResults(results: FrozenJudgeResultInput[]): Promise<JudgeScoreRecord[]> {
    if (!results.length) return [];
    const runs = this.read<CreateJudgeRunInput[]>(JUDGE_RUNS_KEY, []);
    const seen = new Set(runs.map((item) => `${item.sessionId}::${item.judgeIndex}`));
    for (const { run } of results) {
      const key = `${run.sessionId}::${run.judgeIndex}`;
      if (seen.has(key)) throw new Error("Judge index is already recorded for this session.");
      seen.add(key);
    }
    const timestamp = this.now();
    const records = results.map(({ run, score }) => ({
      ...score,
      judgeIndex: run.judgeIndex,
      modelRoute: run.modelRoute,
      total: computeJudgeTotal(score),
      frozenAt: timestamp,
      createdAt: timestamp,
    }));
    this.write(JUDGE_RUNS_KEY, [...runs, ...results.map(({ run }) => structuredClone(run))]);
    this.write(JUDGE_SCORES_KEY, [...this.read<JudgeScoreRecord[]>(JUDGE_SCORES_KEY, []), ...structuredClone(records)]);
    return records;
  }

  async listJudgeScores(sessionId: string): Promise<JudgeScoreRecord[]> {
    const runIds = new Set(this.read<CreateJudgeRunInput[]>(JUDGE_RUNS_KEY, []).filter((run) => run.sessionId === sessionId).map((run) => run.id));
    return this.read<JudgeScoreRecord[]>(JUDGE_SCORES_KEY, []).filter((score) => runIds.has(score.judgeRunId)).sort((a, b) => a.judgeIndex - b.judgeIndex);
  }
}
