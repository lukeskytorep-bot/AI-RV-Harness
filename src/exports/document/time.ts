import type { InterfaceLanguage } from "../../types";

export function formatExportDateTime(value: string | Date, language: InterfaceLanguage): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : date.toISOString();
  return new Intl.DateTimeFormat(language === "pl" ? "pl-PL" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}
