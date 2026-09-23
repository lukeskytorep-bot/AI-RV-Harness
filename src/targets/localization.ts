import type { InterfaceLanguage } from "../types";
import { getBundledTrainingLocalizationPl } from "./bundledLocalization";
import type { TargetRecord } from "./types";

export function localizedTargetTitle(target: TargetRecord, language: InterfaceLanguage): string {
  if (language === "pl") {
    return metadataText(target, "titlePl")
      ?? bundledFactoryPolish(target)?.titlePl
      ?? target.title;
  }
  return metadataText(target, "titleEn") ?? target.title;
}

export function localizedTargetReveal(target: TargetRecord, language: InterfaceLanguage): string | undefined {
  if (language === "pl") {
    return metadataText(target, "revealTextPl")
      ?? bundledFactoryPolish(target)?.revealTextPl
      ?? target.revealText;
  }
  return metadataText(target, "revealTextEn") ?? target.revealText;
}

export function localizedTargetRecord(target: TargetRecord, language: InterfaceLanguage): TargetRecord {
  return {
    ...target,
    title: localizedTargetTitle(target, language),
    revealText: localizedTargetReveal(target, language),
  };
}

function bundledFactoryPolish(target: TargetRecord) {
  if (target.collection !== "training"
    || target.sourceMetadata.origin !== "bundled_factory_training_pack"
    || target.sourceMetadata.packId !== "factory-training-targets-84") {
    return undefined;
  }
  try {
    return getBundledTrainingLocalizationPl(target.id);
  } catch {
    return undefined;
  }
}

function metadataText(target: TargetRecord, key: string): string | undefined {
  const value = target.sourceMetadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
