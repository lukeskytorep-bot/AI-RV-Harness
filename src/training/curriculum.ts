import type { TargetRecord, TargetUsageRecord } from "../targets/types";
import { BUNDLED_TRAINING_TARGETS, FACTORY_TARGET_PACK_VERSION, TRAINING_CATEGORIES, type TrainingCategory, validateFactoryTrainingPack } from "../targets/bundled";
import { userTargetKind } from "../targets/service";

export const FACTORY_CURRICULUM_ID = "factory-training-curriculum";
export const LEGACY_FACTORY_CURRICULUM_VERSION = "1.0.0";
export const FACTORY_CURRICULUM_VERSION = "2.0.0";
export const FACTORY_PLANNER_VERSION = "full-rounds-v1";
export const FACTORY_ROUND_SIZE = 8;
export const MAX_FACTORY_ROUNDS = 10;

export type TrainingTargetRepeatPolicy = "allow" | "avoid_profile";

export interface TrainingCurriculumItem {
  position: number;
  block: number;
  category: TrainingCategory;
  targetId: string;
  sourcePackVersion: string;
}

export interface TrainingPoolAvailability {
  total: number;
  remaining: number;
  available: number;
}

export interface TrainingAvailability {
  categories: Record<TrainingCategory, TrainingPoolAvailability>;
  myTargets: TrainingPoolAvailability;
}

export interface FactoryTrainingPlan {
  targetIds: string[];
  rounds: string[][];
  roundCount: number;
  roundSize: typeof FACTORY_ROUND_SIZE;
  plannerVersion: typeof FACTORY_PLANNER_VERSION;
  repeatPolicy: TrainingTargetRepeatPolicy;
  availability: TrainingAvailability;
  maxRounds: number;
}

/**
 * Historical 84-target curriculum retained only for legacy run compatibility/tests.
 * New Stage 3 Full Training runs are created by planFactoryTrainingRun().
 */
export function buildFactoryCurriculum(): TrainingCurriculumItem[] {
  const validation = validateFactoryTrainingPack();
  if (!validation.valid) throw new Error(`Factory curriculum unavailable: ${validation.errors.join(", ")}`);
  const mixed = BUNDLED_TRAINING_TARGETS.filter((target) => target.category === "mixed_targets");
  // Stage 2 expands the pack to eight categories, but Full Training remains on the
  // historical 84-target / 12-block curriculum until Stage 3 introduces rounds.
  // Keep the original first ten IDs as one legacy curriculum group even though
  // their persisted metadata is now correctly split between mountains/structures.
  const legacySpecialistGroups = [
    BUNDLED_TRAINING_TARGETS.filter((target) => target.id.startsWith("factory_training_01_")),
    ...([
      "structures_in_mountain_terrain",
      "water_combined_elements",
      "human_activity",
      "disasters_destruction",
      "space",
    ] as const).map((category) => BUNDLED_TRAINING_TARGETS.filter((target) => target.category === category)),
  ];
  const result: TrainingCurriculumItem[] = [];
  let mixedIndex = 0;
  let block = 0;
  for (const categoryTargets of legacySpecialistGroups) {
    for (const half of [categoryTargets.slice(0, 5), categoryTargets.slice(5, 10)]) {
      block += 1;
      for (const target of [...half, ...mixed.slice(mixedIndex, mixedIndex + 2)]) {
        result.push({ position: result.length + 1, block, category: target.category, targetId: target.id, sourcePackVersion: FACTORY_TARGET_PACK_VERSION });
      }
      mixedIndex += 2;
    }
  }
  if (result.length !== 84 || new Set(result.map((item) => item.targetId)).size !== 84) throw new Error("Factory curriculum must contain 84 unique targets.");
  return result;
}

export function buildTrainingAvailability(
  targets: TargetRecord[],
  usage: TargetUsageRecord[],
  profileId: string,
  repeatPolicy: TrainingTargetRepeatPolicy,
): TrainingAvailability {
  const used = usedTargetIdsForProfile(usage, profileId);
  const categories = Object.fromEntries(TRAINING_CATEGORIES.map((category) => {
    const pool = targets.filter((target) => target.collection === "training" && target.sourceMetadata.category === category);
    const remaining = pool.filter((target) => !used.has(target.id)).length;
    return [category, { total: pool.length, remaining, available: repeatPolicy === "allow" ? pool.length : remaining }];
  })) as Record<TrainingCategory, TrainingPoolAvailability>;
  const myPool = targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general");
  const myRemaining = myPool.filter((target) => !used.has(target.id)).length;
  return {
    categories,
    myTargets: { total: myPool.length, remaining: myRemaining, available: repeatPolicy === "allow" ? myPool.length : myRemaining },
  };
}

export function limitingFactoryCategory(availability: TrainingAvailability): TrainingCategory {
  return TRAINING_CATEGORIES.reduce((limiting, category) =>
    availability.categories[category].available < availability.categories[limiting].available
      ? category
      : limiting,
  );
}

export function maxFullTrainingRounds(availability: TrainingAvailability): number {
  return Math.min(MAX_FACTORY_ROUNDS, availability.categories[limitingFactoryCategory(availability)].available);
}

export function planFactoryTrainingRun(input: {
  targets: TargetRecord[];
  usage: TargetUsageRecord[];
  profileId: string;
  roundCount: number;
  repeatPolicy: TrainingTargetRepeatPolicy;
  randomWord?: () => number;
}): FactoryTrainingPlan {
  const validation = validateFactoryTrainingPack();
  if (!validation.valid) throw new Error(`Factory curriculum unavailable: ${validation.errors.join(", ")}`);
  const roundCount = Math.floor(input.roundCount);
  if (roundCount < 1 || roundCount > MAX_FACTORY_ROUNDS) throw new Error(`round_count: requested ${input.roundCount}, allowed 1-${MAX_FACTORY_ROUNDS}`);
  const availability = buildTrainingAvailability(input.targets, input.usage, input.profileId, input.repeatPolicy);
  const maxRounds = maxFullTrainingRounds(availability);
  if (roundCount > maxRounds) {
    const limiting = limitingFactoryCategory(availability);
    throw new Error(`${limiting}: requested ${roundCount} rounds, available ${availability.categories[limiting].available}`);
  }

  const used = usedTargetIdsForProfile(input.usage, input.profileId);
  const randomWord = input.randomWord ?? secureRandomWord;
  const selectedByCategory = new Map<TrainingCategory, TargetRecord[]>();
  for (const category of TRAINING_CATEGORIES) {
    const fullPool = input.targets.filter((target) => target.collection === "training" && target.sourceMetadata.category === category);
    const pool = input.repeatPolicy === "avoid_profile" ? fullPool.filter((target) => !used.has(target.id)) : fullPool;
    selectedByCategory.set(category, secureShuffle(pool, randomWord).slice(0, roundCount));
  }

  const rounds: string[][] = [];
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const onePerCategory = TRAINING_CATEGORIES.map((category) => {
      const target = selectedByCategory.get(category)?.[roundIndex];
      if (!target) throw new Error(`${category}: no target available for round ${roundIndex + 1}`);
      return target;
    });
    rounds.push(secureShuffle(onePerCategory, randomWord).map((target) => target.id));
  }
  const targetIds = rounds.flat();
  if (targetIds.length !== roundCount * FACTORY_ROUND_SIZE || new Set(targetIds).size !== targetIds.length) {
    throw new Error("Factory Training planner must create unique targets for every round in one Training Run.");
  }
  return {
    targetIds,
    rounds,
    roundCount,
    roundSize: FACTORY_ROUND_SIZE,
    plannerVersion: FACTORY_PLANNER_VERSION,
    repeatPolicy: input.repeatPolicy,
    availability,
    maxRounds,
  };
}

export function selectPartialTrainingTargets(
  targets: TargetRecord[],
  counts: Partial<Record<TrainingCategory, number>>,
  myTargetsCount = 0,
  options?: {
    usage?: TargetUsageRecord[];
    profileId?: string;
    repeatPolicy?: TrainingTargetRepeatPolicy;
    randomWord?: () => number;
  },
): TargetRecord[] {
  const selected: TargetRecord[] = [];
  const repeatPolicy = options?.repeatPolicy ?? "allow";
  const used = options?.profileId ? usedTargetIdsForProfile(options.usage ?? [], options.profileId) : new Set<string>();
  const randomWord = options?.randomWord ?? secureRandomWord;
  for (const category of TRAINING_CATEGORIES) {
    const count = Math.max(0, Math.floor(counts[category] ?? 0));
    const fullPool = targets.filter((target) => target.collection === "training" && target.sourceMetadata.category === category);
    const pool = repeatPolicy === "avoid_profile" ? fullPool.filter((target) => !used.has(target.id)) : fullPool;
    if (count > pool.length) throw new Error(`${category}: requested ${count}, available ${pool.length}`);
    selected.push(...secureShuffle(pool, randomWord).slice(0, count));
  }
  const userCount = Math.max(0, Math.floor(myTargetsCount));
  const fullUserPool = targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general");
  const userPool = repeatPolicy === "avoid_profile" ? fullUserPool.filter((target) => !used.has(target.id)) : fullUserPool;
  if (userCount > userPool.length) throw new Error(`my_targets: requested ${userCount}, available ${userPool.length}`);
  selected.push(...secureShuffle(userPool, randomWord).slice(0, userCount));
  return selected;
}

/** Baseline paid Viewer calls per Training session, excluding any conditional recovery/repair call. */
export function baselineTrainingViewerCallsPerSession(viewerNotesEnabled: boolean): number {
  return 4 + 1 + 1 + (viewerNotesEnabled ? 1 : 0);
}

function usedTargetIdsForProfile(usage: TargetUsageRecord[], profileId: string): Set<string> {
  return new Set(usage.filter((item) => item.profileId === profileId).map((item) => item.targetId));
}

function secureRandomWord(): number {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return random[0];
}

function secureShuffle<T>(items: readonly T[], randomWord: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = randomWord() % (index + 1);
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}
