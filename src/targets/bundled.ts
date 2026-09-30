import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "./types";
import type { InterfaceLanguage } from "../types";
import { FACTORY_TARGET_LOCALIZATION_PACK_ID, FACTORY_TARGET_LOCALIZATION_PACK_VERSION, getBundledTrainingLocalizationPl, validateBundledTrainingLocalizationsPl } from "./bundledLocalization";

export const LEGACY_FACTORY_TARGET_PACK_ID = "factory-training-targets-84";
export const FACTORY_TARGET_PACK_ID = "factory-training-targets-94";
export const FACTORY_TARGET_PACK_VERSION = "2.0.0";
/** @deprecated kept for export compatibility */
export const STARTER_TARGET_PACK_ID = FACTORY_TARGET_PACK_ID;
/** @deprecated kept for export compatibility */
export const STARTER_TARGET_PACK_VERSION = FACTORY_TARGET_PACK_VERSION;

export const TRAINING_CATEGORIES = [
  "mountains",
  "structures",
  "structures_in_mountain_terrain",
  "water_combined_elements",
  "human_activity",
  "disasters_destruction",
  "space",
  "mixed_targets",
] as const;

export type TrainingCategory = typeof TRAINING_CATEGORIES[number];

export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, Record<InterfaceLanguage, string>> = {
  mountains: { pl: "Góry", en: "Mountains" },
  structures: { pl: "Struktury", en: "Structures" },
  structures_in_mountain_terrain: { pl: "Struktury w terenie górskim", en: "Structures in Mountain Terrain" },
  water_combined_elements: { pl: "Woda i elementy złożone", en: "Water and Combined Elements" },
  human_activity: { pl: "Aktywność człowieka", en: "Human Activity" },
  disasters_destruction: { pl: "Katastrofy i zniszczenia", en: "Disasters and Destruction" },
  space: { pl: "Kosmos", en: "Space" },
  mixed_targets: { pl: "Cele mieszane", en: "Mixed Targets" },
};

const legacyFolderSlot: Record<string, number> = {
  "góry i struktury": 1,
  "struktury na górze": 2,
  "woda z innymi elementami": 3,
  "aktywność ludzka": 4,
  "katastrofy i zniszczenia": 5,
  kosmos: 6,
  różne: 7,
};

const legacyFolderCategory: Record<string, TrainingCategory> = {
  "struktury na górze": "structures_in_mountain_terrain",
  "woda z innymi elementami": "water_combined_elements",
  "aktywność ludzka": "human_activity",
  "katastrofy i zniszczenia": "disasters_destruction",
  kosmos: "space",
  różne: "mixed_targets",
};

const legacyMountainStructureCategoryBySourceFile: Record<string, "mountains" | "structures"> = {
  "target_001SG.md": "mountains",
  "target_0029L.md": "structures",
  "target_002sg.md": "mountains",
  "target_0030L.md": "mountains",
  "target_0032.md": "structures",
  "target_003SG.md": "mountains",
  "target_0040L.md": "mountains",
  "target_0042.md": "structures",
  "target_0043L.md": "structures",
  "target_0046L.md": "structures",
};

type FactoryTargetLocationMetadata = {
  label: string;
  country: string;
  coordinates?: { latitude: number; longitude: number };
};

const newTargetIdentityBySourceFile: Record<string, { id: string; targetId: number; category: "mountains" | "structures"; locationMetadata: FactoryTargetLocationMetadata }> = {
  "alpine_la_berarde.md": { id: "factory_training_08_01", targetId: 85, category: "mountains", locationMetadata: { label: "Saint-Christophe-en-Oisans (La Bérarde), French Alps", country: "France", coordinates: { latitude: 44.939978, longitude: 6.291256 } } },
  "ravnets_peak.md": { id: "factory_training_08_02", targetId: 86, category: "mountains", locationMetadata: { label: "Ravnets Peak, Stara Planina, Stara Zagora Province", country: "Bulgaria" } },
  "mount_fuji.md": { id: "factory_training_08_03", targetId: 87, category: "mountains", locationMetadata: { label: "Mount Fuji (Fuji-san), Honshu", country: "Japan" } },
  "krzyzna_gora.md": { id: "factory_training_08_04", targetId: 88, category: "mountains", locationMetadata: { label: "Krzyżna Góra, Góry Sokole", country: "Poland" } },
  "adrspach_teplice_rocks.md": { id: "factory_training_08_05", targetId: 89, category: "mountains", locationMetadata: { label: "Adršpašsko-teplické skály, Adršpach / Teplice nad Metují", country: "Czech Republic" } },
  "silesian_railway_museum.md": { id: "factory_training_08_06", targetId: 90, category: "structures", locationMetadata: { label: "Silesian Railway Museum, Jaworzyna Śląska", country: "Poland" } },
  "eiffel_tower.md": { id: "factory_training_08_07", targetId: 91, category: "structures", locationMetadata: { label: "Eiffel Tower, Paris", country: "France" } },
  "temple_million_bottles.md": { id: "factory_training_08_08", targetId: 92, category: "structures", locationMetadata: { label: "Wat Pa Maha Chedi Kaew, Khun Han, Sisaket", country: "Thailand" } },
  "na_radosti_40_prague.md": { id: "factory_training_08_09", targetId: 93, category: "structures", locationMetadata: { label: "40 Na Radosti Street, Zličín, Prague", country: "Czech Republic" } },
  "fribourg_ice_palace.md": { id: "factory_training_08_10", targetId: 94, category: "structures", locationMetadata: { label: "Fribourg Ice Palace, Fribourg", country: "Switzerland" } },
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
  classificationSync?: boolean;
  locationMetadata?: FactoryTargetLocationMetadata;
  title: string;
  titlePl: string;
  revealText: string;
  revealTextPl: string;
}

type RawSource = { path: string; folder: string; sourceFile: string; revealText: string };
type IdentifiedSource = RawSource & {
  id: string;
  targetId: number;
  category: TrainingCategory;
  subtype?: "mountain" | "structure";
  classificationSync?: boolean;
  locationMetadata?: FactoryTargetLocationMetadata;
};

const rawSources: RawSource[] = Object.entries(sourceModules).map(([path, revealText]) => {
  const parts = path.split("/");
  return { path, folder: parts.at(-2) ?? "", sourceFile: parts.at(-1) ?? path, revealText };
});

function legacyTargetId(slot: number, order: number): number {
  if (slot >= 1 && slot <= 6) return ((slot - 1) * 10) + order;
  if (slot === 7) return 60 + order;
  throw new Error(`Unknown legacy Training Target slot: ${slot}`);
}

function identifySource(source: RawSource): IdentifiedSource {
  const added = newTargetIdentityBySourceFile[source.sourceFile];
  if (added && (source.folder === "mountains" || source.folder === "structures")) {
    return {
      ...source,
      ...added,
      subtype: added.category === "mountains" ? "mountain" : "structure",
      locationMetadata: added.locationMetadata,
    };
  }

  const slot = legacyFolderSlot[source.folder];
  if (!slot) throw new Error(`Unknown Training Target category folder: ${source.folder}`);
  const siblings = rawSources
    .filter((item) => item.folder === source.folder && legacyFolderSlot[item.folder] === slot)
    .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile, "en", { numeric: true }));
  const order = siblings.findIndex((item) => item.path === source.path) + 1;
  if (order <= 0) throw new Error(`Unable to determine stable legacy Training Target order: ${source.path}`);
  const stableCategory = String(slot).padStart(2, "0");
  const stableOrder = String(order).padStart(2, "0");
  const id = `factory_training_${stableCategory}_${stableOrder}`;

  if (slot === 1) {
    const category = legacyMountainStructureCategoryBySourceFile[source.sourceFile];
    if (!category) throw new Error(`Unclassified legacy mountain/structure Training Target: ${source.sourceFile}`);
    return {
      ...source,
      id,
      targetId: legacyTargetId(slot, order),
      category,
      subtype: category === "mountains" ? "mountain" : "structure",
      classificationSync: true,
    };
  }

  const category = legacyFolderCategory[source.folder];
  if (!category) throw new Error(`Unknown legacy Training Target category folder: ${source.folder}`);
  return { ...source, id, targetId: legacyTargetId(slot, order), category };
}

const categoryCounts = new Map<TrainingCategory, number>();

export const BUNDLED_TRAINING_TARGETS: readonly BundledTrainingTarget[] = rawSources
  .map(identifySource)
  .sort((a, b) => a.targetId - b.targetId)
  .map((source) => {
    const categoryOrder = (categoryCounts.get(source.category) ?? 0) + 1;
    categoryCounts.set(source.category, categoryOrder);
    const localization = getBundledTrainingLocalizationPl(source.id);
    const stableOrder = String(categoryOrder).padStart(2, "0");
    const title = extractTargetTitle(source.revealText) || `${TRAINING_CATEGORY_LABELS[source.category].en} ${stableOrder}`;
    return {
      id: source.id,
      targetId: source.targetId,
      sourceFile: source.sourceFile,
      category: source.category,
      categoryOrder,
      ...(source.subtype ? { subtype: source.subtype } : {}),
      ...(source.classificationSync ? { classificationSync: true } : {}),
      ...(source.locationMetadata ? { locationMetadata: source.locationMetadata } : {}),
      title,
      titlePl: localization.titlePl,
      revealText: normalizeSource(source.revealText),
      revealTextPl: localization.revealTextPl,
    };
  });

export interface TrainingPackValidation {
  valid: boolean;
  total: number;
  expectedTotal: 94;
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
  if (targets.length !== 94) errors.push(`total: ${targets.length}/94`);
  for (const target of targets.filter((item) => item.targetId >= 85)) {
    if (!target.locationMetadata?.label.trim() || !target.locationMetadata.country.trim()) {
      errors.push(`location metadata: ${target.id}`);
    }
  }
  if (new Set(targets.map((target) => target.id)).size !== targets.length) errors.push("duplicate factory target ids");
  if (new Set(targets.map((target) => target.targetId)).size !== targets.length) errors.push("duplicate factory target sequence ids");
  const localizationValidation = validateBundledTrainingLocalizationsPl(targets.map((target) => target.id));
  errors.push(...localizationValidation.errors.map((error) => `pl: ${error}`));
  return { valid: errors.length === 0, total: targets.length, expectedTotal: 94, counts, errors };
}

type FactorySeedRepository = Pick<AppRepository, "listTargets" | "createTarget" | "syncFactoryTrainingTargetClassification">;

export async function ensureBundledTrainingTargets(repository: FactorySeedRepository): Promise<number> {
  const validation = validateFactoryTrainingPack();
  if (!validation.valid) throw new Error(`Factory Training Target pack is incomplete: ${validation.errors.join(", ")}`);
  const existingTargets = await repository.listTargets();
  const existingById = new Map(existingTargets.map((target) => [target.id, target]));
  let created = 0;
  for (const target of BUNDLED_TRAINING_TARGETS) {
    const localizationMetadata = bundledLocalizationMetadata(target);
    const existing = existingById.get(target.id);
    if (!existing) {
      const createdTarget = await repository.createTarget({
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
          ...(target.locationMetadata ? { location: target.locationMetadata } : {}),
          sourceLegacyId: target.sourceFile,
          ...localizationMetadata,
          license: "CC-BY-4.0",
          attribution: "AI RV Harness contributors — see CREDITS.md",
          provenance: "project_author_supplied",
        },
        contentHash: await sha256Text(target.revealText),
      });
      existingById.set(target.id, createdTarget);
      created += 1;
      continue;
    }

    if (target.classificationSync && classificationDiffers(existing, target)) {
      const sourceMetadata = {
        ...existing.sourceMetadata,
        category: target.category,
        categoryOrder: target.categoryOrder,
        subtype: target.subtype,
      };
      await repository.syncFactoryTrainingTargetClassification(target.id, sourceMetadata);
      existing.sourceMetadata = sourceMetadata;
    }
  }
  return created;
}

function classificationDiffers(existing: TargetRecord, target: BundledTrainingTarget): boolean {
  return existing.sourceMetadata.category !== target.category
    || existing.sourceMetadata.categoryOrder !== target.categoryOrder
    || existing.sourceMetadata.subtype !== target.subtype;
}

function bundledLocalizationMetadata(target: BundledTrainingTarget) {
  return {
    titleEn: target.title,
    titlePl: target.titlePl,
    revealTextEn: target.revealText,
    revealTextPl: target.revealTextPl,
    languages: ["en", "pl"] as ["en", "pl"],
    polishTranslationStatus: "accepted" as const,
    localizationPackId: FACTORY_TARGET_LOCALIZATION_PACK_ID,
    localizationPackVersion: FACTORY_TARGET_LOCALIZATION_PACK_VERSION,
  };
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
