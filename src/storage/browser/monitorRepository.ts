import type { CreateMonitorRunInput, MonitorInterventionInput, MonitorInterventionRecord, MonitorRunRecord } from "../../monitor/types";
import type { RvSession } from "../../sessions/types";
import type { MonitorRepository } from "../contracts/monitorRepository";
import { createId, nowIso } from "../repository";

const MONITOR_RUNS_KEY = "rvh.dev.monitor_runs";
const MONITOR_INTERVENTIONS_KEY = "rvh.dev.monitor_interventions";

type StoredMonitorRun = CreateMonitorRunInput & { id: string; createdAt: string };

export interface BrowserMonitorRepositoryDependencies {
  listRvSessions(workspaceId: string): Promise<RvSession[]>;
  storage?: Storage;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class BrowserMonitorRepository implements MonitorRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserMonitorRepositoryDependencies) {
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

  private write<T>(key: string, value: T): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(prefix: string): string {
    return (this.dependencies.createId ?? createId)(prefix);
  }

  async createMonitorRun(input: CreateMonitorRunInput): Promise<string> {
    const id = this.nextId("monitor");
    const all = this.read<StoredMonitorRun[]>(MONITOR_RUNS_KEY, []);
    this.write(MONITOR_RUNS_KEY, [...all, { ...input, id, createdAt: this.now() }]);
    return id;
  }

  async appendMonitorIntervention(monitorRunId: string, intervention: MonitorInterventionInput): Promise<void> {
    const all = this.read<MonitorInterventionRecord[]>(MONITOR_INTERVENTIONS_KEY, []);
    const sequenceNumber = all.filter((item) => item.monitorRunId === monitorRunId).reduce((max, item) => Math.max(max, item.sequenceNumber), 0) + 1;
    this.write(MONITOR_INTERVENTIONS_KEY, [...all, { ...intervention, id: this.nextId("monitor_event"), monitorRunId, sequenceNumber, createdAt: this.now() }]);
  }

  async listMonitorRuns(workspaceId: string): Promise<MonitorRunRecord[]> {
    const sessions = await this.dependencies.listRvSessions(workspaceId);
    const sessionMap = new Map(sessions.filter((session) => session.workspaceId === workspaceId).map((session) => [session.id, session]));
    const interventions = this.read<MonitorInterventionRecord[]>(MONITOR_INTERVENTIONS_KEY, []);
    return this.read<StoredMonitorRun[]>(MONITOR_RUNS_KEY, [])
      .filter((run) => sessionMap.has(run.sessionId))
      .map((run) => ({ ...run, sessionCode: sessionMap.get(run.sessionId)!.sessionCode, interventionCount: interventions.filter((item) => item.monitorRunId === run.id).length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listMonitorInterventions(monitorRunId: string): Promise<MonitorInterventionRecord[]> {
    return this.read<MonitorInterventionRecord[]>(MONITOR_INTERVENTIONS_KEY, []).filter((item) => item.monitorRunId === monitorRunId).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }
}
