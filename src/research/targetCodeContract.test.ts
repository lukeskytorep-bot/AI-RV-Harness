import { expect, it, vi } from "vitest";
import { targetCodeConfig } from "../testing/targetCodeFixture";
import { assertResearchTargetCodeContract, captureResearchTargetCodeContract } from "./targetCodeContract";
import { freezeResearchTargetCodePreference, executeResearchSessions } from "./engine";
import { createResearchProtocolSelection } from "./protocolPolicy";
import { workflowTestRepository } from "../testing/workflowRepository";
import type { AppRepository } from "../storage/repository";
import type { ResearchProjectRecord } from "./types";

it.each(["pl", "en"] as const)("keeps explicit Target Code Presence independent of Profiles (%s)", language => {
  const config = targetCodeConfig(language); captureResearchTargetCodeContract(config);
  expect(config.conditions.map(c => c.targetCode?.mode)).toEqual(["with_code", "without_code"]);
  expect(() => assertResearchTargetCodeContract(config)).not.toThrow();
});
for (const protocol of ["rv-lite", "full-rcp"] as const) for (const language of ["pl", "en"] as const) {
  it(`${protocol}/${language}: freezes ordinary Profile modes once and refuses missing policy`, () => {
    const config = targetCodeConfig(language); config.templateType = "profile"; config.protocol = createResearchProtocolSelection(protocol, language);
    config.conditions.forEach(c => { delete c.targetCode; });
    const profiles = [{ id: "p", name: "P", targetCodeMode: "without_code" as const, createdAt: "t", updatedAt: "t" }];
    const frozen = freezeResearchTargetCodePreference(config, { profiles, providerConfigs: [], models: [], targets: [], targetUsage: [] });
    captureResearchTargetCodeContract(frozen); profiles[0].targetCodeMode = "with_code" as never;
    expect(frozen.conditions.every(c => c.researchProfileTargetCode?.policy.mode === "without_code")).toBe(true);
    expect(() => assertResearchTargetCodeContract(JSON.parse(JSON.stringify(frozen)))).not.toThrow();
    delete frozen.conditions[0].researchProfileTargetCode;
    expect(() => assertResearchTargetCodeContract(frozen)).toThrow(/contract/);
  });
}
it.each(["policy", "version", "marker"])("Research refuses %s loss before initialization or runner dispatch", async field => {
  const config = targetCodeConfig(); captureResearchTargetCodeContract(config);
  if (field === "policy") delete config.conditions[0].targetCode;
  if (field === "version") delete config.targetCodeContractVersion;
  if (field === "marker") delete config.targetCodeContract;
  const project = { id: "r", workspaceId: "w", state: "Interrupted", config, templateType: "target_code", createdAt: "t", updatedAt: "t" } as ResearchProjectRecord;
  const initializeResearchSession = vi.fn(), runner = vi.fn();
  const repository = workflowTestRepository({ getResearchProject: async () => project, initializeResearchSession } as unknown as AppRepository);
  await expect(executeResearchSessions({ repository, projectId: "r", sessionRunner: runner, rvLiteSessionRunner: runner })).rejects.toThrow(/contract/);
  expect(initializeResearchSession).not.toHaveBeenCalled(); expect(runner).not.toHaveBeenCalled();
});
it("does not rewrite unmarked historical Research configurations", () => {
  const legacy = targetCodeConfig(); const before = JSON.stringify(legacy);
  assertResearchTargetCodeContract(legacy); expect(JSON.stringify(legacy)).toBe(before);
});

it.each(["removed", "changed", "profileId", "providerConfigId", "modelId"])("refuses %s Target Code Presence policy in the separate condition record before dispatch", async damage => {
  const config = targetCodeConfig(); captureResearchTargetCodeContract(config);
  const conditions = config.conditions.map(c => ({ id: `condition-${c.key}`, researchProjectId: "r", conditionKey: c.key, config: structuredClone(c) }));
  if (damage === "removed") delete conditions[0].config.targetCode;
  else if (damage === "changed") conditions[0].config.targetCode!.mode = "without_code";
  else conditions[0].config[damage as "profileId" | "providerConfigId" | "modelId"] = "other";
  const project = { id: "r", workspaceId: "w", state: "Interrupted", config, templateType: "target_code", createdAt: "t", updatedAt: "t" } as ResearchProjectRecord;
  const runner = vi.fn(), initializeResearchSession = vi.fn();
  const repository = workflowTestRepository({ getResearchProject: async () => project, listResearchAssignments: async () => [], listBlindingMappings: async () => [],
    listResearchConditions: async () => conditions, listTargets: async () => [], listProviderConfigs: async () => [], listProviderModels: async () => [], listProfiles: async () => [],
    setResearchProjectState: vi.fn(), initializeResearchSession } as unknown as AppRepository);
  await expect(executeResearchSessions({ repository, projectId: "r", sessionRunner: runner, rvLiteSessionRunner: runner })).rejects.toThrow(/target-code policy drift|condition route drift/);
  expect(runner).not.toHaveBeenCalled(); expect(initializeResearchSession).not.toHaveBeenCalled();
});
