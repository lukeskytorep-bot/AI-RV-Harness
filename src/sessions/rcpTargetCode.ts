import { sha256Text } from "../application/sha256";
import { isTargetCodeMode, resolveTargetCodeMode, type TargetCodeMode } from "../domain/targetCodeMode";
import { rcpPhasePrompt } from "./controllerPrompts";
import type { InterfaceLanguage } from "../types";

export const RCP_TARGET_CODE_VERSION = "rcp-target-code-v1" as const;
export const RCP_TARGET_CODE_TEMPLATES_SHA256 = "c33b0277a1756ac666e474064d218e3b7ee9534a977f60a0b38c1f8e4a5a4b9e";
export interface RcpTargetCodePolicy {
  mode: TargetCodeMode;
  version: typeof RCP_TARGET_CODE_VERSION;
  templatesSha256: string;
}
export interface RcpTargetCodeSnapshot {
  policy: RcpTargetCodePolicy;
  renderedPrompts: { content: string; sha256: string }[];
}
export function rcpTargetCodePolicy(mode: TargetCodeMode): RcpTargetCodePolicy {
  return {
    mode: resolveTargetCodeMode(mode),
    version: RCP_TARGET_CODE_VERSION,
    templatesSha256: RCP_TARGET_CODE_TEMPLATES_SHA256,
  };
}
export function assertRcpTargetCodePolicy(policy: RcpTargetCodePolicy): void {
  if (!policy || !isTargetCodeMode(policy.mode) || policy.version !== RCP_TARGET_CODE_VERSION || policy.templatesSha256 !== RCP_TARGET_CODE_TEMPLATES_SHA256) {
    throw new Error("RCP target-code mode/version/template hash mismatch.");
  }
}
// Canonical render matrix includes both modes and both languages with an inert code placeholder.
export function rcpTargetCodeTemplateMatrix(): string {
  return JSON.stringify({
    version: RCP_TARGET_CODE_VERSION,
    prompts: (["pl", "en"] as const).flatMap((language) =>
      (["with_code", "without_code"] as const).map((mode) => ({
        language,
        mode,
        phases: Array.from({ length: 6 }, (_, i) =>
          rcpPhasePrompt(language, i + 1, "{{SESSION_CODE}}", mode)),
      }))),
  });
}
export async function verifyRcpTargetCodeTemplates(): Promise<void> {
  if (await sha256Text(rcpTargetCodeTemplateMatrix()) !== RCP_TARGET_CODE_TEMPLATES_SHA256) {
    throw new Error("RCP target-code template changed; a reviewed version is required.");
  }
}
export async function freezeRcpTargetCode(language: InterfaceLanguage, code: string, policy: RcpTargetCodePolicy): Promise<RcpTargetCodeSnapshot> {
  assertRcpTargetCodePolicy(policy);
  await verifyRcpTargetCodeTemplates();
  const prompts = Array.from({ length: 6 }, (_, i) => rcpPhasePrompt(language, i + 1, code, policy.mode));
  return {
    policy: structuredClone(policy),
    renderedPrompts: await Promise.all(prompts.map(async (content) => ({
      content,
      sha256: await sha256Text(content),
    }))),
  };
}

// Compare the defined fields, not JSON property insertion order. Prompt order remains significant.
export function assertRcpTargetCodeSnapshotMatches(saved: RcpTargetCodeSnapshot, expected: RcpTargetCodeSnapshot | undefined): void {
  assertRcpTargetCodePolicy(saved.policy);
  if (!expected || saved.policy.mode !== expected.policy.mode ||
      saved.policy.version !== expected.policy.version || saved.policy.templatesSha256 !== expected.policy.templatesSha256 ||
      !Array.isArray(saved.renderedPrompts) || saved.renderedPrompts.length !== expected.renderedPrompts.length ||
      !expected.renderedPrompts.every((prompt, index) => {
        const captured = saved.renderedPrompts[index];
        return captured?.content === prompt.content && captured?.sha256 === prompt.sha256;
      })) {
    throw new Error("RCP target-code Resume rendered prompt/hash mismatch.");
  }
}
