import { sha256Text } from "../application/sha256";
import { assertTargetCodeAbsent, isTargetCodeMode, resolveTargetCodeMode } from "../domain/targetCodeMode";
import type { ProviderMessage } from "../providers/types";
import type { Profile } from "../types";
import type { TelepathicSeriesConfig, TelepathicSeriesState, TelepathicTrainingTargetCodePolicy } from "./types";
import { planTelepathicSeries } from "./planner";

const VERSION = "telepathic-training-target-code-v1" as const;
const EXPOSURE = "no_rv_code_assigned" as const;
type Entry = TelepathicTrainingTargetCodePolicy["participants"][number];

function invalidPolicy(): never {
  throw new Error("Invalid frozen Telepathic Training target-code policy.");
}

// Explicit projection, rather than JSON.stringify on objects with arbitrary key order.
// This is a corruption/consistency check, not a signature against malicious rewriting.
async function policyHash(config: TelepathicSeriesConfig, entries: readonly Entry[]): Promise<string> {
  return sha256Text(JSON.stringify({ version: VERSION, exposure: EXPOSURE,
    seriesId: config.seriesId, seriesWorkspaceId: config.seriesWorkspaceId,
    language: config.language, roundCount: config.roundCount,
    participants: entries.map(({ participantId, profileId, mode }) => [participantId, profileId, mode]),
  }));
}

/** Read the authoritative preferences once, before creating any durable series. */
export async function freezeTelepathicTrainingTargetCode(config: TelepathicSeriesConfig, profiles: readonly Profile[]): Promise<TelepathicSeriesConfig> {
  if (config.mode !== "ai_ai_training" || config.trainingTargetCodePolicy !== undefined) invalidPolicy();
  const entries: Entry[] = config.participants.map(item => {
    if (item.kind !== "ai" || !item.ai) invalidPolicy();
    const matching = profiles.filter(profile => profile.id === item.ai!.profileId && !profile.archivedAt);
    if (matching.length !== 1) throw new Error("Telepathic Training requires an active Profile for each frozen target-code preference.");
    return { participantId: item.id, profileId: matching[0].id, mode: resolveTargetCodeMode(matching[0].targetCodeMode) };
  });
  const frozen = structuredClone(config);
  frozen.trainingTargetCodePolicy = { version: VERSION, exposure: EXPOSURE, participants: entries, policySha256: await policyHash(frozen, entries) };
  return frozen;
}

/** Missing policy is legacy; present-but-invalid policy is never a default. */
export async function restoreTelepathicTrainingTargetCode(state: TelepathicSeriesState): Promise<TelepathicTrainingTargetCodePolicy | undefined> {
  const { config, plan, rounds } = state;
  const policy = config.trainingTargetCodePolicy;
  if (policy === undefined) return undefined;
  if (config.mode !== "ai_ai_training" || !policy || policy.version !== VERSION || policy.exposure !== EXPOSURE
    || !Array.isArray(policy.participants) || policy.participants.length !== config.participants.length
    || new Set(config.participants.map(item => item.id)).size !== config.participants.length
    || !Number.isSafeInteger(config.roundCount) || config.roundCount < 1
    || typeof config.seriesId !== "string" || !config.seriesId.trim()
    || typeof policy.policySha256 !== "string" || !/^[a-f0-9]{64}$/.test(policy.policySha256)) invalidPolicy();
  for (const [index, item] of config.participants.entries()) {
    const entry = policy.participants[index];
    if (item.kind !== "ai" || !item.ai || !entry || entry.participantId !== item.id
      || entry.profileId !== item.ai.profileId || !isTargetCodeMode(entry.mode)) invalidPolicy();
  }
  if (new Set(policy.participants.map(entry => entry.profileId)).size !== policy.participants.length
    || await policyHash(config, policy.participants) !== policy.policySha256) invalidPolicy();
  // Round IDs are the target references in this engine. Validate the durable
  // plan and round identity before using them as the protected identifiers.
  if (!plan || plan.seriesId !== config.seriesId || plan.seriesWorkspaceId !== config.seriesWorkspaceId
    || plan.mode !== config.mode || !Array.isArray(plan.rounds) || !Array.isArray(rounds)
    || plan.rounds.length !== config.roundCount || rounds.length !== config.roundCount) invalidPolicy();
  const expectedPlan = planTelepathicSeries({ ...config, trainingTargetCodePolicy: undefined });
  const participantIds = new Set(config.participants.map(item => item.id));
  for (let index = 0; index < config.roundCount; index++) {
    const roundId = `${config.seriesId}:round:${index + 1}`;
    const target = rounds[index]?.target;
    const expected = expectedPlan.rounds[index];
    const planned = plan.rounds[index];
    const assigned = rounds[index]?.assignment;
    const validRoles = (value: typeof planned | undefined) => Boolean(value
      && participantIds.has(value.senderParticipantId)
      && value.receiverParticipantIds.length === new Set(value.receiverParticipantIds).size
      && value.receiverParticipantIds.every(id => participantIds.has(id) && id !== value.senderParticipantId));
    if (planned?.roundId !== roundId || assigned?.roundId !== roundId
      || planned?.roundNumber !== index + 1 || assigned?.roundNumber !== index + 1
      || !validRoles(planned) || !validRoles(assigned)
      || planned.senderParticipantId !== expected.senderParticipantId || assigned.senderParticipantId !== expected.senderParticipantId
      || JSON.stringify(planned.receiverParticipantIds) !== JSON.stringify(expected.receiverParticipantIds)
      || JSON.stringify(assigned.receiverParticipantIds) !== JSON.stringify(expected.receiverParticipantIds)
      || (target && target.roundId !== roundId)) invalidPolicy();
  }
  return policy;
}

/** The guard consumes model-bound messages only, never the packet's scope,
 * ledger, local transcript header, or target integrity metadata. Protect all
 * round IDs, including during shared answers and final-series reflection. */
export function telepathicTrainingTargetCodeGuard(state: TelepathicSeriesState, policy: TelepathicTrainingTargetCodePolicy | undefined, participantId: string): ((messages: ProviderMessage[]) => void) | undefined {
  if (!policy) return undefined;
  const entry = policy.participants.find(item => item.participantId === participantId);
  if (!entry) invalidPolicy();
  if (entry.mode === "with_code") return undefined;
  const codes = state.plan.rounds.map(round => round.roundId);
  return messages => {
    for (const code of codes) assertTargetCodeAbsent("without_code", code, messages);
  };
}

/** Presentation only: native protocol sends no RV code in either preference.
 * Do not mistake an absent or malformed saved preference for a guarded run. */
export function telepathicTrainingTargetCodeSummary(config: TelepathicSeriesConfig, pl: boolean): string {
  const policy = config.trainingTargetCodePolicy;
  if (policy === undefined) return pl ? "Historyczna seria · bez zapisanej preferencji" : "Legacy series · no recorded preference";
  if (!policy || policy.version !== VERSION || policy.exposure !== EXPOSURE || !Array.isArray(policy.participants)
    || policy.participants.length !== config.participants.length
    || policy.participants.some((entry, index) => !entry || entry.participantId !== config.participants[index]?.id
      || entry.profileId !== config.participants[index]?.ai?.profileId || !isTargetCodeMode(entry.mode))) {
    return pl ? "Nieprawidłowa zapisana polityka" : "Invalid stored policy";
  }
  return policy.participants.map((entry, index) => `${config.participants[index].displayName}: ${entry.mode === "without_code"
    ? (pl ? "bez kodu (ochrona ID rund)" : "without code (round ID guard)")
    : (pl ? "standardowy (bez kodu RV)" : "standard (no RV code)")}`).join(" · ");
}
