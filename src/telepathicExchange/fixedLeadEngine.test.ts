import { describe,it,expect } from "vitest";
import type { ProviderConfig,ProviderModel } from "../providers/types";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { TelepathicParticipant,TelepathicSeriesConfig } from "./types";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { createTelepathicSeriesState,runNextTelepathicAiRound,advanceTelepathicConversationSeries,saveHumanTelepathicTarget,confirmHumanTelepathicTransmission,saveHumanLeadGuidance,saveHumanTelepathicSharing,saveHumanTelepathicFirstBlind,saveHumanTelepathicReflection,telepathicConversationHumanStep,saveHumanGuidanceResponse,allowRetryForUncertainTelepathicCall } from "./engine";
import { InMemoryTelepathicExchangeStore } from "./store";
import { buildTelepathicConversationView } from "./conversationView";
import { telepathicRuntimeMetrics } from "./runtimeMetrics";
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
  it("keeps length diagnostics and uses 16K then 32K without a third attempt",async()=>{
    const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));
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
    const attempt:ProviderChatAttempt=async r=>{const content=r.messages.map(m=>m.content).join("\n");return {content:content.includes("CONTRACT:")?JSON.stringify({cycle:1,finishRound:true,finishParticipantIds:[]}):answer(r,0),finishReason:"stop",usage:{}};};
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
   if(content.includes("CONTRACT:")){const cycle=Number(content.match(/"cycle":(\d)/)?.[1]);text=JSON.stringify(cycle===1?{cycle,finishRound:false,finishParticipantIds:[],broadcast:{recipientIds:["a","b"],instruction:"Describe movement"}}:cycle===2?{cycle,finishRound:false,finishParticipantIds:["a"],individual:[{participantId:"b",instruction:"Describe the next change"}]}:{cycle,finishRound:true,finishParticipantIds:["b"]});}
   return {content:text,finishReason:"stop",usage:{}};
  };
  const state=await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed");expect(state.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(1);expect(state.rounds[0].blindByParticipant.b.guidanceResponses).toHaveLength(2);
  expect(state.transcript!.find(e=>e.id.endsWith(":broadcast"))!.recipientIds).toEqual(["a","b"]);
 });
 it("supports a fixed human lead and human JSON-free actions without generating human reflections",async()=>{
  const store=new InMemoryTelepathicExchangeStore();const cfg:TelepathicSeriesConfig={...config,mode:"conversation_exchange",participants:[{id:"human",kind:"human",displayName:"Human"},ai("a")],senderPolicy:{kind:"human_only",humanParticipantId:"human"}};
  await store.saveTelepathicSeries(createTelepathicSeriesState(cfg));const deps={store,resolveRoute,providerAttempt:(async request=>({content:answer(request,0),finishReason:"stop",usage:{}})) as ProviderChatAttempt};
  let state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state).kind).toBe("prepare_target");
  await saveHumanTelepathicTarget(deps,"fixed",{content:"human frozen target"});await confirmHumanTelepathicTransmission(deps,"fixed");state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state).kind).toBe("lead_guidance");
  await saveHumanLeadGuidance(deps,"fixed",{cycle:1,finishRound:false,finishParticipantIds:[],broadcast:{recipientIds:["a"],instruction:"Describe new movement"}});state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state)).toMatchObject({kind:"lead_guidance",cycle:2});
  await saveHumanLeadGuidance(deps,"fixed",{cycle:2,finishRound:true,finishParticipantIds:[]});state=await advanceTelepathicConversationSeries(deps,"fixed");expect(telepathicConversationHumanStep(state).kind).toBe("reflection");await saveHumanTelepathicReflection(deps,"fixed","own reflection");state=await advanceTelepathicConversationSeries(deps,"fixed");expect(state.finalization).toBe("completed");expect(state.finalReflections.human).toBeUndefined();expect(state.rounds[0].blindByParticipant.a.guidanceResponses).toHaveLength(1);
 });
});
