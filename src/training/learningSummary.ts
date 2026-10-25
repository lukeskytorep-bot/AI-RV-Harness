import type { LearningSettlement } from "../aiCenter/learningExecution";
import type { TrainingRunRecord } from "./types";

/** A checkpoint may be durable before its settlement is copied onto the run. */
export function trainingLearningSettlements(run: Pick<TrainingRunRecord, "learningSettlements" | "activeTargetCheckpoint">, events: LearningSettlement[] = []): LearningSettlement[] {
  const values = [...(run.learningSettlements ?? []), ...(run.activeTargetCheckpoint?.learningSettlements ?? []), ...events];
  return [...new Map(values.map(value => [JSON.stringify([value.sessionId, value.kind, value.packetHash]), value])).values()];
}
export function failedLearningSummary(count: number, pl: boolean): string {
  return pl ? `Nieudane aktualizacje pamięci: ${count}` : `Failed memory updates: ${count}`;
}
