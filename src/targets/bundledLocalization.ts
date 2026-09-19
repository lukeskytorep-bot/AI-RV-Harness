const polishModules = import.meta.glob<string>("../resources/training-targets-localized/pl/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

export const FACTORY_TARGET_LOCALIZATION_PACK_ID = "factory-training-target-localization-pl";
export const FACTORY_TARGET_LOCALIZATION_PACK_VERSION = "1.0.0-r1";

export interface BundledTrainingTargetLocalization {
  id: string;
  titlePl: string;
  revealTextPl: string;
  sourceFile: string;
}

export const BUNDLED_TRAINING_LOCALIZATIONS_PL: readonly BundledTrainingTargetLocalization[] = Object.entries(polishModules)
  .map(([path, raw]) => {
    const sourceFile = path.split("/").at(-1) ?? path;
    const match = sourceFile.match(/^(\d{2}_\d{2})\.md$/);
    if (!match) throw new Error(`Invalid Polish Training Target localization file: ${sourceFile}`);
    const titlePl = extractPolishTargetTitle(raw);
    if (!titlePl) throw new Error(`Missing Polish Training Target title: ${sourceFile}`);
    return {
      id: `factory_training_${match[1]}`,
      titlePl,
      revealTextPl: normalizePolishSource(raw),
      sourceFile,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

const polishById = new Map(BUNDLED_TRAINING_LOCALIZATIONS_PL.map((item) => [item.id, item]));

export function getBundledTrainingLocalizationPl(id: string): BundledTrainingTargetLocalization {
  const localization = polishById.get(id);
  if (!localization) throw new Error(`Missing accepted Polish Training Target localization: ${id}`);
  return localization;
}

export function validateBundledTrainingLocalizationsPl(expectedIds: readonly string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const expected = new Set(expectedIds);
  if (BUNDLED_TRAINING_LOCALIZATIONS_PL.length !== expectedIds.length) {
    errors.push(`count: ${BUNDLED_TRAINING_LOCALIZATIONS_PL.length}/${expectedIds.length}`);
  }
  for (const id of expectedIds) {
    const item = polishById.get(id);
    if (!item) errors.push(`missing: ${id}`);
    else if (!item.revealTextPl.trim()) errors.push(`empty: ${id}`);
  }
  for (const item of BUNDLED_TRAINING_LOCALIZATIONS_PL) {
    if (!expected.has(item.id)) errors.push(`orphan: ${item.id}`);
  }
  return { valid: errors.length === 0, errors };
}

function extractPolishTargetTitle(content: string): string {
  const explicit = content.match(/^\s*(?:[-*]\s*)?\*\*Cel:\*\*\s*(.+?)\s*$/mi)?.[1]
    ?? content.match(/^#\s*Cel:\s*(.+?)\s*$/mi)?.[1];
  return explicit?.trim() ?? "";
}

function normalizePolishSource(content: string): string {
  return content
    .replace(/^#{1,2}\s*(?:Cel(?:\s+\d[^\n]*|_[^\n]*)|Cel treningowy[^\n]*)\n+/gim, "")
    .replace(/^Cel\s+\d+[A-Z]?\s*[-–—][^\n]*\n?/gim, "")
    .replace(/^Data celu\s*:[^\n]*\n?/gim, "")
    .replace(/^Współrzędne celu\s*:[^\n]*\n?/gim, "")
    .replace(/^\*\*(?:ID celu|Współrzędne celu|Data celu)\s*:?\*\*\s*:?[^\n]*\n?/gim, "")
    .trim();
}
