/** Bounded final-channel candidate. Private reasoning channels are never copied. */
export const MAX_FINAL_CANDIDATE_BYTES = 2_000_000;
export interface ProviderFinalCandidate {
  content: string | null;
  contentSha256: string;
  byteLength: number;
  omittedForSize: boolean;
  envelopeRemoved: boolean;
  nativeValidation: "accepted" | "rejected" | "not_evaluated";
}
export function parseProviderFinalCandidate(value: unknown): ProviderFinalCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.contentSha256)
    || !Number.isSafeInteger(v.byteLength) || Number(v.byteLength) < 0
    || typeof v.omittedForSize !== "boolean" || typeof v.envelopeRemoved !== "boolean"
    || !["accepted", "rejected", "not_evaluated"].includes(String(v.nativeValidation))) return undefined;
  if (v.omittedForSize ? v.content !== null || Number(v.byteLength) <= MAX_FINAL_CANDIDATE_BYTES
    : typeof v.content !== "string" || v.content.length > MAX_FINAL_CANDIDATE_BYTES || new TextEncoder().encode(v.content).length !== v.byteLength || Number(v.byteLength) > MAX_FINAL_CANDIDATE_BYTES) return undefined;
  return { content: v.content as string | null, contentSha256: v.contentSha256, byteLength: Number(v.byteLength), omittedForSize: v.omittedForSize, envelopeRemoved: v.envelopeRemoved, nativeValidation: v.nativeValidation as ProviderFinalCandidate["nativeValidation"] };
}
