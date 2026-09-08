import type { CreateMonitorRunInput, MonitorInterventionInput, MonitorInterventionRecord, MonitorRunRecord } from "../../monitor/types";
import type { MonitorRepository } from "../contracts/monitorRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };

export interface SqliteMonitorRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  now?: typeof nowIso;
  createId?: typeof createId;
}

export class SqliteMonitorRepository implements MonitorRepository {
  constructor(private readonly dependencies: SqliteMonitorRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  private nextId(prefix: string): string {
    return (this.dependencies.createId ?? createId)(prefix);
  }

  async createMonitorRun(input: CreateMonitorRunInput): Promise<string> {
    const id = this.nextId("monitor");
    await this.dependencies.executeWrite(
      `INSERT INTO monitor_runs (id, session_id, model_route, prompt_version_id, library_version, max_interventions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.sessionId, input.modelRoute, input.promptVersionId ?? null, input.libraryVersion, input.maxInterventions, this.now()],
    );
    return id;
  }

  async appendMonitorIntervention(monitorRunId: string, intervention: MonitorInterventionInput): Promise<void> {
    await this.dependencies.executeWrite(
      `INSERT INTO monitor_interventions
       (id, monitor_run_id, sequence_number, decision, command_id, viewer_evidence, command_text, rationale, created_at)
       SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7, $8
         FROM monitor_interventions WHERE monitor_run_id = $2`,
      [this.nextId("monitor_event"), monitorRunId, intervention.decision, intervention.commandId ?? null, intervention.viewerEvidence ?? null, intervention.commandText ?? null, intervention.rationale ?? null, this.now()],
    );
  }

  async listMonitorRuns(workspaceId: string): Promise<MonitorRunRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; session_id: string; session_code: string; model_route: string; prompt_version_id: string | null; library_version: string; max_interventions: number; created_at: string; intervention_count: number }>>(
      `SELECT mr.id, mr.session_id, s.session_code, mr.model_route, mr.prompt_version_id, mr.library_version,
              mr.max_interventions, mr.created_at, COUNT(mi.id) AS intervention_count
         FROM monitor_runs mr JOIN rv_sessions s ON s.id = mr.session_id
         LEFT JOIN monitor_interventions mi ON mi.monitor_run_id = mr.id
        WHERE s.workspace_id = $1
        GROUP BY mr.id, mr.session_id, s.session_code, mr.model_route, mr.prompt_version_id, mr.library_version, mr.max_interventions, mr.created_at
        ORDER BY mr.created_at DESC`, [workspaceId],
    );
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, sessionCode: row.session_code, modelRoute: row.model_route, promptVersionId: row.prompt_version_id ?? undefined, libraryVersion: row.library_version, maxInterventions: row.max_interventions, createdAt: row.created_at, interventionCount: Number(row.intervention_count) }));
  }

  async listMonitorInterventions(monitorRunId: string): Promise<MonitorInterventionRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; monitor_run_id: string; sequence_number: number; decision: "INTERVENE" | "CONTINUE_PROTOCOL"; command_id: string | null; viewer_evidence: string | null; command_text: string | null; rationale: string | null; created_at: string }>>(
      `SELECT id, monitor_run_id, sequence_number, decision, command_id, viewer_evidence, command_text, rationale, created_at
         FROM monitor_interventions WHERE monitor_run_id = $1 ORDER BY sequence_number`, [monitorRunId],
    );
    return rows.map((row) => ({ id: row.id, monitorRunId: row.monitor_run_id, sequenceNumber: row.sequence_number, decision: row.decision, commandId: row.command_id ?? undefined, viewerEvidence: row.viewer_evidence ?? undefined, commandText: row.command_text ?? undefined, rationale: row.rationale ?? undefined, createdAt: row.created_at }));
  }
}
