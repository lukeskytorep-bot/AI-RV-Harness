import { describe, it, expect } from "vitest";
import { assignTargetGeographies, TARGET_GEOGRAPHY_POOL } from "./geography";
import { validateLeadDecision } from "./leadGuidance";
import { serializeTelepathicPlan, restoreTelepathicRuntime } from "./persistence";
import { createTelepathicSeriesState } from "./engine";
import type { TelepathicSeriesConfig } from "./types";
import { buildTelepathicConversationView } from "./conversationView";

const config: TelepathicSeriesConfig = { schemaVersion: 1, protocolVersion:"fixed_lead_v1",leadInstructionVersion:"fixed_lead_guidance_v1",maxGuidanceCycles:3,
  seriesId:"foundation",seriesWorkspaceId:"w",mode:"conversation_exchange",language:"en",participants:[{id:"human",kind:"human",displayName:"Human"},
  {id:"ai",kind:"ai",displayName:"AI",ai:{profileId:"p",profileName:"AI",workspaceId:"w",aiIdentityId:"i",providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}}],
  roundCount:5,topic:"location",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"ai"} };
describe("fixed lead foundation",()=>{
  it("freezes one lead and distinct geography entries across five rounds",()=>{
    const state=createTelepathicSeriesState(config);
    expect(new Set(state.plan.rounds.map(r=>r.senderParticipantId))).toEqual(new Set(["ai"]));
    expect(new Set(state.plan.rounds.map(r=>r.targetGeography?.areaId)).size).toBe(5);
    expect(state.config.protocolVersion).toBe("fixed_lead_v1");
  });
  it("exhausts the pool before reusing an entry and avoids a boundary repeat",()=>{
    const areas=assignTargetGeographies(TARGET_GEOGRAPHY_POOL.length*2,()=>0);
    expect(new Set(areas.slice(0,TARGET_GEOGRAPHY_POOL.length).map(a=>a.areaId)).size).toBe(TARGET_GEOGRAPHY_POOL.length);
    expect(areas[TARGET_GEOGRAPHY_POOL.length-1].areaId).not.toBe(areas[TARGET_GEOGRAPHY_POOL.length].areaId);
    expect(new Set(TARGET_GEOGRAPHY_POOL.map(a=>a.areaId)).size).toBe(TARGET_GEOGRAPHY_POOL.length);
    expect(TARGET_GEOGRAPHY_POOL.every(a=>a.labelPl&&a.labelEn)).toBe(true);
  });
  it("round-trips all runtime extensions through the existing fenced plan JSON",()=>{
    const state=createTelepathicSeriesState(config);
    const round=state.rounds[0];
    round.guidance={decisions:[{cycle:1,finishRound:false,finishParticipantIds:[],individual:[{participantId:"human",instruction:"Describe movement"}]}],finishedParticipantIds:[],closed:false};
    round.blindByParticipant.human.guidanceResponses=[{cycle:1,instruction:"Describe movement",response:"slow"}];
    state.providerCalls=[{id:"call",seriesId:"foundation",roundId:round.assignment.roundId,participantId:"ai",callStage:"lead_guidance:cycle:1",technicalAttempt:1,status:"succeeded",scopeKey:"scope",requestSha256:"hash",createdAt:"t",updatedAt:"t",usage:{totalTokens:30,costUsd:0.1},elapsedMs:20,physicalAttempts:1,costSource:"provider",requestMessages:[{role:"user",content:"real packet"}]}];
    state.transcript=[{id:"event",seriesId:"foundation",roundId:round.assignment.roundId,sequence:1,stage:"lead_guidance",kind:"response",authorId:"ai",recipientIds:[],text:"decision",createdAt:"t"}];
    state.activeElapsedMs=200;state.finalization="running";state.archivedAt="t";state.archiveRevision=1;
    const stored=JSON.parse(serializeTelepathicPlan(state));
    const reloaded=structuredClone(state);reloaded.plan=structuredClone(stored);reloaded.transcript=undefined;reloaded.rounds[0].guidance=undefined;reloaded.rounds[0].blindByParticipant.human.guidanceResponses=undefined;
    reloaded.providerCalls[0].usage=undefined;
    expect(restoreTelepathicRuntime(reloaded,stored)).toEqual(state);
  });
  it("rejects a rotating new protocol but keeps legacy rotation",()=>{
    expect(()=>createTelepathicSeriesState({...config,senderPolicy:{kind:"rotate"}})).toThrow(/Fixed lead/);
    const {protocolVersion,leadInstructionVersion,maxGuidanceCycles,...legacy}=config;
    expect(createTelepathicSeriesState({...legacy,senderPolicy:{kind:"rotate"}}).plan.rounds[0].targetGeography).toBeUndefined();
  });
  it("rejects duplicate, unknown and leaking instructions",()=>{
    const valid={cycle:1,finishRound:false,finishParticipantIds:[],individual:[{participantId:"a",instruction:"Describe motion"}]};
    expect(validateLeadDecision(valid,1,["a"])).toEqual(valid);
    expect(()=>validateLeadDecision({...valid,broadcast:{recipientIds:["a"],instruction:"Describe"}},1,["a"])).toThrow(/duplicate/);
    expect(()=>validateLeadDecision(valid,1,["b"])).toThrow(/Unknown/);
    expect(()=>validateLeadDecision({...valid,individual:[{participantId:"a",instruction:"Describe Japan"}]},1,["a"],["Japan"])).toThrow(/hidden/);
  });
});
