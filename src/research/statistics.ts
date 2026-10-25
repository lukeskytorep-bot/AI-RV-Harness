import type { ConditionStatistics, PairwiseStatistics, UnblindedSessionResult } from "./types";

export function computeConditionStatistics(sessions: UnblindedSessionResult[]): ConditionStatistics[] {
  const byCondition = new Map<string, UnblindedSessionResult[]>();
  for (const session of sessions) byCondition.set(session.conditionKey, [...(byCondition.get(session.conditionKey) ?? []), session]);
  return [...byCondition.entries()].map(([conditionKey, rows]) => {
    const totals = rows.map((row) => row.total);
    return {
      conditionKey,
      label: rows[0].conditionLabel,
      n: rows.length,
      meanTotal: mean(totals),
      medianTotal: median(totals),
      stdDevTotal: stdDev(totals),
      minTotal: Math.min(...totals),
      maxTotal: Math.max(...totals),
      meanComponents: {
        gestalt: mean(rows.map((row) => row.gestalt)),
        verifiableFeatures: mean(rows.map((row) => row.verifiableFeatures)),
        activityFunctionEvent: mean(rows.map((row) => row.activityFunctionEvent)),
        confabulationControl: mean(rows.map((row) => row.confabulationControl)),
      },
    };
  }).sort((a, b) => a.conditionKey.localeCompare(b.conditionKey));
}

export function computePairwiseStatistics(sessions: UnblindedSessionResult[]): PairwiseStatistics[] {
  const conditionKeys = [...new Set(sessions.map((session) => session.conditionKey))].sort();
  const pairs: PairwiseStatistics[] = [];
  for (let a = 0; a < conditionKeys.length; a += 1) {
    for (let b = a + 1; b < conditionKeys.length; b += 1) {
      const conditionA = conditionKeys[a];
      const conditionB = conditionKeys[b];
      const byPair = new Map<string, Map<string, number>>();
      for (const session of sessions.filter((row) => row.conditionKey === conditionA || row.conditionKey === conditionB)) {
        const map = byPair.get(session.pairKey) ?? new Map<string, number>();
        map.set(session.conditionKey, session.total);
        byPair.set(session.pairKey, map);
      }
      const differences: number[] = [];
      let winsA = 0;
      let winsB = 0;
      let ties = 0;
      for (const values of byPair.values()) {
        const va = values.get(conditionA);
        const vb = values.get(conditionB);
        if (va === undefined || vb === undefined) continue;
        const difference = round2(va - vb);
        differences.push(difference);
        if (difference > 0) winsA += 1;
        else if (difference < 0) winsB += 1;
        else ties += 1;
      }
      pairs.push({ conditionA, conditionB, pairedN: differences.length, winsA, ties, winsB, meanPairedDifference: differences.length ? mean(differences) : 0 });
    }
  }
  return pairs;
}

function mean(values: number[]): number {
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round2((sorted[middle - 1] + sorted[middle]) / 2);
}

function stdDev(values: number[]): number {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round2(Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
