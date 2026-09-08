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

const RV_SESSIONS_KEY = "rvh.dev.rv_sessions";
const SESSION_EVENTS_KEY = "rvh.dev.session_events";
const SESSION_SNAPSHOTS_KEY = "rvh.dev.session_snapshots";
const REVEALS_KEY = "rvh.dev.reveals";
const TARGET_CLARIFICATIONS_KEY = "rvh.dev.target_clarifications";

export interface BrowserSessionsRepositoryDependencies {
  storage?: Storage;
  now?: typeof nowIso;
  isResearchScoresFrozen: (researchProjectId: string) => boolean;
}

export class BrowserSessionsRepository implements SessionsRepository {
  private readonly storage: Storage;

  constructor(private readonly dependencies: BrowserSessionsRepositoryDependencies) {
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

  hasRecordedTargetUse(targetId: string): boolean {
    return this.read<RvSession[]>(RV_SESSIONS_KEY, []).some((item) => item.targetId === targetId);
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
    this.write(RV_SESSIONS_KEY, [session, ...this.read<RvSession[]>(RV_SESSIONS_KEY, [])]);
    return session;
  }

  async updateRvSessionState(id: string, state: RvSessionState, stopReason?: string): Promise<void> {
    const timestamp = this.now();
    this.write(
      RV_SESSIONS_KEY,
      this.read<RvSession[]>(RV_SESSIONS_KEY, []).map((session) =>
        session.id === id ? { ...session, state, updatedAt: timestamp, ...(state === "Completed" ? { completedAt: timestamp } : {}) } : session,
      ),
    );
    if (stopReason) await this.appendSessionEvent(id, { eventType: "SESSION_STOPPED", role: "controller", content: stopReason });
  }

  async appendPostRevealTurn(sessionId: string, role: "user" | "assistant" | "monitor", content: string): Promise<string> {
    const sessions = this.read<RvSession[]>(RV_SESSIONS_KEY, []);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("RV session not found.");
    if (session.state !== "Revealed" && session.state !== "Completed") throw new Error("Post-reveal discussion requires Reveal.");
    if (session.researchProjectId && !this.dependencies.isResearchScoresFrozen(session.researchProjectId)) {
      throw new Error("Research post-reveal discussion requires frozen scores.");
    }
    const next = `${session.postRevealTranscript}${serializePostRevealTurn(role, content)}`;
    const timestamp = this.now();
    this.write(RV_SESSIONS_KEY, sessions.map((item) => item.id === sessionId ? { ...item, postRevealTranscript: next, updatedAt: timestamp } : item));
    await this.appendSessionEvent(sessionId, { eventType: `POST_REVEAL_${role.toUpperCase()}`, role, content: content.trim() });
    return next;
  }

  async appendSessionEvent(sessionId: string, event: SessionEventInput): Promise<void> {
    const all = this.read<SessionEventRecord[]>(SESSION_EVENTS_KEY, []);
    const sequenceNumber = all.filter((item) => item.sessionId === sessionId).reduce((max, item) => Math.max(max, item.sequenceNumber), 0) + 1;
    this.write(SESSION_EVENTS_KEY, [...all, { ...event, id: createId("event"), sessionId, sequenceNumber, createdAt: this.now() }]);
  }

  async listSessionEvents(sessionId: string): Promise<SessionEventRecord[]> {
    return this.read<SessionEventRecord[]>(SESSION_EVENTS_KEY, [])
      .filter((event) => event.sessionId === sessionId)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .map((event) => structuredClone(event));
  }

  async updatePreRevealTranscript(sessionId: string, transcript: string): Promise<void> {
    this.write(RV_SESSIONS_KEY, this.read<RvSession[]>(RV_SESSIONS_KEY, []).map((session) => session.id === sessionId && !session.preRevealSealedAt ? { ...session, preRevealTranscript: transcript, updatedAt: this.now() } : session));
  }

  async saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshot, hash: string): Promise<void> {
    const all = this.read<Array<{ sessionId: string; snapshot: SessionSnapshot; hash: string }>>(SESSION_SNAPSHOTS_KEY, []);
    if (all.some((item) => item.sessionId === sessionId)) throw new Error("session snapshots are immutable");
    this.write(SESSION_SNAPSHOTS_KEY, [...all, { sessionId, snapshot, hash }]);
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    return this.read<Array<{ sessionId: string; snapshot: SessionSnapshot; hash: string }>>(SESSION_SNAPSHOTS_KEY, []).find((item) => item.sessionId === sessionId)?.snapshot ?? null;
  }

  async sealPreReveal(sessionId: string, transcript: string, hash: string): Promise<void> {
    const timestamp = this.now();
    this.write(RV_SESSIONS_KEY, this.read<RvSession[]>(RV_SESSIONS_KEY, []).map((session) => session.id === sessionId ? { ...session, preRevealTranscript: transcript, preRevealHash: hash, preRevealSealedAt: timestamp, state: "AwaitingReveal", updatedAt: timestamp } : session));
  }

  async acceptReveal(sessionId: string, reveal: RevealInput): Promise<void> {
    const reveals = this.read<Array<{ sessionId: string; reveal: RevealInput; acceptedAt: string }>>(REVEALS_KEY, []);
    if (reveals.some((item) => item.sessionId === sessionId)) throw new Error("reveal already exists");
    this.write(REVEALS_KEY, [...reveals, { sessionId, reveal, acceptedAt: this.now() }]);
    await this.updateRvSessionState(sessionId, "Revealed");
  }

  async getReveal(sessionId: string): Promise<RevealInput | null> {
    const item = this.read<Array<{ sessionId: string; reveal: RevealInput; acceptedAt: string }>>(REVEALS_KEY, []).find((entry) => entry.sessionId === sessionId);
    return item ? structuredClone(item.reveal) : null;
  }

  async getViewerEvidence(sessionId: string): Promise<string> {
    const session = this.read<RvSession[]>(RV_SESSIONS_KEY, []).find((item) => item.id === sessionId);
    if (!session?.preRevealSealedAt || !session.preRevealHash) return "";
    return verifySealedViewerEvidence(session.preRevealTranscript, session.preRevealHash);
  }

  async listRvSessions(workspaceId: string): Promise<RvSession[]> {
    return this.read<RvSession[]>(RV_SESSIONS_KEY, []).filter((session) => session.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listRecentRvSessions(workspaceIds: readonly string[], limit: number): Promise<RvSession[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (!safeLimit || workspaceIds.length === 0) return [];
    const workspaceOrder = new Map(workspaceIds.map((workspaceId, index) => [workspaceId, index]));
    return this.read<RvSession[]>(RV_SESSIONS_KEY, [])
      .filter((session) => workspaceOrder.has(session.workspaceId))
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || (workspaceOrder.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER) - (workspaceOrder.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER)
        || right.createdAt.localeCompare(left.createdAt)
        || left.id.localeCompare(right.id),
      )
      .slice(0, safeLimit);
  }

  async addTargetClarification(sessionId: string, content: string): Promise<TargetClarificationRecord> {
    const clean = content.trim();
    if (!clean) throw new Error("Target clarification cannot be empty.");
    const session = this.read<RvSession[]>(RV_SESSIONS_KEY, []).find((item) => item.id === sessionId);
    if (!session || (session.state !== "Revealed" && session.state !== "Completed")) throw new Error("Target clarification is available only after Reveal.");
    if (session.researchProjectId && !this.dependencies.isResearchScoresFrozen(session.researchProjectId)) {
      throw new Error("Research target clarification requires frozen Judge scores.");
    }
    const record: TargetClarificationRecord = { id: createId("clarification"), sessionId, content: clean, createdAt: this.now() };
    this.write(TARGET_CLARIFICATIONS_KEY, [...this.read<TargetClarificationRecord[]>(TARGET_CLARIFICATIONS_KEY, []), record]);
    return record;
  }

  async listTargetClarifications(sessionId: string): Promise<TargetClarificationRecord[]> {
    return this.read<TargetClarificationRecord[]>(TARGET_CLARIFICATIONS_KEY, []).filter((item) => item.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
