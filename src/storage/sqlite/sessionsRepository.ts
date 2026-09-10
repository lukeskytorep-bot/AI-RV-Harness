import type {
  CreateRvSessionInput,
  RevealInput,
  RvSession,
  RvSessionState,
  SessionEventInput,
  SessionEventRecord,
  SessionSnapshot,
  TargetClarificationRecord,
} from "../../sessions/types";
import { serializePostRevealTurn } from "../../sessions/postRevealTranscript";
import { verifySealedViewerEvidence } from "../../sessions/evidence";
import type { SessionsRepository } from "../contracts/sessionsRepository";
import { createId, nowIso } from "../repository";

type WriteResult = { rowsAffected: number };
type RvSessionRow = {
  id: string;
  workspace_id: string;
  profile_id: string;
  session_code: string;
  state: RvSessionState;
  run_type: RvSession["runType"];
  pre_reveal_transcript: string;
  pre_reveal_hash: string | null;
  pre_reveal_sealed_at: string | null;
  post_reveal_transcript: string;
  target_id: string | null;
  target_id_snapshot: string | null;
  research_project_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
};
type RevealRow = { reveal_source: RevealInput["source"]; reveal_text: string | null; artifact_manifest_json: string; reveal_hash: string };
type SessionEventRow = { id: string; session_id: string; sequence_number: number; event_type: string; role: SessionEventRecord["role"] | null; content: string | null; metadata_json: string; created_at: string };

export interface SqliteSessionsRepositoryDependencies {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  executeWrite(query: string, bindValues?: unknown[]): Promise<WriteResult>;
  isResearchScoresFrozen(researchProjectId: string): Promise<boolean>;
  now?: typeof nowIso;
}

function mapRvSession(row: RvSessionRow): RvSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    profileId: row.profile_id,
    sessionCode: row.session_code,
    state: row.state,
    runType: row.run_type,
    preRevealTranscript: row.pre_reveal_transcript,
    preRevealHash: row.pre_reveal_hash ?? undefined,
    preRevealSealedAt: row.pre_reveal_sealed_at ?? undefined,
    postRevealTranscript: row.post_reveal_transcript,
    targetId: row.target_id ?? row.target_id_snapshot ?? undefined,
    researchProjectId: row.research_project_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

export class SqliteSessionsRepository implements SessionsRepository {
  constructor(private readonly dependencies: SqliteSessionsRepositoryDependencies) {}

  private now(): string {
    return (this.dependencies.now ?? nowIso)();
  }

  async createRvSession(input: CreateRvSessionInput): Promise<RvSession> {
    const timestamp = this.now();
    const session: RvSession = {
      id: input.id,
      workspaceId: input.workspaceId,
      profileId: input.profileId,
      sessionCode: input.sessionCode,
      state: "Draft",
      runType: input.runType,
      preRevealTranscript: "",
      postRevealTranscript: "",
      targetId: input.targetId,
      researchProjectId: input.researchProjectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.dependencies.executeWrite(
      `INSERT INTO rv_sessions
       (id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
        post_reveal_transcript, target_id, target_id_snapshot, research_project_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Draft', $5, '', '', $6, $6, $7, $8, $8)`,
      [session.id, session.workspaceId, session.profileId, session.sessionCode, session.runType, session.targetId ?? null, session.researchProjectId ?? null, timestamp],
    );
    return session;
  }

  async updateRvSessionState(id: string, state: RvSessionState, stopReason?: string): Promise<void> {
    const timestamp = this.now();
    await this.dependencies.executeWrite(
      `UPDATE rv_sessions SET state = $1, updated_at = $2,
       completed_at = CASE WHEN $1 = 'Completed' THEN $2 ELSE completed_at END WHERE id = $3`,
      [state, timestamp, id],
    );
    if (stopReason) await this.appendSessionEvent(id, { eventType: "SESSION_STOPPED", role: "controller", content: stopReason });
  }

  async appendPostRevealTurn(sessionId: string, role: "user" | "assistant" | "monitor", content: string): Promise<string> {
    const rows = await this.dependencies.select<Array<{ state: RvSessionState; post_reveal_transcript: string; research_project_id: string | null }>>(
      "SELECT state, post_reveal_transcript, research_project_id FROM rv_sessions WHERE id = $1",
      [sessionId],
    );
    const session = rows[0];
    if (!session) throw new Error("RV session not found.");
    if (session.state !== "Revealed" && session.state !== "Completed") throw new Error("Post-reveal discussion requires Reveal.");
    if (session.research_project_id && !await this.dependencies.isResearchScoresFrozen(session.research_project_id)) {
      throw new Error("Research post-reveal discussion requires frozen scores.");
    }
    const next = `${session.post_reveal_transcript}${serializePostRevealTurn(role, content)}`;
    await this.dependencies.executeWrite("UPDATE rv_sessions SET post_reveal_transcript = $1, updated_at = $2 WHERE id = $3", [next, this.now(), sessionId]);
    await this.appendSessionEvent(sessionId, { eventType: `POST_REVEAL_${role.toUpperCase()}`, role, content: content.trim() });
    return next;
  }

  async appendSessionEvent(sessionId: string, event: SessionEventInput): Promise<void> {
    const timestamp = this.now();
    await this.dependencies.executeWrite(
      `INSERT INTO session_events
       (id, session_id, sequence_number, event_type, role, content, metadata_json, created_at)
       SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1, $3, $4, $5, $6, $7
         FROM session_events WHERE session_id = $2`,
      [createId("event"), sessionId, event.eventType, event.role ?? null, event.content ?? null, JSON.stringify(event.metadata ?? {}), timestamp],
    );
  }

  async listSessionEvents(sessionId: string): Promise<SessionEventRecord[]> {
    const rows = await this.dependencies.select<SessionEventRow[]>(
      `SELECT id, session_id, sequence_number, event_type, role, content, metadata_json, created_at
         FROM session_events WHERE session_id = $1 ORDER BY sequence_number`,
      [sessionId],
    );
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sequenceNumber: Number(row.sequence_number),
      eventType: row.event_type,
      ...(row.role ? { role: row.role } : {}),
      ...(row.content !== null ? { content: row.content } : {}),
      metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  async updatePreRevealTranscript(sessionId: string, transcript: string): Promise<void> {
    await this.dependencies.executeWrite(
      "UPDATE rv_sessions SET pre_reveal_transcript = $1, updated_at = $2 WHERE id = $3",
      [transcript, this.now(), sessionId],
    );
  }

  async saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshot, hash: string): Promise<void> {
    await this.dependencies.executeWrite(
      `INSERT INTO session_snapshots (id, session_id, snapshot_json, snapshot_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [createId("snapshot"), sessionId, JSON.stringify(snapshot), hash, this.now()],
    );
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    const rows = await this.dependencies.select<{ snapshot_json: string }[]>("SELECT snapshot_json FROM session_snapshots WHERE session_id = $1 LIMIT 1", [sessionId]);
    return rows[0] ? JSON.parse(rows[0].snapshot_json) as SessionSnapshot : null;
  }

  async sealPreReveal(sessionId: string, transcript: string, hash: string): Promise<void> {
    const timestamp = this.now();
    await this.dependencies.executeWrite(
      `UPDATE rv_sessions SET pre_reveal_transcript = $1, pre_reveal_hash = $2,
       pre_reveal_sealed_at = $3, state = 'AwaitingReveal', updated_at = $3 WHERE id = $4`,
      [transcript, hash, timestamp, sessionId],
    );
  }

  async acceptReveal(sessionId: string, reveal: RevealInput): Promise<void> {
    const timestamp = this.now();
    await this.dependencies.executeWrite(
      `INSERT INTO reveals (id, session_id, reveal_source, reveal_text, artifact_manifest_json, reveal_hash, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [createId("reveal"), sessionId, reveal.source, reveal.text ?? null, JSON.stringify(reveal.artifactManifest ?? []), reveal.hash, timestamp],
    );
  }

  async getReveal(sessionId: string): Promise<RevealInput | null> {
    const rows = await this.dependencies.select<RevealRow[]>(
      `SELECT reveal_source, reveal_text, artifact_manifest_json, reveal_hash
         FROM reveals WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      source: row.reveal_source,
      ...(row.reveal_text !== null ? { text: row.reveal_text } : {}),
      artifactManifest: JSON.parse(row.artifact_manifest_json) as NonNullable<RevealInput["artifactManifest"]>,
      hash: row.reveal_hash,
    };
  }

  async getViewerEvidence(sessionId: string): Promise<string> {
    const rows = await this.dependencies.select<Array<{ pre_reveal_transcript: string; pre_reveal_hash: string | null; pre_reveal_sealed_at: string | null }>>(
      `SELECT pre_reveal_transcript, pre_reveal_hash, pre_reveal_sealed_at
         FROM rv_sessions WHERE id = $1 LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row?.pre_reveal_sealed_at || !row.pre_reveal_hash) return "";
    return verifySealedViewerEvidence(row.pre_reveal_transcript, row.pre_reveal_hash);
  }

  async getRvSession(id: string): Promise<RvSession | null> {
    const rows = await this.dependencies.select<RvSessionRow[]>(
      `SELECT id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
              pre_reveal_hash, pre_reveal_sealed_at, post_reveal_transcript, target_id, target_id_snapshot,
              research_project_id, created_at, updated_at, completed_at, archived_at
         FROM rv_sessions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ? mapRvSession(rows[0]) : null;
  }

  async listRvSessions(workspaceId: string): Promise<RvSession[]> {
    const rows = await this.dependencies.select<RvSessionRow[]>(
      `SELECT id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
              pre_reveal_hash, pre_reveal_sealed_at, post_reveal_transcript, target_id, target_id_snapshot,
              research_project_id, created_at, updated_at, completed_at, archived_at
         FROM rv_sessions WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map(mapRvSession);
  }

  async listArchivedRvSessions(): Promise<RvSession[]> {
    const rows = await this.dependencies.select<RvSessionRow[]>(
      `SELECT id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
              pre_reveal_hash, pre_reveal_sealed_at, post_reveal_transcript, target_id, target_id_snapshot,
              research_project_id, created_at, updated_at, completed_at, archived_at
         FROM rv_sessions WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`,
    );
    return rows.map(mapRvSession);
  }

  async archiveRvSession(id: string): Promise<void> {
    const timestamp = this.now();
    const result = await this.dependencies.executeWrite(
      "UPDATE rv_sessions SET archived_at = $1, updated_at = $1 WHERE id = $2 AND archived_at IS NULL",
      [timestamp, id],
    );
    if (result.rowsAffected !== 1) throw new Error("Active RV Session not found.");
  }

  async restoreRvSession(id: string): Promise<void> {
    const rows = await this.dependencies.select<Array<{ workspace_id: string; profile_id: string }>>(
      "SELECT workspace_id, profile_id FROM rv_sessions WHERE id = $1 AND archived_at IS NOT NULL", [id],
    );
    const session = rows[0];
    if (!session) throw new Error("Archived RV Session not found.");
    const parents = await this.dependencies.select<Array<{ workspace_id: string }>>(
      `SELECT w.id AS workspace_id FROM workspaces w JOIN profiles p ON p.id = w.profile_id
        WHERE w.id = $1 AND w.profile_id = $2 AND w.archived_at IS NULL AND p.archived_at IS NULL`,
      [session.workspace_id, session.profile_id],
    );
    if (!parents[0]) throw new Error("Restore the parent Profile and Workspace first.");
    const timestamp = this.now();
    await this.dependencies.executeWrite(
      "UPDATE rv_sessions SET archived_at = NULL, updated_at = $1 WHERE id = $2 AND archived_at IS NOT NULL",
      [timestamp, id],
    );
  }

  async listRecentRvSessions(workspaceIds: readonly string[], limit: number): Promise<RvSession[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (!safeLimit || workspaceIds.length === 0) return [];
    const workspacePlaceholders = workspaceIds.map((_, index) => `$${index + 1}`);
    const limitPlaceholder = `$${workspaceIds.length + 1}`;
    const workspaceOrder = workspaceIds.map((_, index) => `WHEN $${index + 1} THEN ${index}`).join(" ");
    const rows = await this.dependencies.select<RvSessionRow[]>(
      `SELECT id, workspace_id, profile_id, session_code, state, run_type, pre_reveal_transcript,
              pre_reveal_hash, pre_reveal_sealed_at, post_reveal_transcript, target_id, target_id_snapshot,
              research_project_id, created_at, updated_at, completed_at, archived_at
         FROM rv_sessions
        WHERE archived_at IS NULL AND workspace_id IN (${workspacePlaceholders.join(", ")})
        ORDER BY updated_at DESC,
                 CASE workspace_id ${workspaceOrder} ELSE ${workspaceIds.length} END ASC,
                 created_at DESC, id ASC
        LIMIT ${limitPlaceholder}`,
      [...workspaceIds, safeLimit],
    );
    return rows.map(mapRvSession);
  }

  async addTargetClarification(sessionId: string, content: string): Promise<TargetClarificationRecord> {
    const clean = content.trim();
    if (!clean) throw new Error("Target clarification cannot be empty.");
    const record: TargetClarificationRecord = { id: createId("clarification"), sessionId, content: clean, createdAt: this.now() };
    await this.dependencies.executeWrite(
      "INSERT INTO target_clarifications (id, session_id, content, created_at) VALUES ($1, $2, $3, $4)",
      [record.id, record.sessionId, record.content, record.createdAt],
    );
    return record;
  }

  async listTargetClarifications(sessionId: string): Promise<TargetClarificationRecord[]> {
    const rows = await this.dependencies.select<Array<{ id: string; session_id: string; content: string; created_at: string }>>(
      "SELECT id, session_id, content, created_at FROM target_clarifications WHERE session_id = $1 ORDER BY created_at",
      [sessionId],
    );
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, content: row.content, createdAt: row.created_at }));
  }
}
