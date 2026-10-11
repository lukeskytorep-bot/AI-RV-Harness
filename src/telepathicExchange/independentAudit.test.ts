import { describe,it,expect } from "vitest";
import type { ProviderConfig,ProviderModel } from "../providers/types";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { TelepathicParticipant,TelepathicSeriesConfig } from "./types";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { createTelepathicSeriesState,runNextTelepathicAiRound,advanceTelepathicConversationSeries,saveHumanTelepathicTarget,confirmHumanTelepathicTransmission,saveHumanLeadGuidance,saveHumanTelepathicSharing,saveHumanTelepathicFirstBlind,saveHumanTelepathicReflection,telepathicConversationHumanStep,saveHumanGuidanceResponse,allowRetryForUncertainTelepathicCall,resumeBlockedTelepathicSeries } from "./engine";
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


describe("Independent audit expected behavior",()=>{
 it("Invalid lead JSON should not be replayed forever on recovery",async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));let leadCalls=0;
  const attempt:ProviderChatAttempt=async r=>{const lead=r.messages.some(m=>m.content.includes("CONTRACT:"));if(lead)leadCalls++;return {content:lead&&leadCalls===1?"not json":answer(r,0),finishReason:"stop",usage:{}};};
  await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed")).rejects.toThrow(/Invalid lead decision/);
  await resumeBlockedTelepathicSeries({store,resolveRoute},"fixed");
  const resumed=await runNextTelepathicAiRound({store,resolveRoute,providerAttempt:attempt},"fixed");
  expect(leadCalls).toBe(2);expect(resumed.status).toBe("completed");
 });
 it("Archived human series must reject target mutation",async()=>{
  const store=new InMemoryTelepathicExchangeStore();const cfg:TelepathicSeriesConfig={...config,mode:"conversation_exchange",participants:[{id:"human",kind:"human",displayName:"Human"},ai("a")],senderPolicy:{kind:"human_only",humanParticipantId:"human"}};
  const state=createTelepathicSeriesState(cfg);state.archivedAt="2026-10-11";state.archiveRevision=1;await store.saveTelepathicSeries(state);
  await expect(saveHumanTelepathicTarget({store,resolveRoute},"fixed",{content:"must not be written"})).rejects.toThrow(/archived|Restore/);
 });
 it("Fingerprint must reject changed generation settings after a durable first attempt",async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));const controller=new AbortController();let settings=0.5;let receiverCalls=0;
  const route=async(p:TelepathicParticipant)=>({...await resolveRoute(p),requestedSettings:{temperature:settings}});
  const first:ProviderChatAttempt=async r=>{const receiver=r.messages.some(m=>m.content.includes("Please give your first description"));if(receiver){receiverCalls++;controller.abort();return {content:"partial",finishReason:"length",usage:{}};}return {content:answer(r,0),finishReason:"stop",usage:{}};};
  await expect(runNextTelepathicAiRound({store,resolveRoute:route,providerAttempt:first,signal:controller.signal},"fixed")).rejects.toThrow();
  settings=1.5;
  await expect(runNextTelepathicAiRound({store,resolveRoute:route,providerAttempt:async r=>{if(r.messages.some(m=>m.content.includes("Please give your first description")))receiverCalls++;return {content:answer(r,0),finishReason:"stop",usage:{}}}},"fixed")).rejects.toThrow(/changed|fingerprint|settings/i);
  expect(receiverCalls).toBe(1);
 });
 it("Unknown token usage must not be reported as measured zero",()=>{
  const state=createTelepathicSeriesState(config);state.providerCalls=[{id:"unknown",seriesId:"fixed",roundId:"r",participantId:"a",callStage:"receiver_first",technicalAttempt:1,status:"uncertain",scopeKey:"k",requestSha256:"h",createdAt:"t",updatedAt:"t"}];
  expect(telepathicRuntimeMetrics(state).tokens).not.toBe(0);
 });
});

 it("Legacy Conversation must retain stored answers in its rendered transcript",()=>{
  const cfg:TelepathicSeriesConfig={...config,mode:"conversation_exchange",protocolVersion:undefined,senderPolicy:{kind:"human_only",humanParticipantId:"human"},participants:[{id:"human",kind:"human",displayName:"Human"},ai("a")]};
  const state=createTelepathicSeriesState(cfg);delete state.transcript;state.rounds[0].revealedAt="2026-10-11";state.rounds[0].blindByParticipant.a={participantId:"a",first:"LEGACY_ANSWER_MUST_REMAIN",status:"sealed",providerAttemptCount:1};
  const view=buildTelepathicConversationView(state);
  expect(view.transcript?.some(e=>e.text.includes("LEGACY_ANSWER_MUST_REMAIN"))).toBe(true);
 });



describe("extended lead acceptance and generation recovery",()=>{
 for (const invalid of ["not json",JSON.stringify({cycle:1,finishRound:false,finishParticipantIds:[],broadcast:{recipientIds:["missing"],instruction:"bad"}})]) it(`persists diagnostics and exhausts two rejected domain attempts: ${invalid}`,async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));let decisions=0,instructions=0;
  const providerAttempt:ProviderChatAttempt=async r=>{if(r.messages.some(m=>m.content.includes("CONTRACT:"))){decisions++;return {content:invalid,finishReason:"stop",usage:{totalTokens:1}};}if(r.messages.some(m=>m.content.includes("LEAD_INSTRUCTION:")))instructions++;return {content:answer(r,0),finishReason:"stop",usage:{}};};
  const deps={store,resolveRoute,providerAttempt};
  for(let i=0;i<2;i++){await expect(runNextTelepathicAiRound(deps,"fixed")).rejects.toThrow(/Invalid lead decision/);await resumeBlockedTelepathicSeries(deps,"fixed");}
  await expect(runNextTelepathicAiRound(deps,"fixed")).rejects.toThrow(/exhausted/);expect(decisions).toBe(2);expect(instructions).toBe(0);
  const calls=(await store.getTelepathicSeries("fixed"))!.providerCalls.filter(c=>c.callStage.startsWith("lead_guidance"));expect(calls.map(c=>c.status)).toEqual(["failed","failed"]);expect(calls.every(c=>c.responseText===invalid)).toBe(true);
 });
 it("does not resolve a changed route or buy another call for a completed accepted step",async()=>{
  const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));let paid=0;
  const providerAttempt:ProviderChatAttempt=async r=>{paid++;return {content:answer(r,0),finishReason:"stop",usage:{}};};
  await runNextTelepathicAiRound({store,resolveRoute,providerAttempt},"fixed");const count=paid;
  await runNextTelepathicAiRound({store,resolveRoute:async()=>{throw new Error("settings changed");},providerAttempt},"fixed");expect(paid).toBe(count);
 });
 it("reports partial token coverage without adding reasoning twice",()=>{
  const state=createTelepathicSeriesState(config);const base={id:"k",seriesId:"fixed",roundId:"r",participantId:"a",callStage:"receiver_first",technicalAttempt:1,scopeKey:"k",requestSha256:"h",createdAt:"t",updatedAt:"t"};
  state.providerCalls=[{...base,status:"succeeded",usage:{inputTokens:10,outputTokens:20,totalTokens:30,reasoningTokens:5,costUsd:0.1},costSource:"provider"},{...base,id:"missing",status:"uncertain"},{...base,id:"partial",status:"failed",usage:{inputTokens:4}}];
  const metrics=telepathicRuntimeMetrics(state);expect(metrics.tokens).toBe(34);expect(metrics.tokensMissing).toBe(2);expect(metrics.costMissing).toBe(2);expect(metrics.costUsd).toBe(0.1);
 });
});

it("a new empty transcript stays new, while legacy export retains only visible stored data",async()=>{
 const cfg:TelepathicSeriesConfig={...config,mode:"conversation_exchange",participants:[{id:"human",kind:"human",displayName:"Human"},ai("a")],senderPolicy:{kind:"fixed_ai",participantId:"a"}};
 const state=createTelepathicSeriesState(cfg);state.transcript=[];expect(buildTelepathicConversationView(state).legacyTranscript).toBe(false);
 delete state.transcript;state.rounds[0].blindByParticipant.a={participantId:"a",first:"PRIVATE_OLD_ANSWER",status:"sealed",providerAttemptCount:1};state.finalReflections.a="OLD_FINAL";
 const {telepathicExportDocument}=await import("./export");expect(telepathicExportDocument(state)).not.toContain("PRIVATE_OLD_ANSWER");state.rounds[0].revealedAt="t";expect(telepathicExportDocument(state)).toContain("PRIVATE_OLD_ANSWER");expect(telepathicExportDocument(state)).toContain("OLD_FINAL");
});

it("replays a durably accepted receiver output after Stop without resolving changed live settings",async()=>{
 const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));const controller=new AbortController();let aCalls=0;
 const first:ProviderChatAttempt=async r=>{if(r.modelId==="model-a" && r.messages.some(m=>m.content.includes("Please give your first description"))){aCalls++;controller.abort();}return {content:answer(r,0),finishReason:"stop",usage:{}};};
 await expect(runNextTelepathicAiRound({store,resolveRoute,providerAttempt:first,signal:controller.signal},"fixed")).rejects.toThrow();
 const state=(await store.getTelepathicSeries("fixed"))!;expect(state.providerCalls.some(c=>c.participantId==="a"&&c.status==="succeeded")).toBe(true);expect(state.rounds[0].blindByParticipant.a.first).toBeUndefined();
 const next=await runNextTelepathicAiRound({store,resolveRoute:async p=>{if(p.id==="a" && !(await store.getTelepathicSeries("fixed"))!.rounds[0].blindByParticipant.a.first)throw new Error("changed live settings should not be resolved for replay");return resolveRoute(p);},providerAttempt:async r=>{if(r.modelId==="model-a"&&r.messages.some(m=>m.content.includes("Please give your first description")))aCalls++;return {content:answer(r,0),finishReason:"stop",usage:{}};}},"fixed");
 expect(next.status).toBe("completed");expect(aCalls).toBe(1);
});

it("distinguishes measured zero, estimates and missing reports on physical retries",()=>{
 const state=createTelepathicSeriesState(config);const call={id:"c",seriesId:"fixed",roundId:"r",participantId:"a",callStage:"receiver_first",technicalAttempt:1,scopeKey:"k",requestSha256:"h",createdAt:"t",updatedAt:"t",status:"failed" as const};
 state.providerCalls=[{...call,usage:{totalTokens:0,costUsd:0},costSource:"provider"}];expect(telepathicRuntimeMetrics(state)).toMatchObject({tokens:0,tokensMissing:0,costSource:"provider",costReports:1});
 state.providerCalls=[{...call,usage:{inputTokens:2,outputTokens:3,costUsd:0.01},costSource:"estimated"}];expect(telepathicRuntimeMetrics(state)).toMatchObject({tokens:5,tokensMissing:0,costSource:"estimated"});
 state.providerCalls[0].physicalAttempts=2;expect(telepathicRuntimeMetrics(state)).toMatchObject({tokens:5,tokensMissing:1,costMissing:1,costSource:"incomplete",knownCostSource:"estimated"});
});
