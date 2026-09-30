export type PurgeEntityKind =
  | "profile"
  | "workspace"
  | "conversation"
  | "rv_session"
  | "training"
  | "research"
  | "target";

export interface DeletionPreview {
  kind: PurgeEntityKind;
  id: string;
  label: string;
  archived: boolean;
  blockedReason?: string;
  requiresPhrase?: string;
  safetyBackupRecommended: boolean;
  viewerNotesPreserved: number;
  viewerNotesDeleted: number;
  counts: {
    profiles: number;
    workspaces: number;
    conversations: number;
    messages: number;
    rvSessions: number;
    sessionEvents: number;
    snapshots: number;
    reveals: number;
    targetClarifications: number;
    monitorRuns: number;
    monitorInterventions: number;
    judgeRuns: number;
    judgeScores: number;
    trainingRuns: number;
    researchProjects: number;
    researchConditions: number;
    researchAssignments: number;
    blindingMappings: number;
    researchResults: number;
    exports: number;
    workspaceSources: number;
    userTargets: number;
    viewerNoteIdentities: number;
    viewerNoteVersions: number;
    viewerNoteReflectionRuns: number;
    viewerNoteActivationEvents: number;
  };
}

export function emptyDeletionCounts(): DeletionPreview["counts"] {
  return {
    profiles: 0,
    workspaces: 0,
    conversations: 0,
    messages: 0,
    rvSessions: 0,
    sessionEvents: 0,
    snapshots: 0,
    reveals: 0,
    targetClarifications: 0,
    monitorRuns: 0,
    monitorInterventions: 0,
    judgeRuns: 0,
    judgeScores: 0,
    trainingRuns: 0,
    researchProjects: 0,
    researchConditions: 0,
    researchAssignments: 0,
    blindingMappings: 0,
    researchResults: 0,
    exports: 0,
    workspaceSources: 0,
    userTargets: 0,
    viewerNoteIdentities: 0,
    viewerNoteVersions: 0,
    viewerNoteReflectionRuns: 0,
    viewerNoteActivationEvents: 0,
  };
}
