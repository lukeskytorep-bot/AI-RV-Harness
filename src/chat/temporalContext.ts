import type { InterfaceLanguage } from "../types";

export function buildLocalTemporalContext(language: InterfaceLanguage, now = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const offset = formatUtcOffset(now);
  const localDateTime = new Intl.DateTimeFormat(language === "pl" ? "pl-PL" : "en-GB", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(now);
  return language === "pl"
    ? `[LOKALNY KONTEKST CZASOWY]\nBieżąca lokalna data i godzina urządzenia: ${localDateTime}. Strefa IANA: ${timeZone}. Przesunięcie UTC: ${offset}. Używaj tej informacji wyłącznie jako kontekstu czasowego; nie wspominaj o niej, chyba że jest istotna dla rozmowy.`
    : `[LOCAL TEMPORAL CONTEXT]\nCurrent local device date and time: ${localDateTime}. IANA time zone: ${timeZone}. UTC offset: ${offset}. Use this only as temporal context; do not mention it unless it is relevant to the conversation.`;
}

function formatUtcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
