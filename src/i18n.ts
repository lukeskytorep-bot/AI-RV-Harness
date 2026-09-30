import type { InterfaceLanguage } from "./types";
import { en as en_core, pl as pl_core } from "./i18n/core";
import { en as en_workspace, pl as pl_workspace } from "./i18n/workspace";
import { en as en_sessions, pl as pl_sessions } from "./i18n/sessions";
import { en as en_research, pl as pl_research } from "./i18n/research";
import { en as en_targets, pl as pl_targets } from "./i18n/targets";
import { en as en_settings, pl as pl_settings } from "./i18n/settings";

export const en = {
  ...en_core,
  ...en_workspace,
  ...en_sessions,
  ...en_research,
  ...en_targets,
  ...en_settings,
} as const;

export type TranslationKey = keyof typeof en;

const pl: Record<TranslationKey, string> = {
  ...pl_core,
  ...pl_workspace,
  ...pl_sessions,
  ...pl_research,
  ...pl_targets,
  ...pl_settings,
};

export function getCopy(language: InterfaceLanguage): Record<TranslationKey, string> {
  return language === "pl" ? pl : en;
}
