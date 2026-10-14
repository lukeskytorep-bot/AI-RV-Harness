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
const mock=vi.hoisted(()=>({dispatch:vi.fn(), routeError:null as Error | null}));
vi.mock("../../aiCenter/viewerIdentitySelection",async original=>({...await original<typeof import("../../aiCenter/viewerIdentitySelection")>(),listEligibleViewerIdentities:async()=>[]}));
vi.mock("../../providers/requestExecutor",async original=>({...await original<typeof import("../../providers/requestExecutor")>(),executeProviderChat:mock.dispatch}));
vi.mock("../../telepathicExchange/providerGateway",async original=>({...await original<typeof import("../../telepathicExchange/providerGateway")>(),resolveTelepathicAiRouteFromRepository:async({participant,requestedSettings,repository}: {participant: {ai:Record<string,string>};requestedSettings:unknown;repository:AppRepository})=>{
 if(mock.routeError) throw mock.routeError;
 const snapshot=participant.ai;return {snapshot,requestedSettings,model:(await repository.listProviderModels())[0],providerConfig:{id:"c",provider:"custom_openai",credentialId:"k",baseUrl:"https://example.test/v1",enabled:true},validatedIdentity:{profileId:snapshot.profileId,workspaceId:snapshot.workspaceId,aiIdentityId:snapshot.aiIdentityId,credentialFingerprint:snapshot.credentialFingerprint}};
}}));
import {BrowserTelepathicExchangeRepository} from "../../storage/browser/telepathicExchangeRepository";
import {createTelepathicSeriesState, advanceTelepathicConversationSeries, runNextTelepathicAiRound, unresolvedTelepathicProviderCalls} from "../../telepathicExchange/engine";
import {TelepathicExchangePanel} from "./TelepathicExchangePanel";
import {TelepathicTrainingPanel} from "../training/TelepathicTrainingPanel";

import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { SqliteTelepathicExchangeRepository } from "../../storage/sqlite/telepathicExchangeRepository";
import type { TelepathicExchangeRepository } from "../../storage/contracts/telepathicExchangeRepository";
import type { DatabaseTransactionStatement } from "../../storage/databaseNative";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import { resolveTelepathicAiRouteFromRepository } from "../../telepathicExchange/providerGateway";

function sqlite() {
 const db = new DatabaseSync(":memory:");
 const migrations = resolve(process.cwd(), "src-tauri/migrations");
 for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) db.exec(readFileSync(resolve(migrations, name), "utf8"));
 db.exec("INSERT INTO profiles(id,display_name,created_at,updated_at) VALUES ('u','U','t','t'); INSERT INTO workspaces(id,profile_id,name,created_at,updated_at,last_opened_at) VALUES ('w','u','W','t','t','t');");
 const bind = (sql: string) => sql.replace(/\$\d+/g, "?");
 const write = async (query: string, values: unknown[] = []) => ({rowsAffected: Number(db.prepare(bind(query)).run(...values as never[]).changes)});
 const transaction = async (statements: DatabaseTransactionStatement[]) => {
  db.exec("BEGIN IMMEDIATE"); try { const counts = []; for (const statement of statements) counts.push((await write(statement.query, statement.values)).rowsAffected); db.exec("COMMIT"); return counts; }
  catch (error) {db.exec("ROLLBACK"); throw error;}
 };
 const repository = new SqliteTelepathicExchangeRepository({ select: async <T,>(query: string, values: unknown[] = []) => db.prepare(bind(query)).all(...values as never[]) as T,
  executeWrite: write, executeTransaction: transaction, executeFencedTransaction: async ({seriesId, leaseOwner, leaseVersion, statements}) => {
   if (!db.prepare("SELECT id FROM telepathic_series WHERE id=? AND run_lease_owner=? AND run_lease_version=? AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").get(seriesId, leaseOwner, leaseVersion)) throw new Error("Lost fence");
   return transaction(statements);
  }});
 return {db, repository};
}

type Mode = "conversation_exchange" | "ai_ai_training";
async function fixture(mode: Mode, language: "pl" | "en" = "en", native = false, finalizing = false) {
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
 localStorage.clear(); mock.dispatch.mockReset(); mock.routeError=null;
 const ai = (id:string) => ({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}});
 const config: TelepathicSeriesConfig = {schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:"execution",seriesWorkspaceId:"w",mode,language,participants:mode === "ai_ai_training" ? [ai("lead"),ai("a")] : [ai("lead"),...(finalizing ? [ai("a")] : []),{id:"human",kind:"human",displayName:"Human"}],roundCount:1,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"lead"}};
 const db = native ? sqlite() : null;
 const store: TelepathicExchangeRepository = db?.repository ?? new BrowserTelepathicExchangeRepository();
 const state = createTelepathicSeriesState(config); state.status = "paused"; state.rounds[0].status = "blind";
 state.rounds[0].target = {schemaVersion:1,roundId:state.rounds[0].assignment.roundId,senderParticipantId:"lead",content:"HIDDEN",assets:[],contentSha256:"hash",status:"transmission_ready",lockedAt:"t",transmissionReadyAt:"t"};
 if (mode === "conversation_exchange") state.rounds[0].blindByParticipant.human = {participantId:"human",first:"own",status:"first_complete",providerAttemptCount:0};
 if (finalizing) {state.currentRoundIndex=1;state.rounds[0].status="completed";state.rounds[0].revealedAt="t";state.finalReflections.a="already accepted";}
 await store.saveTelepathicSeries(state);
 const model = {providerConfigId:"c",provider:"custom_openai",modelId:"m",route:"m",capabilities:{contextTokens:64000,maxOutputTokens:32768,inputModalities:["text"],outputModalities:["text"],reasoning:{supported:true,efforts:["low","high"],confidence:"provider_metadata"},temperature:{supported:true,min:0,max:2,confidence:"provider_metadata"},supportedParameters:["temperature","reasoning","max_tokens"],source:"provider",capturedAt:"t"},pricing:{}} as ProviderModel;
 const profiles = config.participants.filter(p=>p.kind === "ai").map(p=>({id:p.id,name:p.id,defaultViewerModelId:"m",defaultViewerTemperature:0.5,defaultViewerReasoningEffort:"low"} as Profile));
 const facade = (adapter: TelepathicExchangeRepository) => ({getTelepathicSeries:adapter.getTelepathicSeries.bind(adapter),saveTelepathicSeries:adapter.saveTelepathicSeries.bind(adapter),withTelepathicSeriesLease:adapter.withTelepathicSeriesLease.bind(adapter),assertTelepathicSeriesLease:adapter.assertTelepathicSeriesLease.bind(adapter),telepathicSeriesLeaseSignal:adapter.telepathicSeriesLeaseSignal.bind(adapter),getTelepathicSeriesLeaseState:adapter.getTelepathicSeriesLeaseState!.bind(adapter),listTelepathicSeries:adapter.listTelepathicSeries.bind(adapter),listTelepathicSeriesSummaries:adapter.listTelepathicSeriesSummaries.bind(adapter),listProviderConfigs:async()=>[],listProviderModels:async()=>[model]}) as unknown as AppRepository;
 let repository = facade(store);
 const container = document.createElement("div");document.body.append(container);let root = createRoot(container);
 const render = () => act(async()=>root.render(mode === "ai_ai_training" ? <TelepathicTrainingPanel copy={getCopy(language)} settings={{...createDefaultSettings(),interfaceLanguage:language,sessionLanguage:language}} profiles={profiles} workspaces={[]} repository={repository}/> : <TelepathicExchangePanel copy={getCopy(language)} settings={{...createDefaultSettings(),interfaceLanguage:language,sessionLanguage:language}} profiles={profiles} workspaces={[]} profile={{id:"human",name:"Human"} as Profile} workspace={{id:"w",profileId:"human",name:"W",kind:"conversation"} as Workspace} repository={repository}/>));
 const pending: Array<{resolve:(value:unknown)=>void;reject:(error:Error)=>void}> = [];
 mock.dispatch.mockImplementation(({signal}: {signal:AbortSignal}) => new Promise((resolve,reject)=>{
  pending.push({resolve,reject}); signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
 }));
 const button = (text: string) => {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  if (text === "Zatrzymaj") text = "Stop";
  return buttons.find(b => b.textContent?.includes(text)) ?? (["Run / continue", "Continue / Resume", "Uruchom / kontynuuj", "Kontynuuj / Resume"].includes(text) ? buttons.find(b => b.textContent?.trim() === (language === "pl" ? "Wznów" : "Resume")) : undefined);
 };
 const runText = language === "pl" ? (mode === "ai_ai_training" ? "Uruchom / kontynuuj" : "Kontynuuj / Resume") : (mode === "ai_ai_training" ? "Run / continue" : "Continue / Resume");
 const wait = async (assert:()=>unknown) => vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});await assert();},{timeout:4000,interval:25});
 const mount = async () => {await render();await wait(()=>expect(button(runText)?.disabled).toBe(false));};
 const run = async (count=1) => {await act(async()=>button(runText)!.click());await wait(()=>expect(mock.dispatch).toHaveBeenCalledTimes(count));};
 const noAlarm = (historicalFailure = false) => {expect(container.textContent).not.toMatch(/Series blocked|Seria zatrzymana|Uncertain provider calls|Niepewne wywołania providera/);if (!historicalFailure) expect(container.textContent).not.toMatch(/delivery unconfirmed|wysłanie niepotwierdzone/);expect(button(language === "pl" ? "Zezwól na ponowienie" : "Allow retry")).toBeUndefined();};
 const waiting = async (historicalFailure = false) => {await wait(()=>expect(container.textContent).toContain(language === "pl" ? "Oczekiwanie na odpowiedź" : "Waiting for response"));noAlarm(historicalFailure);if (historicalFailure && mode === "ai_ai_training") {const headings=[...container.querySelectorAll(".telepathic-transcript-message small")].map(node=>node.textContent);expect(headings[0]).toContain("delivery unconfirmed");expect(headings.at(-1)).toContain("Waiting for response");}expect(button(language === "pl" ? "Zatrzymaj" : "Stop")).toBeTruthy();};
 const stop = async () => {await act(async()=>button(language === "pl" ? "Zatrzymaj" : "Stop")!.click());await wait(()=>expect(button("Stop")?.disabled ?? true).toBe(true));};
 return {store,db,config,container,pending,button,wait,mount,run,waiting,stop,noAlarm,
  async remount(snapshot?: typeof state, adapter: TelepathicExchangeRepository = store) {await act(async()=>root.unmount());await vi.waitFor(async()=>expect(await store.getTelepathicSeriesLeaseState!("execution")).toBe("idle"));if(snapshot) await store.saveTelepathicSeries(snapshot);repository=facade(adapter);root=createRoot(container);await render();},
  async externalRun() {const controller = new AbortController();const deps = {store,signal:controller.signal,resolveRoute:async(p:typeof config.participants[number])=>resolveTelepathicAiRouteFromRepository({repository,participant:p,requestedSettings:profileGenerationDefaults(profiles.find(profile=>profile.id === p.ai!.profileId)!,model)})};const task = (mode === "ai_ai_training" ? runNextTelepathicAiRound : advanceTelepathicConversationSeries)(deps,"execution").catch(()=>undefined);await vi.waitFor(()=>expect(pending.length).toBe(1));return {controller,task};},
  async observeOther() {repository=facade(new BrowserTelepathicExchangeRepository());await render();},
  async cleanup() {await act(async()=>root.unmount());await vi.waitFor(async()=>expect(await store.getTelepathicSeriesLeaseState!("execution")).toBe("idle"));container.remove();db?.db.close();}
 };
}

for (const mode of ["conversation_exchange","ai_ai_training"] as const) {
 for (const language of ["pl","en"] as const) it(`${mode}/${language}: real dispatched -> succeeded stays neutral`, async()=>{
  const f = await fixture(mode,language);
  try {
   await f.mount();await f.run();await f.waiting();
   const before = (await f.store.getTelepathicSeries("execution"))!;expect(before.providerCalls[0].status).toBe("dispatched");expect(unresolvedTelepathicProviderCalls(before)).toHaveLength(1);
   await act(async()=>f.pending[0].resolve({content:mode === "conversation_exchange" ? JSON.stringify({cycle:1,finishRound:false,finishParticipantIds:[],individual:[{participantId:"human",instruction:"Describe movement"}]}) : "A stone bridge over a river.",finishReason:"stop",usage:{totalTokens:12}}));
   await f.wait(async()=>expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].status).toBe("succeeded"));
   if (mode === "ai_ai_training") {await f.wait(()=>expect(mock.dispatch).toHaveBeenCalledTimes(2));await f.waiting();await f.stop();}
   else {await f.wait(()=>expect(f.button("Stop")?.disabled ?? true).toBe(true));f.noAlarm();expect(mock.dispatch).toHaveBeenCalledTimes(1);}
   expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].usage?.totalTokens).toBe(12);
  } finally {await f.cleanup();}
 });
 it(`${mode}: uncertain failure, explicit second attempt, exhausted limit`, async()=>{
  const f = await fixture(mode);
  try {
   await f.mount();await f.run();await f.waiting();await act(async()=>f.pending[0].reject(new Error("Network interrupted after dispatch.")));
   await f.wait(()=>expect(f.button("Allow retry")?.disabled).toBe(false));expect(f.container.textContent).toContain("Telepathic provider result is uncertain after dispatch.");expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].errorMessage).toBe("Network interrupted after dispatch.");expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].status).toBe("uncertain");
   await act(async()=>f.button("Allow retry")!.click());await f.wait(async()=>expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].status).toBe("failed"));
   await f.wait(()=>expect(f.button(mode === "ai_ai_training" ? "Run / continue" : "Continue / Resume")?.disabled).toBe(false));await f.run(2);await f.waiting(true);
   expect((await f.store.getTelepathicSeries("execution"))!.providerCalls.map(c=>c.technicalAttempt)).toEqual([1,2]);
   await act(async()=>f.pending[1].reject(new Error("Second delivery interrupted.")));await f.wait(()=>expect(f.button("Resolve exhausted attempt")?.disabled).toBe(false));
   await act(async()=>f.button("Resolve exhausted attempt")!.click());await f.wait(()=>expect(f.button(mode === "ai_ai_training" ? "Run / continue" : "Continue / Resume")?.disabled).toBe(false));
   await act(async()=>f.button(mode === "ai_ai_training" ? "Run / continue" : "Continue / Resume")!.click());await f.wait(()=>expect(f.container.textContent).toMatch(/attempts exhausted/));expect(mock.dispatch).toHaveBeenCalledTimes(2);
  } finally {await f.cleanup();}
 });
 for (const language of ["pl","en"] as const) it(`${mode}/${language}: Stop distinguishes paused from blocked; restart with real dispatched checkpoint requires resolution`, async()=>{
  const f = await fixture(mode,language,false,true);
  try {
   await f.mount();await f.run();await f.waiting();const dispatched=(await f.store.getTelepathicSeries("execution"))!;
   await f.stop();const stopped=(await f.store.getTelepathicSeries("execution"))!;expect(stopped.status).toBe("paused");expect(stopped.providerCalls[0].status).toBe("uncertain");expect(f.container.textContent).not.toContain("Unblock and resume");
   await f.remount(dispatched,new BrowserTelepathicExchangeRepository());await f.wait(()=>expect(f.button(language === "pl" ? "Zezwól na ponowienie" : "Allow retry")?.disabled).toBe(false));
   expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].status).toBe("dispatched");expect(f.container.textContent).not.toMatch(/Waiting for response|Oczekiwanie na odpowiedź/);expect(mock.dispatch).toHaveBeenCalledTimes(1);expect(f.container.querySelector(".telepathic-transcript-message small")?.textContent).toContain(language === "pl" ? "wysłanie niepotwierdzone" : "delivery unconfirmed");
  } finally {await f.cleanup();}
 });
 for (const language of ["pl","en"] as const) it(`${mode}/${language}: second window observes the actual owner and offers no retry`, async()=>{
  const f = await fixture(mode,language,false,true);
  let external: Awaited<ReturnType<typeof f.externalRun>> | undefined;
  try {
   external=await f.externalRun();await f.observeOther();await f.wait(()=>expect(f.container.textContent).toContain(language === "pl" ? "Praca trwa w innym oknie" : "Work is running in another window"));
   f.noAlarm();expect(f.container.querySelector(".telepathic-transcript-message small")?.textContent).toContain(language === "pl" ? "Praca trwa w innym oknie" : "Work is running in another window");expect(f.button("Stop")?.disabled ?? true).toBe(true);expect(mock.dispatch).toHaveBeenCalledTimes(1);
   await act(async()=>external!.controller.abort(new DOMException("Interrupted owner","AbortError")));await external.task;
   await f.wait(()=>expect(f.button(language === "pl" ? "Zezwól na ponowienie" : "Allow retry")?.disabled).toBe(false));expect(mock.dispatch).toHaveBeenCalledTimes(1);
  } finally {external?.controller.abort();await external?.task;await f.cleanup();}
 });
 it(`${mode}: actual SQLite lease loss aborts execution and fences the checkpoint`, async()=>{
  const f = await fixture(mode,"en",true);
  try {
   await f.mount();await f.run();await f.waiting();const persisted=(await f.store.getTelepathicSeries("execution"))!;
   f.db!.db.prepare("UPDATE telepathic_series SET run_lease_owner='replacement-owner', run_lease_version=run_lease_version+1, run_lease_expires_at=? WHERE id='execution'").run(new Date(Date.now()+60000).toISOString());
   await f.wait(()=>expect(f.button("Stop")?.disabled ?? true).toBe(true));await f.wait(()=>expect(f.container.textContent).toContain("Work is running in another window"));
   expect(f.container.textContent).toMatch(/Lost fence|lease was lost/);expect(f.button("Allow retry")).toBeUndefined();expect((await f.store.getTelepathicSeries("execution"))!.providerCalls).toEqual(persisted.providerCalls);expect(mock.dispatch).toHaveBeenCalledTimes(1);
   f.db!.db.exec("UPDATE telepathic_series SET run_lease_owner=NULL, run_lease_expires_at=NULL WHERE id='execution'");await f.wait(()=>expect(f.button("Allow retry")?.disabled).toBe(false));
   expect(f.db!.db.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(f.db!.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {f.db!.db.exec("UPDATE telepathic_series SET run_lease_owner=NULL, run_lease_expires_at=NULL WHERE id='execution'");await f.cleanup();}
 });
 it(`${mode}: pre-dispatch route failure retains its actual reason without an uncertain result`, async()=>{
  const f=await fixture(mode);
  try {await f.mount();mock.routeError=new Error("Route unavailable before dispatch");await act(async()=>f.button(mode === "ai_ai_training" ? "Run / continue" : "Continue / Resume")!.click());
   await f.wait(()=>expect(f.container.textContent).toContain("Route unavailable before dispatch"));expect((await f.store.getTelepathicSeries("execution"))!.providerCalls).toHaveLength(0);expect(mock.dispatch).not.toHaveBeenCalled();expect(f.button("Allow retry")).toBeUndefined();await f.wait(()=>expect(f.button("Resume")?.disabled).toBe(false));
  }finally {await f.cleanup();}
 });
 it(`${mode}: repetition is visibly different from uncertain delivery`, async()=>{
  const f=await fixture(mode);
  try {await f.mount();mock.dispatch.mockResolvedValue({content:`Useful evidence\n${"our ".repeat(240)}`,finishReason:"stop",usage:{}});
   await act(async()=>f.button(mode === "ai_ai_training" ? "Run / continue" : "Continue / Resume")!.click());await f.wait(()=>expect(f.container.textContent).toContain("Response repetition detected"));
   const state=(await f.store.getTelepathicSeries("execution"))!;expect(state.status).toBe("blocked");expect(state.providerCalls).toHaveLength(2);expect(state.providerCalls.every(call=>call.status === "failed" && call.finishReason === "repetition_runaway")).toBe(true);expect(f.button("Allow retry")).toBeUndefined();
  }finally {await f.cleanup();}
 });
 it(`${mode}: another window's accepted final response replaces stale dispatched without an alarm`, async()=>{
  const f=await fixture(mode);let external:Awaited<ReturnType<typeof f.externalRun>> | undefined;
  try {
   const state=(await f.store.getTelepathicSeries("execution"))!;state.currentRoundIndex=1;state.rounds[0].status="completed";state.rounds[0].revealedAt="t";if(mode === "ai_ai_training") state.finalReflections.a="already accepted";await f.store.saveTelepathicSeries(state);
   external=await f.externalRun();await f.observeOther();await f.wait(()=>expect(f.container.textContent).toContain("Work is running in another window"));
   await act(async()=>{f.pending[0].resolve({content:"Accepted final reflection",finishReason:"stop",usage:{}});await external!.task;});
   await f.wait(()=>expect(f.container.textContent).toContain("Accepted final reflection"));f.noAlarm();expect(f.container.textContent).not.toContain("Work is running in another window");expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].status).toBe("succeeded");expect(mock.dispatch).toHaveBeenCalledTimes(1);
  }finally {external?.controller.abort();await external?.task;await f.cleanup();}
 });

 it(`${mode}: unknown ownership fails closed without inventing an owner or retrying`, async()=>{
  const f=await fixture(mode);
  try {
   await f.mount();await f.run();await f.waiting();const dispatched=(await f.store.getTelepathicSeries("execution"))!;await f.stop();
   const observer=new BrowserTelepathicExchangeRepository();const check=vi.spyOn(observer,"getTelepathicSeriesLeaseState").mockRejectedValue(new Error("Ownership unavailable"));
   await f.remount(dispatched,observer);await f.wait(()=>expect(f.container.textContent).toContain("Checking execution state"));f.noAlarm();expect(f.container.textContent).not.toContain("Work is running in another window");expect(mock.dispatch).toHaveBeenCalledTimes(1);
   check.mockRestore();await f.wait(()=>expect(f.button("Allow retry")?.disabled).toBe(false));expect(mock.dispatch).toHaveBeenCalledTimes(1);
  }finally {await f.cleanup();}
 });

 for (const language of ["pl","en"] as const) it(`${mode}/${language}: visible final-call materials stay neutral through accepted response`, async()=>{
  const f=await fixture(mode,language,false,true);
  try {
   await f.mount();await f.run();await f.waiting();
   const heading=f.container.querySelector(".telepathic-transcript-message small");expect(heading?.textContent).toContain(language === "pl" ? "Oczekiwanie na odpowiedź" : "Waiting for response");
   const dispatched=(await f.store.getTelepathicSeries("execution"))!;expect(dispatched.providerCalls[0].status).toBe("dispatched");expect(dispatched.providerCalls[0].callStage).toBe("series_reflection");
   await act(async()=>f.pending[0].resolve({content:"Accepted local final reflection",finishReason:"stop",usage:{}}));
   await f.wait(()=>expect(f.container.textContent).toContain("Accepted local final reflection"));await f.wait(()=>expect(f.button("Stop")?.disabled ?? true).toBe(true));f.noAlarm();
   expect(f.container.querySelector(".telepathic-transcript-message small")?.textContent).not.toMatch(/Waiting for response|Oczekiwanie na odpowiedź|unconfirmed|niepotwierdzone/);expect((await f.store.getTelepathicSeries("execution"))!.providerCalls[0].status).toBe("succeeded");expect(mock.dispatch).toHaveBeenCalledTimes(1);
  }finally {await f.cleanup();}
 });

}

for (const mode of ["conversation_exchange", "ai_ai_training"] as const) for (const language of ["pl", "en"] as const) it(`S2 metric Stop/stopping/End whole series: ${mode}/${language}`, async () => {
 const f = await fixture(mode, language); let release!: () => void;
 mock.dispatch.mockImplementation(({signal}: {signal: AbortSignal}) => new Promise((_resolve,reject) => { release = () => reject(signal.reason); }));
 try {
  await f.mount(); await f.run(); await f.waiting();
  expect(f.button("Stop")?.closest(".telepathic-runtime-metrics")).not.toBeNull();
  await act(async()=>f.button("Stop")!.click());
  expect(f.button(language === "pl" ? "Zatrzymywanie…" : "Stopping…")?.disabled).toBe(true);
  expect(f.button(language === "pl" ? "Zakończ" : "End")).toBeUndefined();
  await act(async()=>release());
  await f.wait(()=>expect(f.button(language === "pl" ? "Zakończ" : "End")?.disabled).toBe(false));
  expect(f.button(language === "pl" ? "Wznów" : "Resume")?.disabled).toBe(true);
  const before = (await f.store.getTelepathicSeries("execution"))!;
  expect(before.providerCalls[0].status).toBe("uncertain");
  await act(async()=>f.button(language === "pl" ? "Zakończ" : "End")!.click());
  await f.wait(async()=>expect((await f.store.getTelepathicSeries("execution"))?.termination?.reason).toBe("user_finished"));
  const ended = (await f.store.getTelepathicSeries("execution"))!;
  expect(ended.status).toBe("cancelled"); expect(ended.providerCalls).toEqual(before.providerCalls); expect(ended.rounds).toEqual(before.rounds);
  expect(ended.finalReflections).toEqual(before.finalReflections); expect(mock.dispatch).toHaveBeenCalledTimes(1);
  await f.remount();
  expect(f.button(language === "pl" ? "Zakończ" : "End")).toBeUndefined();
  expect(f.button(language === "pl" ? "Wznów" : "Resume")).toBeUndefined();
  const newLabel = mode === "conversation_exchange" ? (language === "pl" ? "Nowa wymiana" : "New exchange") : (language === "pl" ? "Nowy trening" : "New training");
  expect(f.button(newLabel)?.disabled).toBe(false);
 } finally { release?.(); await f.cleanup(); }
});

for(const mode of ["conversation_exchange","ai_ai_training"] as const) it(`S2 ${mode}: failed End save keeps recovery actions and allows a manual retry`,async()=>{
 const original=BrowserTelepathicExchangeRepository.prototype.saveTelepathicSeries;let fail=true;
 const write=vi.spyOn(BrowserTelepathicExchangeRepository.prototype,"saveTelepathicSeries").mockImplementation(async function(this: BrowserTelepathicExchangeRepository,state){if(fail && state.termination)throw new Error("End checkpoint write failed");return original.call(this,state);});
 const f=await fixture(mode);
 try{
  await f.mount();const before=await f.store.getTelepathicSeries("execution");await act(async()=>f.button("End")!.click());
  await f.wait(()=>expect(f.container.textContent).toContain("End checkpoint write failed"));await f.wait(()=>expect(f.button("End")?.disabled).toBe(false));
  expect(await f.store.getTelepathicSeries("execution")).toEqual(before);expect(f.button("Resume")?.disabled).toBe(false);expect(mock.dispatch).not.toHaveBeenCalled();
  fail=false;await act(async()=>{f.button("End")!.click();f.button("End")?.click();});
  await f.wait(async()=>expect((await f.store.getTelepathicSeries("execution"))!.termination?.reason).toBe("user_finished"));expect(mock.dispatch).not.toHaveBeenCalled();
 }finally{write.mockRestore();await f.cleanup();}
});
