import { describe, expect, it } from "vitest";
import { runResearchPreflight, type ResearchPreflightInventory } from "./preflight";
import type { ResearchConfig, ResearchSamplingDesign } from "./types";
import { buildResearchSamplingConditions } from "./samplingDesign";
import { resolveGenerationSettings } from "../providers/capabilities";

const cap = { inputModalities:["text"], outputModalities:["text"], supportsVision:false, supportsStreaming:true,
  reasoning:{supported:false, efforts:[], confidence:"unknown" as const}, temperature:{supported:true, confidence:"provider_metadata" as const},
  supportedParameters:["top_p","top_k","seed"], contextTokens:100000, maxOutputTokens:32768, source:"provider" as const, capturedAt:"now" };
const prompt={id:"p",version:"1",content:"fixed",contentSha256:"a".repeat(64)};
const inventory: ResearchPreflightInventory={
 profiles:[{id:"p",name:"P",credentialId:"c",createdAt:"now",updatedAt:"now"}],
 providerConfigs:[{id:"pc",provider:"openrouter",label:"OR",credentialId:"c",enabled:true,lastStatus:"ok",createdAt:"now",updatedAt:"now"}],
 models:[{providerConfigId:"pc",provider:"openrouter",modelId:"m",displayName:"M",route:"openrouter:m",capabilities:cap,pricing:{},recommended:true,rawMetadata:{supported_parameters:["top_p","top_k","seed"]},refreshedAt:"now"}],
 targets:[{id:"t",collection:"user",title:"T",revealText:"R",tags:[],sourceMetadata:{},createdAt:"now",updatedAt:"now"}],targetUsage:[] };
function config(seedA=123, seedB=123): ResearchConfig { const s=(seed:number)=>({topP:0.9,topK:0,seed,maxOutputTokens:32768}); return {
 schemaVersion:1,name:"R",workspaceId:"w",templateType:"practice",sessionLanguage:"en",protocol:{id:"full-rcp",version:"1.5a"},targetIds:["t"],repetitions:1,requireUnusedTargets:false,
 viewerControl:{model:{mode:"fixed",modelId:"m"},systemPrompt:{mode:"fixed",source:"locked_only",contentSha256:prompt.contentSha256},reasoning:{mode:"provider_default"},temperature:{mode:"provider_default"},sampling:{source:"profile",profileId:"p",topP:0.9,topK:0,seed:123},maxOutputTokens:32768},
 conditions:["a","b"].map((key,i)=>({key,label:key,profileId:"p",providerConfigId:"pc",modelId:"m",requestedSettings:s(i?seedB:seedA),capabilitySnapshot:cap,effectiveSettings:{requested:s(i?seedB:seedA),effective:s(i?seedB:seedA),omitted:[]},systemPrompt:prompt,practiceOrder:i?"SECOND":"FIRST"})),
 evaluationMode:"save_only",judges:[],randomization:{matchedTargets:true,randomizedExecution:true,randomizedJudgeOrder:true} }; }

function frozenSamplingConditions(d:ResearchSamplingDesign){
 const base=config().conditions[0];
 return buildResearchSamplingConditions({...base,key:"base",label:"base",practiceOrder:undefined},d).map((condition)=>({
  ...condition,capabilitySnapshot:structuredClone(cap),effectiveSettings:resolveGenerationSettings(cap,condition.requestedSettings),
 }));
}

describe("Research sampling preflight",()=>{
 it("accepts one frozen common sampling configuration",()=>{ expect(runResearchPreflight(config(),inventory).checks).toContainEqual(expect.objectContaining({id:"viewer_control_lock",level:"pass"})); });
 it("rejects sampler drift between old-template conditions",()=>{ const r=runResearchPreflight(config(123,456),inventory); expect(r.checks).toContainEqual(expect.objectContaining({id:"controlled_variables",level:"fail"})); });
 it("rejects unconfirmed manual sampling independently of lower generation resolution",()=>{ const broken=structuredClone(inventory); broken.models[0].capabilities.supportedParameters=[]; broken.models[0].rawMetadata={}; const r=runResearchPreflight(config(),broken); expect(r.ok).toBe(false); expect(r.checks.some(c=>c.level==="fail"&&c.message.includes("seed unknown"))).toBe(true); });


it("accepts a Sampling configurations grid while keeping non-sampling controls fixed",()=>{
 const d:ResearchSamplingDesign={version:1,topP:{mode:"varied",values:[0.7,0.9]},topK:{mode:"fixed",value:0},seed:{mode:"varied",values:[123,456]}};
 const sampling:ResearchConfig={...config(),templateType:"sampling",samplingDesign:d,conditions:frozenSamplingConditions(d),viewerControl:{...config().viewerControl!,sampling:{source:"research",profileId:"p",mode:"condition_variable"}}};
 const r=runResearchPreflight(sampling,inventory);
 expect(r.checks).toContainEqual(expect.objectContaining({id:"sampling_design",level:"pass"}));
 expect(r.checks).toContainEqual(expect.objectContaining({id:"controlled_variables",level:"pass"}));
 expect(r.checks).toContainEqual(expect.objectContaining({id:"condition_distinguishability",level:"pass"}));
});

it("rejects a tampered Sampling configurations payload in preflight",()=>{
 const d:ResearchSamplingDesign={version:1,topP:{mode:"varied",values:[0.7,0.9]},topK:{mode:"fixed",value:0},seed:{mode:"fixed",value:123}};
 const sampling:ResearchConfig={...config(),templateType:"sampling",samplingDesign:d,conditions:frozenSamplingConditions(d),viewerControl:{...config().viewerControl!,sampling:{source:"research",profileId:"p",mode:"condition_variable"}}};
 sampling.conditions[0].samplingValues={topP:0.8,topK:0,seed:123};
 const r=runResearchPreflight(sampling,inventory);
 expect(r.ok).toBe(false);
 expect(r.checks).toContainEqual(expect.objectContaining({id:"sampling_design",level:"fail"}));
});

it("rejects Sampling configurations without an explicit Viewer-control lock instead of treating it as legacy",()=>{
 const d:ResearchSamplingDesign={version:1,topP:{mode:"varied",values:[0.7,0.9]},topK:{mode:"fixed",value:0},seed:{mode:"fixed",value:123}};
 const sampling:ResearchConfig={...config(),templateType:"sampling",samplingDesign:d,conditions:frozenSamplingConditions(d),viewerControl:{...config().viewerControl!,sampling:{source:"research",profileId:"p",mode:"condition_variable"}}};
 delete sampling.viewerControl;
 const r=runResearchPreflight(sampling,inventory);
 expect(r.ok).toBe(false);
 expect(r.checks).toContainEqual(expect.objectContaining({id:"viewer_control_lock",level:"fail"}));
 expect(r.checks).toContainEqual(expect.objectContaining({id:"sampling_design",level:"fail"}));
});

it("rejects hidden conditionInstruction drift in Sampling configurations",()=>{
 const d:ResearchSamplingDesign={version:1,topP:{mode:"varied",values:[0.7,0.9]},topK:{mode:"fixed",value:0},seed:{mode:"fixed",value:123}};
 const sampling:ResearchConfig={...config(),templateType:"sampling",samplingDesign:d,conditions:frozenSamplingConditions(d),viewerControl:{...config().viewerControl!,sampling:{source:"research",profileId:"p",mode:"condition_variable"}}};
 sampling.conditions[1].conditionInstruction={id:"injected",version:"1",content:"Use a completely different strategy for this condition",contentSha256:"f1ae8f1316ce005e1e23a9951bb2ef1cf5e044473410daf1cce9c0d242c7f19b"};
 const r=runResearchPreflight(sampling,inventory);
 expect(r.ok).toBe(false);
 expect(r.checks).toContainEqual(expect.objectContaining({id:"sampling_design",level:"fail"}));
});

it("accepts one identical frozen conditionInstruction across every Sampling condition",()=>{
 const d:ResearchSamplingDesign={version:1,topP:{mode:"varied",values:[0.7,0.9]},topK:{mode:"fixed",value:0},seed:{mode:"fixed",value:123}};
 const conditions=frozenSamplingConditions(d);
 const instruction={id:"common",version:"1",content:"Use the same frozen instruction",contentSha256:"a".repeat(64)};
 conditions.forEach((condition)=>{condition.conditionInstruction=structuredClone(instruction);});
 const sampling:ResearchConfig={...config(),templateType:"sampling",samplingDesign:d,conditions,viewerControl:{...config().viewerControl!,sampling:{source:"research",profileId:"p",mode:"condition_variable"}}};
 const r=runResearchPreflight(sampling,inventory);
 expect(r.checks).toContainEqual(expect.objectContaining({id:"sampling_design",level:"pass"}));
});

});
