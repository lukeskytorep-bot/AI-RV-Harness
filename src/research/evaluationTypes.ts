import { stableStringify } from "./planner";
import { computeJudgeTotal } from "../domain/scoring";
import type { JudgeSelection } from "../judge/engine";
import type { JudgeScoreRecord } from "../judge/types";
import type { SessionEventRecord } from "../sessions/types";
import type { InterfaceLanguage } from "../types";

export const evaluationPrefix = "rvh.research.evaluation.v1:";
export const evaluationKey = (projectId: string, id: string) => `${evaluationPrefix}${projectId}:${id}`;
export interface ResearchEvaluation {
  schemaVersion: 1;
  id: string;
  projectId: string;
  revision: number;
  createdAt: string;
  language: InterfaceLanguage;
  status: "Ready" | "Running" | "Incomplete" | "Complete";
  timeoutMs?: number;
  budgetPolicy: import("../providers/outputRecovery").AnalyticalBudgetPolicy;
  judges: JudgeSelection[];
  sources: Array<{ sessionId: string; anonymousSessionId: string; sourceSha256: string }>;
  scores: Record<string, JudgeScoreRecord[]>;
  events: SessionEventRecord[];
}
/** Fail closed before updates, including browser storage and imported snapshots. */
export function validateResearchEvaluation(value: unknown, expected?: { projectId: string; id?: string }): ResearchEvaluation {
  const r = value as ResearchEvaluation;
  if (!r || r.schemaVersion !== 1 || typeof r.id!=="string" || !/^[A-Za-z0-9_-]{1,100}$/.test(r.id) || typeof r.projectId!=="string" || !r.projectId || expected && (r.projectId!==expected.projectId || expected.id!==undefined && r.id!==expected.id) || !Number.isSafeInteger(r.revision) || r.revision < 1
    || !["en", "pl"].includes(r.language) || !["Ready", "Running", "Incomplete", "Complete"].includes(r.status)
    || !Array.isArray(r.judges) || r.judges.length < 1 || r.judges.length > 3 || !r.judges.every(j => j.providerConfig?.id && j.model?.route)
    || !Array.isArray(r.sources) || !r.sources.length || new Set(r.sources.map(s => s.sessionId)).size !== r.sources.length
    || !r.sources.every(s => s.sessionId && /^BlindSession_[A-Z0-9]{8,24}$/.test(s.anonymousSessionId) && /^[a-f0-9]{64}$/.test(s.sourceSha256))
    || !["default","training_reveal","legacy_analytical","frozen_analytical_v1"].includes(r.budgetPolicy)
    || !r.scores || typeof r.scores !== "object" || Array.isArray(r.scores) || !Array.isArray(r.events)) throw new Error("Invalid Research evaluation record.");
  return r;
}
const equalWire = (a:unknown,b:unknown) => stableStringify(a===undefined?null:JSON.parse(JSON.stringify(a)))===stableStringify(b===undefined?null:JSON.parse(JSON.stringify(b)));
export function assertEvaluationUpdate(previous: ResearchEvaluation | null, next: ResearchEvaluation, expectedRevision: number): void {
  validateResearchEvaluation(next);
  if ((previous?.revision ?? 0) !== expectedRevision || next.revision !== expectedRevision + 1) throw new Error("Research evaluation revision conflict.");
  if (previous) {
    for (const key of ["id", "projectId", "schemaVersion", "createdAt", "language", "timeoutMs", "budgetPolicy", "judges", "sources"] as const) {
      if (!equalWire(previous[key],next[key])) throw new Error("Frozen Research evaluation design changed.");
    }
    if (previous.status === "Complete") throw new Error("Completed Research evaluation is immutable.");
    if (next.events.length < previous.events.length || previous.events.some((event,i) => !equalWire(event,next.events[i]))) throw new Error("Research evaluation journal cannot be rewritten.");
    for (const [sessionId, scores] of Object.entries(previous.scores)) {
      if (scores.some(score => !next.scores[sessionId]?.some(candidate => equalWire(candidate,score)))) throw new Error("Frozen Research evaluation score cannot be replaced.");
    }
  } else if (next.events.length || Object.keys(next.scores).length || next.status !== "Ready") throw new Error("A new Research evaluation must start empty.");
  const sourceIds = new Set(next.sources.map(s => s.sessionId));
  for (const [sessionId, scores] of Object.entries(next.scores)) {
    if (!sourceIds.has(sessionId) || !Array.isArray(scores) || new Set(scores.map(s => s.judgeIndex)).size !== scores.length
      || scores.some(s => !s.frozenAt || !next.judges[s.judgeIndex-1] || s.modelRoute !== next.judges[s.judgeIndex-1].model.route)) throw new Error("Invalid Research evaluation score slot.");
  }
  for (const scores of Object.values(next.scores)) for (const score of scores) {
    if (computeJudgeTotal(score)!==score.total || !score.narrative || typeof score.narrative.conciseRationale!=="string" || ![score.narrative.strongestMatches,score.narrative.majorMissesContradictions,score.narrative.confabulationObservations].every(a=>Array.isArray(a) && a.every(s=>typeof s==="string"))) throw new Error("Invalid Research evaluation score content.");
  }
  if (new Set(next.events.map(e=>e.id)).size!==next.events.length) throw new Error("Duplicate evaluation event id.");
  if (next.events.some(e => !sourceIds.has(e.sessionId))) throw new Error("Research evaluation event source mismatch.");
  if (next.status === "Complete" && next.sources.some(s => next.scores[s.sessionId]?.length !== next.judges.length)) throw new Error("Research evaluation is missing scores.");
}
