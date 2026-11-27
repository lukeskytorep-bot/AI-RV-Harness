import { expect, it, vi } from "vitest";
import { targetCodeConfig, model, provider } from "../testing/targetCodeFixture";
import { workflowTestRepository } from "../testing/workflowRepository";
import { getFullRcp, getRvLite } from "../resources/protocolRegistry";
import { createResearchProtocolSelection } from "./protocolPolicy";
import { rcpTargetCodePolicy } from "../sessions/rcpTargetCode";
import { targetCodePolicy } from "../resources/rvLiteTargetCode";
import { executeResearchSessions } from "./engine";
import type { AppRepository } from "../storage/repository";
import type { ResearchProjectRecord } from "./types";
import type { SessionSnapshot } from "../sessions/types";

for (const protocolId of ["rv-lite", "full-rcp"] as const) it.each(["missing", "with_code", "valid"])(`${protocolId}: Revealed Resume %s must agree with Lock before SessionComplete`, async damage => {
  const config = targetCodeConfig(); config.templateType = "profile"; config.protocol = createResearchProtocolSelection(protocolId, "en");
  config.conditions = [config.conditions[0]];
  const condition = config.conditions[0]; delete condition.targetCode;
  condition.researchProfileTargetCode = protocolId === "rv-lite" ? { protocol: "rv-lite", policy: targetCodePolicy("without_code") } : { protocol: "full-rcp", policy: rcpTargetCodePolicy("without_code") };
  const resource = protocolId === "rv-lite" ? getRvLite("en", "extended") : getFullRcp("en");
  const policy = protocolId === "rv-lite" ? targetCodePolicy(damage === "with_code" ? "with_code" : "without_code") : rcpTargetCodePolicy(damage === "with_code" ? "with_code" : "without_code");
  const session = { id: "s", sessionCode: "RV-S", state: "Revealed", preRevealSealedAt: "t", targetId: "t", researchProjectId: "r" };
  const snapshot = { schemaVersion: 4, sessionId: "s", sessionCode: "RV-S", targetId: "t", researchProjectId: "r", workspaceId: "w", profileId: condition.profileId,
    providerConfigId: provider.id, provider: provider.provider, modelId: model.modelId, modelRoute: model.route, protocol: { id: resource.id, version: resource.version, language: resource.language, contentSha256: resource.contentSha256 },
    generationSettings: { requested: condition.requestedSettings, effective: condition.effectiveSettings!.effective },
    ...(damage === "missing" ? {} : protocolId === "rv-lite" ? { profileTargetCode: { policy, renderProfileName: null, renderedPrompts: [] } } : { rcpProfileTargetCode: { policy, renderedPrompts: [] } }) } as SessionSnapshot;
  const project = { id: "r", workspaceId: "w", state: "Interrupted", templateType: "profile", config, createdAt: "t", updatedAt: "t" } as ResearchProjectRecord;
  const updateResearchAssignment = vi.fn(), initializeResearchSession = vi.fn(), runner = vi.fn();
  const repository = workflowTestRepository({ getResearchProject: async () => project,
    listResearchAssignments: async () => [{ id: "a", researchProjectId: "r", anonymousSessionId: "blind", targetId: "t", sessionId: "s", status: "ResumeApproved" }],
    listBlindingMappings: async () => [{ anonymousSessionId: "blind", conditionId: "c" }], listResearchConditions: async () => [{ id: "c", researchProjectId: "r", conditionKey: condition.key, config: condition }],
    listTargets: async () => [{ id: "t" }], listProviderConfigs: async () => [provider], listProviderModels: async () => [model], listProfiles: async () => [],
    getRvSession: async () => session, getSessionSnapshot: async () => snapshot, setResearchProjectState: vi.fn(), updateResearchAssignment, initializeResearchSession,
    getReveal: async () => ({ text: "Reveal" }), listSessionEvents: async () => [{ eventType: "REVEAL_ACCEPTED", metadata: { targetId: "t" } }], listTargetUsage: async () => [{ sessionId: "s", targetId: "t" }],
  } as unknown as AppRepository);
  const run = executeResearchSessions({ repository, projectId: "r", sessionRunner: runner, rvLiteSessionRunner: runner });
  if (damage === "valid") { await run; expect(updateResearchAssignment).toHaveBeenCalledWith("a", "s", "SessionComplete"); }
  else { await expect(run).rejects.toThrow(/Profile target-code policy drift/); expect(updateResearchAssignment).not.toHaveBeenCalled(); }
  expect(runner).not.toHaveBeenCalled(); expect(initializeResearchSession).not.toHaveBeenCalled();
});
