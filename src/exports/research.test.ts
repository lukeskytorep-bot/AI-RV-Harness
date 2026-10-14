import {workflowTestRepository} from "../testing/workflowRepository";
import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { ResearchConfig, ResearchProjectRecord } from "../research/types";

const { writeExportPackage } = vi.hoisted(() => ({ writeExportPackage: vi.fn() }));
vi.mock("./native", () => ({ writeExportPackage }));

import { exportResearchPackage } from "./research";

describe("save-only Research export", () => {
  it("creates a shareable anonymous evaluator folder and keeps the Blinding Key private", async () => {
    const config: ResearchConfig = {
      schemaVersion: 1, name: "External", workspaceId: "workspace", templateType: "model", sessionLanguage: "pl", protocol: { id: "full-rcp", version: "1.5a" }, targetIds: ["target"], repetitions: 1, requireUnusedTargets: false,
      conditions: [
        { key: "a", label: "Secret condition A", profileId: "profile", providerConfigId: "provider", modelId: "viewer-a", requestedSettings: {} },
        { key: "b", label: "Secret condition B", profileId: "profile", providerConfigId: "provider", modelId: "viewer-b", requestedSettings: {} },
      ], evaluationMode: "save_only", judges: [], randomization: { matchedTargets: true, randomizedExecution: true, randomizedJudgeOrder: true },
    };
    const project: ResearchProjectRecord = { id: "research", workspaceId: "workspace", name: "External", templateType: "model", state: "SessionsComplete", config, configHash: "hash", lockedAt: "now", createdAt: "now", updatedAt: "now" };
    const recordExport = vi.fn();
    const repo = workflowTestRepository({
      getResearchProject: vi.fn().mockResolvedValue(project),
      getResearchResults: vi.fn().mockResolvedValue(null),
      listResearchAssignments: vi.fn().mockResolvedValue([{ id: "assignment", researchProjectId: "research", anonymousSessionId: "BlindSession_ABCDEF123456", sessionId: "session", targetId: "target", executionOrder: 1, judgeOrder: 1, status: "SessionComplete" }]),
      listBlindingMappings: vi.fn().mockResolvedValue([{ id: "mapping", researchProjectId: "research", anonymousSessionId: "BlindSession_ABCDEF123456", conditionId: "condition", pairKey: "pair", mappingHash: "mapping-hash", createdAt: "now" }]),
      listResearchConditions: vi.fn().mockResolvedValue([{ id: "condition", researchProjectId: "research", conditionKey: "a", config: config.conditions[0] }]),
      listRvSessions: vi.fn().mockResolvedValue([{ id: "session", workspaceId: "workspace", profileId: "profile", sessionCode: "RVH-1", state: "Completed", runType: "automatic", preRevealTranscript: "private transcript", postRevealTranscript: "", targetId: "target", researchProjectId: "research", createdAt: "now", updatedAt: "now" }]),
      getReveal: vi.fn().mockResolvedValue({ source: "automatic_target", text: "Reveal text", artifactManifest: [{ artifactId: "image", path: "/managed/image.png", originalFileName: "image.png", mimeType: "image/png", size: 12, sha256: "a".repeat(64) }], hash: "reveal-hash" }),
      getViewerEvidence: vi.fn().mockResolvedValue("blind Viewer evidence"),
      getSessionSnapshot: vi.fn().mockResolvedValue({
        schemaVersion: 4, modelId: "viewer-a", providerConfigId: "provider",
        continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "provider", credentialId: "credential-secret-ref", requestedModelId: "viewer-a", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
      }),
      listJudgeScores: vi.fn().mockResolvedValue([]),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      recordExport,
    } as unknown as AppRepository);
    writeExportPackage.mockResolvedValueOnce("/exports/research");

    await expect(exportResearchPackage(repo, "research")).resolves.toEqual({ directory: "/exports/research", manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const request = writeExportPackage.mock.calls[0][0] as { files: Array<{ relativePath: string; content: string }>; artifactCopies: Array<{ sourcePath: string; relativePath: string }> };
    const paths = request.files.map((file) => file.relativePath);
    expect(paths).toContain("external_evaluation/JUDGE_SYSTEM_PROMPT.txt");
    expect(paths).toContain("external_evaluation/HOW_TO_EVALUATE.md");
    expect(paths).toContain("external_evaluation/BlindSession_ABCDEF123456.json");
    expect(paths).toContain("external_evaluation/BlindSession_ABCDEF123456.md");
    expect(paths).toContain("private_master/blinding/blinding_key.json");
    expect(paths).toContain("private_master/blinding/blinding_key.md");
    expect(paths).toContain("private_master/sessions/BlindSession_ABCDEF123456/complete_session.md");
    expect(paths).toContain("README.md");
    expect(paths.some((path) => path.startsWith("judges/") || path.startsWith("results/"))).toBe(false);
    const publicContent = request.files.filter((file) => file.relativePath.startsWith("external_evaluation/")).map((file) => file.content).join("\n");
    expect(publicContent).not.toContain("Secret condition A");
    expect(publicContent).not.toContain("viewer-a");
    expect(publicContent).toContain("BlindSession_ABCDEF123456_artifacts/artifact_1.png");
    const allExportedText = request.files.map((file) => file.content).join("\n");
    expect(allExportedText).not.toContain("continuationRoute");
    expect(allExportedText).not.toContain("credential-secret-ref");
    expect(allExportedText).not.toContain("openrouter-reasoning-details");
    expect(request.artifactCopies).toEqual([{ sourcePath: "/managed/image.png", relativePath: "external_evaluation/BlindSession_ABCDEF123456_artifacts/artifact_1.png" }]);
    expect(recordExport).toHaveBeenCalledWith("workspace", "research", "research_save_only_package", "/exports/research", expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
for(const sealed of [false,true])it(`ended Research export keeps incomplete work private and includes audit data;sealed=${sealed}`,async()=>{
 const config={schemaVersion:1,name:"Stopped",workspaceId:"w",templateType:"model",sessionLanguage:"en",protocol:{id:"full-rcp",version:"1.5a"},targetIds:["t"],repetitions:1,requireUnusedTargets:false,conditions:[{key:"SECRET",label:"Secret condition",profileId:"p",providerConfigId:"pc",modelId:"m",requestedSettings:{}}],judges:[],randomization:{matchedTargets:true,randomizedExecution:true,randomizedJudgeOrder:true}} as ResearchConfig;
 const project={id:"r",workspaceId:"w",name:"Stopped",templateType:"model",state:"Interrupted",config,configHash:"frozen",lockedAt:"lock",createdAt:"t",updatedAt:"t"} as ResearchProjectRecord;const before=JSON.stringify(project);
 const marker={reason:"user_finished",endedAt:"end",stateAtEnd:"Interrupted",phase:"sessions"};const events=[{eventType:"RESEARCH_JUDGE_ATTEMPT",metadata:{status:"uncertain",modelRoute:"m",usage:{totalTokens:31}}}];
 const repository=workflowTestRepository({getResearchProject:async()=>project,getResearchExecutionTermination:async()=>marker,getResearchResults:async()=>null,listResearchAssignments:async()=>[{id:"a",researchProjectId:"r",anonymousSessionId:"BlindSession_ABCDEF123456",sessionId:"s",targetId:"t",status:"Interrupted",executionOrder:1,judgeOrder:1},{id:"b",researchProjectId:"r",anonymousSessionId:"BlindSession_BCDEF1234567",targetId:"t",status:"Pending",executionOrder:2,judgeOrder:2}],listBlindingMappings:async()=>[{anonymousSessionId:"BlindSession_ABCDEF123456",conditionId:"c",pairKey:"pair"}],listResearchConditions:async()=>[{id:"c",conditionKey:"SECRET",config:config.conditions[0]}],listRvSessions:async()=>[{id:"s",workspaceId:"w",profileId:"p",sessionCode:"S",state:"Interrupted",preRevealTranscript:"saved partial blind",postRevealTranscript:"",researchProjectId:"r",createdAt:"t",updatedAt:"t",...(sealed?{preRevealSealedAt:"seal",preRevealHash:"hash"}:{})}],getReveal:async()=>({source:"automatic_target",text:"Target",hash:"h",artifactManifest:[]}),getViewerEvidence:async()=>sealed?"sealed blind":"",getSessionSnapshot:async()=>null,listJudgeScores:async()=>[],listTargetClarifications:async()=>[],listSessionEvents:async()=>events,recordExport:vi.fn()} as unknown as AppRepository);
 writeExportPackage.mockResolvedValue("/exports/stopped");await exportResearchPackage(repository,"r");const files=writeExportPackage.mock.calls.at(-1)![0].files as Array<{relativePath:string;content:string}>;
 expect(files.find(file=>file.relativePath==="private_master/master/execution_termination.json")?.content).toContain("user_finished");expect(files.find(file=>file.relativePath.endsWith("session_events.json"))?.content).toContain("uncertain");expect(files.find(file=>file.relativePath==="summary.md")?.content).toContain("Saved sessions: 1/2");expect(files.find(file=>file.relativePath==="README.md")?.content).toContain("does not mark the study complete");expect(files.filter(file=>file.relativePath.startsWith("external_evaluation/")&&file.relativePath.endsWith("BlindSession_ABCDEF123456.json"))).toHaveLength(sealed?1:0);expect(files.filter(file=>file.relativePath.startsWith("external_evaluation/")).some(file=>file.content.includes("Secret condition"))).toBe(false);expect(JSON.stringify(project)).toBe(before);
});
