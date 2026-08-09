import type { ResearchConfig, ResearchLockPlan } from "./types";

export async function buildResearchLockPlan(projectId: string, config: ResearchConfig): Promise<ResearchLockPlan> {
  validateConfig(config);
  const configHash = await sha256Text(stableStringify(config));
  const conditionRecords = config.conditions.map((condition) => ({
    id: `condition_${crypto.randomUUID()}`,
    researchProjectId: projectId,
    conditionKey: condition.key,
    config: structuredClone(condition),
  }));
  const conditionByKey = new Map(conditionRecords.map((record) => [record.conditionKey, record]));
  const rows: Array<{ assignment: ResearchLockPlan["assignments"][number]; mapping: ResearchLockPlan["mappings"][number] }> = [];

  for (const targetId of config.targetIds) {
    for (let repetition = 0; repetition < config.repetitions; repetition += 1) {
      const pairKey = `pair_${randomToken(12)}`;
      for (const condition of config.conditions) {
        const conditionRecord = conditionByKey.get(condition.key)!;
        const anonymousSessionId = `BlindSession_${randomToken(12)}`;
        const assignment = {
          id: `assignment_${crypto.randomUUID()}`,
          researchProjectId: projectId,
          anonymousSessionId,
          targetId,
          executionOrder: 0,
          judgeOrder: 0,
          status: "Pending",
        };
        const mappingHash = await sha256Text(stableStringify({ anonymousSessionId, conditionId: conditionRecord.id, pairKey, pairOrder: condition.practiceOrder ?? null }));
        rows.push({
          assignment,
          mapping: {
            id: `mapping_${crypto.randomUUID()}`,
            researchProjectId: projectId,
            anonymousSessionId,
            conditionId: conditionRecord.id,
            pairKey,
            pairOrder: condition.practiceOrder,
            mappingHash,
            createdAt: new Date().toISOString(),
          },
        });
      }
    }
  }

  const execution = config.templateType === "practice"
    ? buildPracticeExecution(rows)
    : shuffle(rows.map((_, index) => index));
  const judging = shuffle(rows.map((_, index) => index));
  execution.forEach((rowIndex, order) => { rows[rowIndex].assignment.executionOrder = order + 1; });
  judging.forEach((rowIndex, order) => { rows[rowIndex].assignment.judgeOrder = order + 1; });
  return {
    configHash,
    conditions: conditionRecords,
    assignments: rows.map((row) => row.assignment),
    mappings: rows.map((row) => row.mapping),
  };
}

function buildPracticeExecution(
  rows: Array<{ mapping: ResearchLockPlan["mappings"][number] }>,
): number[] {
  const pairs = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const pair = pairs.get(row.mapping.pairKey) ?? [];
    pair.push(index);
    pairs.set(row.mapping.pairKey, pair);
  });

  const orderedPairs = [...pairs.values()].map((indices) => {
    if (indices.length !== 2) throw new Error("Practice Effect requires exactly two sessions in every target pair.");
    return [...indices].sort((left, right) => practiceRank(rows[left].mapping.pairOrder) - practiceRank(rows[right].mapping.pairOrder));
  });
  return shuffle(orderedPairs).flat();
}

function practiceRank(value: string | undefined): number {
  if (value === "FIRST") return 0;
  if (value === "SECOND") return 1;
  throw new Error("Practice Effect pair is missing FIRST/SECOND order metadata.");
}

export function validateConfig(config: ResearchConfig): void {
  if (!config.name.trim()) throw new Error("Research name is required.");
  if (config.conditions.length < 2) throw new RangeError("Research requires at least two conditions.");
  if (new Set(config.conditions.map((condition) => condition.key)).size !== config.conditions.length) throw new Error("Research condition keys must be unique.");
  if (!config.targetIds.length || new Set(config.targetIds).size !== config.targetIds.length) throw new Error("Research requires a non-empty unique target pool.");
  if (!Number.isInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 100) throw new RangeError("Research repetitions must be an integer between 1 and 100.");
  if (config.judges.length > 3) throw new RangeError("Research supports at most 3 Judges.");
  if (config.evaluationMode === "ai_judges" && config.judges.length < 1) throw new RangeError("AI Judge evaluation requires 1–3 Judges.");
  if (config.evaluationMode === "save_only" && config.judges.length !== 0) throw new RangeError("Save-only Research must not contain Judge routes.");
  if (config.evaluationMode === undefined && config.judges.length < 1) throw new RangeError("Legacy Research configuration requires 1–3 Judges.");
  if (config.templateType === "practice") {
    const orders = config.conditions.map((condition) => condition.practiceOrder).sort();
    if (orders.length !== 2 || orders[0] !== "FIRST" || orders[1] !== "SECOND") throw new Error("Practice Effect requires exactly FIRST and SECOND conditions.");
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function shuffle<T>(input: T[]): T[] {
  const result = [...input];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swap = random[0] % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function randomToken(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, length).toUpperCase();
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
