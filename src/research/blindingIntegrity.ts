import { hashBlindingMapping } from "./planner";
import type { BlindingMappingRecord, ResearchAssignmentRecord, ResearchConditionRecord, ResearchProjectRecord } from "./types";

function unique<T>(rows: readonly T[], key: (row: T) => string): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const value = key(row);
    if (typeof value !== "string" || !value.trim() || index.has(value)) {
      throw new Error("Research blinding records contain an empty or duplicate identity.");
    }
    index.set(value, row);
  }
  return index;
}

export function indexLockedResearchConditions(project: ResearchProjectRecord, conditions: readonly ResearchConditionRecord[]) {
  const lockedByKey = new Map(project.config.conditions.map(condition => [condition.key, condition]));
  const conditionById = new Map(conditions.map(condition => [condition.id, condition]));
  const keys = new Set(conditions.map(condition => condition.conditionKey));
  if (lockedByKey.size !== project.config.conditions.length
    || conditions.length !== lockedByKey.size || keys.size !== conditions.length || conditionById.size !== conditions.length
    || conditions.some(row => !row.id?.trim() || row.researchProjectId !== project.id
      || row.config?.key !== row.conditionKey || !lockedByKey.has(row.conditionKey))) {
    throw new Error("Locked Research condition set is incomplete or inconsistent.");
  }
  return { lockedByKey, conditionById };
}

export async function validateResearchBlindingMappings(
  project: ResearchProjectRecord,
  assignments: readonly ResearchAssignmentRecord[],
  mappings: readonly BlindingMappingRecord[],
  conditions: ReadonlyMap<string, ResearchConditionRecord>,
): Promise<Map<string, BlindingMappingRecord>> {
  unique(assignments, row => row.id);
  unique(mappings, row => row.id);
  unique(assignments.filter(row => row.sessionId !== undefined), row => row.sessionId!);
  const assignmentByAnonymous = unique(assignments, row => row.anonymousSessionId);
  const mappingByAnonymous = unique(mappings, row => row.anonymousSessionId);
  if (assignments.length !== mappings.length) throw new Error("Research blinding assignments and mappings are incomplete.");
  const targetIds = new Set(project.config.targetIds);
  const pairs = new Map<string, { targetId: string; conditionIds: Set<string> }>();
  for (const mapping of mappings) {
    const assignment = assignmentByAnonymous.get(mapping.anonymousSessionId);
    const condition = conditions.get(mapping.conditionId);
    if (!assignment || !condition || mapping.researchProjectId !== project.id || assignment.researchProjectId !== project.id
      || !targetIds.has(assignment.targetId) || typeof mapping.pairKey !== "string" || !mapping.pairKey.trim()
      || (mapping.pairOrder ?? null) !== (condition.config.practiceOrder ?? null)) {
      throw new Error("Research blinding mapping does not match its assignment or locked condition.");
    }
    if (mapping.mappingHash !== await hashBlindingMapping(mapping)) {
      throw new Error("Research blinding mapping hash does not match Experiment Lock.");
    }
    if (project.templateType === "target_code") {
      const pair = pairs.get(mapping.pairKey) ?? { targetId: assignment.targetId, conditionIds: new Set<string>() };
      if (pair.targetId !== assignment.targetId || pair.conditionIds.has(mapping.conditionId)) {
        throw new Error("Target Code Presence pair has inconsistent targets or duplicate conditions.");
      }
      pair.conditionIds.add(mapping.conditionId);
      pairs.set(mapping.pairKey, pair);
    }
  }
  if (project.templateType === "target_code") {
    const counts = new Map<string, number>();
    for (const pair of pairs.values()) {
      if (pair.conditionIds.size !== conditions.size) throw new Error("Target Code Presence pair is incomplete.");
      counts.set(pair.targetId, (counts.get(pair.targetId) ?? 0) + 1);
    }
    if ([...targetIds].some(id => counts.get(id) !== project.config.repetitions)) {
      throw new Error("Target Code Presence does not contain every locked repetition.");
    }
  }
  return mappingByAnonymous;
}
