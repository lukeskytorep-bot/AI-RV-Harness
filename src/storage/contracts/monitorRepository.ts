import type { CreateMonitorRunInput, MonitorInterventionInput, MonitorInterventionRecord, MonitorRunRecord } from "../../monitor/types";

/** Internal persistence contract for AI Monitor runs and ordered interventions. */
export interface MonitorRepository {
  createMonitorRun(input: CreateMonitorRunInput): Promise<string>;
  appendMonitorIntervention(monitorRunId: string, intervention: MonitorInterventionInput): Promise<void>;
  listMonitorRuns(workspaceId: string): Promise<MonitorRunRecord[]>;
  listMonitorInterventions(monitorRunId: string): Promise<MonitorInterventionRecord[]>;
}
