import { describe,it,expect } from "vitest";
import type { ProviderConfig,ProviderModel } from "../providers/types";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { TelepathicParticipant,TelepathicSeriesConfig } from "./types";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { createTelepathicSeriesState,runNextTelepathicAiRound,advanceTelepathicConversationSeries,saveHumanTelepathicTarget,confirmHumanTelepathicTransmission,saveHumanLeadGuidance,saveHumanTelepathicSharing,saveHumanTelepathicFirstBlind,saveHumanTelepathicReflection,telepathicConversationHumanStep,saveHumanGuidanceResponse,allowRetryForUncertainTelepathicCall } from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
import { buildTelepathicConversationView } from "./conversationView";
import { telepathicRuntimeMetrics } from "./runtimeMetrics";
import { buildHumanLeadDecision } from "./leadGuidance";
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
    return JSON.stringify({cycle,finishRound:cycle>cycles,finishParticipantIds:[],individual:cycle<=cycles?["a","b"].map(participantId=>({participantId,instruction:"Describe only new movement"})):[]});
  }
  if(content.includes("please prepare one specific target")) return "FROZEN_TARGET_FOR_TEST";
  if(content.includes("confirm the transmission")) return "READY";
  if(content.includes("YES or NO")) return "NO";
  return "A complete description or reflection.";
}

describe("UX-TEL-3 human individual fields with the executable engine",()=>{
 async function ready(ids:string[]= ["a","b","c"],language:"pl"|"en"="en") {
  const store=new InMemoryTelepathicExchangeStore();
  const cfg:TelepathicSeriesConfig={...config,seriesId:"human-fields",language,mode:"conversation_exchange",participants:[{id:"human",kind:"human",displayName:"Edward"},...ids.map(ai)],senderPolicy:{kind:"human_only",humanParticipantId:"human"}};
  const requests:Array<Parameters<ProviderChatAttempt>[0]>=[];
  const deps={store,resolveRoute,providerAttempt:(async request=>{requests.push(request);return {content:answer(request,0),finishReason:"stop",usage:{}};}) as ProviderChatAttempt};
  await store.saveTelepathicSeries(createTelepathicSeriesState(cfg));
  await advanceTelepathicConversationSeries(deps,cfg.seriesId);
  expect(requests).toHaveLength(0);
  await saveHumanTelepathicTarget(deps,cfg.seriesId,{content:"human own frozen subject"});await confirmHumanTelepathicTransmission(deps,cfg.seriesId);
  const state=await advanceTelepathicConversationSeries(deps,cfg.seriesId);
  return {deps,store,state,requests,id:cfg.seriesId};
 }
 for(const ids of [["a","b"],["a","b","c"]])for(const selection of ["one","all","empty","space"] as const)it(`${ids.length} receivers / ${selection}: persists explicit IDs, dispatches only non-empty questions`,async()=>{
  const f=await ready(ids);const fields=Object.fromEntries(ids.map(id=>[id,selection==="all" || selection==="one"&&id==="a"?`  Describe new movement for ${id}  `:selection==="space"?" \n\t ":""]));
  const decision=buildHumanLeadDecision(1,ids,{...fields,stale:"Must never dispatch"});
  const snapshot=JSON.stringify(f.state.rounds[0].target);
  const saved=await saveHumanLeadGuidance(f.deps,f.id,decision);
  expect(saved.rounds[0].guidance!.decisions[0]).toEqual(decision);expect(decision).not.toHaveProperty("broadcast");
  expect(telepathicConversationHumanStep(saved).kind).toBe("none");
  expect(f.requests).toHaveLength(ids.length);
  const state=await advanceTelepathicConversationSeries(f.deps,f.id);
  const called=state.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:"));
  const expected=ids.filter(id=>fields[id].trim());expect(called.map(c=>c.participantId)).toEqual(expected);
  expect(called).toHaveLength(expected.length);expect(state.rounds[0].guidance!.finishedParticipantIds).toEqual(ids.filter(id=>!fields[id].trim()));
  expect(JSON.stringify(state.rounds[0].target)).toBe(snapshot);
  expect(state.config.participants.map(p=>p.id)).toEqual(["human",...ids]);
  if(!expected.length){expect(state.rounds[0].guidance!.closed).toBe(true);expect(state.rounds[0].blindByParticipant.a.status).toBe("sealed");}
 });
 it("restarts between save and dispatch, resumes cycles 1–3 once, never reopens sealed blind",async()=>{
  const f=await ready(["a","b"]);
  for(const cycle of [1,2,3] as const){
   const state=(await f.store.getTelepathicSeries(f.id))!;expect(telepathicConversationHumanStep(state)).toMatchObject({kind:"lead_guidance",cycle});
   await saveHumanLeadGuidance(f.deps,f.id,buildHumanLeadDecision(cycle,["a","b"],{a:`Describe new movement ${cycle}`,b:`Describe new shape ${cycle}`}));
   const restart=new InMemoryTelepathicExchangeStore();await restart.saveTelepathicSeries((await f.store.getTelepathicSeries(f.id))!);f.store=restart;f.deps={...f.deps,store:restart};
   const completed=await advanceTelepathicConversationSeries(f.deps,f.id);
   expect(completed.providerCalls.filter(c=>c.callStage.startsWith(`receiver_guidance:cycle:${cycle}:`))).toHaveLength(2);
  }
  const final=(await f.store.getTelepathicSeries(f.id))!;
  expect(final.rounds[0].guidance!.closed).toBe(true);expect(final.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(3);
  const before=JSON.stringify(final);
  await expect(saveHumanLeadGuidance(f.deps,f.id,{cycle:3,finishRound:true,finishParticipantIds:[],individual:[]})).rejects.toThrow();
  expect(JSON.stringify(await f.store.getTelepathicSeries(f.id))).toBe(before);
 });
 it("explicit seal ignores drafts and generates no receiver guidance calls",async()=>{
  const f=await ready();await saveHumanLeadGuidance(f.deps,f.id,{cycle:1,finishRound:true,finishParticipantIds:[],individual:[]});const state=await advanceTelepathicConversationSeries(f.deps,f.id);
  expect(state.providerCalls.filter(c=>c.callStage.startsWith("receiver_guidance:"))).toHaveLength(0);expect(state.rounds[0].guidance!.closed).toBe(true);
 });
 for(const blocked of ["archive","uncertain","dispatched","cancelled"] as const)it(`${blocked} cannot mutate a human guidance decision`,async()=>{
  const f=await ready();const state=(await f.store.getTelepathicSeries(f.id))!;
  if(blocked==="archive")state.archivedAt="t";
  else if(blocked==="cancelled")state.status="cancelled";
  else state.providerCalls.push({...state.providerCalls[0],id:"unknown-call",status:blocked});
  await f.store.saveTelepathicSeries(state);const before=JSON.stringify(state);
  await expect(saveHumanLeadGuidance(f.deps,f.id,buildHumanLeadDecision(1,["a","b","c"],{}))).rejects.toThrow();
  expect(JSON.stringify(await f.store.getTelepathicSeries(f.id))).toBe(before);
 });
 for(const language of ["pl","en"] as const)it(`${language}: own target instruction omits assigned geography, keeps historical instruction byte-identical`,async()=>{
  const f=await ready(["a","b"],language);const state=(await f.store.getTelepathicSeries(f.id))!;
  const instruction=state.transcript!.find(e=>e.id.endsWith("human-target-instruction"))!;
  expect(instruction.text).not.toMatch(/Obszar:|Area:/);expect(instruction.text).toContain(language==="pl"?"własny cel":"of your own");
  const pending=createTelepathicSeriesState({...state.config,seriesId:"historical"});pending.transcript=[{...instruction,seriesId:"historical",roundId:pending.rounds[0].assignment.roundId,id:`${pending.rounds[0].assignment.roundId}:human-target-instruction`,text:"HISTORICAL INSTRUCTION Area: ORIGINAL"}];
  await f.store.saveTelepathicSeries(pending);const historical=JSON.stringify(pending.transcript[0]);
  const refreshed=await advanceTelepathicConversationSeries(f.deps,"historical");expect(JSON.stringify(refreshed.transcript![0])).toBe(historical);
 });
});
describe("fixed lead executable engine",()=>{
  for(const cycles of [0,1,2,3]) it(`runs ${cycles} optional cycles, seals every response and finalizes automatically`,async()=>{
    const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));
    const requests:Array<Parameters<ProviderChatAttempt>[0]>=[];
    const attempt:ProviderChatAttempt=async r=>{requests.push(r);return {content:answer(r,cycles),finishReason:"stop",usage:{totalTokens:30,costUsd:0.01}};};
    const state=await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed");
    expect(state.status).toBe("completed");expect(state.finalization).toBe("completed");expect(Object.keys(state.finalReflections)).toHaveLength(3);
    for(const id of ["a","b"]) {expect(state.rounds[0].blindByParticipant[id].guidanceResponses??[]).toHaveLength(cycles);expect(state.rounds[0].blindByParticipant[id].status).toBe("sealed");}
    expect(state.providerCalls.some(c=>c.callStage==="receiver_second")).toBe(false);
    expect(state.rounds[0].guidance!.decisions.length).toBeLessThanOrEqual(3);
    const receiverCalls=state.providerCalls.filter(c=>/^receiver_(first|guidance)/.test(c.callStage));
    for(const c of receiverCalls) {expect(JSON.stringify(c.requestMessages)).not.toContain("FROZEN_TARGET_FOR_TEST");expect(JSON.stringify(c.requestMessages)).not.toContain(state.rounds[0].assignment.targetGeography!.labelEn);}
    const leadReview=state.providerCalls.find(c=>c.callStage==="sender_reveal")!;
    expect(JSON.stringify(leadReview.requestMessages)).toContain("RECEIVER ANSWERS AND REFLECTIONS");
    const before=requests.length;await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed");expect(requests).toHaveLength(before);
    expect(telepathicRuntimeMetrics(state).calls).toBe(state.providerCalls.length);
  });
  it("rejects invalid lead JSON without inventing or sending questions",async()=>{
    const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));
    const attempt:ProviderChatAttempt=async r=>({content:r.messages.some(m=>m.content.includes("CONTRACT:"))?"not json":answer(r,0),finishReason:"stop",usage:{}});
    await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed")).rejects.toThrow(/Invalid lead decision/);
    const state=(await store.getTelepathicSeries("fixed"))!;expect(state.rounds[0].revealedAt).toBeUndefined();expect(state.providerCalls.some(c=>c.callStage.startsWith("receiver_guidance"))).toBe(false);
  });
  it("keeps historical v3 length diagnostics and uses 16K then 32K without a third attempt",async()=>{
    const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState({...config,outputBudgetPolicyVersion:3}));
    const budgets:number[]=[];
    const attempt:ProviderChatAttempt=async r=>{const first=r.messages.some(m=>m.content.includes("Please give your first description"));if(first)budgets.push(r.settings.effective.maxOutputTokens!);return {content:first?"truncated":answer(r,0),finishReason:first?"length":"stop",usage:{totalTokens:12,costUsd:0.02}};};
    await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed")).rejects.toThrow(/Incomplete/);
    const state=(await store.getTelepathicSeries("fixed"))!;
    expect(budgets).toEqual([16384,32768]);expect(state.rounds[0].blindByParticipant.a.first).toBeUndefined();expect(state.rounds[0].revealedAt).toBeUndefined();
    expect(state.providerCalls.filter(c=>c.callStage==="receiver_first")).toHaveLength(2);
    expect(telepathicRuntimeMetrics(state).tokens).toBeGreaterThanOrEqual(24);
  });
  it("persists uncertain Stop and prevents the next receiver dispatch",async()=>{
    const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));const controller=new AbortController();
    const attempt:ProviderChatAttempt=async r=>{if(r.messages.some(m=>m.content.includes("Please give your first description"))){controller.abort();throw new DOMException("Cancelled","AbortError");}return {content:answer(r,0),finishReason:"stop",usage:{}};};
    await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt,signal:controller.signal},"fixed")).rejects.toThrow();
    const state=(await store.getTelepathicSeries("fixed"))!;
    expect(state.status).toBe("paused");expect(state.providerCalls.some(c=>c.status==="uncertain")).toBe(true);expect(state.providerCalls.some(c=>c.participantId==="b")).toBe(false);expect(state.finalReflections).toEqual({});
  });
  it("hides geography and lead data from a human receiver and pauses for human actions",async()=>{
    const store=new InMemoryTelepathicExchangeStore();const human={id:"human",kind:"human" as const,displayName:"Human"};
    const cfg={...config,mode:"conversation_exchange" as const,participants:[human,ai("lead")],seriesId:"human-fixed"};
    await store.saveTelepathicSeries(createTelepathicSeriesState(cfg));
    const attempt:ProviderChatAttempt=async r=>{const content=r.messages.map(m=>m.content).join("\n");return {content:content.includes("CONTRACT:")?JSON.stringify({cycle:1,finishRound:true,finishParticipantIds:[],individual:[]}):answer(r,0),finishReason:"stop",usage:{}};};
    const deps={store,resolveRoute,providerAttempt:attempt};
    let state=await advanceTelepathicConversationSeries(deps,"human-fixed");
    const view=buildTelepathicConversationView(state);expect(JSON.stringify(view)).not.toContain("FROZEN_TARGET_FOR_TEST");expect(view.config.topic).toBeUndefined();expect(view.plan.rounds[0].targetGeography).toBeUndefined();expect(view.rounds[0].assignment.targetGeography).toBeUndefined();
    await saveHumanTelepathicFirstBlind(deps,"human-fixed","human data");state=await advanceTelepathicConversationSeries(deps,"human-fixed");expect(telepathicConversationHumanStep(state).kind).toBe("reflection");
    await saveHumanTelepathicReflection(deps,"human-fixed","human reflection");state=await advanceTelepathicConversationSeries(deps,"human-fixed");expect(telepathicConversationHumanStep(state).kind).toBe("sharing_consent");await saveHumanTelepathicSharing(deps,"human-fixed","no");state=await advanceTelepathicConversationSeries(deps,"human-fixed");expect(state.finalization).toBe("completed");expect(state.finalReflections.human).toBeUndefined();
  });
});

describe("fixed lead restart and isolation",()=>{
 it("resumes after A's saved guidance result without repeating A or changing geography",async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));const controller=new AbortController();let aGuidance=0,bGuidance=0;
  const first:ProviderChatAttempt=async request=>{const content=request.messages.map(m=>m.content).join("\n");if(content.includes("LEAD_INSTRUCTION:")){if(request.modelId==="model-a"){aGuidance++;controller.abort();}else bGuidance++;}return {content:answer(request,1),finishReason:"stop",usage:{totalTokens:10}};};
  await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:first,signal:controller.signal},"fixed")).rejects.toThrow();
  const checkpoint=(await store.getTelepathicSeries("fixed"))!;const area=checkpoint.rounds[0].assignment.targetGeography;expect(checkpoint.providerCalls.some(c=>c.participantId==="a"&&c.callStage.startsWith("receiver_guidance")&&c.status==="succeeded")).toBe(true);expect(bGuidance).toBe(0);
  const second:ProviderChatAttempt=async request=>{if(request.messages.some(m=>m.content.includes("LEAD_INSTRUCTION:"))){if(request.modelId==="model-a")aGuidance++;else bGuidance++;}return {content:answer(request,1),finishReason:"stop",usage:{totalTokens:10}};};
  const result=await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:second},"fixed");expect(aGuidance).toBe(1);expect(bGuidance).toBe(1);expect(result.rounds[0].assignment.targetGeography).toEqual(area);expect(result.finalization).toBe("completed");
 });
 it("resumes only finalization after Stop without reopening a completed round",async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));const controller=new AbortController();
  const first:ProviderChatAttempt=async request=>{if(request.messages.some(m=>m.content.includes('"rounds": ['))){controller.abort();}return {content:answer(request,0),finishReason:"stop",usage:{}};};
  await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:first,signal:controller.signal},"fixed")).rejects.toThrow();
  const checkpoint=(await store.getTelepathicSeries("fixed"))!;expect(checkpoint.currentRoundIndex).toBe(1);expect(checkpoint.rounds[0].status).toBe("completed");const roundCalls=checkpoint.providerCalls.filter(c=>c.roundId!=="series-complete").length;
  const result=await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:async request=>({content:answer(request,0),finishReason:"stop",usage:{}})},"fixed");expect(result.finalization).toBe("completed");expect(result.providerCalls.filter(c=>c.roundId!=="series-complete")).toHaveLength(roundCalls);
 });
});

describe("selective guidance and human lead",()=>{
 it("finishes A early and continues only B",async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));
  const attempt:ProviderChatAttempt=async request=>{const content=request.messages.map(m=>m.content).join("\n");let text=answer(request,0);
   if(content.includes("CONTRACT:")){const cycle=Number(content.match(/"cycle":(\d)/)?.[1]);text=JSON.stringify(cycle===1?{cycle,finishRound:false,finishParticipantIds:[],individual:["a","b"].map(participantId=>({participantId,instruction:"Describe movement"}))}:cycle===2?{cycle,finishRound:false,finishParticipantIds:["a"],individual:[{participantId:"b",instruction:"Describe the next change"}]}:{cycle,finishRound:true,finishParticipantIds:["b"],individual:[]});}
   return {content:text,finishReason:"stop",usage:{}};
  };
  const state=await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed");expect(state.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(1);expect(state.rounds[0].blindByParticipant.b.guidanceResponses).toHaveLength(2);
  expect(state.transcript!.filter(e=>e.kind==="instruction"&&e.cycle===1).map(e=>e.recipientIds)).toEqual([["a"],["b"]]);
 });
 it("supports a fixed human lead and human JSON-free actions without generating human reflections",async()=>{
  const store=new InMemoryTelepathicExchangeStore();const cfg:TelepathicSeriesConfig={...config,mode:"conversation_exchange",participants:[{id:"human",kind:"human",displayName:"Human"},ai("a")],senderPolicy:{kind:"human_only",humanParticipantId:"human"}};
  await store.saveTelepathicSeries(createTelepathicSeriesState(cfg));const deps={store,resolveRoute,providerAttempt:(async request=>({content:answer(request,0),finishReason:"stop",usage:{}})) as ProviderChatAttempt};
  let state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state).kind).toBe("prepare_target");
  await saveHumanTelepathicTarget(deps,"fixed",{content:"human frozen target"});await confirmHumanTelepathicTransmission(deps,"fixed");state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state).kind).toBe("lead_guidance");
  await saveHumanLeadGuidance(deps,"fixed",{cycle:1,finishRound:false,finishParticipantIds:[],individual:[{participantId:"a",instruction:"Describe new movement"}]});state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state)).toMatchObject({kind:"lead_guidance",cycle:2});
  await saveHumanLeadGuidance(deps,"fixed",{cycle:2,finishRound:true,finishParticipantIds:[],individual:[]});state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state).kind).toBe("reflection");await saveHumanTelepathicReflection(deps,"fixed","own reflection");state=await advanceTelepathicConversationSeries(deps,"fixed");expect(state.finalization).toBe("completed");expect(state.finalReflections.human).toBeUndefined();expect(state.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(1);
 });
});
