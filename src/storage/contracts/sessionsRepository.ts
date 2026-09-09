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

/** Internal persistence contract for RV session records and their sealed/reveal lifecycle. */
export interface SessionsRepository {
  createRvSession(input: CreateRvSessionInput): Promise<RvSession>;
  updateRvSessionState(id: string, state: RvSessionState, stopReason?: string): Promise<void>;
  appendSessionEvent(sessionId: string, event: SessionEventInput): Promise<void>;
  listSessionEvents(sessionId: string): Promise<SessionEventRecord[]>;
  updatePreRevealTranscript(sessionId: string, transcript: string): Promise<void>;
  appendPostRevealTurn(sessionId: string, role: "user" | "assistant" | "monitor", content: string): Promise<string>;
  saveSessionSnapshot(sessionId: string, snapshot: SessionSnapshot, hash: string): Promise<void>;
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null>;
  sealPreReveal(sessionId: string, transcript: string, hash: string): Promise<void>;
  acceptReveal(sessionId: string, reveal: RevealInput): Promise<void>;
  getReveal(sessionId: string): Promise<RevealInput | null>;
  getViewerEvidence(sessionId: string): Promise<string>;
  getRvSession(id: string): Promise<RvSession | null>;
  listRvSessions(workspaceId: string): Promise<RvSession[]>;
  listArchivedRvSessions(): Promise<RvSession[]>;
  archiveRvSession(id: string): Promise<void>;
  restoreRvSession(id: string): Promise<void>;
  listRecentRvSessions(workspaceIds: readonly string[], limit: number): Promise<RvSession[]>;
  addTargetClarification(sessionId: string, content: string): Promise<TargetClarificationRecord>;
  listTargetClarifications(sessionId: string): Promise<TargetClarificationRecord[]>;
}
