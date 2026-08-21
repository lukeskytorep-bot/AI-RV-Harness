import type { TargetRecord } from "../targets/types";
import { BUNDLED_TRAINING_TARGETS, FACTORY_TARGET_PACK_VERSION, TRAINING_CATEGORIES, type TrainingCategory, validateFactoryTrainingPack } from "../targets/bundled";

export const FACTORY_CURRICULUM_ID = "factory-training-curriculum";
export const FACTORY_CURRICULUM_VERSION = "1.0.0";

export interface TrainingCurriculumItem {
  position: number;
  block: number;
  category: TrainingCategory;
  targetId: string;
  sourcePackVersion: string;
}

export function buildFactoryCurriculum(): TrainingCurriculumItem[] {
  const validation = validateFactoryTrainingPack();
  if (!validation.valid) throw new Error(`Factory curriculum unavailable: ${validation.errors.join(", ")}`);
  const mixed = BUNDLED_TRAINING_TARGETS.filter((target) => target.category === "mixed_targets");
  const specialistCategories = TRAINING_CATEGORIES.filter((category) => category !== "mixed_targets");
  const result: TrainingCurriculumItem[] = [];
  let mixedIndex = 0;
  let block = 0;
  for (const category of specialistCategories) {
    const categoryTargets = BUNDLED_TRAINING_TARGETS.filter((target) => target.category === category).slice(0, 10);
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

export function selectPartialTrainingTargets(
  targets: TargetRecord[],
  counts: Partial<Record<TrainingCategory, number>>,
  myTargetsCount = 0,
): TargetRecord[] {
  const selected: TargetRecord[] = [];
  for (const category of TRAINING_CATEGORIES) {
    const count = Math.max(0, Math.floor(counts[category] ?? 0));
    const pool = targets.filter((target) => target.collection === "training" && target.sourceMetadata.category === category);
    if (count > pool.length) throw new Error(`${category}: requested ${count}, available ${pool.length}`);
    selected.push(...shuffle(pool).slice(0, count));
  }
  const userCount = Math.max(0, Math.floor(myTargetsCount));
  const userPool = targets.filter((target) => target.collection === "user");
  if (userCount > userPool.length) throw new Error(`my_targets: requested ${userCount}, available ${userPool.length}`);
  selected.push(...shuffle(userPool).slice(0, userCount));
  return selected;
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swap = random[0] % (index + 1);
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}
