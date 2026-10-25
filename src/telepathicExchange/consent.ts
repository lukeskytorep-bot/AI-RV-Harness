export function parseTelepathicSharingConsent(text: string): "yes" | "no" {
  const normalized = text.trim().toLowerCase();
  if (normalized === "yes" || normalized === "tak") return "yes";
  if (normalized === "no" || normalized === "nie") return "no";
  return "no";
}
