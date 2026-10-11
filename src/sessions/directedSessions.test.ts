import { sendPostRevealTurn } from "./postReveal";
import { renderCompleteSessionMarkdown } from "../exports/sessionDocument";
import { buildJudgePacket } from "../domain/judgePacket";
import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, ProviderModel, ProviderMessage } from "../providers/types";
import { getFullRcp, getRvLite } from "../resources/protocolRegistry";
import type { AppRepository } from "../storage/repository";
import { BrowserSessionsRepository } from "../storage/browser/sessionsRepository";
import type { TargetRecord } from "../targets/types";
import type { CustomProtocolVersion } from "../protocols/types";
import { runAutomaticRcpSession, submitExternalReveal } from "./controller";
import { runAutomaticRvLiteSession } from "./rvLiteController";
import { runAutomaticCustomSession } from "./customController";
import { createSessionReplay } from "./resumeReplay";
import { focusOpening, validateSessionFocus, type SessionFocusPlan } from "./sessionFocus";
import { reconstructAcceptedBlindTranscript } from "../components/BlindTranscriptRecord";
import { runOrdinaryBatch } from "./batch";

class MemoryStorage implements Storage {
 readonly values=new Map<string,string>();
 get length(){return this.values.size;}
 clear(){this.values.clear();} getItem(key:string){return this.values.get(key)??null;}
 key(index:number){return [...this.values.keys()][index]??null;}
 removeItem(key:string){this.values.delete(key);} setItem(key:string,value:string){this.values.set(key,value);}
}
const config:ProviderConfig={id:"p",provider:"openrouter",label:"P",credentialId:"c",enabled:true,createdAt:"now",updatedAt:"now"};
const model:ProviderModel={providerConfigId:"p",provider:"openrouter",modelId:"m",displayName:"M",route:"openrouter:m",pricing:{},recommended:false,rawMetadata:{},refreshedAt:"now",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:false,confidence:"unknown"},supportedParameters:[],maxOutputTokens:65536,contextTokens:131072,source:"provider",capturedAt:"now"}};
const target:TargetRecord={id:"t",collection:"training",title:"SECRET TITLE",revealText:"SECRET REVEAL",tags:[],sourceMetadata:{},createdAt:"now",updatedAt:"now"};
const custom:CustomProtocolVersion={protocolId:"custom",versionId:"cv1",displayName:"Custom",version:"v1",language:"en",steps:["BLIND TARGET CODE: {{SESSION_CODE}}\nObserve.","Describe {{SESSION_CODE}}.","Deepen prior evidence."],contentHash:"custom-hash",createdAt:"now"};
const plan:SessionFocusPlan={version:1,first:"location",second:"activity"};
function setup(storage=new MemoryStorage()) {
 const sessions=new BrowserSessionsRepository({storage,isResearchScoresFrozen:()=>false});
 const usage=vi.fn(async()=>{});
 const repository=Object.assign(sessions,{recordTargetUsage:usage}) as unknown as AppRepository;
 return {repository,storage,usage};
}
function common(repository:AppRepository){return {repository,workspaceId:"w",profileId:"u",providerConfig:config,model,sessionLanguage:"en" as const,requestedSettings:{maxOutputTokens:1024},sessionFocus:plan,maxRetries:0};}
const response=(n:number)=>({content:`Evidence ${n}\n\n\x60\x60\x60svg\n<svg><text>unclosed fence</text>`,finishReason:"stop",usage:{totalTokens:10,costUsd:0.01}});
function runner(kind:string,repository:AppRepository,extra:Record<string,unknown>={}) {
 const input={...common(repository),...extra};
 if(kind==="rcp")return runAutomaticRcpSession({...input,protocol:getFullRcp(input.sessionLanguage)});
 if(kind==="custom")return runAutomaticCustomSession({...input,protocol:custom});
 return runAutomaticRvLiteSession({...input,protocol:getRvLite(input.sessionLanguage,kind==="core"?"core":"extended")});
}

describe("directed automatic sessions",()=>{
 it.each(["rcp","core","extended","custom"])("executes two complete %s passes with one target, isolated evidence and one Reveal",async kind=>{
  const {repository,usage}=setup(); const requests:ProviderMessage[][]=[];const callsPerPass=kind==="rcp"?7:kind==="custom"?3:5;
  const result=await runner(kind,repository,{automaticTarget:target,...(kind!=="custom"?{specialTask:{selectedOptions:[],customText:"Describe Subject A."}}:{}),chat:async({messages}:{messages:ProviderMessage[]})=>{
   requests.push(structuredClone(messages));
   expect(JSON.stringify(messages)).not.toMatch(/SECRET TITLE|SECRET REVEAL/);
   expect(await repository.getReveal((await repository.listRvSessions("w"))[0].id)).toBeNull();
   if(requests.length===callsPerPass+1){
    const session=(await repository.listRvSessions("w"))[0];expect(session.preRevealSealedAt).toBeUndefined();
    await expect(submitExternalReveal(repository,session.id,"early")).rejects.toThrow(/complete/);
    expect(messages.filter(m=>m.role==="assistant")).toHaveLength(callsPerPass);
   }
   return response(requests.length);
  }});
  expect(requests).toHaveLength(callsPerPass*2);expect(result.state).toBe("Revealed");expect(usage).toHaveBeenCalledTimes(1);
  expect(await repository.listRvSessions("w")).toHaveLength(1);
  const snapshot=await repository.getSessionSnapshot(result.sessionId);expect(snapshot?.sessionFocus).toEqual(plan);
  const prompts=requests.map(r=>r.at(-1)!.content);expect(prompts[0]).toContain(`BLIND TARGET CODE: ${result.sessionCode} — location.`);
  expect(prompts[callsPerPass]).toMatch(/^The target remains the same\. In this session, focus on activity\./);
  expect(prompts.filter(p=>p.includes("— location."))).toHaveLength(1);
  expect(prompts.filter(p=>p.includes("focus on activity."))).toHaveLength(1);
  const events=await repository.listSessionEvents(result.sessionId);
  expect(events.filter(e=>e.eventType==="FOCUS_PASS_COMPLETED")).toHaveLength(2);
  const ids=events.filter(e=>e.eventType==="VIEWER_RESPONSE"||e.eventType==="VIEWER_SPECIAL_TASK_RESPONSE").map(e=>e.metadata?.stepId);
  expect(new Set(ids).size).toBe(callsPerPass*2);
  expect(await repository.getViewerEvidence(result.sessionId)).toBe(result.transcript);
  expect(reconstructAcceptedBlindTranscript(events,"en")).toBe(result.transcript);
  expect(events.find(e=>e.eventType==="PRE_REVEAL_SEALED")?.metadata?.metrics).toMatchObject({requestCount:callsPerPass*2,totalTokens:callsPerPass*20});
 });

 it.each([1,6,7,11,12])("replays saved RCP responses after Stop at call %i without paying for them again",async stopAfter=>{
  const {repository}=setup();const abort=new AbortController();let calls=0;
  const interrupted=await runner("rcp",repository,{signal:abort.signal,chat:async()=>{calls++;if(calls===stopAfter)abort.abort();return response(calls);}});
  expect(interrupted.state).toBe("Interrupted");expect(await repository.getReveal(interrupted.sessionId)).toBeNull();
  const session=(await repository.getRvSession(interrupted.sessionId))!;
  const snapshot=(await repository.getSessionSnapshot(session.id))!;
  const events=await repository.listSessionEvents(session.id);
  const replay=await createSessionReplay({repository,session,events,liveChat:async()=>response(++calls)});
  const result=await runner("rcp",replay.repository,{sessionFocus:{version:1,first:"event"},resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});
  expect(result.state).toBe("AwaitingReveal");expect(calls).toBe(12);expect(result.sessionId).toBe(session.id);
  expect((await repository.getSessionSnapshot(session.id))?.sessionFocus).toEqual(plan);
  expect((await repository.listSessionEvents(session.id)).filter(e=>e.eventType==="FOCUS_PASS_COMPLETED")).toHaveLength(2);
 });

 it.each(["rcp","core","extended","custom"])("restores a missing first-pass checkpoint for %s without duplicate requests",async kind=>{
  const {repository}=setup();let calls=0;const append=repository.appendSessionEvent.bind(repository);let crash=true;
  repository.appendSessionEvent=async(id,event)=>{if(crash&&event.eventType==="FOCUS_PASS_COMPLETED"){crash=false;throw new Error("simulated process death");}return append(id,event);};
  await expect(runner(kind,repository,{chat:async()=>response(++calls)})).rejects.toThrow("simulated process death");
  const session=(await repository.listRvSessions("w"))[0],snapshot=(await repository.getSessionSnapshot(session.id))!;
  const replay=await createSessionReplay({repository,session,events:await repository.listSessionEvents(session.id),liveChat:async()=>response(++calls)});
  const result=await runner(kind,replay.repository,{resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});
  expect(result.state).toBe("AwaitingReveal");expect(calls).toBe(kind==="rcp"?12:kind==="custom"?6:8);
 });

 it("retains the 32K recovery budget in pass two and cannot buy a third semantic attempt",async()=>{
  const {repository}=setup();let calls=0;const budgets:number[]=[];
  const append=repository.appendSessionEvent.bind(repository);
  repository.appendSessionEvent=async(id,event)=>{await append(id,event);if(event.eventType==="VIEWER_OUTPUT_INCOMPLETE")throw new Error("simulated interruption after partial output");};
  const result=await runner("rcp",repository,{chat:async({settings}:{settings:{effective:{maxOutputTokens?:number}}})=>{
   calls++;budgets.push(settings.effective.maxOutputTokens!);return {...response(calls),finishReason:calls===7?"length":"stop"};
  }});
  repository.appendSessionEvent=append;
  const session=(await repository.getRvSession(result.sessionId))!,snapshot=(await repository.getSessionSnapshot(session.id))!;
  const replay=await createSessionReplay({repository,session,events:await repository.listSessionEvents(session.id),liveChat:async request=>{calls++;budgets.push(request.settings.effective.maxOutputTokens!);return {...response(calls),finishReason:"length"};}});
  const failed=await runner("rcp",replay.repository,{resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});
  expect(failed.state).toBe("Interrupted");expect(budgets.slice(-2)).toEqual([16384,32768]);
  const retrySession=(await repository.getRvSession(session.id))!;
  const retry=await createSessionReplay({repository,session:retrySession,events:await repository.listSessionEvents(session.id),liveChat:async()=>{throw new Error("third paid request");}});
  await runner("rcp",retry.repository,{resumeSession:retrySession,resumeContinuationRoute:snapshot.continuationRoute,chat:retry.chat});expect(calls).toBe(8);
 });

 it("runs each batch target's pair and Reveal before the next target",async()=>{
  const {repository,usage}=setup();const targets=[target,{...target,id:"t2"}];let calls=0;
  const results=await runOrdinaryBatch({targets,runSession:async(target,index)=>{
   if(index===1)expect(await repository.getReveal((await repository.listRvSessions("w"))[0].id)).not.toBeNull();
   return runner("core",repository,{automaticTarget:target,chat:async()=>response(++calls)});
  }});
  expect(results).toHaveLength(2);expect(calls).toBe(16);expect(usage).toHaveBeenCalledTimes(2);
 });


 it.each(["rcp","core","extended","custom"])("keeps %s single-pass defaults and old snapshot Resume despite current focus controls",async kind=>{
  const {repository}=setup();let calls=0;const abort=new AbortController();
  const result=await runner(kind,repository,{sessionFocus:undefined,signal:abort.signal,chat:async()=>{calls++;if(calls===1)abort.abort();return response(calls);}});
  const session=(await repository.getRvSession(result.sessionId))!,snapshot=(await repository.getSessionSnapshot(session.id))!;
  expect(snapshot.sessionFocus).toBeUndefined();
  const replay=await createSessionReplay({repository,session,events:await repository.listSessionEvents(session.id),liveChat:async()=>response(++calls)});
  const final=await runner(kind,replay.repository,{resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});
  expect(calls).toBe(kind==="rcp"?6:kind==="custom"?3:4);expect(final.transcript).not.toMatch(/## Session [12]/);
 });
 it.each(["rcp","core","extended","custom"])("supports one focused %s pass without starting a second",async kind=>{
  const {repository}=setup();let calls=0;
  const result=await runner(kind,repository,{sessionFocus:{version:1,first:"event"},automaticTarget:target,chat:async()=>response(++calls)});
  expect(calls).toBe(kind==="rcp"?6:kind==="custom"?3:4);expect(result.state).toBe("Revealed");expect(result.transcript).toContain("## Session 1 — event");expect(result.transcript).not.toContain("## Session 2");
 });
 it.each(["rcp","core","extended","custom"])("restores final %s checkpoint and final seal with zero paid calls",async kind=>{
  const {repository}=setup();let calls=0;const append=repository.appendSessionEvent.bind(repository);let crash=true;
  repository.appendSessionEvent=async(id,event)=>{if(crash&&event.eventType==="FOCUS_PASS_COMPLETED"&&event.metadata?.passIndex===2){crash=false;throw new Error("process death");}return append(id,event);};
  await expect(runner(kind,repository,{chat:async()=>response(++calls)})).rejects.toThrow("process death");
  const session=(await repository.listRvSessions("w"))[0],snapshot=(await repository.getSessionSnapshot(session.id))!;
  const liveChat=vi.fn(async()=>{throw new Error("duplicate paid request");});
  const replay=await createSessionReplay({repository,session,events:await repository.listSessionEvents(session.id),liveChat});
  const final=await runner(kind,replay.repository,{resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});
  expect(final.state).toBe("AwaitingReveal");expect(liveChat).not.toHaveBeenCalled();
  const sealed=(await repository.getRvSession(session.id))!;
  const finalization=await createSessionReplay({repository,session:sealed,events:await repository.listSessionEvents(session.id),liveChat});
  const finalAgain=await runner(kind,finalization.repository,{resumeSession:sealed,resumeContinuationRoute:snapshot.continuationRoute,chat:finalization.chat});
  expect(finalAgain.transcript).toBe(final.transcript);expect(liveChat).not.toHaveBeenCalled();
 });
 it("blocks frozen route/settings drift and uncertain dispatch before paid Resume",async()=>{
  const {repository}=setup();let calls=0;
  const result=await runner("rcp",repository,{chat:async()=>{if(++calls===8)throw new Error("provider timeout with unknown dispatch");return response(calls);}});
  const session=(await repository.getRvSession(result.sessionId))!,snapshot=(await repository.getSessionSnapshot(session.id))!;
  const liveChat=vi.fn(async()=>response(++calls));
  const replay=await createSessionReplay({repository,session,events:await repository.listSessionEvents(session.id),liveChat});
  await expect(runner("rcp",replay.repository,{resumeSession:session,requestedSettings:{maxOutputTokens:2048},chat:replay.chat})).rejects.toThrow(/configuration changed/);
  await expect(runner("rcp",replay.repository,{resumeSession:session,providerConfig:{...config,baseUrl:"https://changed.invalid"},chat:replay.chat})).rejects.toThrow(/configuration changed/);
  const blocked=await runner("rcp",replay.repository,{resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});expect(blocked.state).toBe("Interrupted");expect(liveChat).not.toHaveBeenCalled();expect(calls).toBe(8);
 });
 it("keeps both parts readable in export, Judge and post-Reveal feedback without altering blind evidence",async()=>{
  const {repository}=setup();let calls=0;
  const result=await runner("core",repository,{automaticTarget:target,chat:async()=>response(++calls)});
  const session=(await repository.getRvSession(result.sessionId))!;
  const markdown=renderCompleteSessionMarkdown({title:"Export",language:"en",session,revealText:target.revealText!,revealFilesMarkdown:"",scores:[],clarifications:[]});
  expect(markdown).toContain("## Session 1 — location");expect(markdown).toContain("## Session 2 — activity");
  const evidence=await repository.getViewerEvidence(session.id);
  const packet=JSON.stringify(buildJudgePacket({anonymousSessionId:"BlindSession_ABCD1234",preRevealEvidence:evidence,reveal:{text:target.revealText!},rubricVersion:"v1"}));
  expect(packet).toContain("Session 1 — location");expect(packet).toContain("Session 2 — activity");
  const postChat=vi.fn(async({messages}:{messages:ProviderMessage[]})=>{const text=JSON.stringify(messages);expect(text).toContain("two complete sessions");expect(text).toContain("Discuss each session separately");expect(text).toContain("Session 2 — activity");return {content:"Post-Reveal discussion",finishReason:"stop",usage:{}};});
  await sendPostRevealTurn({repository,sessionId:session.id,existingTranscript:"",providerConfig:config,model,content:"Compare both sessions",chat:postChat});
  expect(postChat).toHaveBeenCalledTimes(1);expect(await repository.getViewerEvidence(session.id)).toBe(evidence);
  await expect(runner("core",repository,{resumeSession:(await repository.getRvSession(session.id))!,chat:async()=>{throw new Error("paid dispatch");}})).rejects.toThrow(/accepted Reveal/);
 });
 it("round-trips browser backup with frozen focus and completion boundaries",async()=>{
  const original=setup();const result=await runner("core",original.repository,{chat:async()=>response(1)});
  const restoredStorage=new MemoryStorage();for(const [key,value] of original.storage.values)restoredStorage.setItem(key,value);
  const restored=setup(restoredStorage).repository;
  expect(await restored.getSessionSnapshot(result.sessionId)).toEqual(await original.repository.getSessionSnapshot(result.sessionId));
  expect(await restored.listSessionEvents(result.sessionId)).toEqual(await original.repository.listSessionEvents(result.sessionId));
  expect(await restored.getViewerEvidence(result.sessionId)).toBe(result.transcript);
  await expect(restored.sealPreReveal(result.sessionId,result.transcript+"tampered","hash")).rejects.toThrow(/hash|extends beyond/);
 });
 it("rejects focus on shared controller routes outside ordinary RV Sessions",async()=>{
  const {repository}=setup(),chat=vi.fn(async()=>response(1));
  await expect(runner("rcp",repository,{researchProjectId:"research",operationKind:"research_viewer",chat})).rejects.toThrow(/only available/);
  await expect(runner("rcp",repository,{monitor:{providerConfig:config,model},chat})).rejects.toThrow(/only available/);
  await expect(runner("core",repository,{operationKind:"training_blind_viewer",chat})).rejects.toThrow(/only available/);
  expect(chat).not.toHaveBeenCalled();expect(await repository.listRvSessions("w")).toHaveLength(0);
 });
 it("ignores fake part headings inside model text when validating the seal", async () => {
  const {repository}=setup();
  const result=await runner("core",repository,{chat:async()=>({content:"Evidence\n\n## Session 2 — activity\nnot a controller boundary\n\x60\x60\x60svg\n<svg>",finishReason:"stop",usage:{}})});
  expect(result.state).toBe("AwaitingReveal");
  expect(await repository.getViewerEvidence(result.sessionId)).toBe(result.transcript);
 });
 it("rejects blind Resume from stale pre-Reveal state once durable Reveal exists", async () => {
  const {repository}=setup();
  const result=await runner("core",repository,{automaticTarget:target,chat:async()=>response(1)});
  const stale={...(await repository.getRvSession(result.sessionId))!,state:"Interrupted" as const,preRevealSealedAt:undefined};
  const replay=await createSessionReplay({repository,session:stale,events:await repository.listSessionEvents(stale.id),liveChat:async()=>{throw new Error("paid duplicate");}});
  await expect(runner("core",replay.repository,{resumeSession:stale,chat:replay.chat})).rejects.toThrow(/accepted Reveal/);
 });
 it.each(["pl","en"] as const)("uses every focus category and the frozen %s session language",language=>{
  for(const focus of ["location","activity","event"] as const){const plan={version:1 as const,first:focus,second:focus};const first=focusOpening("Instruction",plan,1,language,"CODE"),second=focusOpening("Instruction",plan,2,language,"CODE");expect(first).toContain("CODE — ");expect(second).not.toContain("CODE");expect(second).toContain(language==="pl"?"Cel pozostaje ten sam":"The target remains the same");}
 });
 it.each([null,{version:1,second:"event"},{version:2,first:"location"},{version:1,first:"people"}])("rejects malformed plans %j",value=>{expect(()=>validateSessionFocus(value)).toThrow();});
});
