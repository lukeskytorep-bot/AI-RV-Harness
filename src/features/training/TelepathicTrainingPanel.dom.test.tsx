import { historyPage, validateHistoryQuery, type TelepathicHistoryQuery } from "../../telepathicExchange/historySummaries";
// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {getCopy} from "../../i18n";
import {createDefaultSettings} from "../../startupDefaults";
import type {AppRepository} from "../../storage/repository";
import type {TelepathicSeriesConfig} from "../../telepathicExchange/types";
const mock=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("../../telepathicExchange/engine",async original=>({...await original<typeof import("../../telepathicExchange/engine")>(),runNextTelepathicAiRound:mock.run}));
import {createTelepathicSeriesState} from "../../telepathicExchange/engine";
import {TelepathicTrainingPanel} from "./TelepathicTrainingPanel";
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement("div");document.body.append(container);root=createRoot(container);mock.run.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
describe("telepathic Training mounted actions",()=>{
 it("retains the viewed round when collapsing history and stops the current operation",async()=>{
  const participants=["lead","a"].map(id=>({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:id,credentialId:id,credentialFingerprint:id,modelId:id,route:id}}));
  const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:"mounted",seriesWorkspaceId:"w",mode:"ai_ai_training",language:"en",participants,roundCount:2,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"lead"}};
  const state=createTelepathicSeriesState(config);state.status="paused";
  const repository={listProviderConfigs:vi.fn(async()=>[]),listProviderModels:vi.fn(async()=>[]),listTelepathicSeries:vi.fn(async()=>[state]),getTelepathicSeries:vi.fn(async()=>state)} as unknown as AppRepository;
 vi.mocked(repository).listTelepathicSeriesSummaries=vi.fn(async(query:TelepathicHistoryQuery)=>{
  const limit=validateHistoryQuery(query);
  const states=await repository.listTelepathicSeries();
  return historyPage(states.filter(item=>item.config.mode===query.mode && (!query.seriesWorkspaceId || item.config.seriesWorkspaceId===query.seriesWorkspaceId) && (query.archive==="all" || Boolean(item.archivedAt)===(query.archive==="archived")) && (!query.cursor || item.updatedAt<query.cursor.updatedAt || (item.updatedAt===query.cursor.updatedAt && item.config.seriesId<query.cursor.seriesId))).map(item=>({seriesId:item.config.seriesId,mode:item.config.mode,seriesWorkspaceId:item.config.seriesWorkspaceId,status:item.status,roundCount:item.config.roundCount,createdAt:item.createdAt,updatedAt:item.updatedAt,archivedAt:item.archivedAt,participantNames:item.config.participants.map(p=>p.displayName)})),limit);
 });

  let signal:AbortSignal|undefined;mock.run.mockImplementation((deps:{signal:AbortSignal})=>{signal=deps.signal;return new Promise((_resolve,reject)=>signal!.addEventListener("abort",()=>reject(new DOMException("Stopped","AbortError")),{once:true}));});
  await act(async()=>root.render(<TelepathicTrainingPanel copy={getCopy("en")} settings={{...createDefaultSettings(),interfaceLanguage:"en",sessionLanguage:"en"}} profiles={[]} workspaces={[]} repository={repository}/>));
  expect(container.textContent).not.toContain("Run preflight");expect(container.textContent).not.toContain("Generate final");
  const roundButtons=container.querySelectorAll<HTMLButtonElement>(".telepathic-round-tabs button");await act(async()=>roundButtons[1].click());const selected=container.querySelector(".telepathic-round-tabs button.active")?.textContent;
  await act(async()=>container.querySelector<HTMLButtonElement>(".telepathic-history-toggle")!.click());expect(container.querySelector(".telepathic-round-tabs button.active")?.textContent).toBe(selected);
  const run=[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("Run / continue"))!;
  await act(async()=>{run.click();await Promise.resolve();});expect(signal?.aborted).toBe(false);
  const stop=[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Stop")!;expect(stop).toBeTruthy();await act(async()=>stop.click());expect(signal?.aborted).toBe(true);expect(mock.run).toHaveBeenCalledTimes(1);expect(container.textContent).not.toContain("Uncertain provider calls");
 });
});
