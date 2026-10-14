import * as E from "./engine";
import { describe, expect, it, vi } from "vitest";
import type { ProviderChatAttempt } from "../providers/requestExecutor";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { createTelepathicSeriesState, runNextTelepathicAiRound, runTelepathicFinalReflections } from "./engine";
import type { ResolvedTelepathicAiRoute } from "./providerGateway";
import { InMemoryTelepathicExchangeStore } from "./store";
import type { TelepathicParticipant, TelepathicSeriesConfig } from "./types";

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

const config: TelepathicSeriesConfig = {
  schemaVersion: 1,
  seriesId: "series-step3a",
  seriesWorkspaceId: "workspace-leo",
  mode: "conversation_exchange",
  language: "en",
  participants: [ai("leo"), ai("nemo")],
  roundCount: 2,
  topic: "location",
  discloseTopicToReceivers: false,
  senderPolicy: { kind: "rotate" },
};


for (const mode of ["conversation_exchange", "ai_ai_training"] as const) it(`S2 End preserves uncertain ledger and all checkpoints: ${mode}`, async () => {
 const store = new InMemoryTelepathicExchangeStore();
 const state = createTelepathicSeriesState({...config, mode, protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,senderPolicy:{kind:"fixed_ai",participantId:"leo"}});
 state.status="paused";state.providerCalls=[{id:"uncertain",seriesId:config.seriesId,roundId:state.rounds[0].assignment.roundId,participantId:"leo",callStage:"receiver_first",technicalAttempt:2,status:"uncertain",scopeKey:"scope",requestSha256:"old-fingerprint",usage:{totalTokens:9},createdAt:"old",updatedAt:"old"}];
 await store.saveTelepathicSeries(state); const attempt=vi.fn(); const deps={store,resolveRoute:vi.fn(),providerAttempt:attempt};
 const ended=await E.endTelepathicSeries(deps,config.seriesId);
 expect(ended.status).toBe("cancelled");expect(ended.termination?.reason).toBe("user_finished");
 for(const key of ["providerCalls","rounds","config","plan","finalReflections","currentRoundIndex"] as const)expect(ended[key]).toEqual(state[key]);
 expect(await E.endTelepathicSeries(deps,config.seriesId)).toEqual(ended);
 const actions=[()=>E.advanceTelepathicConversationSeries(deps,config.seriesId),()=>E.runNextTelepathicAiRound(deps,config.seriesId),()=>E.resumeBlockedTelepathicSeries(deps,config.seriesId),()=>E.allowRetryForUncertainTelepathicCall(deps,config.seriesId,"uncertain"),()=>E.runTelepathicFinalReflections(deps,config.seriesId),()=>E.saveHumanTelepathicTarget(deps,config.seriesId,{} as never),()=>E.confirmHumanTelepathicTransmission(deps,config.seriesId),()=>E.saveHumanTelepathicFirstBlind(deps,config.seriesId,"text"),()=>E.sealHumanTelepathicBlind(deps,config.seriesId),()=>E.saveHumanTelepathicReflection(deps,config.seriesId,"text"),()=>E.saveHumanTelepathicSharing(deps,config.seriesId,"yes"),()=>E.cancelCurrentTelepathicRoundBeforeReveal(deps,config.seriesId),()=>E.saveHumanLeadGuidance(deps,config.seriesId,{} as never),()=>E.saveHumanGuidanceResponse(deps,config.seriesId,"text")];
 for(const action of actions)await expect(action()).rejects.toThrow(/ended/);
 expect(await store.getTelepathicSeries(config.seriesId)).toEqual(ended);expect(attempt).not.toHaveBeenCalled();expect(deps.resolveRoute).not.toHaveBeenCalled();
 await expect(store.saveTelepathicSeries(state)).rejects.toThrow(/Ended/);
});
it("S2 terminal guard precedes all-rounds-finished finalization shortcut",async()=>{
 const store=new InMemoryTelepathicExchangeStore();const state=createTelepathicSeriesState({...config,mode:"ai_ai_training",protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,senderPolicy:{kind:"fixed_ai",participantId:"leo"}});
 state.currentRoundIndex=state.rounds.length;state.status="paused";state.finalization="blocked";await store.saveTelepathicSeries(state);
 const deps={store,resolveRoute:vi.fn(),providerAttempt:vi.fn()};await E.endTelepathicSeries(deps,config.seriesId);
 await expect(E.runNextTelepathicAiRound(deps,config.seriesId)).rejects.toThrow(/ended/);expect(deps.resolveRoute).not.toHaveBeenCalled();
});
it("S2 active run lease blocks End until the task settles",async()=>{
 const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(createTelepathicSeriesState(config));let release!:()=>void;
 const held=store.withTelepathicSeriesLease(config.seriesId,()=>new Promise<void>(resolve=>{release=resolve;}));
 await expect(E.endTelepathicSeries({store,resolveRoute:vi.fn()},config.seriesId)).rejects.toThrow(/running/);release();await held;
 expect((await E.endTelepathicSeries({store,resolveRoute:vi.fn()},config.seriesId)).status).toBe("cancelled");
});

it("S2 End refuses false success when storage does not retain the marker",async()=>{
 const store=new InMemoryTelepathicExchangeStore();const state=createTelepathicSeriesState(config);await store.saveTelepathicSeries(state);
 vi.spyOn(store,"saveTelepathicSeries").mockResolvedValue(undefined);
 await expect(E.endTelepathicSeries({store,resolveRoute:vi.fn()},config.seriesId)).rejects.toThrow(/not persisted/);
 expect(await store.getTelepathicSeries(config.seriesId)).toEqual(state);
});
