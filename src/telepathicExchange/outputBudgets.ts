import type { TelepathicProviderCallRecord } from "./types";

export const TELEPATHIC_OUTPUT_POLICY_VERSION = 3 as const;
export type TelepathicOutputStage = "sender_target" | "sender_transmission_confirmation" | "lead_guidance"
  | "sharing_consent" | "receiver_first" | "receiver_second" | "receiver_guidance" | "receiver_reveal"
  | "sender_reveal" | "shared_answers_comment" | "series_reflection";

/** Output limits, not input/context limits. One shared policy for Conversation and Training. */
export const TELEPATHIC_OUTPUT_BUDGETS_V2: Readonly<Record<TelepathicOutputStage, readonly [number, number]>> = {
  sender_target: [16384, 32768], sender_transmission_confirmation: [16384, 32768], lead_guidance: [16384, 32768],
  sharing_consent: [8192, 16384], receiver_first: [16384, 32768], receiver_second: [16384, 32768],
  receiver_guidance: [16384, 32768], receiver_reveal: [16384, 32768], sender_reveal: [16384, 32768],
  shared_answers_comment: [16384, 32768], series_reflection: [16384, 32768],
};
// Keep v1/v2 tables independent of the current policy. Historical snapshots
// and fingerprints must retain their exact pairs after an application update.
export const TELEPATHIC_OUTPUT_BUDGETS: Readonly<Record<TelepathicOutputStage, readonly [number, number]>> = {
  ...TELEPATHIC_OUTPUT_BUDGETS_V2,
  receiver_reveal: [32768, 49152], sender_reveal: [32768, 49152],
  shared_answers_comment: [32768, 49152], series_reflection: [32768, 49152],
};
const LEGACY_OUTPUT_BUDGETS: Readonly<Record<TelepathicOutputStage, readonly [number, number]>> = {
  ...TELEPATHIC_OUTPUT_BUDGETS_V2, sender_target: [4096, 4096], sender_transmission_confirmation: [4096, 4096],
  lead_guidance: [4096, 4096], sharing_consent: [4096, 4096], receiver_second: [4096, 4096],
};
for (const table of [LEGACY_OUTPUT_BUDGETS, TELEPATHIC_OUTPUT_BUDGETS_V2, TELEPATHIC_OUTPUT_BUDGETS]) {
  for (const pair of Object.values(table)) Object.freeze(pair);
  Object.freeze(table);
}
export interface TelepathicOutputBudgetSnapshot {
  version: 1 | 2 | 3;
  stage: TelepathicOutputStage;
  attemptLimits: [number, number];
  modelMaxOutputTokens?: number;
}
export interface TelepathicOutputDiagnostics {
  policyVersion?: 1 | 2 | 3;
  requestedMaxOutputTokens?: number;
  effectiveMaxOutputTokens?: number;
  modelMaxOutputTokens?: number;
  completion: "unknown" | "partial" | "complete";
}

export function telepathicOutputStage(callStage: string): TelepathicOutputStage {
  if (Object.prototype.hasOwnProperty.call(TELEPATHIC_OUTPUT_BUDGETS, callStage)) return callStage as TelepathicOutputStage;
  const [stage, qualifier, cycle, ...tail] = callStage.split(":");
  if (qualifier === "cycle" && ["1", "2", "3"].includes(cycle)) {
    if (stage === "lead_guidance" && tail.length === 0) return "lead_guidance";
    if (stage === "receiver_guidance" && tail[0] === "recipient" && tail.slice(1).join(":").trim()) return "receiver_guidance";
  }
  throw new Error(`Unknown Telepathic output stage: ${callStage}`);
}

function validateCeiling(value?: number): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid model maximum output limit.");
}
function limits(version: 1 | 2 | 3, stage: TelepathicOutputStage) {
  return (version === 1 ? LEGACY_OUTPUT_BUDGETS : version === 2 ? TELEPATHIC_OUTPUT_BUDGETS_V2 : TELEPATHIC_OUTPUT_BUDGETS)[stage];
}
export function validateOutputBudgetSnapshot(snapshot: TelepathicOutputBudgetSnapshot, callStage: string, modelMaxOutputTokens?: number): void {
  const stage = telepathicOutputStage(callStage);
  validateCeiling(modelMaxOutputTokens);
  if (!snapshot || ![1, 2, 3].includes(snapshot.version) || snapshot.stage !== stage || !Array.isArray(snapshot.attemptLimits)
    || snapshot.attemptLimits.length !== 2 || JSON.stringify(snapshot.attemptLimits) !== JSON.stringify(limits(snapshot.version, stage))
    || snapshot.modelMaxOutputTokens !== modelMaxOutputTokens) {
    throw new Error("Frozen Telepathic output policy/model ceiling changed; dispatch blocked.");
  }
}

/** Freeze per logical scope. Legacy scopes keep their original fingerprint and budget, never a fresh counter. */
export function scopeOutputBudget(callStage: string, modelMaxOutputTokens: number | undefined, existing: TelepathicProviderCallRecord[] = [], configuredVersion?: 2 | 3): TelepathicOutputBudgetSnapshot {
  if (configuredVersion !== undefined && ![2, 3].includes(configuredVersion)) throw new Error("Unsupported Telepathic output policy version.");
  const stage = telepathicOutputStage(callStage);
  validateCeiling(modelMaxOutputTokens);
  const snapshots = existing.flatMap(call => call.outputBudgetSnapshot ? [call.outputBudgetSnapshot] : []);
  const version = snapshots[0]?.version ?? (existing.length ? 1 : configuredVersion ?? TELEPATHIC_OUTPUT_POLICY_VERSION);
  const snapshot = snapshots[0] ?? { version, stage, attemptLimits: [...limits(version, stage)] as [number, number], ...(modelMaxOutputTokens !== undefined ? { modelMaxOutputTokens } : {}) };
  validateOutputBudgetSnapshot(snapshot, callStage, modelMaxOutputTokens);
  if (snapshots.some(other => JSON.stringify(other) !== JSON.stringify(snapshot))
    || version >= 2 && existing.some(call => !call.outputBudgetSnapshot)) throw new Error("Inconsistent durable Telepathic output snapshots.");
  return structuredClone(snapshot);
}

export function outputAttemptBudget(snapshot: TelepathicOutputBudgetSnapshot, technicalAttempt: number) {
  if (!Number.isSafeInteger(technicalAttempt) || ![1, 2].includes(technicalAttempt)) throw new Error("Telepathic stage attempts exhausted; only two attempts are allowed.");
  const requested = snapshot.attemptLimits[technicalAttempt - 1];
  return { requested, effective: Math.min(requested, snapshot.modelMaxOutputTokens ?? requested) };
}

export function nextDurableTechnicalAttempt(existing: TelepathicProviderCallRecord[]): number {
  if (existing.some(call => ![1, 2].includes(call.technicalAttempt))) throw new Error("Invalid durable Telepathic attempt level.");
  return Math.max(1, ...existing.map(call => call.technicalAttempt + (call.status === "failed" ? 1 : 0)));
}

export function lengthRecoveryUnavailable(snapshot: TelepathicOutputBudgetSnapshot, existing: TelepathicProviderCallRecord[]): boolean {
  const latestFailed = [...existing].reverse().find(call => call.status === "failed");
  if (!latestFailed || !["length", "max_tokens", "max_output_tokens", "max_completion_tokens"].includes(String(latestFailed.finishReason ?? "").trim().toLowerCase().replace(/[ -]/g, "_"))) return false;
  // Match the old restriction for old scopes; the new policy applies it consistently to every stage.
  if (snapshot.version === 1 && !["receiver_first", "receiver_guidance"].includes(snapshot.stage)) return false;
  return outputAttemptBudget(snapshot, 2).effective <= outputAttemptBudget(snapshot, 1).effective;
}
