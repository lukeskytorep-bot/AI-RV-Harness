export interface CreateMonitorRunInput {
  sessionId: string;
  modelRoute: string;
  promptVersionId?: string;
  libraryVersion: string;
  maxInterventions: number;
}

export interface MonitorInterventionInput {
  decision: "INTERVENE" | "CONTINUE_PROTOCOL";
  commandId?: string;
  viewerEvidence?: string;
  commandText?: string;
  rationale?: string;
}

export interface MonitorRunRecord extends CreateMonitorRunInput {
  id: string;
  sessionCode: string;
  createdAt: string;
  interventionCount: number;
}

export interface MonitorInterventionRecord extends MonitorInterventionInput {
  id: string;
  monitorRunId: string;
  sequenceNumber: number;
  createdAt: string;
}
