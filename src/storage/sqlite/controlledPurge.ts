import type { ResearchProjectRecord } from "../../research/types";
import type { TrainingRunRecord } from "../../training/types";
import { emptyDeletionCounts, type DeletionPreview, type PurgeEntityKind } from "../controlledPurge";
import type { DatabaseTransactionStatement } from "../databaseNative";

export interface SqliteControlledPurgeDependencies {
  select<T>(query: string, values?: unknown[]): Promise<T>;
  executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>;
}

type ProfileRow = { id: string; display_name: string; archived_at: string | null };
type WorkspaceRow = { id: string; profile_id: string; name: string; archived_at: string | null };
type ThreadRow = { id: string; workspace_id: string; title: string; archived_at: string | null };
type SessionRow = { id: string; workspace_id: string; profile_id: string; session_code: string; research_project_id: string | null; archived_at: string | null };
type TrainingRow = { id: string; record_json: string; archived_at: string | null };
type ResearchRow = { id: string; workspace_id: string; name: string; state: ResearchProjectRecord["state"]; config_json: string; locked_at: string | null; archived_at: string | null };
type TargetRow = { id: string; collection: "training" | "user"; title: string; archived_at: string | null };
type CountRow = { n: number };

interface Scope {
  label: string;
  archived: boolean;
  blockedReason?: string;
  requiresPhrase?: string;
  safetyBackupRecommended: boolean;
  profileIds: Set<string>;
  workspaceIds: Set<string>;
  threadIds: Set<string>;
  sessionIds: Set<string>;
  trainingIds: Set<string>;
  researchIds: Set<string>;
  aiIdentityIds: Set<string>;
}

function placeholders(size: number): string {
  return Array.from({ length: size }, (_, index) => `$${index + 1}`).join(", ");
}

function valuesOf(set: Set<string>): string[] {
  return [...set];
}

function sessionIdsForTraining(run: TrainingRunRecord): string[] {
  return [...new Set([...(run.sessionIds ?? []), ...(run.activeTargetCheckpoint?.sessionId ? [run.activeTargetCheckpoint.sessionId] : [])])];
}

function terminalResearch(state: ResearchProjectRecord["state"]): boolean {
  return ["Complete", "Interrupted", "Failed"].includes(state);
}

export class SqliteControlledPurge {
  constructor(private readonly dependencies: SqliteControlledPurgeDependencies) {}

  private async countIn(table: string, column: string, ids: Set<string>): Promise<number> {
    if (!ids.size) return 0;
    const values = valuesOf(ids);
    const rows = await this.dependencies.select<CountRow[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IN (${placeholders(values.length)})`, values);
    return Number(rows[0]?.n ?? 0);
  }

  private async allTrainingRows(): Promise<TrainingRow[]> {
    return this.dependencies.select<TrainingRow[]>("SELECT id, record_json, archived_at FROM training_runs");
  }

  private async allResearchRows(): Promise<ResearchRow[]> {
    return this.dependencies.select<ResearchRow[]>("SELECT id, workspace_id, name, state, config_json, locked_at, archived_at FROM research_projects");
  }

  private async collectScope(kind: Exclude<PurgeEntityKind, "target">, id: string): Promise<Scope> {
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

    const trainingRows = await this.allTrainingRows();
    const parsedTraining = trainingRows.map((row) => ({ row, run: JSON.parse(row.record_json) as TrainingRunRecord }));
    const researchRows = await this.allResearchRows();

    if (kind === "profile") {
      const profile = (await this.dependencies.select<ProfileRow[]>("SELECT id, display_name, archived_at FROM profiles WHERE id = $1", [id]))[0];
      if (!profile) throw new Error("Profile not found.");
      label = profile.display_name;
      archived = Boolean(profile.archived_at);
      profileIds.add(id);
      const workspaces = await this.dependencies.select<WorkspaceRow[]>("SELECT id, profile_id, name, archived_at FROM workspaces WHERE profile_id = $1", [id]);
      workspaces.forEach((row) => workspaceIds.add(row.id));
      parsedTraining.filter(({ run }) => run.profileId === id || workspaceIds.has(run.workspaceId)).forEach(({ row, run }) => {
        trainingIds.add(row.id);
        sessionIdsForTraining(run).forEach((sessionId) => sessionIds.add(sessionId));
      });
      researchRows.filter((row) => workspaceIds.has(row.workspace_id)).forEach((row) => researchIds.add(row.id));
      const identities = await this.dependencies.select<Array<{ id: string }>>("SELECT id FROM ai_identities WHERE profile_id = $1", [id]);
      identities.forEach((row) => aiIdentityIds.add(row.id));
      safetyBackupRecommended = true;
    } else if (kind === "workspace") {
      const workspace = (await this.dependencies.select<WorkspaceRow[]>("SELECT id, profile_id, name, archived_at FROM workspaces WHERE id = $1", [id]))[0];
      if (!workspace) throw new Error("Workspace not found.");
      label = workspace.name;
      archived = Boolean(workspace.archived_at);
      workspaceIds.add(id);
      parsedTraining.filter(({ run }) => run.workspaceId === id).forEach(({ row, run }) => {
        trainingIds.add(row.id);
        sessionIdsForTraining(run).forEach((sessionId) => sessionIds.add(sessionId));
      });
      researchRows.filter((row) => row.workspace_id === id).forEach((row) => researchIds.add(row.id));
      safetyBackupRecommended = true;
    } else if (kind === "conversation") {
      const thread = (await this.dependencies.select<ThreadRow[]>("SELECT id, workspace_id, title, archived_at FROM chat_threads WHERE id = $1", [id]))[0];
      if (!thread) throw new Error("Conversation / Manual RV not found.");
      label = thread.title;
      archived = Boolean(thread.archived_at);
      threadIds.add(id);
    } else if (kind === "rv_session") {
      const session = (await this.dependencies.select<SessionRow[]>("SELECT id, workspace_id, profile_id, session_code, research_project_id, archived_at FROM rv_sessions WHERE id = $1", [id]))[0];
      if (!session) throw new Error("RV Session not found.");
      label = session.session_code;
      archived = Boolean(session.archived_at);
      sessionIds.add(id);
      if (session.research_project_id) blockedReason = "Research-owned sessions are deleted with their Research project.";
      if (parsedTraining.some(({ run }) => sessionIdsForTraining(run).includes(id))) blockedReason = "Training-owned sessions are deleted with their Training run.";
    } else if (kind === "training") {
      const match = parsedTraining.find(({ row }) => row.id === id);
      if (!match) throw new Error("Training run not found.");
      label = `#${match.run.runNumber} · ${match.run.name}`;
      archived = Boolean(match.row.archived_at);
      trainingIds.add(id);
      sessionIdsForTraining(match.run).forEach((sessionId) => sessionIds.add(sessionId));
      safetyBackupRecommended = true;
    } else {
      const project = researchRows.find((row) => row.id === id);
      if (!project) throw new Error("Research project not found.");
      label = project.name;
      archived = Boolean(project.archived_at);
      researchIds.add(id);
      const sessions = await this.dependencies.select<Array<{ id: string }>>("SELECT id FROM rv_sessions WHERE research_project_id = $1", [id]);
      sessions.forEach((row) => sessionIds.add(row.id));
      safetyBackupRecommended = true;
      if (project.locked_at || !["Draft", "Preflight"].includes(project.state)) requiresPhrase = "DELETE";
    }

    if (workspaceIds.size) {
      const workspaceValues = valuesOf(workspaceIds);
      const wsParams = placeholders(workspaceValues.length);
      const threads = await this.dependencies.select<Array<{ id: string }>>(`SELECT id FROM chat_threads WHERE workspace_id IN (${wsParams})`, workspaceValues);
      threads.forEach((row) => threadIds.add(row.id));
      const sessions = await this.dependencies.select<Array<{ id: string }>>(`SELECT id FROM rv_sessions WHERE workspace_id IN (${wsParams})`, workspaceValues);
      sessions.forEach((row) => sessionIds.add(row.id));
      parsedTraining.filter(({ run }) => workspaceIds.has(run.workspaceId)).forEach(({ row, run }) => {
        trainingIds.add(row.id);
        sessionIdsForTraining(run).forEach((sessionId) => sessionIds.add(sessionId));
      });
      researchRows.filter((row) => workspaceIds.has(row.workspace_id)).forEach((row) => researchIds.add(row.id));
    }

    return { label, archived, blockedReason, requiresPhrase, safetyBackupRecommended, profileIds, workspaceIds, threadIds, sessionIds, trainingIds, researchIds, aiIdentityIds };
  }

  private async targetBlockReason(targetId: string): Promise<string | undefined> {
    for (const row of await this.allTrainingRows()) {
      const run = JSON.parse(row.record_json) as TrainingRunRecord;
      if (run.status !== "Completed" && run.targetIds.includes(targetId)) return `Target is still required by unfinished Training #${run.runNumber}.`;
    }
    for (const project of await this.allResearchRows()) {
      const config = JSON.parse(project.config_json) as ResearchProjectRecord["config"];
      if (!terminalResearch(project.state) && config.targetIds.includes(targetId)) return `Target is still required by unfinished Research “${project.name}”.`;
    }
    return undefined;
  }

  async preview(kind: PurgeEntityKind, id: string): Promise<DeletionPreview> {
    if (kind === "target") {
      const target = (await this.dependencies.select<TargetRow[]>("SELECT id, collection, title, archived_at FROM targets WHERE id = $1", [id]))[0];
      if (!target) throw new Error("Target not found.");
      const counts = emptyDeletionCounts();
      counts.userTargets = 1;
      return {
        kind, id, label: target.title, archived: Boolean(target.archived_at),
        blockedReason: target.collection !== "user" ? "Factory Training Targets are immutable and cannot be deleted." : await this.targetBlockReason(id),
        safetyBackupRecommended: false, viewerNotesPreserved: 0, viewerNotesDeleted: 0, counts,
      };
    }

    const scope = await this.collectScope(kind, id);
    const counts = emptyDeletionCounts();
    counts.profiles = await this.countIn("profiles", "id", scope.profileIds);
    counts.workspaces = await this.countIn("workspaces", "id", scope.workspaceIds);
    counts.conversations = await this.countIn("chat_threads", "id", scope.threadIds);
    counts.messages = await this.countIn("chat_messages", "thread_id", scope.threadIds);
    counts.rvSessions = await this.countIn("rv_sessions", "id", scope.sessionIds);
    counts.sessionEvents = await this.countIn("session_events", "session_id", scope.sessionIds);
    counts.snapshots = await this.countIn("session_snapshots", "session_id", scope.sessionIds);
    counts.reveals = await this.countIn("reveals", "session_id", scope.sessionIds);
    counts.targetClarifications = await this.countIn("target_clarifications", "session_id", scope.sessionIds);
    counts.monitorRuns = await this.countIn("monitor_runs", "session_id", scope.sessionIds);
    const monitorRunIds = new Set<string>();
    if (scope.sessionIds.size) {
      const values = valuesOf(scope.sessionIds);
      const rows = await this.dependencies.select<Array<{ id: string }>>(`SELECT id FROM monitor_runs WHERE session_id IN (${placeholders(values.length)})`, values);
      rows.forEach((row) => monitorRunIds.add(row.id));
    }
    counts.monitorInterventions = await this.countIn("monitor_interventions", "monitor_run_id", monitorRunIds);
    counts.judgeRuns = await this.countIn("judge_runs", "session_id", scope.sessionIds);
    const judgeRunIds = new Set<string>();
    if (scope.sessionIds.size) {
      const values = valuesOf(scope.sessionIds);
      const rows = await this.dependencies.select<Array<{ id: string }>>(`SELECT id FROM judge_runs WHERE session_id IN (${placeholders(values.length)})`, values);
      rows.forEach((row) => judgeRunIds.add(row.id));
    }
    counts.judgeScores = await this.countIn("judge_scores", "judge_run_id", judgeRunIds);
    counts.trainingRuns = await this.countIn("training_runs", "id", scope.trainingIds);
    counts.researchProjects = await this.countIn("research_projects", "id", scope.researchIds);
    counts.researchConditions = await this.countIn("research_conditions", "research_project_id", scope.researchIds);
    counts.researchAssignments = await this.countIn("research_assignments", "research_project_id", scope.researchIds);
    counts.blindingMappings = await this.countIn("blinding_mappings", "research_project_id", scope.researchIds);
    counts.researchResults = await this.countIn("research_results", "research_project_id", scope.researchIds);
    counts.workspaceSources = await this.countIn("workspace_sources", "workspace_id", scope.workspaceIds);
    counts.viewerNoteIdentities = await this.countIn("ai_identities", "id", scope.aiIdentityIds);
    counts.viewerNoteVersions = await this.countIn("ai_note_versions", "ai_identity_id", scope.aiIdentityIds);
    counts.viewerNoteReflectionRuns = await this.countIn("ai_note_reflection_runs", "ai_identity_id", scope.aiIdentityIds);
    counts.viewerNoteActivationEvents = await this.countIn("ai_note_activation_events", "ai_identity_id", scope.aiIdentityIds);

    let exportCount = 0;
    if (scope.workspaceIds.size || scope.researchIds.size) {
      const clauses: string[] = [];
      const values: string[] = [];
      if (scope.workspaceIds.size) {
        const ids = valuesOf(scope.workspaceIds);
        const offset = values.length;
        clauses.push(`workspace_id IN (${ids.map((_, i) => `$${offset + i + 1}`).join(", ")})`);
        values.push(...ids);
      }
      if (scope.researchIds.size) {
        const ids = valuesOf(scope.researchIds);
        const offset = values.length;
        clauses.push(`research_project_id IN (${ids.map((_, i) => `$${offset + i + 1}`).join(", ")})`);
        values.push(...ids);
      }
      exportCount = Number((await this.dependencies.select<CountRow[]>(`SELECT COUNT(*) AS n FROM exports WHERE ${clauses.join(" OR ")}`, values))[0]?.n ?? 0);
    }
    counts.exports = exportCount;

    let preserved = 0;
    if (scope.sessionIds.size || scope.workspaceIds.size) {
      const clauses: string[] = [];
      const values: string[] = [];
      if (scope.sessionIds.size) {
        const ids = valuesOf(scope.sessionIds);
        const offset = values.length;
        clauses.push(`source_session_id IN (${ids.map((_, i) => `$${offset + i + 1}`).join(", ")})`);
        values.push(...ids);
      }
      if (scope.workspaceIds.size) {
        const ids = valuesOf(scope.workspaceIds);
        const offset = values.length;
        clauses.push(`source_workspace_id IN (${ids.map((_, i) => `$${offset + i + 1}`).join(", ")})`);
        values.push(...ids);
      }
      let identityExclusion = "";
      if (scope.aiIdentityIds.size) {
        const ids = valuesOf(scope.aiIdentityIds);
        const offset = values.length;
        identityExclusion = ` AND ai_identity_id NOT IN (${ids.map((_, i) => `$${offset + i + 1}`).join(", ")})`;
        values.push(...ids);
      }
      preserved = Number((await this.dependencies.select<CountRow[]>(`SELECT COUNT(*) AS n FROM ai_note_versions WHERE (${clauses.join(" OR ")})${identityExclusion}`, values))[0]?.n ?? 0);
    }

    return {
      kind, id, label: scope.label, archived: scope.archived, blockedReason: scope.blockedReason,
      requiresPhrase: scope.requiresPhrase, safetyBackupRecommended: scope.safetyBackupRecommended,
      viewerNotesPreserved: preserved, viewerNotesDeleted: counts.viewerNoteVersions, counts,
    };
  }

  private assertDeletable(preview: DeletionPreview): void {
    if (!preview.archived) throw new Error("Permanent Delete is available only for archived records.");
    if (preview.blockedReason) throw new Error(preview.blockedReason);
  }

  private context(statements: DatabaseTransactionStatement[]): DatabaseTransactionStatement[] {
    return [
      { query: "DELETE FROM controlled_purge_context" },
      { query: "INSERT INTO controlled_purge_context (id, reason, started_at) VALUES (1, 'UX-DATA-8 controlled purge', datetime('now'))" },
      ...statements,
      { query: "DELETE FROM controlled_purge_context WHERE id = 1" },
    ];
  }

  private deleteWhereIn(table: string, column: string, ids: Set<string>): DatabaseTransactionStatement | null {
    if (!ids.size) return null;
    const values = valuesOf(ids);
    return { query: `DELETE FROM ${table} WHERE ${column} IN (${placeholders(values.length)})`, values };
  }

  async purge(kind: PurgeEntityKind, id: string): Promise<void> {
    const preview = await this.preview(kind, id);
    this.assertDeletable(preview);

    if (kind === "target") {
      await this.dependencies.executeTransaction(this.context([
        { query: "DELETE FROM targets WHERE id = $1 AND collection = 'user' AND archived_at IS NOT NULL", values: [id] },
      ]));
      return;
    }

    const scope = await this.collectScope(kind, id);
    const statements: DatabaseTransactionStatement[] = [];
    const deleteUsageBySession = this.deleteWhereIn("target_usage", "session_id", scope.sessionIds);
    if (deleteUsageBySession) statements.push(deleteUsageBySession);
    const deleteUsageByResearch = this.deleteWhereIn("target_usage", "research_project_id", scope.researchIds);
    if (deleteUsageByResearch) statements.push(deleteUsageByResearch);
    const deleteUsageByProfile = this.deleteWhereIn("target_usage", "profile_id", scope.profileIds);
    if (deleteUsageByProfile) statements.push(deleteUsageByProfile);

    if (kind === "profile") {
      statements.push(
        { query: "DELETE FROM ai_note_activation_events WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", values: [id] },
        { query: "UPDATE ai_note_settings SET active_version_id = NULL WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", values: [id] },
        { query: "UPDATE ai_note_versions SET base_version_id = NULL WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", values: [id] },
        { query: "DELETE FROM ai_note_versions WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", values: [id] },
        { query: "DELETE FROM ai_note_reflection_runs WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", values: [id] },
        { query: "DELETE FROM ai_note_settings WHERE ai_identity_id IN (SELECT id FROM ai_identities WHERE profile_id = $1)", values: [id] },
        { query: "DELETE FROM ai_identities WHERE profile_id = $1", values: [id] },
      );
      // rv_sessions.profile_id deliberately uses ON DELETE RESTRICT. Workspace
      // cascading therefore cannot remove sessions while their Profile is being
      // purged; remove the already-previewed session scope explicitly first.
      const deleteSessions = this.deleteWhereIn("rv_sessions", "id", scope.sessionIds);
      if (deleteSessions) statements.push(deleteSessions);
      const deleteTraining = this.deleteWhereIn("training_runs", "id", scope.trainingIds);
      if (deleteTraining) statements.push(deleteTraining);
      statements.push({ query: "DELETE FROM profiles WHERE id = $1 AND archived_at IS NOT NULL", values: [id] });
    } else if (kind === "workspace") {
      const deleteTraining = this.deleteWhereIn("training_runs", "id", scope.trainingIds);
      if (deleteTraining) statements.push(deleteTraining);
      statements.push({ query: "DELETE FROM workspaces WHERE id = $1 AND archived_at IS NOT NULL", values: [id] });
    } else if (kind === "conversation") {
      statements.push({ query: "DELETE FROM chat_threads WHERE id = $1 AND archived_at IS NOT NULL", values: [id] });
    } else if (kind === "rv_session") {
      statements.push({ query: "DELETE FROM rv_sessions WHERE id = $1 AND archived_at IS NOT NULL", values: [id] });
    } else if (kind === "training") {
      const deleteSessions = this.deleteWhereIn("rv_sessions", "id", scope.sessionIds);
      if (deleteSessions) statements.push(deleteSessions);
      statements.push({ query: "DELETE FROM training_runs WHERE id = $1 AND archived_at IS NOT NULL", values: [id] });
    } else {
      statements.push(
        { query: "DELETE FROM exports WHERE research_project_id = $1", values: [id] },
        { query: "DELETE FROM rv_sessions WHERE research_project_id = $1", values: [id] },
        { query: "DELETE FROM research_projects WHERE id = $1 AND archived_at IS NOT NULL", values: [id] },
      );
    }

    await this.dependencies.executeTransaction(this.context(statements));
  }
}
