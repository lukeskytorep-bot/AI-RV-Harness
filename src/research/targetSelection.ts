import type { TargetRecord } from "../targets/types";

export type ResearchTargetSource = "training" | "user" | "all";
export type ResearchTargetSelectionMode = "manual" | "random";

export function sampleResearchTargetIds(
  targets: TargetRecord[],
  requestedCount: number,
  randomIndex: (upperExclusive: number) => number = secureRandomIndex,
): string[] {
  const count = Math.max(0, Math.min(targets.length, Math.floor(requestedCount)));
  const pool = [...targets];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.max(0, Math.min(index, randomIndex(index + 1)));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, count).map((target) => target.id);
}

function secureRandomIndex(upperExclusive: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % upperExclusive;
}
