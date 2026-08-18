import type { InterfaceLanguage } from "../types";
import type { TargetRecord } from "./types";

export function localizedTargetTitle(target: TargetRecord, language: InterfaceLanguage): string {
  if (language === "pl") return metadataText(target, "titlePl") ?? target.title;
  return metadataText(target, "titleEn") ?? target.title;
}

export function localizedTargetReveal(target: TargetRecord, language: InterfaceLanguage): string | undefined {
  if (language === "pl") return metadataText(target, "revealTextPl") ?? target.revealText;
  return metadataText(target, "revealTextEn") ?? target.revealText;
}

export function localizedTargetRecord(target: TargetRecord, language: InterfaceLanguage): TargetRecord {
  return {
    ...target,
    title: localizedTargetTitle(target, language),
    revealText: localizedTargetReveal(target, language),
  };
}

function metadataText(target: TargetRecord, key: string): string | undefined {
  const value = target.sourceMetadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
