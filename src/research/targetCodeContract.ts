import { assertTargetCodeContract, captureTargetCodeContract } from "../domain/targetCodeContract";
import { assertTargetCodePolicy } from "../resources/rvLiteTargetCode";
import { assertRcpTargetCodePolicy } from "../sessions/rcpTargetCode";
import type { ResearchConfig } from "./types";
function owner(config: ResearchConfig) {
  return { projectId: config.targetCodeProjectId, workspaceId: config.workspaceId, schemaVersion: config.schemaVersion, templateType: config.templateType,
    language: config.sessionLanguage, protocol: config.protocol, targetIds: config.targetIds, repetitions: config.repetitions,
    conditions: config.conditions.map(c => ({ key: c.key, profileId: c.profileId, providerConfigId: c.providerConfigId, modelId: c.modelId })) };
}
function policies(config: ResearchConfig) {
  return config.conditions.map(c => ({ key: c.key, targetCode: c.targetCode, researchProfileTargetCode: c.researchProfileTargetCode }));
}
export function captureResearchTargetCodeContract(config: ResearchConfig): void {
  for (const condition of config.conditions) {
    if (config.templateType === "target_code") {
      if (!condition.targetCode || condition.researchProfileTargetCode !== undefined) throw new Error("Research requires its explicit target-code condition.");
    } else if (!condition.researchProfileTargetCode || condition.targetCode !== undefined) throw new Error("Research requires its frozen Profile target-code preference.");
  }
  captureTargetCodeContract(config, owner(config), policies(config));
  assertResearchTargetCodeContract(config);
}
export function assertResearchTargetCodeContract(config: ResearchConfig): void {
  assertTargetCodeContract(config, owner(config), policies(config));
  for (const c of config.conditions) {
    if (c.targetCode !== undefined) assertTargetCodePolicy(c.targetCode);
    const frozen = c.researchProfileTargetCode;
    if (frozen !== undefined) {
      if (!frozen || c.targetCode !== undefined || frozen.protocol !== config.protocol.id) throw new Error("Conflicting Research target-code policy.");
      if (frozen.protocol === "full-rcp") assertRcpTargetCodePolicy(frozen.policy);
      else if (frozen.protocol === "rv-lite") assertTargetCodePolicy(frozen.policy);
      else throw new Error("Invalid Research target-code protocol.");
    }
  }
}

/** Only before insertion of a brand-new project; never used on read/Resume. */
export function bindNewResearchTargetCodeProject(config: ResearchConfig, projectId: string): ResearchConfig {
  assertResearchTargetCodeContract(config);
  if (!config.targetCodeContract) return structuredClone(config);
  if (config.targetCodeProjectId !== undefined) throw new Error("Research target-code contract is already bound to a project.");
  const bound = structuredClone(config);
  bound.targetCodeProjectId = projectId;
  delete bound.targetCodeContract; delete bound.targetCodeContractVersion;
  captureResearchTargetCodeContract(bound);
  return bound;
}
export function assertResearchTargetCodeProject(project: Pick<import("./types").ResearchProjectRecord, "id" | "workspaceId" | "templateType" | "config">): void {
  assertResearchTargetCodeContract(project.config);
  if (project.config.targetCodeContract && (project.workspaceId !== project.config.workspaceId || project.templateType !== project.config.templateType
    || (project.config.targetCodeProjectId !== undefined && project.config.targetCodeProjectId !== project.id))) {
    throw new Error("Research target-code contract project binding mismatch.");
  }
}
