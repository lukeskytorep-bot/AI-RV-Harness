import { legacyLeadState as createTelepathicSeriesState } from "./__fixtures__/legacyLeadState";
import {it,expect,vi} from "vitest";
import type {ProviderConfig,ProviderModel} from "../providers/types";
import type {ProviderChatAttempt} from "../providers/requestExecutor";
import type {TelepathicParticipant,TelepathicSeriesConfig} from "./types";
import type {ResolvedTelepathicAiRoute} from "./providerGateway";
import {runNextTelepathicAiRound,advanceTelepathicConversationSeries} from "./engine";
import {InMemoryTelepathicExchangeStore} from "./store";
import {parseLeadDecisionResponse} from "./leadDecisionResponse";
import {telepathicExportDocument} from "./export";
function ai(id: string): TelepathicParticipant {
  return {
    id,
    kind: "ai",
    displayName: id.toUpperCase(),
    ai: {
      profileId: `profile-${id}`,
      profileName: id.toUpperCase(),
      workspaceId: `workspace-${id}`,
      aiIdentityId: `identity-${id}`,
      providerConfigId: `provider-${id}`,
      credentialId: `credential-${id}`,
      credentialFingerprint: `fingerprint-${id}`,
      modelId: `model-${id}`,
      route: `custom_openai:model-${id}`,
    },
  };
}

function model(id: string): ProviderModel {
  return {
    providerConfigId: `provider-${id}`,
    provider: "custom_openai",
    modelId: `model-${id}`,
    displayName: `${id} model`,
    route: `custom_openai:model-${id}`,
    capabilities: {
      contextTokens: 64_000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsVision: false,
      supportsStreaming: false,
      reasoning: { supported: false, efforts: [], confidence: "unknown" },
      temperature: { supported: true, min: 0, max: 2, confidence: "provider_metadata" },
      supportedParameters: ["temperature"],
      source: "provider",
      capturedAt: "2026-10-06T20:00:00.000Z",
    },
    pricing: {},
    recommended: true,
    rawMetadata: {},
    refreshedAt: "2026-10-06T20:00:00.000Z",
  };
}

function configFor(id: string): ProviderConfig {
  return {
    id: `provider-${id}`,
    provider: "custom_openai",
    label: id,
    credentialId: `credential-${id}`,
    credentialFingerprint: `fingerprint-${id}`,
    baseUrl: "https://example.test/v1",
    enabled: true,
    createdAt: "2026-10-06T20:00:00.000Z",
    updatedAt: "2026-10-06T20:00:00.000Z",
  };
}

const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"fixed_lead_guidance_v1",maxGuidanceCycles:3,
  seriesId:"fixed",seriesWorkspaceId:"workspace-lead",mode:"ai_ai_training",language:"en",participants:[ai("a"),ai("lead"),ai("b")],roundCount:1,topic:"location",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"lead"}};
function resolveRoute(p:TelepathicParticipant):Promise<ResolvedTelepathicAiRoute> { return Promise.resolve({snapshot:p.ai!,providerConfig:configFor(p.id),model:{...model(p.id),capabilities:{...model(p.id).capabilities,maxOutputTokens:32768,supportedParameters:["temperature","max_tokens"]}},requestedSettings:{temperature:0.5},validatedIdentity:{profileId:p.ai!.profileId,workspaceId:p.ai!.workspaceId,aiIdentityId:p.ai!.aiIdentityId,credentialFingerprint:p.ai!.credentialFingerprint}}); }
function answer(request:Parameters<ProviderChatAttempt>[0],cycles:number) {
  const content=request.messages.map(m=>m.content).join("\n");
  if(content.includes("CONTRACT:")) {
    const cycle=Number(content.match(/"cycle":(\d)/)?.[1]);
    return JSON.stringify({cycle,finishRound:cycle>cycles,finishParticipantIds:[],...(cycle<=cycles?{broadcast:{recipientIds:["a","b"],instruction:"Describe only new movement"}}:{})});
  }
  if(content.includes("please prepare one specific target")) return "FROZEN_TARGET_FOR_TEST";
  if(content.includes("confirm the transmission")) return "READY";
  if(content.includes("YES or NO")) return "NO";
  return "A complete description or reflection.";
}


const round=()=>{const r=createTelepathicSeriesState(config).rounds[0];r.target={content:"SECRET_TOWER"} as typeof r.target;return r;};
const decision=(cycle=1)=>({cycle,finishRound:false,finishParticipantIds:[],broadcast:{recipientIds:["a","b"],instruction:"Describe new movement"},individual:[]});
const wrappers:Record<string,(s:string)=>string>={plain:s=>s,whitespace:s=>` \n\uFEFF ${s} \t`,json:s=>`\`\`\`json\n${s}\n\`\`\``,bare:s=>`\`\`\`\n${s}\n\`\`\``,upper:s=>`\uFEFF  \`\`\`JSON  \r\n${s}\r\n  \`\`\` \n`};
for(const [name,wrap] of Object.entries(wrappers))for(const cycle of [1,2] as const)it(`parser ${name}/cycle${cycle} preserves object and raw evidence`,()=>{
 const raw=wrap(JSON.stringify(decision(cycle)));const before=raw;expect(parseLeadDecisionResponse(raw,round(),cycle)).toEqual(decision(cycle));expect(raw).toBe(before);
});
const invalid:Record<string,[string,string]>={
 syntax:['{"cycle":1,}',"invalid_json"],prose:['Here is the decision: '+JSON.stringify(decision()),"invalid_json"],trailing:[JSON.stringify(decision())+' thanks',"invalid_json"],
 multiple:[JSON.stringify(decision())+'\n'+JSON.stringify(decision()),"invalid_json"],blocks:['```json\n'+JSON.stringify(decision())+'\n```\n```json\n{}\n```',"invalid_json"],
 wrongLabel:['```javascript\n'+JSON.stringify(decision())+'\n```',"invalid_json"],nested:['```json\n```json\n'+JSON.stringify(decision())+'\n```\n```',"invalid_json"],
 object:['[]',"invalid_object"],cycle:[JSON.stringify(decision(2)),"invalid_cycle"],header:[JSON.stringify({...decision(),finishRound:"false"}),"invalid_header"],
 unknown:[JSON.stringify({...decision(),broadcast:{recipientIds:["stranger"],instruction:"Describe movement"}}),"invalid_receivers"],
 duplicates:[JSON.stringify({...decision(),individual:[{participantId:"a",instruction:"Describe form"}]}),"invalid_receivers"],
 finished:[JSON.stringify({...decision(),finishParticipantIds:["a"]}),"invalid_receivers"],
 leak:[JSON.stringify({...decision(),broadcast:{recipientIds:["a"],instruction:"Describe SECRET_TOWER"}}),"target_leak"],
 finish:[JSON.stringify({...decision(),finishRound:true}),"finished_round"],
 alias:[JSON.stringify({cycle:1,finishRound:false,finishedParticipantIds:[],broadcast:decision().broadcast}),"invalid_header"],
};
for(const [name,[raw,reason]] of Object.entries(invalid))it(`parser rejects ${name} with durable ${reason}`,()=>expect(()=>parseLeadDecisionResponse(raw,round(),1)).toThrow(`[${reason}]`));
it("parser still excludes inactive receivers and target geography",()=>{
 const r=round();r.guidance={decisions:[],finishedParticipantIds:["a"],closed:false};expect(()=>parseLeadDecisionResponse(JSON.stringify(decision()),r,1)).toThrow("invalid_receivers");
 const area=r.assignment.targetGeography!.labelEn;expect(()=>parseLeadDecisionResponse(JSON.stringify({...decision(),broadcast:{recipientIds:["b"],instruction:`Describe ${area}`}}),r,1)).toThrow("target_leak");
});
for(const mode of ["ai_ai_training","conversation_exchange"] as const)for(const format of ["plain","json","upper"] as const)it(`${mode}/${format}: both cycles accepted identically, request fingerprints and raw replies retained`,async()=>{
 const seed=createTelepathicSeriesState({...config,mode});
 const run=async(wrap:(s:string)=>string)=>{const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(structuredClone(seed));
 const originals:string[]=[];const attempt:ProviderChatAttempt=async req=>{let text=answer(req,2);if(req.messages.some(m=>m.content.includes("CONTRACT:"))){text=wrap(text);originals.push(text);}return{content:text,finishReason:"stop",usage:{totalTokens:13,costUsd:0.01}};};
 const execute=mode==="ai_ai_training"?runNextTelepathicAiRound:advanceTelepathicConversationSeries;const state=await execute({store,resolveRoute,providerAttempt:attempt},"fixed");return{state,originals};};
 const baseline=await run(wrappers.plain),actual=await run(wrappers[format]);
 expect(actual.state.finalization).toBe("completed");expect(actual.state.rounds[0].guidance).toEqual(baseline.state.rounds[0].guidance);
 const calls=actual.state.providerCalls.filter(c=>c.callStage.startsWith("lead_guidance:"));expect(calls.map(c=>c.responseText)).toEqual(actual.originals);expect(calls.every(c=>c.status==="succeeded")).toBe(true);
 expect(calls.map(c=>[c.requestMessages,c.requestSha256,c.requestSettings,c.outputBudgetSnapshot])).toEqual(baseline.state.providerCalls.filter(c=>c.callStage.startsWith("lead_guidance:")).map(c=>[c.requestMessages,c.requestSha256,c.requestSettings,c.outputBudgetSnapshot]));
 for(const id of ["a","b"])expect(actual.state.rounds[0].blindByParticipant[id].guidanceResponses).toHaveLength(2);
});
for(const mode of ["ai_ai_training","conversation_exchange"] as const)it(`${mode}: rejection persists reason/raw/usage, sends no rejected question and does not rewrite failed on load`,async()=>{
 const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState({...config,mode}));const raw=wrappers.json(JSON.stringify({...decision(2),broadcast:{recipientIds:["unknown"],instruction:"DO_NOT_DISPATCH"}}));
 const attempt:ProviderChatAttempt=async req=>{const content=req.messages.map(m=>m.content).join("\n");return{content:content.includes('CONTRACT: {"cycle":2')?raw:answer(req,2),finishReason:"stop",usage:{totalTokens:19,costUsd:0.03}};};
 const execute=mode==="ai_ai_training"?runNextTelepathicAiRound:advanceTelepathicConversationSeries;await expect(execute({store,resolveRoute,providerAttempt:attempt},"fixed")).rejects.toThrow("invalid_receivers");
 const state=(await store.getTelepathicSeries("fixed"))!;const failed=state.providerCalls.find(c=>c.callStage==="lead_guidance:cycle:2")!;expect(failed).toMatchObject({status:"failed",responseText:raw,usage:{totalTokens:19,costUsd:0.03}});expect(failed.errorMessage).toContain("invalid_receivers");
 expect(state.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:cycle:2"))).toHaveLength(0);expect(state.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(1);
 expect(state.transcript!.find(e=>e.providerCallId===failed.id && e.kind==="notice")?.decisionRejectionReason).toBe(failed.errorMessage);expect(telepathicExportDocument(state)).toContain(raw);
 const reloaded=new InMemoryTelepathicExchangeStore();await reloaded.saveTelepathicSeries(state);expect((await reloaded.getTelepathicSeries("fixed"))!.providerCalls.find(c=>c.id===failed.id)).toEqual(failed);
});
for(const mode of ["ai_ai_training","conversation_exchange"] as const)it(`${mode}: saved succeeded fenced decision is revalidated and reused after restart without repeating accepted questions`,async()=>{
 const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState({...config,mode}));const stop=new AbortController();
 const execute=mode==="ai_ai_training"?runNextTelepathicAiRound:advanceTelepathicConversationSeries;
 const attempt:ProviderChatAttempt=async req=>{const text=answer(req,2);if(req.messages.some(m=>m.content.includes('CONTRACT: {"cycle":2')))stop.abort();return{content:req.messages.some(m=>m.content.includes("CONTRACT:"))?wrappers.json(text):text,finishReason:"stop",usage:{}};};
 await expect(execute({store,resolveRoute,providerAttempt:attempt,signal:stop.signal},"fixed")).rejects.toThrow();const checkpoint=(await store.getTelepathicSeries("fixed"))!;const saved=checkpoint.providerCalls.find(c=>c.callStage==="lead_guidance:cycle:2")!;expect(saved.status).toBe("succeeded");expect(checkpoint.rounds[0].guidance!.decisions.map(d=>d.cycle)).toEqual([1]);
 const original=JSON.stringify(saved),previous=checkpoint.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:cycle:1"));const restart=new InMemoryTelepathicExchangeStore();await restart.saveTelepathicSeries(checkpoint);
 const paid=vi.fn<ProviderChatAttempt>(async req=>({content:answer(req,2),finishReason:"stop",usage:{}}));const result=await execute({store:restart,resolveRoute,providerAttempt:paid},"fixed");expect(result.finalization).toBe("completed");expect(JSON.stringify(result.providerCalls.find(c=>c.id===saved.id))).toBe(original);
 for(const c of previous)expect(result.providerCalls.filter(x=>x.scopeKey===c.scopeKey)).toEqual([c]);expect(result.providerCalls.filter(c=>c.callStage==="lead_guidance:cycle:2")).toHaveLength(1);
 expect(paid.mock.calls.some(([req])=>req.messages.some(m=>m.content.includes('CONTRACT: {"cycle":2')))).toBe(false);
});
for(const mode of ["ai_ai_training","conversation_exchange"] as const)for(const historical of ["invalid_succeeded","failed"] as const)it(`${mode}: historical ${historical} is not accepted or automatically repaired`,async()=>{
 const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState({...config,mode}));const stop=new AbortController();
 const execute=mode==="ai_ai_training"?runNextTelepathicAiRound:advanceTelepathicConversationSeries;
 await expect(execute({store,resolveRoute,signal:stop.signal,providerAttempt:async req=>{const text=answer(req,2);if(req.messages.some(m=>m.content.includes('CONTRACT: {"cycle":2')))stop.abort();return{content:req.messages.some(m=>m.content.includes("CONTRACT:"))?wrappers.json(text):text,finishReason:"stop",usage:{totalTokens:7}};}},"fixed")).rejects.toThrow();
 const state=(await store.getTelepathicSeries("fixed"))!;const saved=state.providerCalls.find(c=>c.callStage==="lead_guidance:cycle:2")!;
 if(historical==="invalid_succeeded")saved.responseText=wrappers.json(JSON.stringify(decision(1)));
 else {saved.status="failed";saved.technicalAttempt=2;saved.errorMessage="Historical parser rejection";}
 const original=structuredClone(saved);const restart=new InMemoryTelepathicExchangeStore();await restart.saveTelepathicSeries(state);const paid=vi.fn<ProviderChatAttempt>();
 await expect(execute({store:restart,resolveRoute,providerAttempt:paid},"fixed")).rejects.toThrow(historical==="invalid_succeeded"?"invalid_cycle":"attempts exhausted");
 const after=(await restart.getTelepathicSeries("fixed"))!;const call=after.providerCalls.find(c=>c.id===saved.id)!;expect(paid).not.toHaveBeenCalled();expect(call.status).toBe("failed");expect(call.responseText).toBe(original.responseText);expect(call.usage).toEqual(original.usage);expect(call.requestSha256).toBe(original.requestSha256);expect(call.requestMessages).toEqual(original.requestMessages);
 if(historical==="failed")expect(call).toEqual(original);else expect(call.errorMessage).toContain("invalid_cycle");
 expect(after.providerCalls.some(c=>c.callStage.startsWith("receiver_guidance:cycle:2"))).toBe(false);
});
