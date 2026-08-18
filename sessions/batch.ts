import type { RvSessionState } from "./types";
import type { TargetRecord } from "../targets/types";

export interface OrdinaryBatchSessionResult {
  sessionId: string;
  sessionCode: string;
  state: RvSessionState;
}

export interface OrdinaryBatchProgress {
  completed: number;
  total: number;
  current: number;
}

export function selectBatchTargets(targets: TargetRecord[], count: number, random: () => number = Math.random): TargetRecord[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("Batch count must be a positive integer.");
  if (count > targets.length) throw new RangeError("Batch count exceeds the eligible target pool.");
  const shuffled = [...targets];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.max(0, Math.min(0.999999999999, random())) * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

export async function runOrdinaryBatch(input: {
  targets: TargetRecord[];
  signal?: AbortSignal;
  runSession: (target: TargetRecord, index: number) => Promise<OrdinaryBatchSessionResult>;
  onProgress?: (progress: OrdinaryBatchProgress) => void;
  onSessionComplete?: (result: OrdinaryBatchSessionResult) => void;
}): Promise<OrdinaryBatchSessionResult[]> {
  if (!input.targets.length) throw new Error("Ordinary batch requires at least one automatic target.");
  const results: OrdinaryBatchSessionResult[] = [];
  for (let index = 0; index < input.targets.length; index += 1) {
    if (input.signal?.aborted) break;
    input.onProgress?.({ completed: results.length, total: input.targets.length, current: index + 1 });
    const result = await input.runSession(input.targets[index], index);
    results.push(result);
    input.onSessionComplete?.(result);
    input.onProgress?.({ completed: results.length, total: input.targets.length, current: index + 1 });
    if (result.state === "Interrupted" || result.state === "Failed") break;
  }
  return results;
}
