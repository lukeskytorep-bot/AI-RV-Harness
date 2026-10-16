// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {getCopy} from "../../i18n";
import {createDefaultSettings} from "../../startupDefaults";
import type {Profile,Workspace} from "../../types";
import type {AppRepository} from "../../storage/repository";
import type {ProviderModel} from "../../providers/types";
import type {TelepathicSeriesConfig} from "../../telepathicExchange/types";
const mock=vi.hoisted(()=>({dispatch:vi.fn()}));
vi.mock("../../aiCenter/viewerIdentitySelection",async original=>({...await original<typeof import("../../aiCenter/viewerIdentitySelection")>(),listEligibleViewerIdentities:async()=>[]}));
vi.mock("../../providers/requestExecutor",async original=>({...await original<typeof import("../../providers/requestExecutor")>(),executeProviderChat:mock.dispatch}));
vi.mock("../../telepathicExchange/providerGateway",async original=>({...await original<typeof import("../../telepathicExchange/providerGateway")>(),resolveTelepathicAiRouteFromRepository:async({participant,requestedSettings,repository}:{participant:{ai:Record<string,string>};requestedSettings:unknown;repository:AppRepository})=>({snapshot:participant.ai,requestedSettings,model:(await repository.listProviderModels())[0],providerConfig:{id:"c",provider:"custom_openai",credentialId:"k",baseUrl:"https://example.test/v1",enabled:true},validatedIdentity:{profileId:participant.ai.profileId,workspaceId:"w",aiIdentityId:participant.ai.aiIdentityId,credentialFingerprint:"f"}})}));
import {BrowserTelepathicExchangeRepository} from "../../storage/browser/telepathicExchangeRepository";
import {createTelepathicSeriesState,telepathicConversationHumanStep} from "../../telepathicExchange/engine";
import {TelepathicExchangePanel} from "./TelepathicExchangePanel";

// Isolate asynchronous writes and lease keys from a previous unmounted fixture.
let fixtureSequence = 0;
async function fixture(pl:boolean,prepare=false){
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 localStorage.clear();mock.dispatch.mockReset();mock.dispatch.mockResolvedValue({content:"New rounded perception",finishReason:"stop",usage:{}});
 const ai=(id:string)=>({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}});
 const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:`human-form-${++fixtureSequence}`,seriesWorkspaceId:"w",mode:"conversation_exchange",language:pl?"pl":"en",participants:[{id:"human",kind:"human",displayName:"Edward"},ai("a"),ai("b"),ai("c")],roundCount:2,topic:"location",discloseTopicToReceivers:false,senderPolicy:{kind:"human_only",humanParticipantId:"human"}};
 const store=new BrowserTelepathicExchangeRepository();let state=createTelepathicSeriesState(config);state.status="paused";
 if(!prepare){const round=state.rounds[0];round.status="blind";round.target={schemaVersion:1,roundId:round.assignment.roundId,senderParticipantId:"human",content:"FROZEN TARGET",assets:[],contentSha256:"hash",status:"transmission_ready",lockedAt:"t",transmissionReadyAt:"t"};for(const id of ["a","b","c"])round.blindByParticipant[id]={participantId:id,first:"Initial impression",status:"first_complete",providerAttemptCount:1};}
 await store.saveTelepathicSeries(state);
 const model={displayName:"Test model",recommended:true,rawMetadata:{},refreshedAt:"t",providerConfigId:"c",provider:"custom_openai",modelId:"m",route:"m",capabilities:{supportsVision:false,supportsStreaming:false,contextTokens:64000,maxOutputTokens:32768,inputModalities:["text"],outputModalities:["text"],reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:true,min:0,max:2,confidence:"provider_metadata"},supportedParameters:["temperature","max_tokens"],source:"provider",capturedAt:"t"},pricing:{}} as ProviderModel;
 const repository={getTelepathicSeries:store.getTelepathicSeries.bind(store),saveTelepathicSeries:store.saveTelepathicSeries.bind(store),withTelepathicSeriesLease:store.withTelepathicSeriesLease.bind(store),assertTelepathicSeriesLease:store.assertTelepathicSeriesLease.bind(store),telepathicSeriesLeaseSignal:store.telepathicSeriesLeaseSignal.bind(store),getTelepathicSeriesLeaseState:store.getTelepathicSeriesLeaseState.bind(store),listTelepathicSeriesSummaries:store.listTelepathicSeriesSummaries.bind(store),listProviderConfigs:async()=>[],listProviderModels:async()=>[model]} as unknown as AppRepository;
 const profiles=["a","b","c"].map(id=>({id,name:id,defaultViewerTemperature:.5} as Profile));const workspace={id:"w",profileId:"human",name:"W",kind:"conversation"} as Workspace;
 const host=document.createElement("div");document.body.append(host);let root=createRoot(host);
 const render=()=>act(async()=>root.render(<TelepathicExchangePanel copy={getCopy(pl?"pl":"en")} settings={{...createDefaultSettings(),interfaceLanguage:pl?"pl":"en",sessionLanguage:pl?"pl":"en"}} profile={{id:"human",name:"Edward"} as Profile} workspace={workspace} profiles={profiles} workspaces={[]} repository={repository}/>));
 const wait=(check:()=>unknown)=>vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});await check();},{timeout:4000});
 const mount=async()=>{await render();await wait(()=>expect(host.querySelector(".telepathic-action-box")).not.toBeNull());};
 const fields=()=>[...host.querySelectorAll<HTMLTextAreaElement>(".telepathic-human-guidance textarea")];
 const type=async(index:number,text:string)=>act(async()=>{const field=fields()[index];Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,text);field.dispatchEvent(new Event("input",{bubbles:true}));});
 const refresh=async()=>{
  const button=()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===(pl?"Odśwież":"Refresh"))!;
  await wait(()=>expect(button().disabled).toBe(false));
  const step=telepathicConversationHumanStep((await store.getTelepathicSeries(config.seriesId))!);
  await act(async()=>button().click());
  await wait(()=>expect(fields()).toHaveLength(step.kind==="lead_guidance"?step.activeIds.length:0));
 };
 return {store,host,mount,wait,fields,type,refresh,getState:()=>store.getTelepathicSeries(config.seriesId),setState:async(next:typeof state)=>{state=next;await store.saveTelepathicSeries(state);},restart:async()=>{await act(async()=>root.unmount());root=createRoot(host);await mount();},cleanup:async()=>{await act(async()=>root.unmount());host.remove();}};
}

for(const pl of [false,true])it(`full Conversation ${pl?"PL":"EN"}: one question, empty finishes, checkpoint retains draft, next cycle clears it`,async()=>{
 const f=await fixture(pl);try{
  await f.mount();expect(f.fields()).toHaveLength(3);expect(f.host.querySelector(".telepathic-human-guidance input[type=checkbox]")).toBeNull();
  expect(f.fields()[0].closest("label")?.textContent).toContain(pl?"Pytanie / instrukcja dla a":"Question / instruction for a");
  await f.type(0,"  Describe the next motion  ");await f.refresh();expect(f.fields()[0].value).toContain("Describe the next motion");
  await act(async()=>f.host.querySelector<HTMLButtonElement>(".telepathic-human-guidance button[type=submit]")!.click());
  await f.wait(async()=>expect((await f.getState())!.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(1));
  await f.wait(()=>expect(f.fields()).toHaveLength(1));expect(f.fields()[0].value).toBe("");
  const state=(await f.getState())!,decision=state.rounds[0].guidance!.decisions[0];
  expect(decision).toEqual({cycle:1,finishRound:false,finishParticipantIds:["b","c"],individual:[{participantId:"a",instruction:"Describe the next motion"}]});
  expect(state.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:")).map(c=>c.participantId)).toEqual(["a"]);
  expect(mock.dispatch).toHaveBeenCalledTimes(1);expect(f.host.querySelector(".telepathic-guidance-actions")?.querySelectorAll("button")).toHaveLength(2);
  await f.type(0,"Unsaved next draft");await f.restart();expect(f.fields()[0].value).toBe("");
 }finally{await f.cleanup();}
});
for(const pl of [false,true])it(`full Conversation ${pl?"PL":"EN"}: own target category without assigned area`,async()=>{
 const f=await fixture(pl,true);try{await f.mount();const panel=f.host.querySelector(".telepathic-action-box")!;expect(panel.textContent).toContain(pl?"Kategoria":"Category");expect(panel.textContent).not.toMatch(/Obszar:|Area:/);expect(panel.textContent).toContain(pl?"własny cel":"your own target");expect(mock.dispatch).not.toHaveBeenCalled();}finally{await f.cleanup();}
});
it("history switches series without reusing another series' unsaved guidance draft",async()=>{
 const f=await fixture(false);try{
  const initial=(await f.getState())!;const other=createTelepathicSeriesState({...initial.config,seriesId:"other"},"2020-01-01T00:00:00Z");other.status="paused";
  other.rounds[0]={...structuredClone(initial.rounds[0]),assignment:other.rounds[0].assignment};other.rounds[0].target!.roundId=other.rounds[0].assignment.roundId;
  await f.store.saveTelepathicSeries(other);await f.mount();await f.type(0,"Draft belonging to first series");
  const open=()=>f.host.querySelectorAll<HTMLButtonElement>('.telepathic-history-icons button[aria-label="Open exchange"]');
  expect(open()).toHaveLength(2);await act(async()=>open()[1].click());await f.wait(()=>expect(f.fields()[0].value).toBe(""));
  await f.type(0,"Draft belonging to other series");await act(async()=>open()[0].click());await f.wait(()=>expect(f.fields()[0].value).toBe(""));
  expect(mock.dispatch).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});
for(const action of ["empty","explicit"] as const)it(`full Conversation ${action}: closes guidance without paid question calls`,async()=>{
 const f=await fixture(false);try{
  await f.mount();if(action==="explicit")await f.type(0,"This draft must not be sent");else await f.type(0," \n\t ");
  const selector=action==="explicit"?'button[type="button"]':'button[type="submit"]';
  await act(async()=>f.host.querySelector<HTMLButtonElement>(`.telepathic-human-guidance ${selector}`)!.click());
  await f.wait(async()=>expect((await f.getState())!.rounds[0].guidance!.closed).toBe(true));
  await f.wait(async()=>expect((await f.getState())!.rounds[0].blindByParticipant.a.status).toBe("sealed"));
  const state=(await f.getState())!;expect(state.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:"))).toHaveLength(0);expect(state.rounds[0].blindByParticipant.a.status).toBe("sealed");
  expect(state.rounds[0].guidance!.decisions[0].finishRound).toBe(action==="explicit");
  expect(state.rounds[0].guidance!.decisions[0].finishParticipantIds).toEqual(action==="explicit"?[]:["a","b","c"]);
 }finally{await f.cleanup();}
});
it("full Conversation changes round, hides archived actions, and disables fields during busy/uncertain",async()=>{
 const f=await fixture(false);try{
  await f.mount();await f.type(0,"Old round question");const original=(await f.getState())!;
  const next=structuredClone(original);next.currentRoundIndex=1;next.rounds[1]={...structuredClone(original.rounds[0]),assignment:next.rounds[1].assignment};
  await f.setState(next);await f.refresh();expect(f.fields()[0].value).toBe("");
  await f.type(0,"Pending question");let resolve!: (v:unknown)=>void;mock.dispatch.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>f.host.querySelector<HTMLButtonElement>(".telepathic-human-guidance button[type=submit]")!.click());await f.wait(()=>expect(mock.dispatch).toHaveBeenCalledTimes(1));
  expect(f.fields()[0].matches(":disabled")).toBe(true);expect(f.host.querySelector(".telepathic-human-guidance button")!.matches(":disabled")).toBe(true);
  await act(async()=>resolve({content:"A new movement",finishReason:"stop",usage:{}}));await f.wait(async()=>expect((await f.getState())!.rounds[1].blindByParticipant.a.guidanceResponses).toHaveLength(1));
  const uncertain=(await f.getState())!;uncertain.providerCalls[0].status="uncertain";await f.setState(uncertain);await f.refresh();
  await f.wait(()=>expect(f.fields()[0].matches(":disabled")).toBe(true));
  const before=JSON.stringify(await f.getState()),calls=mock.dispatch.mock.calls.length;
  await act(async()=>f.host.querySelector<HTMLFormElement>(".telepathic-human-guidance")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(JSON.stringify(await f.getState())).toBe(before);expect(mock.dispatch).toHaveBeenCalledTimes(calls);
  const archived=(await f.getState())!;archived.archivedAt="t";await f.setState(archived);await f.refresh();expect(f.fields()).toHaveLength(0);
 }finally{await f.cleanup();}
});
