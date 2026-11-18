import { assertTargetCodePolicy } from "../resources/rvLiteTargetCode";
import { aggregateJudgeScores } from "../domain/scoring";
import type { JudgeScoreRecord } from "../judge/types";
import type { RvSession } from "../sessions/types";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord } from "./types";

export interface TargetCodeSessionResult {
  mode: "with_code" | "without_code";
  sessionId?: string;
  sessionCode?: string;
  anonymousSessionId: string;
  status: string;
  scores: JudgeScoreRecord[];
  aggregate?: ReturnType<typeof aggregateJudgeScores>["mean"];
}
export interface TargetCodePairResult {
  pairKey: string;
  targetId: string;
  repetition: number;
  a?: TargetCodeSessionResult;
  b?: TargetCodeSessionResult;
  difference?: number;
  winner: "A" | "B" | "tie" | "missing";
}
export interface TargetCodeComparison {
  version: 1;
  pairs: TargetCodePairResult[];
  summary: { scoredA: number; scoredB: number; meanA?: number; meanB?: number; completePairs: number; missingPairs: number; meanPairedDifference?: number; winsA: number; ties: number; winsB: number };
}

/** Caller must cross the existing unblinding boundary, or write this only to private_master. */
export function computeTargetCodeComparison(input: {
  assignments: ResearchAssignmentRecord[]; mappings: BlindingMappingRecord[]; conditions: ResearchConditionRecord[];
  sessions: RvSession[]; scoresBySession: Record<string, JudgeScoreRecord[]>; requiredJudges: number;
}): TargetCodeComparison {
  const pairs = new Map<string, TargetCodePairResult>();
  const mappingByAnonymous = new Map(input.mappings.map(m=>[m.anonymousSessionId,m]));
  const conditionById = new Map(input.conditions.map(c=>[c.id,c]));
  const sessionById = new Map(input.sessions.map(s=>[s.id,s]));
  for (const assignment of input.assignments) {
    const mapping = mappingByAnonymous.get(assignment.anonymousSessionId);
    const condition = mapping ? conditionById.get(mapping.conditionId) : undefined;
    if (!mapping || !condition?.config.targetCode) throw new Error("Target-code comparison requires a complete structural blinding key.");
    assertTargetCodePolicy(condition.config.targetCode);
    const match = /^pair_tc(\d+)_/.exec(mapping.pairKey);
    if (!match) throw new Error("Target-code pair has no frozen repetition index.");
    const pair = pairs.get(mapping.pairKey) ?? { pairKey: mapping.pairKey, targetId: assignment.targetId, repetition: Number(match[1]), winner: "missing" as const };
    if (pair.targetId !== assignment.targetId) throw new Error("Target-code pair contains different targets.");
    const mode = condition.config.targetCode.mode;
    const side = mode === "with_code" ? "a" : "b";
    if (pair[side]) throw new Error("Duplicate target-code condition in pair.");
    const session = assignment.sessionId ? sessionById.get(assignment.sessionId) : undefined;
    const scores = session ? input.scoresBySession[session.id] ?? [] : [];
    const fullyScored = input.requiredJudges > 0 && scores.length === input.requiredJudges && scores.every(s => s.frozenAt && s.judgeIndex >= 1 && s.judgeIndex <= input.requiredJudges)
      && new Set(scores.map(s => s.judgeIndex)).size === input.requiredJudges && ["SessionComplete", "Judged"].includes(assignment.status) && Boolean(session?.preRevealHash && session.preRevealSealedAt && ["Revealed", "Completed"].includes(session.state));
    pair[side] = { mode, anonymousSessionId: assignment.anonymousSessionId, sessionId: session?.id, sessionCode: session?.sessionCode, status: assignment.status, scores,
      ...(fullyScored ? { aggregate: aggregateJudgeScores(scores).mean } : {}) };
    pairs.set(pair.pairKey, pair);
  }
  const rows = [...pairs.values()].sort((a,b) => a.targetId.localeCompare(b.targetId) || a.repetition-b.repetition);
  for (const pair of rows) {
    if (pair.a?.aggregate && pair.b?.aggregate) {
      pair.difference = Math.round((pair.a.aggregate.total - pair.b.aggregate.total) * 100) / 100;
      pair.winner = pair.difference > 0 ? "A" : pair.difference < 0 ? "B" : "tie";
    }
  }
  const a = rows.flatMap(p => p.a?.aggregate ? [p.a.aggregate.total] : []);
  const b = rows.flatMap(p => p.b?.aggregate ? [p.b.aggregate.total] : []);
  const diffs = rows.flatMap(p => p.difference !== undefined ? [p.difference] : []);
  const mean = (values: number[]) => values.length ? values.reduce((s,v)=>s+v,0)/values.length : undefined;
  return { version: 1, pairs: rows, summary: { scoredA:a.length, scoredB:b.length, meanA:mean(a), meanB:mean(b), completePairs:diffs.length, missingPairs:rows.length-diffs.length, meanPairedDifference:mean(diffs), winsA:rows.filter(p=>p.winner==="A").length, ties:rows.filter(p=>p.winner==="tie").length, winsB:rows.filter(p=>p.winner==="B").length } };
}

export function targetCodeComparisonCsv(comparison: TargetCodeComparison): string {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [["target_id","repetition","A_with_code_session","A_score","B_without_code_session","B_score","A_minus_B","winner","A_session_id","B_session_id"],
    ...comparison.pairs.map(p=>[p.targetId,p.repetition,p.a?.sessionCode,p.a?.aggregate?.total,p.b?.sessionCode,p.b?.aggregate?.total,p.difference,p.winner,p.a?.sessionId,p.b?.sessionId])].map(row=>row.map(escape).join(",")).join("\n");
}
