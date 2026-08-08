import type { InterfaceLanguage, SessionLanguageSetting } from "../types";

export function resolveSessionLanguage(
  interfaceLanguage: InterfaceLanguage,
  setting: SessionLanguageSetting,
): InterfaceLanguage {
  return setting === "same" ? interfaceLanguage : setting;
}

export function detectInterfaceLanguage(browserLanguage: string): InterfaceLanguage {
  return browserLanguage.toLowerCase().startsWith("pl") ? "pl" : "en";
}
