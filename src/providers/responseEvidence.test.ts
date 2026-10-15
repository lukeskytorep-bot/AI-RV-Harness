import {it,expect,vi} from "vitest";
import {parseProviderResponseEvidence,classifyProviderAttempt,classifyProviderAttempts,type ProviderResponseEvidence} from "./responseEvidence";
import {normalizeProviderCallError,ProviderCallError} from "./providerError";
import {executeProviderRequest,ProviderExecutionError} from "./requestExecutor";
const finished:ProviderResponseEvidence={version:1,transportOutcome:"response_finished",boundary:"sse_done",finishReason:"stop",generationId:"gen-1",usage:{totalTokens:31}};
for(const boundary of ["body_read","sse_done"] as const)it(`${boundary}: structured and JSON IPC normalization retain only safe completion evidence`,()=>{
 const input={code:"unknown",message:"reasoning without final response",phase:"validating_response",responseEvidence:{...finished,boundary,reasoning:"PRIVATE",secret:"SECRET",usage:{totalTokens:31,costUsd:0,extra:"SECRET"}}};
 for(const value of [input,JSON.stringify(input),{details:input}]){
  const error=normalizeProviderCallError(value);expect(error.details.responseEvidence).toEqual({...finished,boundary,usage:{totalTokens:31,costUsd:0}});expect(JSON.stringify(error.details)).not.toMatch(/PRIVATE|SECRET/);expect(classifyProviderAttempt(error.details)).toBe("response_finished");
 }
});
for(const candidate of [undefined,null,{}, {...finished,version:2},{...finished,boundary:"validating_response"},{...finished,transportOutcome:"stop"}])it(`no invented completion proof ${JSON.stringify(candidate)}`,()=>{
 expect(parseProviderResponseEvidence(candidate)).toBeUndefined();expect(classifyProviderAttempt({phase:"validating_response",responseEvidence:candidate})).toBe("dispatch_unknown");
});
it("safe numeric evidence does not invent zero costs or copy malformed counters",()=>{
 expect(parseProviderResponseEvidence({...finished,usage:{totalTokens:-1,costUsd:NaN,inputTokens:2.5}})?.usage).toBeUndefined();expect(parseProviderResponseEvidence(finished)?.usage).toEqual({totalTokens:31});
});
for(const code of ["response_body_read","cancelled","invalid_provider_json","empty_assistant_response","unknown"] as const)it(`legacy ${code}/stop/request ID/semantic tokens is still unknown without transport proof`,()=>{
 const error=normalizeProviderCallError({code,message:"complete [finish-reason=stop]",phase:"validating_response",httpStatus:200,providerRequestId:"gen-id",semanticOutputStarted:true});expect(classifyProviderAttempt(error.details)).toBe("dispatch_unknown");
});
it("before-dispatch remains separate from a rejected completed response",()=>expect(classifyProviderAttempt({phase:"before_dispatch"})).toBe("not_dispatched"));
it("executor binds completed rejection to the physical attempt and preserves received usage",async()=>{
 const hook=vi.fn();let caught:unknown;
 try{await executeProviderRequest({operationId:"r1",configuredRetries:5,onAttemptFailure:hook,executeAttempt:async()=>{throw new ProviderCallError({code:"unknown",phase:"validating_response",message:"Rejected",responseEvidence:finished,transportRequestId:"transport-1"});}});}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(ProviderExecutionError);const error=caught as ProviderExecutionError;const outcome=error.report.attemptOutcomes![0];expect(outcome).toMatchObject({outcome:"response_finished",validation:"rejected",physicalAttempt:1,responseEvidence:finished,transportRequestId:"transport-1"});expect(outcome.attemptId).toBe(`${error.report.logicalRequestId}:1`);expect(error.causeError.details.attemptId).toBe(outcome.attemptId);expect(hook).toHaveBeenCalledTimes(1);
});
it("an earlier unknown physical attempt survives a later completed rejection",async()=>{
 let count=0,caught:unknown;try{await executeProviderRequest({operationId:"multi",configuredRetries:2,sleep:async()=>undefined,executeAttempt:async()=>{if(++count===1)throw new ProviderCallError({code:"response_body_read",message:"connection lost",phase:"reading_body"});throw new ProviderCallError({code:"unknown",message:"Rejected",phase:"validating_response",responseEvidence:finished});}});}catch(error){caught=error;}
 const report=(caught as ProviderExecutionError).report;expect(report.physicalAttempts).toBe(2);expect(report.attemptOutcomes!.map(a=>a.outcome)).toEqual(["dispatch_unknown","response_finished"]);expect(new Set(report.attemptOutcomes!.map(a=>a.attemptId)).size).toBe(2);expect(classifyProviderAttempts(report.attemptOutcomes!)).toBe("dispatch_unknown");
});
it("separate repair requests cannot overwrite an earlier unknown attempt",()=>{
 expect(classifyProviderAttempts([{attemptId:"first:1",logicalRequestId:"first",physicalAttempt:1,outcome:"dispatch_unknown",validation:"not_evaluated"},{attemptId:"repair:1",logicalRequestId:"repair",physicalAttempt:1,outcome:"response_finished",validation:"rejected",responseEvidence:finished}])).toBe("dispatch_unknown");expect(classifyProviderAttempts([])).toBe("dispatch_unknown");
});
it("successful response proof and adapter acceptance remain independent of persisted domain state",async()=>{
 const result=await executeProviderRequest({operationId:"ok",responseEvidence:value=>value.responseEvidence,executeAttempt:async()=>({content:"final",responseEvidence:finished})});expect(result.report.attemptOutcomes![0]).toMatchObject({outcome:"response_finished",validation:"accepted"});expect(result.report.attemptOutcomes![0]).not.toHaveProperty("persisted");
});
it("late valid response after Stop keeps completion evidence but is still rejected by cancellation policy",async()=>{
 const stop=new AbortController();const result=executeProviderRequest({operationId:"late",signal:stop.signal,rejectResponseAfterAbort:true,responseEvidence:value=>value.responseEvidence,executeAttempt:async()=>{stop.abort();return{responseEvidence:finished};}});await expect(result).rejects.toMatchObject({name:"AbortError",providerAttemptOutcomes:[expect.objectContaining({outcome:"response_finished",validation:"accepted"})]});
});
it("pre-dispatch hook failure never acquires response completion",async()=>{
 const attempt=vi.fn();let caught:unknown;try{await executeProviderRequest({operationId:"hook",configuredRetries:0,onAttemptStart:()=>{throw Error("save failed");},executeAttempt:attempt});}catch(error){caught=error;}expect(attempt).not.toHaveBeenCalled();expect((caught as ProviderExecutionError).report.attemptOutcomes![0]).toMatchObject({outcome:"not_dispatched",validation:"not_evaluated"});
});
