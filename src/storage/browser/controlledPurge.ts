import type { AiIdentity, ViewerNoteActivationEvent, ViewerNoteReflectionRun, ViewerNoteSettings, ViewerNoteVersion } from "../../aiCenter/types";
import type { CreateJudgeRunInput, JudgeScoreRecord } from "../../judge/types";
import type { MonitorInterventionRecord } from "../../monitor/types";
import type { ResearchAssignmentRecord, ResearchProjectRecord } from "../../research/types";
import type { RvSession, SessionEventRecord, TargetClarificationRecord } from "../../sessions/types";
import type { TargetRecord, TargetUsageRecord } from "../../targets/types";
import type { TrainingRunRecord } from "../../training/types";
import type { ChatMessage, ChatThread, Profile, Workspace } from "../../types";
import type { WorkspaceSource } from "../../sources/types";
import { emptyDeletionCounts, type DeletionPreview, type PurgeEntityKind } from "../controlledPurge";

const K = {
  profiles: "rvh.dev.profiles",
  workspaces: "rvh.dev.workspaces",
  threads: "rvh.dev.chat_threads",
  messages: "rvh.dev.chat_messages",
  workspaceSources: "rvh.dev.workspace_sources",
  chatSourceSelection: "rvh.dev.chat_source_selection",
  sessions: "rvh.dev.rv_sessions",
  sessionEvents: "rvh.dev.session_events",
  sessionSnapshots: "rvh.dev.session_snapshots",
  reveals: "rvh.dev.reveals",
  targetClarifications: "rvh.dev.target_clarifications",
  monitorRuns: "rvh.dev.monitor_runs",
  monitorInterventions: "rvh.dev.monitor_interventions",
  judgeRuns: "rvh.dev.judge_runs",
  judgeScores: "rvh.dev.judge_scores",
  trainingRuns: "rvh.dev.training_runs",
  researchProjects: "rvh.dev.research_projects",
  researchConditions: "rvh.dev.research_conditions",
  researchAssignments: "rvh.dev.research_assignments",
  blindingMappings: "rvh.dev.blinding_mappings",
  researchResults: "rvh.dev.research_results",
  exports: "rvh.dev.exports",
  targets: "rvh.dev.targets",
  targetUsage: "rvh.dev.target_usage",
  aiIdentities: "rvh.dev.ai_identities",
  aiNoteSettings: "rvh.dev.ai_note_settings",
  aiNoteVersions: "rvh.dev.ai_note_versions",
  aiNoteReflectionRuns: "rvh.dev.ai_note_reflection_runs",
  aiNoteActivationEvents: "rvh.dev.ai_note_activation_events",
} as const;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type IdRecord = { id: string };
type SessionSnapshotRecord = { sessionId: string; snapshot: unknown; hash: string };
type RevealRecord = { sessionId: string; reveal: unknown; acceptedAt: string };
type MonitorRun = { id: string; sessionId: string };
type ResearchOwned = { id: string; researchProjectId: string };
type ResearchResultRecord = { id: string; projectId: string };
type ExportRecord = { id: string; workspaceId: string; researchProjectId?: string };

function read<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function setOf(values: Iterable<string>): Set<string> {
  return new Set(values);
}

function trainingSessionIds(runs: TrainingRunRecord[]): Set<string> {
  return setOf(runs.flatMap((run) => [...(run.sessionIds ?? []), ...(run.activeTargetCheckpoint?.sessionId ? [run.activeTargetCheckpoint.sessionId] : [])]));
}

function terminalResearch(project: ResearchProjectRecord): boolean {
  return ["Complete", "Interrupted", "Failed"].includes(project.state);
}

interface Scope {
  profileIds: Set<string>;
  workspaceIds: Set<string>;
  threadIds: Set<string>;
  sessionIds: Set<string>;
  trainingIds: Set<string>;
  researchIds: Set<string>;
  aiIdentityIds: Set<string>;
  label: string;
  archived: boolean;
  blockedReason?: string;
  requiresPhrase?: string;
  safetyBackupRecommended: boolean;
}

function collections(storage: StorageLike) {
  return {
    profiles: read<Profile[]>(storage, K.profiles, []),
    workspaces: read<Workspace[]>(storage, K.workspaces, []),
    threads: read<ChatThread[]>(storage, K.threads, []),
    messages: read<ChatMessage[]>(storage, K.messages, []),
    workspaceSources: read<WorkspaceSource[]>(storage, K.workspaceSources, []),
    sessions: read<RvSession[]>(storage, K.sessions, []),
    sessionEvents: read<SessionEventRecord[]>(storage, K.sessionEvents, []),
    sessionSnapshots: read<SessionSnapshotRecord[]>(storage, K.sessionSnapshots, []),
    reveals: read<RevealRecord[]>(storage, K.reveals, []),
    targetClarifications: read<TargetClarificationRecord[]>(storage, K.targetClarifications, []),
    monitorRuns: read<MonitorRun[]>(storage, K.monitorRuns, []),
    monitorInterventions: read<MonitorInterventionRecord[]>(storage, K.monitorInterventions, []),
    judgeRuns: read<CreateJudgeRunInput[]>(storage, K.judgeRuns, []),
    judgeScores: read<JudgeScoreRecord[]>(storage, K.judgeScores, []),
    trainingRuns: read<TrainingRunRecord[]>(storage, K.trainingRuns, []),
    researchProjects: read<ResearchProjectRecord[]>(storage, K.researchProjects, []),
    researchConditions: read<ResearchOwned[]>(storage, K.researchConditions, []),
    researchAssignments: read<ResearchAssignmentRecord[]>(storage, K.researchAssignments, []),
    blindingMappings: read<ResearchOwned[]>(storage, K.blindingMappings, []),
    researchResults: read<ResearchResultRecord[]>(storage, K.researchResults, []),
    exports: read<ExportRecord[]>(storage, K.exports, []),
    targets: read<TargetRecord[]>(storage, K.targets, []),
    targetUsage: read<TargetUsageRecord[]>(storage, K.targetUsage, []),
    aiIdentities: read<AiIdentity[]>(storage, K.aiIdentities, []),
    aiNoteSettings: read<ViewerNoteSettings[]>(storage, K.aiNoteSettings, []),
    aiNoteVersions: read<ViewerNoteVersion[]>(storage, K.aiNoteVersions, []),
    aiNoteReflectionRuns: read<ViewerNoteReflectionRun[]>(storage, K.aiNoteReflectionRuns, []),
    aiNoteActivationEvents: read<ViewerNoteActivationEvent[]>(storage, K.aiNoteActivationEvents, []),
  };
}

function collectScope(storage: StorageLike, kind: Exclude<PurgeEntityKind, "target">, id: string): Scope {
  const c = collections(storage);
  const profileIds = new Set<string>();
  const workspaceIds = new Set<string>();
  const threadIds = new Set<string>();
  const sessionIds = new Set<string>();
  const trainingIds = new Set<string>();
  const researchIds = new Set<string>();
  const aiIdentityIds = new Set<string>();
  let label = id;
  let archived = false;
  let blockedReason: string | undefined;
  let requiresPhrase: string | undefined;
  let safetyBackupRecommended = false;

  if (kind === "profile") {
    const profile = c.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profile not found.");
    label = profile.name;
    archived = Boolean(profile.archivedAt);
    profileIds.add(profile.id);
    for (const workspace of c.workspaces.filter((item) => item.profileId === profile.id)) workspaceIds.add(workspace.id);
    safetyBackupRecommended = true;
  } else if (kind === "workspace") {
    const workspace = c.workspaces.find((item) => item.id === id);
    if (!workspace) throw new Error("Workspace not found.");
    label = workspace.name;
    archived = Boolean(workspace.archivedAt);
    workspaceIds.add(workspace.id);
    safetyBackupRecommended = true;
  } else if (kind === "conversation") {
    const thread = c.threads.find((item) => item.id === id);
    if (!thread) throw new Error("Conversation / Manual RV not found.");
    label = thread.title;
    archived = Boolean(thread.archivedAt);
    threadIds.add(thread.id);
  } else if (kind === "rv_session") {
    const session = c.sessions.find((item) => item.id === id);
    if (!session) throw new Error("RV Session not found.");
    label = session.sessionCode;
    archived = Boolean(session.archivedAt);
    if (session.researchProjectId) blockedReason = "Research-owned sessions are deleted with their Research project.";
    const ownedByTraining = c.trainingRuns.some((run) => (run.sessionIds ?? []).includes(id) || run.activeTargetCheckpoint?.sessionId === id);
    if (ownedByTraining) blockedReason = "Training-owned sessions are deleted with their Training run.";
    sessionIds.add(session.id);
  } else if (kind === "training") {
    const run = c.trainingRuns.find((item) => item.id === id);
    if (!run) throw new Error("Training run not found.");
    label = `#${run.runNumber} · ${run.name}`;
    archived = Boolean(run.archivedAt);
    trainingIds.add(run.id);
    for (const sessionId of trainingSessionIds([run])) sessionIds.add(sessionId);
    safetyBackupRecommended = true;
  } else {
    const project = c.researchProjects.find((item) => item.id === id);
    if (!project) throw new Error("Research project not found.");
    label = project.name;
    archived = Boolean(project.archivedAt);
    researchIds.add(project.id);
    for (const session of c.sessions.filter((item) => item.researchProjectId === project.id)) sessionIds.add(session.id);
    safetyBackupRecommended = true;
    if (project.lockedAt || !["Draft", "Preflight"].includes(project.state)) requiresPhrase = "DELETE";
  }

  if (workspaceIds.size) {
    for (const thread of c.threads.filter((item) => workspaceIds.has(item.workspaceId))) threadIds.add(thread.id);
    for (const session of c.sessions.filter((item) => workspaceIds.has(item.workspaceId))) sessionIds.add(session.id);
    for (const run of c.trainingRuns.filter((item) => workspaceIds.has(item.workspaceId))) {
      trainingIds.add(run.id);
      for (const sessionId of trainingSessionIds([run])) sessionIds.add(sessionId);
    }
    for (const project of c.researchProjects.filter((item) => workspaceIds.has(item.workspaceId))) {
      researchIds.add(project.id);
      for (const session of c.sessions.filter((item) => item.researchProjectId === project.id)) sessionIds.add(session.id);
    }
  }

  if (profileIds.size) {
    for (const identity of c.aiIdentities.filter((item) => profileIds.has(item.profileId))) aiIdentityIds.add(identity.id);
  }

  return { profileIds, workspaceIds, threadIds, sessionIds, trainingIds, researchIds, aiIdentityIds, label, archived, blockedReason, requiresPhrase, safetyBackupRecommended };
}

function targetBlockReason(c: ReturnType<typeof collections>, targetId: string): string | undefined {
  const unfinishedTraining = c.trainingRuns.find((run) => run.status !== "Completed" && run.targetIds.includes(targetId));
  if (unfinishedTraining) return `Target is still required by unfinished Training #${unfinishedTraining.runNumber}.`;
  const unfinishedResearch = c.researchProjects.find((project) => !terminalResearch(project) && project.config.targetIds.includes(targetId));
  if (unfinishedResearch) return `Target is still required by unfinished Research “${unfinishedResearch.name}”.`;
  return undefined;
}

function previewTarget(storage: StorageLike, id: string): DeletionPreview {
  const c = collections(storage);
  const target = c.targets.find((item) => item.id === id);
  if (!target) throw new Error("Target not found.");
  const counts = emptyDeletionCounts();
  const archived = Boolean(target.archivedAt);
  const blockedReason = target.collection !== "user" ? "Factory Training Targets are immutable and cannot be deleted." : targetBlockReason(c, id);
  counts.userTargets = 1;
  return {
    kind: "target", id, label: target.title, archived, blockedReason,
    safetyBackupRecommended: false, viewerNotesPreserved: 0, viewerNotesDeleted: 0, counts,
  };
}

export function previewBrowserPermanentDelete(storage: StorageLike, kind: PurgeEntityKind, id: string): DeletionPreview {
  if (kind === "target") return previewTarget(storage, id);
  const c = collections(storage);
  const scope = collectScope(storage, kind, id);
  const counts = emptyDeletionCounts();
  const monitorRunIds = setOf(c.monitorRuns.filter((item) => scope.sessionIds.has(item.sessionId)).map((item) => item.id));
  const judgeRunIds = setOf(c.judgeRuns.filter((item) => scope.sessionIds.has(item.sessionId)).map((item) => item.id));

  counts.profiles = c.profiles.filter((item) => scope.profileIds.has(item.id)).length;
  counts.workspaces = c.workspaces.filter((item) => scope.workspaceIds.has(item.id)).length;
  counts.conversations = c.threads.filter((item) => scope.threadIds.has(item.id)).length;
  counts.messages = c.messages.filter((item) => scope.threadIds.has(item.threadId)).length;
  counts.rvSessions = c.sessions.filter((item) => scope.sessionIds.has(item.id)).length;
  counts.sessionEvents = c.sessionEvents.filter((item) => scope.sessionIds.has(item.sessionId)).length;
  counts.snapshots = c.sessionSnapshots.filter((item) => scope.sessionIds.has(item.sessionId)).length;
  counts.reveals = c.reveals.filter((item) => scope.sessionIds.has(item.sessionId)).length;
  counts.targetClarifications = c.targetClarifications.filter((item) => scope.sessionIds.has(item.sessionId)).length;
  counts.monitorRuns = monitorRunIds.size;
  counts.monitorInterventions = c.monitorInterventions.filter((item) => monitorRunIds.has(item.monitorRunId)).length;
  counts.judgeRuns = judgeRunIds.size;
  counts.judgeScores = c.judgeScores.filter((item) => judgeRunIds.has(item.judgeRunId)).length;
  counts.trainingRuns = c.trainingRuns.filter((item) => scope.trainingIds.has(item.id)).length;
  counts.researchProjects = c.researchProjects.filter((item) => scope.researchIds.has(item.id)).length;
  counts.researchConditions = c.researchConditions.filter((item) => scope.researchIds.has(item.researchProjectId)).length;
  counts.researchAssignments = c.researchAssignments.filter((item) => scope.researchIds.has(item.researchProjectId)).length;
  counts.blindingMappings = c.blindingMappings.filter((item) => scope.researchIds.has(item.researchProjectId)).length;
  counts.researchResults = c.researchResults.filter((item) => scope.researchIds.has(item.projectId)).length;
  counts.exports = c.exports.filter((item) => scope.workspaceIds.has(item.workspaceId) || Boolean(item.researchProjectId && scope.researchIds.has(item.researchProjectId))).length;
  counts.workspaceSources = c.workspaceSources.filter((item) => scope.workspaceIds.has(item.workspaceId)).length;
  counts.viewerNoteIdentities = c.aiIdentities.filter((item) => scope.aiIdentityIds.has(item.id)).length;
  counts.viewerNoteVersions = c.aiNoteVersions.filter((item) => scope.aiIdentityIds.has(item.aiIdentityId)).length;
  counts.viewerNoteReflectionRuns = c.aiNoteReflectionRuns.filter((item) => scope.aiIdentityIds.has(item.aiIdentityId)).length;
  counts.viewerNoteActivationEvents = c.aiNoteActivationEvents.filter((item) => scope.aiIdentityIds.has(item.aiIdentityId)).length;

  const preservedVersionIds = c.aiNoteVersions.filter((item) => !scope.aiIdentityIds.has(item.aiIdentityId)
    && (Boolean(item.sourceSessionId && scope.sessionIds.has(item.sourceSessionId)) || Boolean(item.sourceWorkspaceId && scope.workspaceIds.has(item.sourceWorkspaceId))));

  return {
    kind, id, label: scope.label, archived: scope.archived,
    blockedReason: scope.blockedReason,
    requiresPhrase: scope.requiresPhrase,
    safetyBackupRecommended: scope.safetyBackupRecommended,
    viewerNotesPreserved: preservedVersionIds.length,
    viewerNotesDeleted: counts.viewerNoteVersions,
    counts,
  };
}

function assertDeletable(preview: DeletionPreview): void {
  if (!preview.archived) throw new Error("Permanent Delete is available only for archived records.");
  if (preview.blockedReason) throw new Error(preview.blockedReason);
}

function atomicWrite(storage: StorageLike, changes: Map<string, unknown>): void {
  const previous = new Map<string, string | null>();
  for (const key of changes.keys()) previous.set(key, storage.getItem(key));
  try {
    for (const [key, value] of changes) storage.setItem(key, JSON.stringify(value));
  } catch (cause) {
    for (const [key, value] of previous) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    throw cause;
  }
}

export function purgeBrowserPermanentDelete(storage: StorageLike, kind: PurgeEntityKind, id: string): void {
  const preview = previewBrowserPermanentDelete(storage, kind, id);
  assertDeletable(preview);
  const c = collections(storage);

  if (kind === "target") {
    const changes = new Map<string, unknown>();
    changes.set(K.targets, c.targets.filter((item) => item.id !== id));
    changes.set(K.targetUsage, c.targetUsage.filter((item) => item.targetId !== id));
    atomicWrite(storage, changes);
    return;
  }

  const scope = collectScope(storage, kind, id);
  const monitorRunIds = setOf(c.monitorRuns.filter((item) => scope.sessionIds.has(item.sessionId)).map((item) => item.id));
  const judgeRunIds = setOf(c.judgeRuns.filter((item) => scope.sessionIds.has(item.sessionId)).map((item) => item.id));
  const deletedSourceIds = setOf(c.workspaceSources.filter((item) => scope.workspaceIds.has(item.workspaceId)).map((item) => item.id));
  const selection = read<Record<string, string[]>>(storage, K.chatSourceSelection, {});
  const nextSelection: Record<string, string[]> = {};
  for (const [threadId, sourceIds] of Object.entries(selection)) {
    if (scope.threadIds.has(threadId)) continue;
    nextSelection[threadId] = sourceIds.filter((sourceId) => !deletedSourceIds.has(sourceId));
  }

  const retainedVersions = c.aiNoteVersions
    .filter((item) => !scope.aiIdentityIds.has(item.aiIdentityId))
    .map((item) => ({ ...item,
      ...(item.sourceSessionId && scope.sessionIds.has(item.sourceSessionId) ? { sourceSessionId: undefined } : {}),
      ...(item.sourceWorkspaceId && scope.workspaceIds.has(item.sourceWorkspaceId) ? { sourceWorkspaceId: undefined } : {}),
    }));
  const retainedRuns = c.aiNoteReflectionRuns
    .filter((item) => !scope.aiIdentityIds.has(item.aiIdentityId))
    .map((item) => ({ ...item,
      ...(item.sourceSessionId && scope.sessionIds.has(item.sourceSessionId) ? { sourceSessionId: undefined } : {}),
      ...(item.sourceWorkspaceId && scope.workspaceIds.has(item.sourceWorkspaceId) ? { sourceWorkspaceId: undefined } : {}),
    }));
  const retainedActivations = c.aiNoteActivationEvents
    .filter((item) => !scope.aiIdentityIds.has(item.aiIdentityId))
    .map((item) => ({ ...item,
      ...(item.sourceSessionId && scope.sessionIds.has(item.sourceSessionId) ? { sourceSessionId: undefined } : {}),
      ...(item.workspaceId && scope.workspaceIds.has(item.workspaceId) ? { workspaceId: undefined } : {}),
    }));

  const changes = new Map<string, unknown>();
  changes.set(K.profiles, c.profiles.filter((item) => !scope.profileIds.has(item.id)));
  changes.set(K.workspaces, c.workspaces.filter((item) => !scope.workspaceIds.has(item.id)));
  changes.set(K.threads, c.threads.filter((item) => !scope.threadIds.has(item.id)));
  changes.set(K.messages, c.messages.filter((item) => !scope.threadIds.has(item.threadId)));
  changes.set(K.workspaceSources, c.workspaceSources.filter((item) => !scope.workspaceIds.has(item.workspaceId)));
  changes.set(K.chatSourceSelection, nextSelection);
  changes.set(K.sessions, c.sessions.filter((item) => !scope.sessionIds.has(item.id)));
  changes.set(K.sessionEvents, c.sessionEvents.filter((item) => !scope.sessionIds.has(item.sessionId)));
  changes.set(K.sessionSnapshots, c.sessionSnapshots.filter((item) => !scope.sessionIds.has(item.sessionId)));
  changes.set(K.reveals, c.reveals.filter((item) => !scope.sessionIds.has(item.sessionId)));
  changes.set(K.targetClarifications, c.targetClarifications.filter((item) => !scope.sessionIds.has(item.sessionId)));
  changes.set(K.monitorRuns, c.monitorRuns.filter((item) => !monitorRunIds.has(item.id)));
  changes.set(K.monitorInterventions, c.monitorInterventions.filter((item) => !monitorRunIds.has(item.monitorRunId)));
  changes.set(K.judgeRuns, c.judgeRuns.filter((item) => !judgeRunIds.has(item.id)));
  changes.set(K.judgeScores, c.judgeScores.filter((item) => !judgeRunIds.has(item.judgeRunId)));
  changes.set(K.trainingRuns, c.trainingRuns.filter((item) => !scope.trainingIds.has(item.id)));
  changes.set(K.researchProjects, c.researchProjects.filter((item) => !scope.researchIds.has(item.id)));
  changes.set(K.researchConditions, c.researchConditions.filter((item) => !scope.researchIds.has(item.researchProjectId)));
  changes.set(K.researchAssignments, c.researchAssignments.filter((item) => !scope.researchIds.has(item.researchProjectId)));
  changes.set(K.blindingMappings, c.blindingMappings.filter((item) => !scope.researchIds.has(item.researchProjectId)));
  changes.set(K.researchResults, c.researchResults.filter((item) => !scope.researchIds.has(item.projectId)));
  changes.set(K.exports, c.exports.filter((item) => !scope.workspaceIds.has(item.workspaceId) && !(item.researchProjectId && scope.researchIds.has(item.researchProjectId))));
  changes.set(K.targetUsage, c.targetUsage.filter((item) => !scope.profileIds.has(item.profileId ?? "") && !scope.sessionIds.has(item.sessionId ?? "") && !scope.researchIds.has(item.researchProjectId ?? "")));
  changes.set(K.aiIdentities, c.aiIdentities.filter((item) => !scope.aiIdentityIds.has(item.id)));
  changes.set(K.aiNoteSettings, c.aiNoteSettings.filter((item) => !scope.aiIdentityIds.has(item.aiIdentityId)));
  changes.set(K.aiNoteVersions, retainedVersions);
  changes.set(K.aiNoteReflectionRuns, retainedRuns);
  changes.set(K.aiNoteActivationEvents, retainedActivations);
  atomicWrite(storage, changes);
}
