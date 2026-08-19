import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";

export const FACTORY_TARGET_PACK_ID = "factory-training-targets-84";
export const FACTORY_TARGET_PACK_VERSION = "1.0.0";
/** @deprecated kept for export compatibility */
export const STARTER_TARGET_PACK_ID = FACTORY_TARGET_PACK_ID;
/** @deprecated kept for export compatibility */
export const STARTER_TARGET_PACK_VERSION = FACTORY_TARGET_PACK_VERSION;

export const TRAINING_CATEGORIES = [
  "mountain_structure_contrast",
  "structures_in_mountain_terrain",
  "water_combined_elements",
  "human_activity",
  "disasters_destruction",
  "space",
  "mixed_targets",
] as const;

export type TrainingCategory = typeof TRAINING_CATEGORIES[number];

export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, Record<InterfaceLanguage, string>> = {
  mountain_structure_contrast: { pl: "Góry i struktury — kontrast", en: "Mountains and Structures — Contrast" },
  structures_in_mountain_terrain: { pl: "Struktury w terenie górskim", en: "Structures in Mountain Terrain" },
  water_combined_elements: { pl: "Woda i elementy towarzyszące", en: "Water and Combined Elements" },
  human_activity: { pl: "Aktywność ludzka", en: "Human Activity" },
  disasters_destruction: { pl: "Katastrofy i zniszczenia", en: "Disasters and Destruction" },
  space: { pl: "Kosmos", en: "Space" },
  mixed_targets: { pl: "Cele mieszane", en: "Mixed Targets" },
};

const folderCategory: Record<string, TrainingCategory> = {
  "góry i struktury": "mountain_structure_contrast",
  "struktury na górze": "structures_in_mountain_terrain",
  "woda z innymi elementami": "water_combined_elements",
  "aktywność ludzka": "human_activity",
  "katastrofy i zniszczenia": "disasters_destruction",
  kosmos: "space",
  różne: "mixed_targets",
};

const sourceModules = import.meta.glob<string>("../resources/training-targets-source/**/*.{md,txt}", {
  eager: true,
  query: "?raw",
  import: "default",
});

export interface BundledTrainingTarget {
  id: string;
  targetId: number;
  sourceFile: string;
  category: TrainingCategory;
  categoryOrder: number;
  subtype?: "mountain" | "structure";
  title: string;
  titlePl?: string;
  revealText: string;
  revealTextPl?: string;
}

const categoryIndex = new Map(TRAINING_CATEGORIES.map((category, index) => [category, index]));

export const BUNDLED_TRAINING_TARGETS: readonly BundledTrainingTarget[] = Object.entries(sourceModules)
  .map(([path, revealText]) => {
    const parts = path.split("/");
    const folder = parts.at(-2) ?? "";
    const category = folderCategory[folder];
    if (!category) throw new Error(`Unknown Training Target category folder: ${folder}`);
    return { path, sourceFile: parts.at(-1) ?? path, category, revealText };
  })
  .sort((a, b) => (categoryIndex.get(a.category)! - categoryIndex.get(b.category)!) || a.sourceFile.localeCompare(b.sourceFile, "en", { numeric: true }))
  .map((source, targetIndex, all) => {
    const categoryOrder = all.slice(0, targetIndex).filter((item) => item.category === source.category).length + 1;
    const stableCategory = String(categoryIndex.get(source.category)! + 1).padStart(2, "0");
    const stableOrder = String(categoryOrder).padStart(2, "0");
    const title = extractTargetTitle(source.revealText) || `${TRAINING_CATEGORY_LABELS[source.category].en} ${stableOrder}`;
    return {
      id: `factory_training_${stableCategory}_${stableOrder}`,
      targetId: targetIndex + 1,
      sourceFile: source.sourceFile,
      category: source.category,
      categoryOrder,
      ...(source.category === "mountain_structure_contrast" ? { subtype: categoryOrder % 2 === 1 ? "mountain" as const : "structure" as const } : {}),
      title,
      revealText: normalizeSource(source.revealText),
    };
  });

export interface TrainingPackValidation {
  valid: boolean;
  total: number;
  expectedTotal: 84;
  counts: Record<TrainingCategory, number>;
  errors: string[];
}

export function validateFactoryTrainingPack(targets = BUNDLED_TRAINING_TARGETS): TrainingPackValidation {
  const counts = Object.fromEntries(TRAINING_CATEGORIES.map((category) => [category, 0])) as Record<TrainingCategory, number>;
  for (const target of targets) counts[target.category] += 1;
  const errors: string[] = [];
  for (const category of TRAINING_CATEGORIES) {
    const minimum = category === "mixed_targets" ? 24 : 10;
    if (counts[category] < minimum) errors.push(`${category}: ${counts[category]}/${minimum}`);
  }
  if (targets.length !== 84) errors.push(`total: ${targets.length}/84`);
  return { valid: errors.length === 0, total: targets.length, expectedTotal: 84, counts, errors };
}

export async function ensureBundledTrainingTargets(repository: Pick<AppRepository, "listTargets" | "createTarget">): Promise<number> {
  const validation = validateFactoryTrainingPack();
  if (!validation.valid) throw new Error(`Factory Training Target pack is incomplete: ${validation.errors.join(", ")}`);
  const existingIds = new Set((await repository.listTargets()).map((target) => target.id));
  let created = 0;
  for (const target of BUNDLED_TRAINING_TARGETS) {
    if (existingIds.has(target.id)) continue;
    await repository.createTarget({
      id: target.id,
      collection: "training",
      title: target.title,
      revealText: target.revealText,
      tags: ["factory-training", target.category, ...(target.subtype ? [target.subtype] : [])],
      sourceMetadata: {
        origin: "bundled_factory_training_pack",
        packId: FACTORY_TARGET_PACK_ID,
        packVersion: FACTORY_TARGET_PACK_VERSION,
        category: target.category,
        categoryOrder: target.categoryOrder,
        curriculumOrder: target.targetId,
        subtype: target.subtype,
        sourceLegacyId: target.sourceFile,
        ...(target.titlePl ? { titlePl: target.titlePl } : {}),
        ...(target.revealTextPl ? { revealTextPl: target.revealTextPl } : {}),
        languages: ["en"],
        polishTranslationStatus: "not_supplied",
        license: "CC-BY-4.0",
        attribution: "AI RV Harness contributors — see CREDITS.md",
        provenance: "project_author_supplied",
      },
      contentHash: await sha256Text(target.revealText),
    });
    existingIds.add(target.id);
    created += 1;
  }
  return created;
}

export function isFactoryTrainingTargetId(id: string): boolean {
  return id.startsWith("factory_training_");
}

function extractTargetTitle(content: string): string {
  const explicit = content.match(/^\s*(?:[-*]\s*)?\*\*Target:\*\*\s*(.+?)\s*$/mi)?.[1]
    ?? content.match(/^#\s*Target:\s*(.+?)\s*$/mi)?.[1];
  if (explicit?.trim()) return explicit.trim();
  const headings = [...content.matchAll(/^#\s+(.+?)\s*$/gm)].map((match) => match[1].trim());
  return headings.find((heading) => !/^(?:Target(?:\s+\d|_|\s*-|$)|Training Target\b)/i.test(heading)) ?? "";
}

function normalizeSource(content: string): string {
  return content
    .replace(/^#{1,2}\s*(?:Target(?:\s+\d[^\n]*|_[^\n]*)|Training Target[^\n]*)\n+/gim, "")
    .replace(/^Target\s+\d+[A-Z]?\s*[-–—][^\n]*\n?/gim, "")
    .replace(/^Date of (?:the )?target\s*:[^\n]*\n?/gim, "")
    .replace(/^Target coordinates\s*:[^\n]*\n?/gim, "")
    .replace(/^\*\*(?:Target ID|Target coordinates|Date of (?:the )?target)\s*:?\*\*\s*:?[^\n]*\n?/gim, "")
    .replace(/^\s*[*-]\s*\*\*(?:TRN\s*\(Identifier\)|Target Date and Time|Coordinates\s*\(GPS\))\s*:\*\*[^\n]*\n?/gim, "")
    .trim();
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
