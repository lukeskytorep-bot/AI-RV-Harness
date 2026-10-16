import {beforeEach,it,expect,vi} from "vitest";
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:bridge.invoke,Channel:class {onmessage?:unknown;}}));
vi.mock("../storage",()=>({isTauriRuntime:()=>true}));
vi.mock("./debug",()=>({recordProviderDebug:vi.fn(),detailedProviderDiagnosticsEnabled:()=>false}));
import {executeProviderChat,ProviderExecutionError} from "./requestExecutor";
import {classifyProviderAttempts} from "./responseEvidence";
const evidence={version:1,transportOutcome:"response_finished",boundary:"sse_done",finishReason:"stop",providerRequestId:"header-id",generationId:"gen-id",usage:{reasoningTokens:100,totalTokens:101}};
const request={config:{id:"pc",provider:"custom_openai" as const,label:"Fixture",credentialId:"opaque",baseUrl:"https://fixture.invalid/v1",enabled:true,createdAt:"t",updatedAt:"t"},modelId:"m",messages:[{role:"user" as const,content:"Fixture"}],settings:{requested:{},effective:{},omitted:[]},configuredRetries:0};
beforeEach(()=>{bridge.invoke.mockReset();});
for(const serialization of ["object","json"] as const)it(`${serialization}: native rejection survives IPC normalization into executor metadata without accepting reasoning`,async()=>{
 const failure={code:"unknown",message:"provider returned reasoning without a final assistant response [finish-reason=stop]",phase:"validating_response",responseEvidence:{...evidence,reasoning:"PRIVATE"}};bridge.invoke.mockRejectedValueOnce(serialization==="json"?JSON.stringify(failure):failure);
 let caught:unknown;try{await executeProviderChat(request);}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(ProviderExecutionError);const error=caught as ProviderExecutionError;
 const transportRequestId=bridge.invoke.mock.calls[0][1].request.requestId;expect(transportRequestId).toEqual(expect.any(String));expect(error.causeError.details.transportRequestId).toBe(transportRequestId);expect(error.causeError.details.responseEvidence).toEqual(evidence);
 expect(error.report.attemptOutcomes![0]).toMatchObject({transportRequestId,outcome:"response_finished",validation:"rejected",responseEvidence:evidence});expect(classifyProviderAttempts(error.report.attemptOutcomes!)).toBe("response_finished");expect(JSON.stringify(error.report)).not.toContain("PRIVATE");expect(bridge.invoke).toHaveBeenCalledTimes(1);
});
it("native successful reasoning+final content retains the same completion marker",async()=>{
 bridge.invoke.mockResolvedValueOnce({content:"Actual final response",reasoning_content:"Private reasoning",finish_reason:"stop",usage:{total_tokens:101},response_evidence:evidence});const result=await executeProviderChat(request);expect(result.content).toBe("Actual final response");expect(result.responseEvidence).toEqual(evidence);expect(result.execution?.attemptOutcomes?.[0]).toMatchObject({outcome:"response_finished",validation:"accepted"});expect(result.execution?.attemptOutcomes?.[0].responseEvidence?.usage?.costUsd).toBeUndefined();
});
it("old native errors without transport proof remain unknown",async()=>{
 bridge.invoke.mockRejectedValueOnce({code:"unknown",phase:"validating_response",message:"reasoning only [finish-reason=stop]",providerRequestId:"id",semanticOutputStarted:true});await expect(executeProviderChat(request)).rejects.toMatchObject({report:{attemptOutcomes:[expect.objectContaining({outcome:"dispatch_unknown",validation:"not_evaluated"})]}});
});
it("T2 adapter carries final candidate on native success independently of private reasoning",async()=>{
 const content='{"notes":"Do not print <think> markers."}';const {sha256Text}=await import("../application/sha256");
 const candidate={content,contentSha256:await sha256Text(content),byteLength:new TextEncoder().encode(content).length,omittedForSize:false,envelopeRemoved:false,nativeValidation:"accepted"};
 bridge.invoke.mockResolvedValueOnce({content,final_candidate:candidate,reasoning_content:"PRIVATE",usage:{},response_evidence:evidence});
 const response=await executeProviderChat(request);expect(response.finalCandidate).toEqual(candidate);expect(response.content).toBe(content);expect(response.transportRequestId).toEqual(expect.any(String));expect(JSON.stringify(response.finalCandidate)).not.toContain("PRIVATE");
});
for(const shape of ["object","json"] as const)it(`T2 ${shape}: adapter preserves rejected final candidate alongside R1 evidence`,async()=>{
 const content='{"notes":"Literal <think>example</think>"}';const {sha256Text}=await import("../application/sha256");
 const candidate={content,contentSha256:await sha256Text(content),byteLength:new TextEncoder().encode(content).length,omittedForSize:false,envelopeRemoved:false,nativeValidation:"rejected"};
 const failure={code:"unknown",phase:"validating_response",message:"native continuation validation rejected",providerRequestId:"rejected-id",finalCandidate:candidate,responseEvidence:evidence};bridge.invoke.mockRejectedValueOnce(shape==="json"?JSON.stringify(failure):failure);
 await expect(executeProviderChat(request)).rejects.toMatchObject({causeError:{details:{finalCandidate:candidate,responseEvidence:evidence,providerRequestId:"rejected-id",transportRequestId:expect.any(String),attemptId:expect.any(String)}}});
});

it("T4 owned request sends the exact workflow token inherited by its signal", async () => {
 const { registerAbortOwnership, inheritAbortOwnership } = await import("../application/abortOwnership");
 const parent = new AbortController(), child = new AbortController();
 const binding = { profileId: "profile", owner: "owner", version: 9, entities: [{ kind: "rv" as const, id: "session" }] };
 registerAbortOwnership(parent.signal, async () => {}, () => binding); inheritAbortOwnership(child.signal, parent.signal);
 bridge.invoke.mockResolvedValueOnce({ content: "Final", usage: {}, response_evidence: evidence });
 await executeProviderChat({ ...request, signal: child.signal });
 expect(bridge.invoke.mock.calls[0][1].request.workflowOwnership).toEqual(binding);
});
for (const kind of ["ownership_lost", "database_error", "view_closed"] as const) it(`T4 ${kind}: native cancellation keeps the actual reason and completion proof`, async () => {
 const { WorkflowAbortError } = await import("../application/abortOwnership"); const stop = new AbortController();
 bridge.invoke.mockImplementation(async (command: string) => {
  if (command === "cancel_provider_request") return true;
  stop.abort(new WorkflowAbortError(kind, `Actual ${kind} reason`));
  throw { code: "cancelled", phase: "reading_body", message: "generic cancellation", responseEvidence: evidence };
 });
 const executing = executeProviderChat({ ...request, signal: stop.signal });
 let failure: any;
 try { await executing; } catch (cause) { failure = cause; }
 expect(failure?.name).toBe("AbortError"); expect(failure?.kind).toBe(kind); expect(failure?.message).toBe(`Actual ${kind} reason`);
 expect(failure?.providerAttemptOutcomes?.[0]?.outcome).toBe("response_finished");
 expect(bridge.invoke.mock.calls.some(([command]) => command === "cancel_provider_request")).toBe(true);
});
