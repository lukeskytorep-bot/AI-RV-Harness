import { expect, it, vi } from "vitest";
import { analyticalOutputBudget, analyticalBudgetPolicyForSnapshot, callWithAnalyticalOutputRecovery, type FrozenAnalyticalOutputPolicy } from "./outputRecovery";
import { sendPostRevealTurn, sendMonitorPostRevealReview } from "../sessions/postReveal";
import { freezeResearchViewerOutputPolicy } from "../research/engine";
import { stableStringify } from "../research/planner";
import type { ResearchConfig } from "../research/types";
import type { ProviderConfig, ProviderModel } from "./types";
import type { SessionSnapshot } from "../sessions/types";
const provider:ProviderConfig={id:"p",provider:"custom_openai",label:"P",credentialId:"c",baseUrl:"https://example.test/v1",enabled:true,createdAt:"t",updatedAt:"t"};
const model:ProviderModel={providerConfigId:"p",provider:"custom_openai",modelId:"m",displayName:"M",route:"m",recommended:false,rawMetadata:{},pricing:{},refreshedAt:"t",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:true,efforts:["high"],confidence:"provider_metadata"},temperature:{supported:true,min:0,max:2,confidence:"provider_metadata"},supportedParameters:["reasoning","temperature","max_tokens"],contextTokens:262144,maxOutputTokens:131072,source:"provider",capturedAt:"t"}};
const v1:FrozenAnalyticalOutputPolicy={version:1,initialTokens:16384,recoveryTokens:32768};
const v2:FrozenAnalyticalOutputPolicy={version:2,initialTokens:32768,recoveryTokens:49152};
for(const policy of [undefined,v1,v2]) for(const role of ["viewer","monitor"] as const)it(`B2 actual Research post-Reveal ${role} honors frozen ${policy?.version??"absent"}`,async()=>{
 let transcript="";
 const snapshot={researchProjectId:"r",providerConfigId:"p",modelId:"m",sessionLanguage:"en",generationSettings:{requested:{reasoningEffort:"high",temperature:0.5},effective:{},omitted:[]},monitor:{providerConfigId:"p",modelId:"m",effectivePrompt:"Monitor"},...(policy?{postRevealOutputPolicy:policy}:{})} as unknown as SessionSnapshot;
 const before=stableStringify(snapshot);
 const repository={getSessionSnapshot:async()=>snapshot,getReveal:async()=>({source:"external_text" as const,text:"Tower",hash:"h"}),getViewerEvidence:async()=>"tall",listTargetClarifications:async()=>[],listMonitorRuns:async()=>[],listMonitorInterventions:async()=>[],appendPostRevealTurn:async(_id:string,turnRole:string,content:string)=>transcript+=JSON.stringify({role:turnRole,content})+"\n"};
 const budgets:number[]=[];
 const chat=vi.fn(async request=>{budgets.push(request.settings.effective.maxOutputTokens);return {content:"Complete analysis",finishReason:budgets.length===1?"length":"stop",usage:{}};});
 if(role==="viewer")await sendPostRevealTurn({repository,sessionId:"s",existingTranscript:"",providerConfig:provider,model,content:"Analyze",budgetPolicy:"training_reveal",chat});
 else await sendMonitorPostRevealReview({repository,sessionId:"s",existingTranscript:"",providerConfig:provider,model,chat});
 expect(budgets).toEqual(policy?.version===2?[32768,49152]:[16384,32768]);
 expect(stableStringify(snapshot)).toBe(before);
 expect(transcript).toContain("Complete analysis");
});
for(const capacity of [1024,2048,4096,16384])for(const operationKind of ["field_guide_update","viewer_notes_reflection"] as const)it(`B2 ${operationKind} C=${capacity} keeps independent capacity`,()=>{
 for(const attempt of [0,1] as const)expect(analyticalOutputBudget({model,messages:[{role:"user",content:"Update"}],operationKind,attempt,learningObjectCapacityTokens:capacity,budgetPolicy:"training_reveal"})).toBe(capacity+(attempt===0?32768:49152));
});
for(const ceiling of [8192,32768,40000])it(`B2 analytical ceiling ${ceiling} never repeats an ineffective limit`,async()=>{
 const limited={...model,capabilities:{...model.capabilities,maxOutputTokens:ceiling}};const budgets:number[]=[];
 const run=callWithAnalyticalOutputRecovery({model:limited,messages:[{role:"user",content:"Analyze"}],operationKind:"judge",call:async settings=>{budgets.push(settings.effective.maxOutputTokens!);return {content:"partial",finishReason:budgets.length===1?"length":"stop",usage:{}};}});
 if(ceiling<=32768){await expect(run).rejects.toThrow("cannot increase");expect(budgets).toEqual([ceiling]);}else{await run;expect(budgets).toEqual([32768,40000]);}
});
it("B2 rejects corrupted frozen policies rather than selecting a current fallback",()=>{
 expect(()=>analyticalBudgetPolicyForSnapshot({version:2,initialTokens:16384,recoveryTokens:32768} as unknown as FrozenAnalyticalOutputPolicy)).toThrow("Unsupported frozen");
});
it("B2 freezes independent analytical v2 before lock while preserving old serialized configs",()=>{
 const config={conditions:[{key:"a",requestedSettings:{maxOutputTokens:8192},capabilitySnapshot:model.capabilities}],randomization:{matchedTargets:true,randomizedExecution:true,randomizedJudgeOrder:true}} as unknown as ResearchConfig;
 const frozen=freezeResearchViewerOutputPolicy(config);
 expect(frozen.judgeOutputPolicy).toEqual(v2);expect(frozen.postRevealOutputPolicy).toEqual(v2);
 expect(frozen.conditions[0].viewerOutputPolicy).toMatchObject({version:1,initialTokens:16384,recoveryTokens:32768});
 const historical={...frozen,judgeOutputPolicy:v1,postRevealOutputPolicy:undefined};
 const wire=stableStringify(historical);expect(stableStringify(freezeResearchViewerOutputPolicy(historical))).toBe(wire);
});
