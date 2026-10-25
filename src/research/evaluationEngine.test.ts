import { evaluationFixture } from "../testing/researchEvaluationFixture";
import { expect, it, vi } from "vitest";
import { fixture, model, provider, output, lost } from "../testing/researchJudgeRecoveryFixture";
import { assertEvaluationUpdate, type ResearchEvaluation } from "./evaluationTypes";
import { createResearchEvaluation, runResearchEvaluation, evaluationSessionResults } from "./evaluationEngine";
import { judgeResearch } from "./engine";
import { ResearchJudgeCheckpointError } from "./judgeRequestRecovery";


it("evaluates the same preserved sessions in two independent same-Judge panels without changing original scores or End",async()=>{
 const f=evaluationFixture();await f.repo.recordFrozenJudgeResults!([{run:{id:"original",sessionId:"s",judgeIndex:1,modelRoute:model.route,rubricVersion:"v",anonymousSessionId:"BlindSession_ABCDEF12",packetHash:"h"},score:{id:"original-score",judgeRunId:"original",gestalt:2,verifiableFeatures:2,activityFunctionEvent:1,confabulationControl:1,narrative:JSON.parse(output)}}]);
 const original=await f.repo.listJudgeScores("s");f.state.ended=true;
 const first=await f.create();await f.run(first.id);const second=await f.create();await f.run(second.id);
 expect(f.chat).toHaveBeenCalledTimes(2);expect(first.id).not.toBe(second.id);
 const a=f.panels.get(first.id)!,b=f.panels.get(second.id)!;expect(a.status).toBe("Complete");expect(b.status).toBe("Complete");
 expect(a.scores.s[0].judgeRunId).not.toBe(b.scores.s[0].judgeRunId);
 expect(await f.repo.listJudgeScores("s")).toEqual(original);expect(await f.repo.getResearchExecutionTermination("r")).toBe(f.marker);
 await expect(judgeResearch({repository:f.repo,projectId:"r"})).rejects.toThrow(/ended/);
 expect(evaluationSessionResults(a)).toMatchObject([{anonymousSessionId:"BlindSession_ABCDEF12",judgeCount:1}]);
 expect(f.repo.getRvSession).toHaveBeenCalled();
});
it("uses a selected new Judge panel and never mixes its scores with the previous panel",async()=>{
 const f=evaluationFixture();f.repo.listProviderModels=async()=>[model,{...model,modelId:"other",route:"other:m",displayName:"Other"}];
 const a=await f.create();await f.run(a.id);const before=structuredClone(f.panels.get(a.id));
 const b=await f.create([{providerConfigId:"pc",modelId:"other"}]);await f.run(b.id);
 expect(f.panels.get(b.id)?.scores.s[0].modelRoute).toBe("other:m");expect(f.panels.get(a.id)).toEqual(before);expect(f.chat).toHaveBeenCalledTimes(2);
});
it("a panel with duplicate model routes keeps Judge indexes separate, including a missing first score",async()=>{
 const f=evaluationFixture();const p=await f.create([{providerConfigId:"pc",modelId:"m"},{providerConfigId:"pc",modelId:"m"}]);
 f.chat.mockResolvedValueOnce({content:JSON.stringify({...JSON.parse(output),strongestMatches:null}),finishReason:"stop",usage:{}});
 await f.run(p.id);expect(f.panels.get(p.id)?.status).toBe("Incomplete");expect(f.panels.get(p.id)?.scores.s.map(s=>s.judgeIndex)).toEqual([2]);
 const existing=structuredClone(f.panels.get(p.id)?.scores.s[0]);await f.run(p.id);expect(f.chat).toHaveBeenCalledTimes(2);
 await f.run(p.id,{completeMissing:true});expect(f.chat).toHaveBeenCalledTimes(3);expect(f.panels.get(p.id)?.status).toBe("Complete");expect(f.panels.get(p.id)?.scores.s[1]).toEqual(existing);
});
it("transport allowances are panel-local and survive restart without automatic renewal",async()=>{
 const f=evaluationFixture(),p=await f.create();f.chat.mockRejectedValue(lost());await f.run(p.id);expect(f.chat).toHaveBeenCalledTimes(2);
 Object.defineProperty(f.repo,"recoveryOwner",{value:{},configurable:true});await f.run(p.id);expect(f.chat).toHaveBeenCalledTimes(2);
 await f.run(p.id,{completeMissing:true});expect(f.chat).toHaveBeenCalledTimes(4);
 const q=await f.create();await f.run(q.id);expect(f.chat).toHaveBeenCalledTimes(6);
 expect(f.panels.get(p.id)?.events.filter(e=>e.eventType==="RESEARCH_JUDGE_COMPLETION_AUTH_V1")).toHaveLength(1);
});
it("STOP after an accepted score preserves it and resume evaluates only the missing slot",async()=>{
 const f=evaluationFixture(),p=await f.create([{providerConfigId:"pc",modelId:"m"},{providerConfigId:"pc",modelId:"m"}]),stop=new AbortController();
 f.chat.mockImplementationOnce(async()=>{stop.abort();return{content:output,finishReason:"stop",usage:{}};});
 await expect(f.run(p.id,{signal:stop.signal})).rejects.toThrow();expect(f.panels.get(p.id)?.scores.s).toHaveLength(1);expect(f.chat).toHaveBeenCalledTimes(1);
 await f.run(p.id);expect(f.chat).toHaveBeenCalledTimes(2);expect(f.panels.get(p.id)?.status).toBe("Complete");
});
it("a failed receipt save stops without any outer-handler writes; RAM recovery does not repurchase the response",async()=>{
 const f=evaluationFixture(),p=await f.create(),save=f.repo.saveResearchEvaluation.bind(f.repo);let broken=true,failedRevision=0;
 f.repo.saveResearchEvaluation=vi.fn(async(record,expected)=>{if(broken && record.events.at(-1)?.metadata?.status==="received"){failedRevision=record.revision;throw new Error("disk full");}return save(record,expected);});
 await expect(f.run(p.id)).rejects.toBeInstanceOf(ResearchJudgeCheckpointError);expect(f.chat).toHaveBeenCalledTimes(1);
 expect(f.panels.get(p.id)?.revision).toBe(failedRevision-1);broken=false;await f.run(p.id);expect(f.chat).toHaveBeenCalledTimes(1);expect(f.panels.get(p.id)?.status).toBe("Complete");
});
it("changed source or frozen provider identity prevents every paid request",async()=>{
 for(const change of ["source","provider"]){const f=evaluationFixture(),p=await f.create();if(change==="source")f.state.changed=true;else f.repo.listProviderConfigs=async()=>[{...provider,baseUrl:"https://changed.test"}];await expect(f.run(p.id)).rejects.toThrow(/changed/);expect(f.chat).not.toHaveBeenCalled();}
});
it("an ambiguous committed panel checkpoint is inspected instead of overwritten or repurchased",async()=>{
 const f=evaluationFixture(),p=await f.create(),save=f.repo.saveResearchEvaluation.bind(f.repo);let ambiguous=true;
 f.repo.saveResearchEvaluation=async(record,expected)=>{await save(record,expected);if(ambiguous && record.events.at(-1)?.metadata?.status==="received"){ambiguous=false;throw new Error("ack lost");}};
 await f.run(p.id);expect(f.chat).toHaveBeenCalledTimes(1);expect(f.panels.get(p.id)?.events.filter(e=>e.metadata?.status==="received")).toHaveLength(1);
});
it("revision conflicts, design changes, rewritten journal and overwritten frozen scores are refused",async()=>{
 const f=evaluationFixture(),p=await f.create();await f.run(p.id);const saved=f.panels.get(p.id)!;
 expect(()=>assertEvaluationUpdate(saved,{...saved,revision:saved.revision+1},saved.revision)).toThrow(/immutable/);
 const partial={...saved,status:"Incomplete" as const};
 for(const patch of [{judges:[]},{events:[]},{scores:{}}])expect(()=>assertEvaluationUpdate(partial,{...partial,...patch,revision:partial.revision+1},partial.revision)).toThrow();
 expect(()=>evaluationSessionResults(partial)).toThrow(/every score/);
});
it("JSON round trips and native object key order do not break append-only panel checkpoints",async()=>{
 const f=evaluationFixture(),p=await f.create(),read=f.repo.getResearchEvaluation.bind(f.repo);
 const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):v && typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,sorted(value)])):v;
 f.repo.getResearchEvaluation=async(project,id)=>JSON.parse(JSON.stringify(sorted(await read(project,id))));
 await f.run(p.id);expect(f.panels.get(p.id)?.status).toBe("Complete");expect(f.chat).toHaveBeenCalledTimes(1);
});
it("48 preserved sessions are fully evaluated in independent panels; one missing score is completed without regenerating RV",async()=>{
 const f=evaluationFixture();f.state.ended=true;f.project.config.judges.push({providerConfigId:"pc",modelId:"m"});
 f.repo.listResearchAssignments=async()=>Array.from({length:48},(_,i)=>({id:`a${i}`,researchProjectId:"r",sessionId:`s${i}`,targetId:"t",anonymousSessionId:`BlindSession_${String(i).padStart(8,"0")}`,executionOrder:i,judgeOrder:i,status:"SessionComplete"}));
 const a=await f.create();f.chat.mockImplementation(async()=>({content:f.chat.mock.calls.length===9?JSON.stringify({...JSON.parse(output),strongestMatches:null}):output,finishReason:"stop",usage:{}}));
 await f.run(a.id);expect(f.chat).toHaveBeenCalledTimes(96);expect(Object.values(f.panels.get(a.id)!.scores).flat()).toHaveLength(95);expect(f.panels.get(a.id)?.status).toBe("Incomplete");
 await f.run(a.id,{completeMissing:true});expect(f.chat).toHaveBeenCalledTimes(97);const completed=structuredClone(f.panels.get(a.id));expect(completed?.status).toBe("Complete");
 const b=await f.create();await f.run(b.id);expect(f.chat).toHaveBeenCalledTimes(193);expect(Object.values(f.panels.get(b.id)!.scores).flat()).toHaveLength(96);expect(f.panels.get(a.id)).toEqual(completed);
 expect(f.repo.setResearchProjectState).not.toHaveBeenCalled();expect(await f.repo.getResearchExecutionTermination("r")).toBe(f.marker);
},60_000);
