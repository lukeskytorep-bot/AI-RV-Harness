import { validateSessionTargetCodeFragment, type SessionTargetCodeContractSource } from "./targetCodeContract";
import { sha256Text } from "../application/sha256";
import { isTargetCodeMode, resolveTargetCodeMode, type TargetCodeMode } from "../domain/targetCodeMode";
import { telepathicStepPrompt, telepathicFixedDeepeningPrompt, telepathicQuestionPrompt } from "./telepathicControllerPrompts";
import type { InterfaceLanguage } from "../types";

export const TELEPATHIC_TARGET_CODE_VERSION = "telepathic-target-code-v1" as const;
export const TELEPATHIC_TARGET_CODE_TEMPLATES_SHA256 = "1106def9ac538a45121a4ecf8467d8fb8df086fe801ac3183ba03169ca0fbfe8";
export interface TelepathicTargetCodePolicy {
  mode: TargetCodeMode;
  version: typeof TELEPATHIC_TARGET_CODE_VERSION;
  templatesSha256: string;
}
export interface TelepathicTargetCodeSnapshot {
  policy: TelepathicTargetCodePolicy;
  renderedPrompts: { content: string; sha256: string }[];
}
export function telepathicTargetCodePolicy(mode: TargetCodeMode): TelepathicTargetCodePolicy {
  return { mode: resolveTargetCodeMode(mode), version: TELEPATHIC_TARGET_CODE_VERSION, templatesSha256: TELEPATHIC_TARGET_CODE_TEMPLATES_SHA256 };
}
export function assertTelepathicTargetCodePolicy(policy: TelepathicTargetCodePolicy): void {
  if (!policy || !isTargetCodeMode(policy.mode) || policy.version !== TELEPATHIC_TARGET_CODE_VERSION || policy.templatesSha256 !== TELEPATHIC_TARGET_CODE_TEMPLATES_SHA256) {
    throw new Error("TELEPATHIC target-code mode/version/template hash mismatch.");
  }
}
// Canonical render matrix includes both modes and both languages with an inert code placeholder.
export function telepathicTargetCodeTemplateMatrix(): string {
  return JSON.stringify({ version: TELEPATHIC_TARGET_CODE_VERSION, prompts: (["pl", "en"] as const).flatMap(language => (["with_code", "without_code"] as const).map(mode => ({ language, mode, steps: Array.from({ length: 9 }, (_, i) => telepathicStepPrompt(language, i + 1, "{{SESSION_CODE}}", mode)), deepenings: ([3, 4, 5] as const).map(step => telepathicFixedDeepeningPrompt(language, step)), question: telepathicQuestionPrompt(language, "{{QUESTION}}", 1) }))) });
}
export async function verifyTelepathicTargetCodeTemplates(): Promise<void> {
  if (await sha256Text(telepathicTargetCodeTemplateMatrix()) !== TELEPATHIC_TARGET_CODE_TEMPLATES_SHA256) throw new Error("TELEPATHIC target-code template changed; a reviewed version is required.");
}
export async function freezeTelepathicTargetCode(language: InterfaceLanguage, code: string, policy: TelepathicTargetCodePolicy): Promise<TelepathicTargetCodeSnapshot> {
  assertTelepathicTargetCodePolicy(policy);
  await verifyTelepathicTargetCodeTemplates();
  const prompts = Array.from({ length: 9 }, (_, i) => telepathicStepPrompt(language, i + 1, code, policy.mode));
  return { policy: structuredClone(policy), renderedPrompts: await Promise.all(prompts.map(async content => ({ content, sha256: await sha256Text(content) }))) };
}

// Compare the defined fields, not JSON property insertion order. Prompt order remains significant.
export function assertTelepathicTargetCodeSnapshotMatches(saved: TelepathicTargetCodeSnapshot, expected: TelepathicTargetCodeSnapshot | undefined): void {
  assertTelepathicTargetCodePolicy(saved.policy);
  if (!expected || saved.policy.mode !== expected.policy.mode ||
      saved.policy.version !== expected.policy.version || saved.policy.templatesSha256 !== expected.policy.templatesSha256 ||
      !Array.isArray(saved.renderedPrompts) || saved.renderedPrompts.length !== expected.renderedPrompts.length ||
      !expected.renderedPrompts.every((prompt, index) => {
        const captured = saved.renderedPrompts[index];
        return captured?.content === prompt.content && captured?.sha256 === prompt.sha256;
      })) {
    throw new Error("TELEPATHIC target-code rendered prompt/hash mismatch.");
  }
}

export async function restoreTelepathicTargetCode(snapshot: SessionTargetCodeContractSource, session: Pick<import("./types").RvSession, "id" | "sessionCode">): Promise<TelepathicTargetCodeSnapshot | undefined> {
  if (snapshot.protocol?.id !== "telepathic-protocol" || snapshot.sessionId !== session.id || snapshot.sessionCode !== session.sessionCode ||
      !session.id || !session.sessionCode?.trim() || (snapshot.sessionLanguage !== "pl" && snapshot.sessionLanguage !== "en") || snapshot.profileTargetCode !== undefined || snapshot.rcpProfileTargetCode !== undefined || snapshot.researchTargetCode !== undefined) {
    throw new Error("Conflicting frozen Telepathic target-code policy or Session Snapshot.");
  }
  await validateSessionTargetCodeFragment(snapshot);
  const saved = snapshot.telepathicProfileTargetCode;
  if (saved === undefined) return undefined;
  if (!saved || typeof saved !== "object") throw new Error("Invalid frozen Telepathic target-code snapshot.");
  const expected = await freezeTelepathicTargetCode(snapshot.sessionLanguage, session.sessionCode, saved.policy);
  assertTelepathicTargetCodeSnapshotMatches(saved, expected);
  return expected;
}
