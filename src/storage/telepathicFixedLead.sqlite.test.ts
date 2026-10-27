import { legacyLeadState } from "../telepathicExchange/__fixtures__/legacyLeadState";
import { scopeOutputBudget } from "../telepathicExchange/outputBudgets";
import { BrowserTelepathicExchangeRepository } from "./browser/telepathicExchangeRepository";
import type { ResolvedTelepathicAiRoute } from "../telepathicExchange/providerGateway";
import type { ProviderModel } from "../providers/types";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync,backup } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe,it,expect } from "vitest";
import { SqliteTelepathicExchangeRepository } from "./sqlite/telepathicExchangeRepository";
import { endTelepathicSeries,telepathicConversationHumanStep,advanceTelepathicConversationSeries,saveHumanTelepathicTarget,confirmHumanTelepathicTransmission,saveHumanTelepathicFirstBlind,sealHumanTelepathicBlind,saveHumanTelepathicReflection,saveHumanTelepathicSharing,saveHumanLeadGuidance,saveHumanGuidanceResponse,createTelepathicSeriesState } from "../telepathicExchange/engine";
import type { TelepathicSeriesConfig } from "../telepathicExchange/types";
import type { DatabaseTransactionStatement } from "./databaseNative";
import { setTelepathicArchived } from "../telepathicExchange/archive";
import { serializeTelepathicPlan } from "../telepathicExchange/persistence";
import { buildHumanLeadDecision } from "../telepathicExchange/leadGuidance";

it("UX-TEL-4 SQLite: archive/restore preserves checkpoint and ledger; another native owner blocks archiving",async()=>{
 const {db,repository}=database();try{
  const state=createTelepathicSeriesState(config);state.status="paused";state.finalReflections.a="Accepted final";
  state.providerCalls=[{id:"ledger",seriesId:"sqlite",roundId:state.rounds[0].assignment.roundId,participantId:"a",callStage:"receiver_first",technicalAttempt:1,status:"succeeded",scopeKey:"scope",requestSha256:"fingerprint",createdAt:"t",updatedAt:"t",responseText:"accepted"}];
  state.rounds[0].blindByParticipant.a={participantId:"a",first:"accepted",status:"sealed",providerAttemptCount:1,contentSha256:"sealed-hash",sealedAt:"t"};
  await repository.saveTelepathicSeries(state);const before=(await repository.getTelepathicSeries("sqlite"))!;
  const second=database(db,false).repository;
  let release!:()=>void;let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
  const held=repository.withTelepathicSeriesLease("sqlite",async()=>{started();await new Promise<void>(r=>{release=r;});});
  await ready;try{await expect(setTelepathicArchived(second,"sqlite",true)).rejects.toThrow();}finally{release();await held;}
  expect((await repository.getTelepathicSeries("sqlite"))!.archivedAt).toBeUndefined();
  await setTelepathicArchived(second,"sqlite",true);
  expect((await repository.listTelepathicSeriesSummaries({mode:"conversation_exchange",archive:"active"})).items).toEqual([]);
  expect((await repository.listTelepathicSeriesSummaries({mode:"conversation_exchange",archive:"archived"})).items).toHaveLength(1);
  await setTelepathicArchived(repository,"sqlite",false);const after=(await second.getTelepathicSeries("sqlite"))!;
  expect(after.archiveRevision).toBe(2);expect(after.rounds).toEqual(before.rounds);expect(after.providerCalls).toEqual(before.providerCalls);expect(after.finalReflections).toEqual(before.finalReflections);expect(after.plan).toEqual(before.plan);
  expect((await repository.listTelepathicSeriesSummaries({mode:"conversation_exchange",archive:"active"})).items).toHaveLength(1);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
 }finally{db.close();}
});
function database(db = new DatabaseSync(":memory:"), initialize = true, beforeTransaction?:()=>void) {
 if(initialize) {
 db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('w');");
 for(const file of ["028_telepathic_exchange_series.sql","029_telepathic_series_run_lease.sql"]) db.exec(readFileSync(new URL(`../../src-tauri/migrations/${file}`,import.meta.url),"utf8"));
 }
 const bind=(sql:string)=>sql.replace(/\$\d+/g,"?");
 const executeWrite=async(query:string,values:unknown[]=[])=>({rowsAffected:Number(db.prepare(bind(query)).run(...values as never[]).changes)});
 const transaction=async(statements:DatabaseTransactionStatement[])=>{beforeTransaction?.();db.exec("BEGIN IMMEDIATE");try {const result=[];for(const s of statements){const rows=(await executeWrite(s.query,s.values)).rowsAffected;if(s.query.startsWith("INSERT INTO telepathic_series ") && rows!==1)throw new Error("Stale telepathic archive revision conflict");result.push(rows);}db.exec("COMMIT");return result;}catch(error){db.exec("ROLLBACK");throw error;}};
 const repository=new SqliteTelepathicExchangeRepository({select:async<T>(query:string,values:unknown[]=[])=>db.prepare(bind(query)).all(...values as never[]) as T,executeWrite,executeTransaction:transaction,executeFencedTransaction:async({seriesId,leaseOwner,leaseVersion,statements})=>{
  const lease=db.prepare("SELECT id FROM telepathic_series WHERE id=? AND run_lease_owner=? AND run_lease_version=? AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").get(seriesId,leaseOwner,leaseVersion);
  if(!lease)throw new Error("Lost fence");return transaction(statements);
 }});
 return {db,repository};
}
const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:"sqlite",seriesWorkspaceId:"w",mode:"conversation_exchange",language:"en",roundCount:1,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"human_only",humanParticipantId:"lead"},participants:[{id:"lead",kind:"human",displayName:"Lead"},{id:"a",kind:"ai",displayName:"A",ai:{profileId:"p",profileName:"A",workspaceId:"w",aiIdentityId:"i",providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}}]};
describe("real SQLite fixed-lead checkpoint",()=>{
 it("round-trips geography, cycles, responses, transcript, usage, finalization and archive under lease",async()=>{
  const {db,repository}=database();try{
   const state=legacyLeadState(config);await repository.saveTelepathicSeries(state);
   state.rounds[0].guidance={decisions:[{cycle:1,finishRound:false,finishParticipantIds:[],broadcast:{recipientIds:["a"],instruction:"Describe movement"}}],finishedParticipantIds:[],closed:false};
   state.rounds[0].blindByParticipant.a={participantId:"a",status:"first_complete",providerAttemptCount:1,first:"slow",guidanceResponses:[{cycle:1,instruction:"Describe movement",response:"curved"}]};
   state.providerCalls=[{id:"call",seriesId:"sqlite",roundId:state.rounds[0].assignment.roundId,participantId:"a",callStage:"receiver_guidance:cycle:1:recipient:a",technicalAttempt:1,status:"succeeded",scopeKey:"scope",requestSha256:"hash",responseText:"curved",createdAt:"t",updatedAt:"t",usage:{totalTokens:100,costUsd:0.1},elapsedMs:50,physicalAttempts:1,costSource:"provider",finishReason:"stop",requestMessages:[{role:"user",content:"exact request"}]}];
   state.transcript=[{id:"event",seriesId:"sqlite",roundId:state.rounds[0].assignment.roundId,sequence:1,stage:"receiver_guidance",kind:"materials",authorId:"controller",recipientIds:["a"],text:"RAW REQUEST EVIDENCE",display:{version:1,instruction:"Describe motion"},createdAt:"t"}];state.finalization="pending";state.activeElapsedMs=50;
   await repository.withTelepathicSeriesLease("sqlite",()=>repository.saveTelepathicSeries(state));
   const loaded=(await repository.getTelepathicSeries("sqlite"))!;
   expect(loaded.rounds).toEqual(state.rounds);expect(loaded.providerCalls).toEqual(state.providerCalls);expect(loaded.transcript).toEqual(state.transcript);expect(loaded.plan).toEqual(state.plan);expect(loaded.finalization).toBe("pending");expect(loaded.activeElapsedMs).toBe(50);
   await setTelepathicArchived(repository,"sqlite",true);const archived=(await repository.getTelepathicSeries("sqlite"))!;expect(archived.archivedAt).toBeTruthy();
   // Even a stale snapshot with no revision cannot undo archive metadata.
   await expect(repository.saveTelepathicSeries(state)).rejects.toThrow(/revision/);expect((await repository.getTelepathicSeries("sqlite"))!.archivedAt).toBe(archived.archivedAt);
   await setTelepathicArchived(repository,"sqlite",false);const restored=(await repository.getTelepathicSeries("sqlite"))!;expect(restored.archivedAt).toBeUndefined();expect(restored.transcript).toEqual(state.transcript);
   expect(db.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{db.close();}
 });
 it("backs up and reopens real SQLite with the extension intact",async()=>{
  const {db,repository}=database();const directory=mkdtempSync(join(tmpdir(),"telepathy-backup-"));
  try{const state=createTelepathicSeriesState(config);await repository.saveTelepathicSeries(state);
   await backup(db,join(directory,"backup.sqlite"));const restoredDb=new DatabaseSync(join(directory,"backup.sqlite"));
   try{const restored=database(restoredDb,false).repository;const loaded=(await restored.getTelepathicSeries("sqlite"))!;expect(loaded.plan).toEqual(state.plan);expect(loaded.config).toEqual(state.config);expect(loaded.finalization).toBe("pending");expect(restoredDb.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});}finally{restoredDb.close();}
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
 });
});


describe("post-audit durability regressions",()=>{
 for (const fenced of [false,true]) it(`rolls back a raced parent conflict before any child writes (fenced=${fenced})`,async()=>{
  let race=false;
  const db=new DatabaseSync(":memory:");
  const {repository}=database(db,true,()=>{if(race){race=false;db.prepare("UPDATE telepathic_series SET plan_json=json_set(plan_json,'$._runtime.archiveRevision',1,'$._runtime.archivedAt','archived') WHERE id='sqlite'").run();}});
  try {
   const state=createTelepathicSeriesState(config);state.providerCalls=[{id:"call",seriesId:"sqlite",roundId:state.rounds[0].assignment.roundId,participantId:"a",callStage:"receiver_first",technicalAttempt:1,status:"succeeded",scopeKey:"k",requestSha256:"h",responseText:"accepted",createdAt:"t",updatedAt:"t"}];
   state.finalReflections={a:"accepted final"};await repository.saveTelepathicSeries(state);
   const stale=structuredClone(state);stale.providerCalls[0].status="dispatched";stale.providerCalls[0].responseText="stale";stale.finalReflections.a="stale final";stale.config.participants[1].displayName="stale name";stale.rounds[0].reflectionsByParticipant.a={participantId:"a",role:"receiver",reflection:"stale reflection"};
   race=true;
   const save=()=>repository.saveTelepathicSeries(stale);
   await expect(fenced?repository.withTelepathicSeriesLease("sqlite",save):save()).rejects.toThrow(/revision conflict/);
   const loaded=(await repository.getTelepathicSeries("sqlite"))!;
   expect(loaded.providerCalls).toEqual(state.providerCalls);expect(loaded.finalReflections).toEqual(state.finalReflections);expect(loaded.rounds).toEqual(state.rounds);expect(loaded.config).toEqual(state.config);expect(loaded.archivedAt).toBe("archived");
  }finally{db.close();}
 });
 for (const comment of [undefined,"","nonempty"]) it(`preserves NULL versus intentional comment ${JSON.stringify(comment)}`,async()=>{
  const {db,repository}=database();try {const state=createTelepathicSeriesState(config);state.rounds[0].reflectionsByParticipant.lead={participantId:"lead",role:"sender",reflection:"done",shareOthersConsent:"yes",sharedAnswersComment:comment};await repository.saveTelepathicSeries(state);const loaded=(await repository.getTelepathicSeries("sqlite"))!;expect(loaded.rounds[0].reflectionsByParticipant.lead.sharedAnswersComment).toBe(comment);}finally{db.close();}
 });
});

function browser() {
 const values=new Map<string,string>();
 const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},clear:()=>values.clear(),key:(n:number)=>[...values.keys()][n]??null,get length(){return values.size;}};
 return {repository:new BrowserTelepathicExchangeRepository({storage}),db: {close:()=>{}}};
}
function routeForA(): ResolvedTelepathicAiRoute {
 const snapshot=config.participants[1].ai!;
 return {snapshot,providerConfig:{id:"c",provider:"custom_openai",credentialId:"k",baseUrl:"https://example.test/v1",enabled:true,label:"test",createdAt:"t",updatedAt:"t"},
  model:{providerConfigId:"c",provider:"custom_openai",modelId:"m",route:"m",capabilities:{contextTokens:64000,maxOutputTokens:32768,inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:false,reasoning:{supported:true,efforts:["low","high"],confidence:"provider_metadata"},temperature:{supported:true,min:0,max:2,confidence:"provider_metadata"},supportedParameters:["temperature","reasoning","max_tokens"],source:"provider",capturedAt:"t"},pricing:{}} as ProviderModel,
  requestedSettings:{temperature:0.5,reasoningEffort:"low"},validatedIdentity:{profileId:"p",workspaceId:"w",aiIdentityId:"i",credentialFingerprint:"f"}};
}

describe("UX-TEL-3 durable human decisions",()=>{
 for(const backend of ["sqlite","browser"] as const)it(`${backend}: save, reload before dispatch, one recipient, explicit finishes, then empty decision seals`,async()=>{
  const {db,repository}=backend==="sqlite"?database():browser();try{
   const cfg:TelepathicSeriesConfig={...config,participants:[config.participants[0],...['a','b','c'].map(id=>({...config.participants[1],id,displayName:id}))]};
   await repository.saveTelepathicSeries(createTelepathicSeriesState(cfg));
   const deps={store:repository,resolveRoute:async()=>routeForA(),providerAttempt:async()=>({content:"A new rounded shape",finishReason:"stop",usage:{}})};
   await advanceTelepathicConversationSeries(deps,"sqlite");await saveHumanTelepathicTarget(deps,"sqlite",{content:"OWN TARGET"});await confirmHumanTelepathicTransmission(deps,"sqlite");
   const initial=await advanceTelepathicConversationSeries(deps,"sqlite");const target=JSON.stringify(initial.rounds[0].target);
   await saveHumanLeadGuidance(deps,"sqlite",buildHumanLeadDecision(1,["a","b","c"],{a:"Describe motion",b:"  \n",stale:"wrong ID"}));
   const checkpoint=(await repository.getTelepathicSeries("sqlite"))!;expect(checkpoint.rounds[0].guidance!.decisions[0]).toEqual({cycle:1,finishRound:false,finishParticipantIds:["b","c"],individual:[{participantId:"a",instruction:"Describe motion"}]});
   expect(telepathicConversationHumanStep(checkpoint).kind).toBe("none");
   let state=await advanceTelepathicConversationSeries(deps,"sqlite");expect(state.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:")).map(c=>c.participantId)).toEqual(["a"]);
   expect(telepathicConversationHumanStep(state)).toMatchObject({kind:"lead_guidance",cycle:2,activeIds:["a"]});
   await saveHumanLeadGuidance(deps,"sqlite",buildHumanLeadDecision(2,["a"],{}));
   const saved=(await repository.getTelepathicSeries("sqlite"))!;expect(telepathicConversationHumanStep(saved).kind).toBe("none");
   state=await advanceTelepathicConversationSeries(deps,"sqlite");expect(state.rounds[0].guidance!.closed).toBe(true);expect(state.rounds[0].blindByParticipant.a.status).toBe("sealed");expect(JSON.stringify(state.rounds[0].target)).toBe(target);
   const reloaded=(await repository.getTelepathicSeries("sqlite"))!;expect(reloaded.rounds[0].guidance).toEqual(state.rounds[0].guidance);expect(reloaded.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:"))).toHaveLength(1);
   if(backend==="sqlite"){const native=db as DatabaseSync;expect(native.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(native.prepare("PRAGMA foreign_key_check").all()).toEqual([]);}
  }finally{db.close();}
 });
});
describe("both durable backends use the engine's frozen step contract",()=>{
 for(const backend of ["sqlite","browser"] as const) {
  for(const drift of ["temperature","reasoning","endpoint","budgetRestart"] as const) it(`${backend}: ${drift} after restart of a length attempt`,async()=>{
   const {db,repository}=backend==="sqlite"?database():browser();
   try{
    let route=routeForA();const resolveRoute=async()=>route;
    await repository.saveTelepathicSeries(createTelepathicSeriesState({...config,outputBudgetPolicyVersion:3}));
    await saveHumanTelepathicTarget({store:repository,resolveRoute},"sqlite",{content:"TARGET"});await confirmHumanTelepathicTransmission({store:repository,resolveRoute},"sqlite");
    const controller=new AbortController();let calls=0;
    await expect(advanceTelepathicConversationSeries({store:repository,resolveRoute,signal:controller.signal,providerAttempt:async()=>{calls++;controller.abort();return {content:"partial",finishReason:"length",usage:{}};}},"sqlite")).rejects.toThrow();
    const loaded=(await repository.getTelepathicSeries("sqlite"))!;expect(loaded.providerCalls[0].requestSettings?.effective.temperature).toBe(0.5);
    if(drift==="temperature")route={...route,requestedSettings:{...route.requestedSettings,temperature:1.5}};
    if(drift==="reasoning")route={...route,requestedSettings:{...route.requestedSettings,reasoningEffort:"high"}};
    if(drift==="endpoint")route={...route,providerConfig:{...route.providerConfig,baseUrl:"https://other.test/v1"}};
    const resume=()=>advanceTelepathicConversationSeries({store:repository,resolveRoute,providerAttempt:async request=>{calls++;expect(request.settings.effective.maxOutputTokens).toBe(32768);return {content:"COMPLETE_RESTARTED",finishReason:"stop",usage:{}};}},"sqlite");
    if(drift==="budgetRestart") {const next=await resume();expect(next.rounds[0].blindByParticipant.a.first).toBe("COMPLETE_RESTARTED");expect(calls).toBe(2);}
    else {await expect(resume()).rejects.toThrow(/fingerprint.*changed/);expect(calls).toBe(1);}
   }finally{db.close();}
  });
  it(`${backend}: every human mutation uses fresh archived state under lease`,async()=>{
   const {db,repository}=backend==="sqlite"?database():browser();try{
    const resolveRoute=async()=>routeForA();const deps={store:repository,resolveRoute};await repository.saveTelepathicSeries(createTelepathicSeriesState(config));await setTelepathicArchived(repository,"sqlite",true);
    const before=await repository.getTelepathicSeries("sqlite");
    const actions=[()=>saveHumanTelepathicTarget(deps,"sqlite",{content:"changed"}),()=>confirmHumanTelepathicTransmission(deps,"sqlite"),()=>saveHumanTelepathicFirstBlind(deps,"sqlite","changed"),()=>sealHumanTelepathicBlind(deps,"sqlite","changed"),()=>saveHumanTelepathicReflection(deps,"sqlite","changed"),()=>saveHumanTelepathicSharing(deps,"sqlite","yes",""),()=>saveHumanLeadGuidance(deps,"sqlite",{cycle:1,finishRound:true,finishParticipantIds:[],individual:[]}),()=>saveHumanGuidanceResponse(deps,"sqlite","changed")];
    for(const action of actions)await expect(action()).rejects.toThrow(/archived/);
    expect(await repository.getTelepathicSeries("sqlite")).toEqual(before);
    await setTelepathicArchived(repository,"sqlite",false);const next=await saveHumanTelepathicTarget(deps,"sqlite",{content:"legal after restore"});expect(next.rounds[0].target?.content).toBe("legal after restore");
   }finally{db.close();}
  });
 }
});

for(const backend of ["sqlite","browser"] as const) it(`${backend}: a completed empty human sharing comment does not reopen after read`,async()=>{
 const {db,repository}=backend==="sqlite"?database():browser();try{
  const state=createTelepathicSeriesState({...config,senderPolicy:{kind:"fixed_ai",participantId:"a"}});state.rounds[0].revealedAt="t";state.rounds[0].reflectionsByParticipant.lead={participantId:"lead",role:"receiver",reflection:"done",shareOthersConsent:"yes",sharedAnswersComment:""};await repository.saveTelepathicSeries(state);const restarted=(await repository.getTelepathicSeries("sqlite"))!;expect(telepathicConversationHumanStep(restarted).kind).toBe("none");
 }finally{db.close();}
});

for(const version of [1,2,3,4] as const) it(`backs up and restores Telepathic output v${version} in SQLite and Browser`, async () => {
 const {db,repository}=database();const directory=mkdtempSync(join(tmpdir(),"telepathy-budget-backup-"));
 try {
  const state=createTelepathicSeriesState({...config,outputBudgetPolicyVersion:version===1?2:version});
  if(version===1)delete state.config.outputBudgetPolicyVersion;
  state.providerCalls=[{id:"budget-call",seriesId:config.seriesId,roundId:state.rounds[0].assignment.roundId,participantId:"a",callStage:"receiver_reveal",technicalAttempt:2,status:"failed",scopeKey:"frozen-budget-scope",requestSha256:"frozen-request",createdAt:"now",updatedAt:"now",outputBudgetSnapshot:scopeOutputBudget("receiver_reveal",65536,version===1?[{technicalAttempt:1,status:"failed"} as never]:[],version===1?undefined:version),outputDiagnostics:{policyVersion:version,requestedMaxOutputTokens:version>=3?49152:32768,effectiveMaxOutputTokens:version>=3?49152:32768,modelMaxOutputTokens:65536,completion:"partial"},usage:{totalTokens:11,reasoningTokens:5},finishReason:"length"}];
  if(version===4) {
   const parent=state.providerCalls[0];parent.manualRetryAuthorization={at:"authorized",originalStatus:"uncertain"};
   state.providerCalls.push({...structuredClone(parent),id:"manual-child",manualRetryAuthorization:undefined,manualRetryOfCallId:parent.id});
  }
  await repository.saveTelepathicSeries(state);await backup(db,join(directory,"budgets.sqlite"));
  const restoredDb=new DatabaseSync(join(directory,"budgets.sqlite"));
  try {
   const restored=(await database(restoredDb,false).repository.getTelepathicSeries(config.seriesId))!;
   expect(restored.config.outputBudgetPolicyVersion).toBe(version===1?undefined:version);expect(restored.providerCalls).toEqual(state.providerCalls);
   expect(restoredDb.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});
   const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}} as Storage;
   const browser=new BrowserTelepathicExchangeRepository({storage});await browser.saveTelepathicSeries(restored);
   const browserLoaded=(await browser.getTelepathicSeries(config.seriesId))!;expect(browserLoaded.providerCalls).toEqual(state.providerCalls);
  }finally{restoredDb.close();}
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

describe("S2 durable whole-series End",()=>{
 for(const backend of ["browser","sqlite"] as const) it(`${backend}: End preserves uncertain evidence, survives archive/restore and rejects stale writes`,async()=>{
  const {repository,db}=backend==="browser"?browser():database();
  try{
   const state=createTelepathicSeriesState(config);state.status="blocked";
   state.providerCalls=[{id:"uncertain",seriesId:"sqlite",roundId:state.rounds[0].assignment.roundId,participantId:"a",callStage:"receiver_first",technicalAttempt:2,status:"uncertain",scopeKey:"scope",requestSha256:"frozen-hash",createdAt:"t",updatedAt:"t",responseText:"partial evidence",usage:{totalTokens:29}}];
   await repository.saveTelepathicSeries(state);
   const deps={store:repository,resolveRoute:async()=>{throw new Error("provider must not be reached");}};
   const ended=await endTelepathicSeries(deps,"sqlite");
   expect(ended.termination?.reason).toBe("user_finished");expect(ended.providerCalls).toEqual(state.providerCalls);expect(ended.rounds).toEqual(state.rounds);
   expect(await endTelepathicSeries(deps,"sqlite")).toEqual(ended);
   await expect(repository.saveTelepathicSeries(state)).rejects.toThrow(/Ended/);
   await setTelepathicArchived(repository,"sqlite",true);await setTelepathicArchived(repository,"sqlite",false);
   const restored=(await repository.getTelepathicSeries("sqlite"))!;expect(restored.termination).toEqual(ended.termination);expect(restored.status).toBe("cancelled");expect(restored.providerCalls).toEqual(state.providerCalls);
   await expect(advanceTelepathicConversationSeries(deps,"sqlite")).rejects.toThrow(/ended/);
  }finally{db.close();}
 });
 it("SQLite: another lease owner blocks End; backup/reopen keeps the terminal marker",async()=>{
  const {db,repository}=database();const dir=mkdtempSync(join(tmpdir(),"s2-end-"));
  try{
   await repository.saveTelepathicSeries(createTelepathicSeriesState(config));const second=database(db,false).repository;
   let release!:()=>void;let ready!:()=>void;const started=new Promise<void>(r=>{ready=r;});
   const held=repository.withTelepathicSeriesLease("sqlite",async()=>{ready();await new Promise<void>(r=>{release=r;});});
   await started;try{await expect(endTelepathicSeries({store:second,resolveRoute:async()=>{throw new Error("must not dispatch");}},"sqlite")).rejects.toThrow();}finally{release();await held;}
   const ended=await endTelepathicSeries({store:second,resolveRoute:async()=>{throw new Error("must not dispatch");}},"sqlite");await backup(db,join(dir,"backup.sqlite"));
   const reopened=new DatabaseSync(join(dir,"backup.sqlite"));try{const repo=database(reopened,false).repository;expect((await repo.getTelepathicSeries("sqlite"))!.termination).toEqual(ended.termination);await expect(advanceTelepathicConversationSeries({store:repo,resolveRoute:async()=>{throw new Error("must not dispatch");}},"sqlite")).rejects.toThrow(/ended/);expect(reopened.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);}finally{reopened.close();}
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
 });
 for(const fenced of [false,true]) it(`SQLite: raced terminal parent rolls back all stale child writes (fenced=${fenced})`,async()=>{
  let race=false;const db=new DatabaseSync(":memory:");
  const {repository}=database(db,true,()=>{if(race){race=false;db.exec("UPDATE telepathic_series SET status='cancelled',plan_json=json_set(plan_json,'$._runtime.termination',json('{\"reason\":\"user_finished\",\"endedAt\":\"end\"}')) WHERE id='sqlite'");}});
  try{
   const state=createTelepathicSeriesState(config);state.finalReflections.a="accepted";await repository.saveTelepathicSeries(state);
   const stale=structuredClone(state);stale.finalReflections.a="late stale result";stale.config.participants[1].displayName="stale";stale.rounds[0].reflectionsByParticipant.a={participantId:"a",role:"receiver",reflection:"stale"};race=true;
   const save=()=>repository.saveTelepathicSeries(stale);await expect(fenced?repository.withTelepathicSeriesLease("sqlite",save):save()).rejects.toThrow(/revision conflict/);
   const actual=(await repository.getTelepathicSeries("sqlite"))!;expect(actual.status).toBe("cancelled");expect(actual.termination?.reason).toBe("user_finished");expect(actual.finalReflections).toEqual(state.finalReflections);expect(actual.rounds).toEqual(state.rounds);expect(actual.config).toEqual(state.config);
  }finally{db.close();}
 });
});
