import type { TrainingRunRecord } from "../training/types";
import type { RvSession } from "../sessions/types";

export interface TrainingArchivePlan {
  id: string;
  profileId: string;
  workspaceId: string;
  restore: boolean;
  expectedRun: TrainingRunRecord;
  nextRun: TrainingRunRecord;
  sessions: Array<{ id: string; expectedArchivedAt: string | null; archivedAt: string | null }>;
}

/** Only sessions archived by this run's latest archive are eligible for restore. */
export function planTrainingArchive(
  run: TrainingRunRecord, sessions: readonly RvSession[], restore: boolean, timestamp: string,
): TrainingArchivePlan {
  if (restore !== Boolean(run.archivedAt)) throw new Error(restore ? "Archived Training run not found." : "Active Training run not found.");
  const ids = new Set([...(run.sessionIds ?? []), ...(run.activeTargetCheckpoint?.sessionId ? [run.activeTargetCheckpoint.sessionId] : [])]);
  const previous = new Set(run.archivedSessionIds ?? []);
  const changes: TrainingArchivePlan["sessions"] = [];
  for (const session of sessions) {
    if (!ids.has(session.id)) continue;
    if (session.profileId !== run.profileId || session.workspaceId !== run.workspaceId || session.researchProjectId) {
      throw new Error("Training session ownership does not match its run.");
    }
    if (restore ? previous.has(session.id) && session.archivedAt === run.archivedAt : !session.archivedAt) {
      changes.push({ id: session.id, expectedArchivedAt: session.archivedAt ?? null, archivedAt: restore ? null : timestamp });
    }
  }
  return {
    id: run.id, profileId: run.profileId, workspaceId: run.workspaceId, restore, expectedRun: run,
    nextRun: { ...run, updatedAt: timestamp, archivedAt: restore ? undefined : timestamp,
      archivedSessionIds: restore ? undefined : changes.map(session => session.id) },
    sessions: changes,
  };
}
