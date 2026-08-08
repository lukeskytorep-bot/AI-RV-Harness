export function createSessionCode(prefix = "RVH"): string {
  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "RVH";
  return `${cleanPrefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}
