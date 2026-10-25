// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {SettingsScreen} from "./SettingsScreen";
import {TelepathicTrainingPanel} from "../training/TelepathicTrainingPanel";
import {TelepathicExchangePanel} from "../conversations/TelepathicExchangePanel";
import {BrowserTelepathicExchangeRepository} from "../../storage/browser/telepathicExchangeRepository";
import {createTelepathicSeriesState} from "../../telepathicExchange/engine";
import {createDefaultSettings} from "../../startupDefaults";
import {getCopy} from "../../i18n";
import type {AppRepository} from "../../storage/repository";
import type {Profile,Workspace} from "../../types";
import type {TelepathicMode} from "../../telepathicExchange/types";
import * as gateway from "../../telepathicExchange/providerGateway";
vi.mock("../../components/ProviderSettings",()=>({ProviderSettings:()=>null}));

function state(i:number,mode:TelepathicMode,archived=true){
 const ai=(id:string)=>({id,kind:"ai" as const,displayName:`${mode}-${i}-${id}`,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}});
 const s=createTelepathicSeriesState({schemaVersion:1,seriesId:`${mode}-${i}`,seriesWorkspaceId:"w",mode,language:"en",protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,participants:[ai("lead"),ai("a")],senderPolicy:{kind:"fixed_ai",participantId:"lead"},roundCount:1,topic:"any",discloseTopicToReceivers:false},new Date(Date.UTC(2026,9,13,1,i)).toISOString());
 s.status="paused";if(archived){s.archivedAt="2026-10-12T00:00:00Z";s.archiveRevision=1;}return s;
}
async function fixture(pl=false){
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 const store=new BrowserTelepathicExchangeRepository();
 const repository=Object.assign(store,{listProviderConfigs:async()=>[],listProviderModels:async()=>[],listArchivedProfiles:async()=>[],listArchivedWorkspaces:async()=>[],listArchivedChatThreads:async()=>[],listArchivedRvSessions:async()=>[],listArchivedTrainingRuns:async()=>[],listArchivedResearchProjects:async()=>[],listArchivedTargets:async()=>[]}) as unknown as AppRepository;
 for(const mode of ["conversation_exchange","ai_ai_training"] as const){for(let i=0;i<61;i++)await store.saveTelepathicSeries(state(i,mode));await store.saveTelepathicSeries(state(100,mode,false));}
 const full=vi.spyOn(repository,"listTelepathicSeries"),detail=vi.spyOn(repository,"getTelepathicSeries"),page=vi.spyOn(repository,"listTelepathicSeriesSummaries"),dispatch=vi.spyOn(gateway,"executeTelepathicProviderPacket"),changed=vi.fn(async()=>undefined);
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const copy=getCopy(pl?"pl":"en"),settings={...createDefaultSettings(),interfaceLanguage:pl?"pl" as const:"en" as const,sessionLanguage:pl?"pl" as const:"en" as const};
 const wait=(check:()=>unknown)=>vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,0));});await check();},{timeout:4000});
 const mount=async()=>{await act(async()=>root.render(<SettingsScreen copy={copy} settings={settings} workspaces={[]} repository={repository} onDataChanged={changed} onChange={()=>{}}/>));await act(async()=>[...host.querySelectorAll<HTMLButtonElement>(".settings-tabs button")].find(b=>b.textContent===copy.storage)!.click());};
 return {store,repository,host,root,copy,settings,full,detail,page,dispatch,changed,wait,mount,cleanup:async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();}};
}
for(const pl of [false,true])for(const mode of ["ai_ai_training","conversation_exchange"] as const)it(`Settings ${mode}/${pl}: pages >50 archived summaries, restores one with one detail and returns it to active history`,async()=>{
 const f=await fixture(pl);try{
  await f.mount();await f.wait(()=>expect(f.host.querySelectorAll(".telepathic-archive-group")).toHaveLength(2));
  const group=()=>[...f.host.querySelectorAll<HTMLElement>(".telepathic-archive-group")].find(g=>g.querySelector("summary")?.textContent?.includes(mode==="ai_ai_training"?"Training":"Conversation"))!;
  expect(group().querySelectorAll(".archive-row")).toHaveLength(50);expect(group().querySelector("summary")!.textContent).toContain("50+");expect(f.full).not.toHaveBeenCalled();expect(f.detail).not.toHaveBeenCalled();
  await act(async()=>[...group().querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===(pl?"Pokaż więcej":"Load more"))!.click());
  await f.wait(()=>expect(group().querySelectorAll(".archive-row")).toHaveLength(61));
  const row=[...group().querySelectorAll(".archive-row")].find(r=>r.querySelector("strong")?.textContent?.startsWith(`${mode}-0-`))!;
  await act(async()=>row.querySelector<HTMLButtonElement>("button")!.click());await f.wait(()=>expect(f.changed).toHaveBeenCalledTimes(1));
  const restored=(await f.store.getTelepathicSeries(`${mode}-0`))!;expect(restored.archivedAt).toBeUndefined();expect(restored.archiveRevision).toBe(2);expect(restored.providerCalls).toEqual([]);
  expect(f.detail.mock.calls.filter(c=>c[0]===`${mode}-0`)).toHaveLength(2); // restore detail plus this assertion's detail
  expect(f.full).not.toHaveBeenCalled();expect(f.dispatch).not.toHaveBeenCalled();expect(f.page.mock.calls.every(c=>c[0].archive==="archived")).toBe(true);
  await act(async()=>f.root.render(mode==="ai_ai_training"?<TelepathicTrainingPanel copy={f.copy} settings={f.settings} repository={f.repository} profiles={[]} workspaces={[]}/>:<TelepathicExchangePanel copy={f.copy} settings={f.settings} repository={f.repository} profiles={[]} workspaces={[]} profile={{id:"human",name:"Human"} as Profile} workspace={{id:"w"} as Workspace}/>));
  await f.wait(()=>expect(f.host.querySelectorAll(".telepathic-history article")).toHaveLength(2));expect(f.dispatch).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});
it("Settings failed archive page retries same cursor, restore failure leaves the record and parent archive blocks restore",async()=>{
 const f=await fixture();try{
  await f.mount();await f.wait(()=>expect(f.host.querySelectorAll(".telepathic-archive-group")).toHaveLength(2));
  const group=f.host.querySelector<HTMLElement>(".telepathic-archive-group")!;
  f.page.mockRejectedValueOnce(new Error("PAGE_FAILED"));await act(async()=>[...group.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Load more")!.click());await f.wait(()=>expect(group.textContent).toContain("PAGE_FAILED"));
  const query=f.page.mock.calls.at(-1)![0];await act(async()=>[...group.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Retry")!.click());await f.wait(()=>expect(group.querySelectorAll(".archive-row")).toHaveLength(61));expect(f.page.mock.calls.at(-1)![0]).toEqual(query);
  f.detail.mockRejectedValueOnce(new Error("RESTORE_FAILED"));await act(async()=>group.querySelector<HTMLButtonElement>(".archive-row button")!.click());await f.wait(()=>expect(f.host.textContent).toContain("RESTORE_FAILED"));expect(group.querySelectorAll(".archive-row")).toHaveLength(61);expect(f.changed).not.toHaveBeenCalled();
  Object.assign(f.repository,{listArchivedWorkspaces:async()=>[{id:"w",profileId:"p",name:"W",archivedAt:"t"}]});
  await act(async()=>f.root.render(<SettingsScreen copy={f.copy} settings={f.settings} workspaces={[]} repository={null} onDataChanged={f.changed} onChange={()=>{}}/>));
  await f.mount();await f.wait(()=>expect(f.host.querySelector('.telepathic-archive-group .archive-row button')?.matches(":disabled")).toBe(true));
  expect(f.dispatch).not.toHaveBeenCalled();
 }finally{await f.cleanup();}
});
