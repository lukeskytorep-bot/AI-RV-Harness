import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../../training/types";
import type { TrainingRepository } from "../contracts/trainingRepository";
import { createId, nowIso } from "../repository";

const TRAINING_RUNS_KEY = "rvh.dev.training_runs";

export interface BrowserTrainingRepositoryDependencies {
  storage?: Storage;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class BrowserTrainingRepository implements TrainingRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserTrainingRepositoryDependencies = {}) {
    this.storage = dependencies.storage ?? localStorage;
  }

  private read<T>(fallback: T): T {
    try {
      const raw = this.storage.getItem(TRAINING_RUNS_KEY);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write(value: TrainingRunRecord[]): void {
    this.storage.setItem(TRAINING_RUNS_KEY, JSON.stringify(value));
  }

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(): string {
    return (this.dependencies.createId ?? createId)("training");
  }

  async createTrainingRun(input: CreateTrainingRunInput): Promise<TrainingRunRecord> {
    const all = this.read<TrainingRunRecord[]>([]);
    const timestamp = this.now();
    const run: TrainingRunRecord = {
      ...input,
      id: this.nextId(),
      runNumber: Math.max(0, ...all.map((item) => item.runNumber)) + 1,
      completedTargetIds: [],
      sessionIds: [],
      currentIndex: 0,
      errors: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.write([run, ...all]);
    return run;
  }

  async updateTrainingRun(id: string, input: UpdateTrainingRunInput): Promise<void> {
    this.write(this.read<TrainingRunRecord[]>([]).map((run) =>
      run.id === id
        ? { ...run, ...input, errors: input.error ? [...run.errors, input.error] : run.errors, updatedAt: this.now() }
        : run,
    ));
  }

  async listTrainingRuns(): Promise<TrainingRunRecord[]> {
    return this.read<TrainingRunRecord[]>([])
      .map((run) => ({ ...run, sessionIds: run.sessionIds ?? [] }))
      .sort((a, b) => b.runNumber - a.runNumber);
  }
}
