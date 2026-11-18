import { describe,it,expect } from "vitest";
import { targetCodeConfig,model,provider } from "../testing/targetCodeFixture";
import { buildResearchLockPlan,validateConfig,stableStringify } from "./planner";
import { runResearchPreflight } from "./preflight";
import { assertTargetCodeDesign } from "./targetCodeDesign";

describe("target-code matched design",()=>{
 it("locks two conditions per target and repetition with independent neutral IDs and shuffled orders",async()=>{
  const c=targetCodeConfig();c.targetIds=["t1","t2"];c.repetitions=3;
  const orders = new Set<string>();
  for(let i=0;i<8;i++){
   const p=await buildResearchLockPlan("r",c);expect(p.assignments).toHaveLength(12);
   expect(new Set(p.assignments.map(a=>a.anonymousSessionId)).size).toBe(12);
   expect(new Set(p.assignments.map(a=>a.judgeOrder)).size).toBe(12);
   const groups=new Map<string,typeof p.mappings>();for(const m of p.mappings)groups.set(m.pairKey,[...(groups.get(m.pairKey)??[]),m]);expect(groups.size).toBe(6);
   for(const [key,ms] of groups){expect(key).toMatch(/^pair_tc[123]_/);expect(ms).toHaveLength(2);expect(ms.every(m=>m.pairOrder===undefined)).toBe(true);expect(new Set(p.assignments.filter(a=>ms.some(m=>m.anonymousSessionId===a.anonymousSessionId)).map(a=>a.targetId)).size).toBe(1);}
   orders.add(p.assignments.slice().sort((a,b)=>a.executionOrder-b.executionOrder).map(a=>p.mappings.find(m=>m.anonymousSessionId===a.anonymousSessionId)!.conditionId).join());
   expect(p.configHash).not.toBe((await buildResearchLockPlan("r",{...c,conditions:c.conditions.map(x=>({...x,label:x.label+"!"}))})).configHash);
  }
  expect(orders.size).toBeGreaterThan(1);
 });
 it("rejects extra instructions, differing controls, modes, hash, protocol and Focus before dispatch",()=>{
  const mutate=[(c:ReturnType<typeof targetCodeConfig>)=>{c.conditions[1].requestedSettings.seed=42;},(c:ReturnType<typeof targetCodeConfig>)=>{c.conditions[1].targetCode!.templatesSha256="x";},(c:ReturnType<typeof targetCodeConfig>)=>{c.conditions[1].targetCode!.mode="bad" as never;},(c:ReturnType<typeof targetCodeConfig>)=>{c.conditions[1].conditionInstruction={id:"x",version:"1",content:"experiment",contentSha256:"x"};},(c:ReturnType<typeof targetCodeConfig>)=>{Object.assign(c,{sessionFocus:{second:{}}});},(c:ReturnType<typeof targetCodeConfig>)=>{c.protocol={id:"full-rcp",version:"1.5a"};}];
  for(const change of mutate){const c=targetCodeConfig();change(c);expect(()=>validateConfig(c)).toThrow();}
  const legacy={...targetCodeConfig(),templateType:"model" as const,conditions:targetCodeConfig().conditions.map(({targetCode:_,...c})=>c)};const before=stableStringify(legacy);assertTargetCodeDesign(legacy);expect(stableStringify(legacy)).toBe(before);
 });
 it("preflight recognizes four calls per session and refuses invalid structural policy",()=>{
  const c=targetCodeConfig();const inventory={profiles:[{id:"p",name:"P",credentialId:provider.credentialId,createdAt:"t",updatedAt:"t"}],providerConfigs:[{...provider,lastStatus:"ok" as const}],models:[model],targets:[{id:"t",collection:"user" as const,title:"T",revealText:"Reveal",tags:[],sourceMetadata:{},createdAt:"t",updatedAt:"t"}],targetUsage:[]};
  expect(runResearchPreflight(c,inventory).estimatedViewerCalls).toBe(8);
  c.conditions[1].targetCode!.templatesSha256="bad";expect(runResearchPreflight(c,inventory).checks).toContainEqual(expect.objectContaining({id:"target_code_design",level:"fail"}));
 });
});
