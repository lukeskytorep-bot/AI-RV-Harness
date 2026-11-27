import { assertTargetCodeContract, captureTargetCodeContract } from "../domain/targetCodeContract";
import type { TrainingRunRecord } from "./types";
import { sha256Text } from "../application/sha256";
import { assertTargetCodeAbsent } from "../domain/targetCodeMode";
import { getRvLite } from "../resources/protocolRegistry";
import { assertTargetCodePolicy, renderProfileTargetCodeSteps, verifyTargetCodeTemplates, type TargetCodePolicy } from "../resources/rvLiteTargetCode";
import type { SessionSnapshot } from "../sessions/types";

/** The run policy is optional only for pre-CODE-5A runs. Never infer it from the live profile on Resume. */
export function validateTrainingTargetCodePolicy(policy: TargetCodePolicy | undefined): void {
  if (policy !== undefined) {
    if (!policy) throw new Error("Invalid frozen Training target-code policy.");
    assertTargetCodePolicy(policy);
  }
}

/** Validate the exact frozen rendering before a Training stage can use it. */
export async function validateTrainingSessionTargetCode(policy: TargetCodePolicy | undefined, snapshot: SessionSnapshot | null | undefined): Promise<void> {
  validateTrainingTargetCodePolicy(policy);
  if (!snapshot || snapshot.protocol?.id !== "rv-lite" || snapshot.researchTargetCode !== undefined || snapshot.rcpProfileTargetCode !== undefined || snapshot.telepathicProfileTargetCode !== undefined) {
    throw new Error("Training requires a compatible frozen RV Lite target-code snapshot.");
  }
  if (policy === undefined && snapshot.profileTargetCode === undefined) return; // validated legacy
  if (!snapshot.profileTargetCode) throw new Error("Training requires a compatible frozen RV Lite target-code snapshot.");
  const frozen = snapshot.profileTargetCode;
  validateTrainingTargetCodePolicy(frozen.policy);
  if (!frozen.policy || !policy || frozen.policy.mode !== policy.mode || frozen.policy.version !== policy.version || frozen.policy.templatesSha256 !== policy.templatesSha256) throw new Error("Training target-code policy mismatch between series and session.");
  await verifyTargetCodeTemplates();
  const protocol = getRvLite(snapshot.sessionLanguage, snapshot.protocol.variant);
  if (snapshot.protocol.language !== snapshot.sessionLanguage || protocol.version !== snapshot.protocol.version || protocol.contentSha256 !== snapshot.protocol.contentSha256 || protocol.content !== snapshot.protocol.fullContent) throw new Error("Training target-code protocol snapshot drift.");
  if (frozen.renderProfileName !== null && typeof frozen.renderProfileName !== "string") throw new Error("Invalid frozen Training renderer identity.");
  const prompts = renderProfileTargetCodeSteps(protocol, frozen.renderProfileName ?? undefined, snapshot.sessionCode, policy);
  if (!Array.isArray(frozen.renderedPrompts) || frozen.renderedPrompts.length !== prompts.length) throw new Error("Invalid frozen Training rendered prompts.");
  for (let i = 0; i < prompts.length; i++) {
    if (frozen.renderedPrompts[i]?.content !== prompts[i] || frozen.renderedPrompts[i]?.sha256 !== await sha256Text(prompts[i])) throw new Error("Training target-code rendered prompt/hash mismatch.");
  }
}

/** Applied to final learning messages, including repair and output recovery. */
export function assertTrainingLearningMessages(snapshot: SessionSnapshot, messages: unknown): void {
  if (snapshot.profileTargetCode === undefined) return;
  const policy = snapshot.profileTargetCode?.policy;
  if (!policy) throw new Error("Invalid frozen Training learning target-code policy.");
  assertTargetCodePolicy(policy);
  assertTargetCodeAbsent(policy.mode, snapshot.sessionCode, messages);
}

function trainingContractOwner(run: TrainingRunRecord) {
  return { id: run.id, profileId: run.profileId, workspaceId: run.workspaceId, modelRoute: run.modelRoute, mode: run.mode, protocolVariant: run.protocolVariant };
}
export function captureTrainingTargetCodeContract(run: TrainingRunRecord): void {
  const policy = run.executionSnapshot?.targetCodePolicy;
  validateTrainingTargetCodePolicy(policy);
  if (policy !== undefined) captureTargetCodeContract(run, trainingContractOwner(run), policy);
}
export function assertTrainingTargetCodeContract(run: TrainingRunRecord): void {
  assertTargetCodeContract(run, trainingContractOwner(run), run.executionSnapshot?.targetCodePolicy);
  validateTrainingTargetCodePolicy(run.executionSnapshot?.targetCodePolicy);
}
