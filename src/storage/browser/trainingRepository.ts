import type { CreateTrainingRunInput, TrainingRunRecord, UpdateTrainingRunInput } from "../../training/types";
import type { Profile, Workspace } from "../../types";
import type { TrainingRepository } from "../contracts/trainingRepository";
import { createId, nowIso } from "../repository";

const TRAINING_RUNS_KEY = "rvh.dev.training_runs";
const PROFILES_KEY = "rvh.dev.profiles";
const WORKSPACES_KEY = "rvh.dev.workspaces";

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

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
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

  private normalize(run: TrainingRunRecord): TrainingRunRecord {
    return { ...run, sessionIds: run.sessionIds ?? [] };
  }

  async createTrainingRun(input: CreateTrainingRunInput): Promise<TrainingRunRecord> {
    const all = this.read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []);
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
    const all = this.read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []);
    const current = all.find((run) => run.id === id && !run.archivedAt);
    if (!current) throw new Error("Active Training run not found.");
    this.write(all.map((run) => run.id === id
      ? { ...run, ...input, errors: input.error ? [...run.errors, input.error] : run.errors, updatedAt: this.now() }
      : run));
  }

  async listTrainingRuns(): Promise<TrainingRunRecord[]> {
    return this.read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, [])
      .filter((run) => !run.archivedAt)
      .map((run) => this.normalize(run))
      .sort((a, b) => b.runNumber - a.runNumber);
  }

  async listArchivedTrainingRuns(): Promise<TrainingRunRecord[]> {
    return this.read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, [])
      .filter((run) => Boolean(run.archivedAt))
      .map((run) => this.normalize(run))
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || b.runNumber - a.runNumber);
  }

  async archiveTrainingRun(id: string): Promise<void> {
    const all = this.read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []);
    const run = all.find((item) => item.id === id && !item.archivedAt);
    if (!run) throw new Error("Active Training run not found.");
    const timestamp = this.now();
    this.write(all.map((item) => item.id === id ? { ...item, archivedAt: timestamp, updatedAt: timestamp } : item));
  }

  async restoreTrainingRun(id: string): Promise<void> {
    const all = this.read<TrainingRunRecord[]>(TRAINING_RUNS_KEY, []);
    const run = all.find((item) => item.id === id && item.archivedAt);
    if (!run) throw new Error("Archived Training run not found.");
    const workspace = this.read<Workspace[]>(WORKSPACES_KEY, []).find((item) => item.id === run.workspaceId && !item.archivedAt);
    const profile = this.read<Profile[]>(PROFILES_KEY, []).find((item) => item.id === run.profileId && !item.archivedAt);
    if (!workspace || workspace.profileId !== run.profileId || !profile) throw new Error("Restore the parent Profile and Workspace first.");
    const timestamp = this.now();
    this.write(all.map((item) => item.id === id ? { ...item, archivedAt: undefined, updatedAt: timestamp } : item));
  }
}
