/** Research-only, deterministic aliases. The provider response is never mutated. */
export const RESEARCH_JUDGE_NORMALIZER_VERSION = "research-judge-aliases/v1";
export interface JudgeNormalizationTrace { version: typeof RESEARCH_JUDGE_NORMALIZER_VERSION; aliases: string[]; }
const aliases = {
  strong_matches: "strongestMatches",
  major_misses_contradictions: "majorMissesContradictions",
  confabulation_observations: "confabulationObservations",
  concise_rationale: "conciseRationale",
} as const;
export function normalizeResearchJudgeOutput(content: string): { content: string; trace?: JudgeNormalizationTrace } {
  let value: unknown;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return { content }; } // Existing bounded JSON formatter owns syntax failures.
  if (!value || typeof value !== "object" || Array.isArray(value)) return { content };
  const record = value as Record<string, unknown>, used: string[] = [];
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!Object.hasOwn(record, alias)) continue;
    // Ambiguity is rejected, even if the two supplied values happen to be equal.
    if (Object.hasOwn(record, canonical)) throw new Error(`Conflicting Judge fields: ${canonical} / ${alias}.`);
    record[canonical] = record[alias]; delete record[alias]; used.push(alias);
  }
  return used.length ? { content: JSON.stringify(record), trace: { version: RESEARCH_JUDGE_NORMALIZER_VERSION, aliases: used } } : { content };
}
