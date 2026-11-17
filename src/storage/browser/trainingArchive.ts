import { planTrainingArchive } from "../../application/trainingArchive";
import type { TrainingRunRecord } from "../../training/types";
import type { RvSession } from "../../sessions/types";
import type { Profile, Workspace } from "../../types";

const RUNS = "rvh.dev.training_runs";
const SESSIONS = "rvh.dev.rv_sessions";
const JOURNAL = "rvh.dev.training_archive_journal";
interface Journal { runs: string; sessions: string }

/** Redo journal. Each localStorage write is atomic, while the pair is recoverable. */
export function recoverBrowserTrainingArchive(storage: Storage): void {
  const pending = storage.getItem(JOURNAL);
  if (pending === null) return;
  const record = JSON.parse(pending) as Journal;
  if (typeof record.runs !== "string" || typeof record.sessions !== "string"
    || !Array.isArray(JSON.parse(record.runs)) || !Array.isArray(JSON.parse(record.sessions))) {
    throw new Error("Invalid Training archive recovery journal.");
  }
  storage.setItem(SESSIONS, record.sessions);
  storage.setItem(RUNS, record.runs);
  storage.removeItem(JOURNAL);
}

export async function changeBrowserTrainingArchive(storage: Storage, id: string, restore: boolean): Promise<void> {
  // There is no await between reading, planning and writing. Web Locks provide
  // cross-tab exclusion when available. Recovery runs before further mutations.
  const change = () => {
    recoverBrowserTrainingArchive(storage);
    const runs = JSON.parse(storage.getItem(RUNS) ?? "[]") as TrainingRunRecord[];
    const sessions = JSON.parse(storage.getItem(SESSIONS) ?? "[]") as RvSession[];
    const run = runs.find(run => run.id === id);
    if (!run) throw new Error(restore ? "Archived Training run not found." : "Active Training run not found.");
    const profiles = JSON.parse(storage.getItem("rvh.dev.profiles") ?? "[]") as Profile[];
    const workspaces = JSON.parse(storage.getItem("rvh.dev.workspaces") ?? "[]") as Workspace[];
    if (restore && (!profiles.some(profile => profile.id === run.profileId && !profile.archivedAt)
      || !workspaces.some(workspace => workspace.id === run.workspaceId && workspace.profileId === run.profileId && !workspace.archivedAt))) {
      throw new Error("Restore the parent Profile and Workspace first.");
    }
    const plan = planTrainingArchive(run, sessions, restore, new Date().toISOString());
    const changes = new Map(plan.sessions.map(session => [session.id, session]));
    const nextSessions = sessions.map(session => {
      const change = changes.get(session.id);
      return change ? { ...session, archivedAt: change.archivedAt ?? undefined, updatedAt: plan.nextRun.updatedAt } : session;
    });
    const journal: Journal = {
      runs: JSON.stringify(runs.map(item => item.id === id ? plan.nextRun : item)),
      sessions: JSON.stringify(nextSessions),
    };
    storage.setItem(JOURNAL, JSON.stringify(journal));
    recoverBrowserTrainingArchive(storage);
  };
  if (navigator.locks) await navigator.locks.request("rvh.training.archive", change);
  else change();
}
