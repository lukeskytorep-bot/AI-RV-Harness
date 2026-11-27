// @vitest-environment jsdom
import { afterEach,it,expect,vi } from "vitest";
import { executeProviderChat } from "../providers/requestExecutor";
import { normalizeModelDiscovery, resolveGenerationSettings } from "../providers/capabilities";
import { BrowserRepository } from "../storage/browserRepository";
import { targetCodeConfig,provider as fixtureProvider,model as fixtureModel } from "../testing/targetCodeFixture";
import { buildResearchLockPlan } from "./planner";
import { executeResearchSessions,freezeResearchViewerOutputPolicy,prepareInterruptedResearchRetry,unblindAndComputeResearch,judgeResearch } from "./engine";
import { createSessionReplay } from "../sessions/resumeReplay";
import { runAutomaticRvLiteSession } from "../sessions/rvLiteController";
import type { ProviderMessage } from "../providers/types";
import { runBlindJudging } from "../judge/engine";
import { output } from "../testing/researchJudgeRecoveryFixture";
import { exportResearchPackage } from "../exports/research";
const { writeExportPackage } = vi.hoisted(()=>({writeExportPackage:vi.fn(async()=>({directory:"test",manifestHash:"hash"}))}));
vi.mock("../exports/native",()=>({writeExportPackage}));

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("../storage", async importOriginal => ({
  ...await importOriginal<typeof import("../storage")>(),
  isTauriRuntime: () => true,
}));

type ChatIpcRequest = { provider: string; modelId: string; messages: ProviderMessage[] };
function mockChatResponse(respond: (request: ChatIpcRequest) => { content: string; finish_reason: string }) {
  invoke.mockImplementation((command: string, args: { request: ChatIpcRequest }) => {
    // The STOP test also sends a cancellation command.
    if (command === "cancel_provider_request") return Promise.resolve();
    expect(command).toBe("provider_chat");
    return Promise.resolve(respond(structuredClone(args.request)));
  });
}
const locks=()=>{const held=new Set<string>();return{request:async(name:string,_opts:unknown,cb:(lock:object|null)=>Promise<unknown>)=>{if(held.has(name))return cb(null);held.add(name);try{return await cb({name});}finally{held.delete(name);}}};};
afterEach(()=>{localStorage.clear();vi.unstubAllGlobals();invoke.mockReset();});
it.each(["custom_openai","ollama_cloud"] as const)("%s: independent sessions persist B across reconnect and STOP/Resume without resending P1",async providerKind=>{
 const provider={...fixtureProvider,provider:providerKind,...(providerKind==="ollama_cloud"?{baseUrl:undefined}:{})};
 const model=providerKind==="ollama_cloud"?normalizeModelDiscovery(provider,{models:[{name:fixtureModel.modelId}]},"t")[0]:fixtureModel;
 writeExportPackage.mockClear();
 localStorage.clear();vi.stubGlobal("navigator",{locks:locks()});let repository=new BrowserRepository();
 const profile=await repository.createProfile({name:"Leo"});const workspace=await repository.createWorkspace({profileId:profile.id,name:"Research",kind:"rv"});
 localStorage.setItem("rvh.dev.providers",JSON.stringify([provider]));await repository.replaceProviderModels(provider.id,[model]);
 const target=await repository.createTarget({id:"t",collection:"user",title:"T",revealText:"A tall bridge over water",tags:[],sourceMetadata:{}});
 const registered=(await repository.listProviderModels())[0];
 let config=targetCodeConfig();config.conditions=config.conditions.map(c=>({...c,capabilitySnapshot:registered.capabilities,effectiveSettings:resolveGenerationSettings(registered.capabilities,c.requestedSettings,{provider:registered.provider})}));config=freezeResearchViewerOutputPolicy({...config,workspaceId:workspace.id,targetIds:[target.id],conditions:config.conditions.map(c=>({...c,profileId:profile.id}))});
 config.evaluationMode="ai_judges";config.judges=[{providerConfigId:provider.id,modelId:model.modelId}];
 const project=await repository.createResearchProject(config);const plan=await buildResearchLockPlan(project.id,config);
 // Deterministic execution order for this integration scenario only: stop B while A is untouched.
 for(const a of plan.assignments){a.executionOrder=plan.mappings.find(m=>m.anonymousSessionId===a.anonymousSessionId)?.conditionId===plan.conditions.find(c=>c.conditionKey==="without_code")!.id?1:2;}
 await repository.lockResearchProject(project.id,plan);
 const mappingKey = "rvh.dev.blinding_mappings";
 const originalMappings = localStorage.getItem(mappingKey)!;
 const corruptMappings = () => {
   const rows = JSON.parse(originalMappings) as typeof plan.mappings;
   rows[0].conditionId = rows[1].conditionId;
   localStorage.setItem(mappingKey, JSON.stringify(rows));
 };
 corruptMappings();
 const refusedRunner = vi.fn();
 const initialize = vi.spyOn(repository, "initializeResearchSession");
 await expect(executeResearchSessions({ repository, projectId: project.id, rvLiteSessionRunner: refusedRunner })).rejects.toThrow(/mapping hash/);
 expect(refusedRunner).not.toHaveBeenCalled();
 expect(initialize).not.toHaveBeenCalled();
 expect(await repository.listRvSessions(workspace.id)).toHaveLength(0);
 initialize.mockRestore();
 localStorage.setItem(mappingKey, originalMappings);

 const stop = new AbortController();
 const before: ChatIpcRequest[] = [];
 mockChatResponse(request => {
   expect(request.provider).toBe(providerKind);
   expect(request.modelId).toBe(model.modelId);
   before.push(request);
   stop.abort();
   return { content: "Accepted B first answer", finish_reason: "stop" };
 });
 await executeResearchSessions({repository,projectId:project.id,signal:stop.signal,rvLiteSessionRunner:input=>runAutomaticRvLiteSession({...input,chat:request=>executeProviderChat({...request,operationKind:"research_viewer",configuredRetries:0})})});
 const stopped=(await repository.listResearchAssignments(project.id)).find(a=>a.sessionId)!;
 const snapshot=await repository.getSessionSnapshot(stopped.sessionId!);expect(snapshot?.researchTargetCode?.policy.mode).toBe("without_code");
 expect(before).toHaveLength(1);
 expect(JSON.stringify(before[0])).not.toContain(snapshot!.sessionCode);
 expect((await repository.getRvSession(stopped.sessionId!))?.state).toBe("Interrupted");
 repository=new BrowserRepository();expect(await repository.getSessionSnapshot(stopped.sessionId!)).toEqual(snapshot);
 // STOP during an accepted response leaves only the missing next step to resume.
 await prepareInterruptedResearchRetry(repository,project.id,async()=>true);
 const dispatched: Array<{ mode: string; request: ChatIpcRequest; code: string }> = [];
 const liveChat = async (mode: string, code: string, messages: ProviderMessage[]) => {
   mockChatResponse(request => {
     dispatched.push({ mode, request, code });
     return { content: `Fresh evidence ${dispatched.length}`, finish_reason: "stop" };
   });
   return executeProviderChat({
     config: provider, modelId: model.modelId, messages,
     settings: resolveGenerationSettings(model.capabilities, { maxOutputTokens: 16384 }, { provider: provider.provider }),
     operationKind: "research_viewer", configuredRetries: 0,
   });
 };
 await executeResearchSessions({repository,projectId:project.id,sessionReplayFactory:args=>createSessionReplay({...args,liveChat:({messages})=>liveChat("without_code",args.session.sessionCode,messages)}),rvLiteSessionRunner:input=>runAutomaticRvLiteSession({...input,chat:input.chat??(({messages})=>liveChat(input.targetCode!.mode,input.sessionIdentity!.sessionCode,messages))})});
 const assignments=await repository.listResearchAssignments(project.id);expect(assignments.every(a=>a.status==="SessionComplete")).toBe(true);
 const sessions=await repository.listRvSessions(workspace.id);expect(sessions).toHaveLength(2);expect(new Set(sessions.map(s=>s.sessionCode)).size).toBe(2);expect(new Set(sessions.map(s=>s.id)).size).toBe(2);
 expect(sessions.every(s=>s.targetId===target.id && s.state==="Revealed")).toBe(true);
 expect(dispatched.filter(d=>d.mode==="without_code")).toHaveLength(3);expect(dispatched.filter(d=>d.mode==="with_code")).toHaveLength(4);
 for(const d of dispatched.filter(d=>d.mode==="without_code"))expect(JSON.stringify(d.request)).not.toContain(d.code);
 const firstA=dispatched.find(d=>d.mode==="with_code")!;expect(dispatched.some(d=>d.mode==="with_code" && JSON.stringify(d.request).includes(d.code))).toBe(true);expect(JSON.stringify(firstA.request.messages)).not.toContain("Accepted B first answer");expect(firstA.request.messages.filter(m=>m.role==="assistant")).toHaveLength(0);
 await expect(unblindAndComputeResearch(repository,project.id)).rejects.toThrow(/every Judge score/);
 expect((await repository.getResearchProject(project.id))?.configHash).toBe(plan.configHash);
 const judgePayloads:string[]=[];
 mockChatResponse(request => {
   judgePayloads.push(JSON.stringify(request));
   // Produce one malformed reply so the actual Judge JSON repair also reaches the IPC boundary.
   return { content: judgePayloads.length === 1 ? "Malformed scores" : output, finish_reason: "stop" };
 });
 await judgeResearch({repository,projectId:project.id,judgeRunner:args=>runBlindJudging({...args,chat:request=>executeProviderChat({...request,operationKind:"judge",configuredRetries:0})})});
 expect(judgePayloads).toHaveLength(3);
 expect(judgePayloads[1]).toContain("Malformed scores");
 for (const payload of judgePayloads) {
   expect(payload).not.toMatch(/with_code|without_code|target-code-presence|pair_tc|Target code/);
   expect(payload).not.toContain(snapshot!.sessionCode);
 }
 expect((await repository.getResearchProject(project.id))?.state).toBe("ScoresFrozen");
 corruptMappings();
 await expect(unblindAndComputeResearch(repository, project.id)).rejects.toThrow(/mapping hash/);
 expect(await repository.getResearchResults(project.id)).toBeNull();
 expect((await repository.getResearchProject(project.id))?.state).toBe("Unblinded");
 localStorage.setItem(mappingKey, originalMappings);
 const results=await unblindAndComputeResearch(repository,project.id);
 expect(results.targetCodeComparison?.summary).toMatchObject({completePairs:1,missingPairs:0,meanA:6,meanB:6,ties:1,meanPairedDifference:0});
 expect(results.targetCodeComparison?.pairs[0].a?.sessionCode).toBeTruthy();
 expect(results.targetCodeComparison?.pairs[0].b?.sessionCode).toBeTruthy();
 repository=new BrowserRepository();expect(await repository.getResearchResults(project.id)).toEqual(results);
 await exportResearchPackage(repository,project.id);
 const exported=(writeExportPackage.mock.calls[0] as unknown as [{files:Array<{relativePath:string;content:string}>}])[0].files;
 const csv=exported.find(f=>f.relativePath==="results/target_code_pairs.csv")!.content;
 for(const session of sessions)expect(csv).toContain(session.sessionCode);
 expect(csv).toContain('"0","tie"');
 const master=JSON.parse(exported.find(f=>f.relativePath==="master/master_record.json")!.content);
 expect(master.sessionSnapshots[stopped.anonymousSessionId].researchTargetCode).toEqual(snapshot?.researchTargetCode);
 // Research packages have no dedicated importer. Round-trip their existing JSON master/snapshot contract.
 const imported=JSON.parse(JSON.stringify(master));expect(imported.project.config.conditions.find((c:{key:string})=>c.key==="without_code").targetCode).toEqual(snapshot?.researchTargetCode?.policy);
});
