// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {getCopy} from "../../i18n";
import {createDefaultSettings} from "../../startupDefaults";
import type {AppRepository} from "../../storage/repository";
import type {Profile,Workspace} from "../../types";
import type {ProviderModel} from "../../providers/types";
import type {TelepathicSeriesConfig} from "../../telepathicExchange/types";
const mock=vi.hoisted(()=>({dispatch:vi.fn()}));
vi.mock("../../aiCenter/viewerIdentitySelection",async original=>({...await original<typeof import("../../aiCenter/viewerIdentitySelection")>(),listEligibleViewerIdentities:async()=>[]}));
vi.mock("../../providers/requestExecutor",async original=>({...await original<typeof import("../../providers/requestExecutor")>(),executeProviderChat:mock.dispatch}));
vi.mock("../../telepathicExchange/providerGateway",async original=>({...await original<typeof import("../../telepathicExchange/providerGateway")>(),resolveTelepathicAiRouteFromRepository:async({participant,requestedSettings,repository}: {participant: {ai:Record<string,string>};requestedSettings:unknown;repository:AppRepository})=>{
 const snapshot=participant.ai;return {snapshot,requestedSettings,model:(await repository.listProviderModels())[0],providerConfig:{id:"c",provider:"custom_openai",credentialId:"k",baseUrl:"https://example.test/v1",enabled:true},validatedIdentity:{profileId:snapshot.profileId,workspaceId:snapshot.workspaceId,aiIdentityId:snapshot.aiIdentityId,credentialFingerprint:snapshot.credentialFingerprint}};
}}));
import {BrowserTelepathicExchangeRepository} from "../../storage/browser/telepathicExchangeRepository";
import {createTelepathicSeriesState} from "../../telepathicExchange/engine";
import {TelepathicExchangePanel} from "./TelepathicExchangePanel";
import {TelepathicTrainingPanel} from "../training/TelepathicTrainingPanel";
for(const mode of ["conversation_exchange","ai_ai_training"] as const) for(const change of ["temperature","reasoning","manual_retry"] as const) it(`${mode} mounted Resume rejects ${change} drift before another dispatch`,async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.clear();mock.dispatch.mockReset();const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 try {
  const ai=(id:string)=>({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}});
  const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:"panel-recovery",seriesWorkspaceId:"w",mode,language:"en",participants:mode==="ai_ai_training"?[ai("lead"),ai("a")]:[ai("lead"),{id:"human",kind:"human",displayName:"Human"}],roundCount:1,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"lead"}};
  const state=createTelepathicSeriesState({...config,outputBudgetPolicyVersion:3});state.status="paused";state.rounds[0].status="blind";state.rounds[0].target={schemaVersion:1,roundId:state.rounds[0].assignment.roundId,senderParticipantId:"lead",content:"HIDDEN",assets:[],contentSha256:"hash",status:"transmission_ready",lockedAt:"t",transmissionReadyAt:"t"};
  if(mode==="conversation_exchange")state.rounds[0].blindByParticipant.human={participantId:"human",first:"own",status:"first_complete",providerAttemptCount:0};
  const store=new BrowserTelepathicExchangeRepository();await store.saveTelepathicSeries(state);
  const model={providerConfigId:"c",provider:"custom_openai",modelId:"m",route:"m",capabilities:{contextTokens:64000,maxOutputTokens:32768,inputModalities:["text"],outputModalities:["text"],reasoning:{supported:true,efforts:["low","high"],confidence:"provider_metadata"},temperature:{supported:true,min:0,max:2,confidence:"provider_metadata"},supportedParameters:["temperature","reasoning","max_tokens"],source:"provider",capturedAt:"t"},pricing:{}} as ProviderModel;
  const repository={getTelepathicSeries:store.getTelepathicSeries.bind(store),saveTelepathicSeries:store.saveTelepathicSeries.bind(store),withTelepathicSeriesLease:store.withTelepathicSeriesLease.bind(store),assertTelepathicSeriesLease:store.assertTelepathicSeriesLease.bind(store),telepathicSeriesLeaseSignal:store.telepathicSeriesLeaseSignal.bind(store),listTelepathicSeries:store.listTelepathicSeries.bind(store),listTelepathicSeriesSummaries:store.listTelepathicSeriesSummaries.bind(store),listProviderConfigs:async()=>[],listProviderModels:async()=>[model]} as unknown as AppRepository;
  let profiles=config.participants.filter(p=>p.kind==="ai").map(p=>({id:p.id,name:p.id,defaultViewerModelId:"m",defaultViewerTemperature:0.5,defaultViewerReasoningEffort:"low"} as Profile));
  const workspace={id:"w",profileId:"human",name:"W",kind:"conversation"} as Workspace;
  const render=()=>act(async()=>root.render(mode==="ai_ai_training"?<TelepathicTrainingPanel copy={getCopy("en")} settings={createDefaultSettings()} profiles={profiles} workspaces={[]} repository={repository}/>:<TelepathicExchangePanel copy={getCopy("en")} settings={createDefaultSettings()} profiles={profiles} workspaces={[]} profile={{id:"human",name:"Human"} as Profile} workspace={workspace} repository={repository}/>));
  let release!: (response: unknown)=>void;
  mock.dispatch.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await render();
  const run=()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>(b.textContent?.includes(mode==="ai_ai_training"?"Run / continue":"Continue / Resume") || b.textContent?.trim()==="Resume"))!;
  await act(async()=>{run().click();await vi.waitFor(()=>expect(mock.dispatch).toHaveBeenCalledTimes(1),{timeout:3000});});expect(mock.dispatch).toHaveBeenCalledTimes(1);
  await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Stop")!.click());
  await act(async()=>{release({content:"partial",finishReason:"length",usage:{}});await vi.waitFor(async()=>expect((await store.getTelepathicSeries("panel-recovery"))?.status).toBe("paused"),{timeout:3000});});
  if(change==="manual_retry") {
   mock.dispatch.mockResolvedValueOnce({content:"partial",finishReason:"length",usage:{}});
   await act(async()=>{run().click();await vi.waitFor(async()=>expect((await store.getTelepathicSeries("panel-recovery"))?.status).toBe("blocked"),{timeout:3000});});
   expect(mock.dispatch).toHaveBeenCalledTimes(2);
   const before=(await store.getTelepathicSeries("panel-recovery"))!,last=before.providerCalls.at(-1)!;
   mock.dispatch.mockImplementation(async()=>{
    const call=(await store.getTelepathicSeries("panel-recovery"))!.providerCalls.at(-1)!;
    return {content:call.callStage.startsWith("lead_guidance")?JSON.stringify({cycle:1,finishRound:true,finishParticipantIds:[],individual:[]}):call.callStage==="sharing_consent"?"NO":"Complete final response.",finishReason:"stop",usage:{}};
   });
   const retry=[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Retry step")!;
   expect(retry).toBeDefined();expect(retry.disabled).toBe(false);expect(retry.title).toContain("additional charge");
   await act(async()=>{retry.click();await vi.waitFor(async()=>expect((await store.getTelepathicSeries("panel-recovery"))!.providerCalls.some(c=>c.manualRetryOfCallId===last.id&&c.status==="succeeded")).toBe(true),{timeout:3000});});
   const after=(await store.getTelepathicSeries("panel-recovery"))!;
   expect(after.providerCalls.filter(c=>c.scopeKey===last.scopeKey)).toHaveLength(3);
   expect(after.rounds[0].target).toEqual(before.rounds[0].target);
   expect(after.providerCalls.find(c=>c.id===last.id)?.manualRetryAuthorization).toMatchObject({originalStatus:"failed"});
   return;
  }
  profiles=profiles.map(p=>({...p,...(change==="temperature"?{defaultViewerTemperature:1.5}:{defaultViewerReasoningEffort:"high" as const})}));await render();
  await act(async()=>{run().click();await vi.waitFor(async()=>expect((await store.getTelepathicSeries("panel-recovery"))?.status).toBe("blocked"),{timeout:3000});});
  expect(mock.dispatch).toHaveBeenCalledTimes(1);expect(container.textContent).toMatch(/fingerprint\/settings changed/);
 }finally{await act(async()=>root.unmount());container.remove();}
});
