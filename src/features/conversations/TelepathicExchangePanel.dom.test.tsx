import { historyPage, validateHistoryQuery, type TelepathicHistoryQuery } from "../../telepathicExchange/historySummaries";
// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {getCopy} from "../../i18n";
import {createDefaultSettings} from "../../startupDefaults";
import type {AppRepository} from "../../storage/repository";
import type {Workspace,Profile} from "../../types";
import type {TelepathicSeriesConfig} from "../../telepathicExchange/types";
const mock=vi.hoisted(()=>({advance:vi.fn()}));
vi.mock("../../telepathicExchange/engine",async original=>({...await original<typeof import("../../telepathicExchange/engine")>(),advanceTelepathicConversationSeries:mock.advance}));
import {createTelepathicSeriesState} from "../../telepathicExchange/engine";
import {TelepathicExchangePanel} from "./TelepathicExchangePanel";
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement("div");document.body.append(container);root=createRoot(container);mock.advance.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();});
function fixture(legacy=false){
 const participants=[{id:"human",kind:"human" as const,displayName:"Human"},{id:"a",kind:"ai" as const,displayName:"A",ai:{profileId:"a",profileName:"A",workspaceId:"w",aiIdentityId:"a",providerConfigId:"a",credentialId:"a",credentialFingerprint:"a",modelId:"a",route:"a"}}];
 const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:legacy?undefined:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:"mounted",seriesWorkspaceId:"w",mode:"conversation_exchange",language:"en",participants,roundCount:2,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"a"}};
 const state=createTelepathicSeriesState(config);state.status="paused";
 const repository={listProviderConfigs:vi.fn(async()=>[]),listProviderModels:vi.fn(async()=>[]),listTelepathicSeries:vi.fn(async()=>[state]),getTelepathicSeries:vi.fn(async()=>structuredClone(state))} as unknown as AppRepository;
 vi.mocked(repository).listTelepathicSeriesSummaries=vi.fn(async(query:TelepathicHistoryQuery)=>{
  const limit=validateHistoryQuery(query);
  const states=await repository.listTelepathicSeries();
  return historyPage(states.filter(item=>item.config.mode===query.mode && (!query.seriesWorkspaceId || item.config.seriesWorkspaceId===query.seriesWorkspaceId) && (query.archive==="all" || Boolean(item.archivedAt)===(query.archive==="archived")) && (!query.cursor || item.updatedAt<query.cursor.updatedAt || (item.updatedAt===query.cursor.updatedAt && item.config.seriesId<query.cursor.seriesId))).map(item=>({seriesId:item.config.seriesId,mode:item.config.mode,seriesWorkspaceId:item.config.seriesWorkspaceId,status:item.status,roundCount:item.config.roundCount,createdAt:item.createdAt,updatedAt:item.updatedAt,archivedAt:item.archivedAt,participantNames:item.config.participants.map(p=>p.displayName)})),limit);
 });

 const render=async(workspaceId="w")=>act(async()=>root.render(<TelepathicExchangePanel copy={getCopy("en")} settings={{...createDefaultSettings(),interfaceLanguage:"en",sessionLanguage:"en"}} profile={{id:"human",name:"Human"} as Profile} workspace={{id:workspaceId} as Workspace} profiles={[]} workspaces={[]} repository={repository}/>));
 return {state,repository,render};
}
describe("mounted Conversation audit regressions",()=>{
 it("projects live checkpoints and metrics before operation completion, preserves viewed round and stops",async()=>{
  vi.useFakeTimers();const {state,render}=fixture();
  state.rounds[0].revealedAt="t";state.currentRoundIndex=1;state.rounds[1].blindByParticipant.human={participantId:"human",first:"own",status:"first_complete",providerAttemptCount:0};
  let signal:AbortSignal|undefined;
  mock.advance.mockImplementation((deps:{signal:AbortSignal})=>{signal=deps.signal;return new Promise((_resolve,reject)=>signal!.addEventListener("abort",()=>reject(new DOMException("Stopped","AbortError")),{once:true}));});
  await render();
  await act(async()=>container.querySelector<HTMLButtonElement>(".telepathic-schedule button")!.click());
  const selected=container.querySelector(".telepathic-schedule button.active")?.textContent;
  await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("Continue / Resume"))!.click());
  state.transcript=[{id:"checkpoint",seriesId:"mounted",roundId:state.rounds[0].assignment.roundId,sequence:1,stage:"reflection",kind:"reflection",authorId:"a",recipientIds:[],text:"FIRST_DURABLE_RESULT",createdAt:"t"}];
  state.providerCalls=[{id:"call",seriesId:"mounted",roundId:"r",participantId:"a",callStage:"receiver_first",technicalAttempt:1,status:"succeeded",scopeKey:"k",requestSha256:"h",usage:{totalTokens:42,costUsd:0.01},createdAt:"t",updatedAt:"t"}];
  await act(async()=>vi.advanceTimersByTimeAsync(550));
  expect(container.textContent).toContain("FIRST_DURABLE_RESULT");expect(container.querySelector(".session-run-metrics > span:nth-child(2) strong")?.textContent).toBe("42");expect(mock.advance).toHaveBeenCalledTimes(1);expect(signal?.aborted).toBe(false);expect(container.querySelector(".telepathic-schedule button.active")?.textContent).toBe(selected);
  await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Stop")!.click());expect(signal?.aborted).toBe(true);
 });
 it("retains legacy answers/reflections after reveal and hides other blinds before reveal",async()=>{
  const {state,render}=fixture(true);delete state.transcript;
  state.rounds[0].blindByParticipant.a={participantId:"a",first:"LEGACY_ANSWER",status:"sealed",providerAttemptCount:1};state.rounds[0].reflectionsByParticipant.a={participantId:"a",role:"sender",reflection:"LEGACY_REFLECTION"};state.finalReflections.a="LEGACY_FINAL";
  await render();expect(container.textContent).not.toContain("LEGACY_ANSWER");expect(container.textContent).toContain("not recorded in this version");
  state.rounds[0].revealedAt="t";await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Refresh")!.click());
  expect(container.textContent).toContain("LEGACY_ANSWER");expect(container.textContent).toContain("LEGACY_REFLECTION");expect(container.textContent).toContain("LEGACY_FINAL");
 });
 it("rejects a late polling result after workspace change",async()=>{
  vi.useFakeTimers();const {state,repository,render}=fixture();state.rounds[0].blindByParticipant.human={participantId:"human",first:"own",status:"first_complete",providerAttemptCount:0};
  mock.advance.mockImplementation((deps:{signal:AbortSignal})=>new Promise((_resolve,reject)=>deps.signal.addEventListener("abort",()=>reject(new DOMException("Stopped","AbortError")),{once:true})));
  await render();await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("Continue / Resume"))!.click());
  let release!: (value: typeof state)=>void;
  vi.mocked(repository.getTelepathicSeries).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve as typeof release;}));
  await act(async()=>vi.advanceTimersByTimeAsync(550));
  vi.mocked(repository.listTelepathicSeries).mockResolvedValue([]);
  await render("other-workspace");
  state.finalReflections.a="LATE_PRIVATE_OLD_VIEW";await act(async()=>release(state));
  expect(container.textContent).not.toContain("LATE_PRIVATE_OLD_VIEW");expect(container.querySelector(".telepathic-run-head")).toBeNull();
 });
 it("shows archived series with history actions and without human/recovery forms",async()=>{
  const {state,render}=fixture();state.archivedAt="t";state.archiveRevision=1;state.status="blocked";
  await render();expect(container.querySelector('.telepathic-history input[type="checkbox"]')).toBeNull();
  await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="Open exchange"]')!.click());
  expect(container.querySelector(".telepathic-run-head")).not.toBeNull();expect(container.querySelector(".telepathic-action-box")).toBeNull();
  expect(container.querySelector('button[aria-label="Save exchange"]')).not.toBeNull();expect(container.querySelector('button[aria-label="Restore exchange"]')).not.toBeNull();
 });

});
