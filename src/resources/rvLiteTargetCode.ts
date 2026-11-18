import { renderRvLiteSteps, type RvLiteProtocolResource } from "./protocolRegistry";
import raw from "./research/target-code-presence-v1.json?raw";
import type { InterfaceLanguage } from "../types";

export type TargetCodeMode = "with_code" | "without_code";
export interface TargetCodePolicy { mode: TargetCodeMode; version: "target-code-presence-v1"; templatesSha256: string; }
export const TARGET_CODE_VERSION = "target-code-presence-v1" as const;
export const TARGET_CODE_TEMPLATES_SHA256 = "1d59a832e34956dd9743c7d81d81b597449b1c8e6b3f428a2e66517ef9d0e9ff";
const templates = JSON.parse(raw) as { version: string } & Record<InterfaceLanguage, { waitingWithCode: string; waitingWithoutCode: string; secondWithCode: string; secondWithoutCode: string }>;
export function targetCodePolicy(mode: TargetCodeMode): TargetCodePolicy { return { mode, version: TARGET_CODE_VERSION, templatesSha256: TARGET_CODE_TEMPLATES_SHA256 }; }
export function assertTargetCodePolicy(policy: TargetCodePolicy): void {
  if (!["with_code", "without_code"].includes(policy.mode) || policy.version !== TARGET_CODE_VERSION || policy.templatesSha256 !== TARGET_CODE_TEMPLATES_SHA256) throw new Error("Research target-code mode/version/template hash mismatch.");
}
export async function verifyTargetCodeTemplates(): Promise<void> {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== TARGET_CODE_TEMPLATES_SHA256 || templates.version !== TARGET_CODE_VERSION) throw new Error("Research target-code template source changed; a reviewed version is required.");
}
export function targetCodeSteps(steps: readonly [string, string, string, string], language: InterfaceLanguage, policy: TargetCodePolicy): readonly [string, string, string, string] {
  assertTargetCodePolicy(policy);
  const text = templates[language];
  if (steps[0].split(text.waitingWithCode).length !== 2 || steps[1] !== text.secondWithCode) throw new Error("RV Lite target-code transformation expected the approved text exactly once.");
  return policy.mode === "with_code" ? steps : [steps[0].replace(text.waitingWithCode, text.waitingWithoutCode), text.secondWithoutCode, steps[2], steps[3]];
}

/** Research-only wrapper: the approved renderer and resource hashes remain unchanged. */
export function renderResearchTargetCodeSteps(resource: RvLiteProtocolResource, profileName: string | undefined, sessionCode: string, policy: TargetCodePolicy): readonly [string,string,string,string] {
  if(resource.variant !== "extended") throw new Error("Target-code Research requires RV Lite Extended.");
  return renderRvLiteSteps({...resource,steps:targetCodeSteps(resource.steps,resource.language,policy)},profileName,sessionCode);
}
