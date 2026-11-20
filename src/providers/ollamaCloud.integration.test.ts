import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, Channel: class { onmessage?: unknown; } }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
import { normalizeModelDiscovery, resolveGenerationSettings } from "./capabilities";
import { executeProviderChat } from "./requestExecutor";
import type { OperationKind } from "./operationResourceProfiles";
import { supportsAdditionalSamplingProvider } from "./openRouterSamplingSettings";
const config = { id: "cloud", provider: "ollama_cloud" as const, credentialId: "opaque-bound-key", label: "Cloud", enabled: true, createdAt: "t", updatedAt: "t" };
const models = () => normalizeModelDiscovery(config, { models: [{ name: "qwen3:235b", digest: "sha256:fixture" }] }, "t");
beforeEach(() => bridge.invoke.mockReset());
it("uses exact Cloud names and exposes no invented context, vision or effort control", () => {
  const model = models()[0];
  expect(model.modelId).toBe("qwen3:235b");
  expect(model.capabilities).toMatchObject({ supportsVision: false, supportsStreaming: true, reasoning: { supported: true, efforts: ["none","high"] } });
  expect(model.capabilities.contextTokens).toBeUndefined(); expect(model.capabilities.maxOutputTokens).toBeUndefined();
  expect(supportsAdditionalSamplingProvider("ollama_cloud")).toBe(true);
  expect(resolveGenerationSettings(model.capabilities, { reasoningEffort: "high", maxOutputTokens: 49152 }, { provider: "ollama_cloud" })).toMatchObject({ effective: { maxOutputTokens: 49152,reasoningEffort:"high" }, omitted: [] });
});
const operations: OperationKind[] = ["conversation", "manual_rv_viewer", "rv_session_viewer", "training_blind_viewer", "research_viewer", "live_monitor", "judge", "post_reveal_viewer", "post_reveal_monitor", "field_guide_update", "viewer_notes_reflection", "telepathic_exchange"];
it.each(operations)("%s passes the hosted identity, budget, sampling, thinking and native usage through the common executor", async operationKind => {
  bridge.invoke.mockResolvedValueOnce({ content: "Final", reasoning_content: "Thinking", reasoning_source: "ollama_thinking", finish_reason: "stop", actual_model: "qwen3:235b", usage: { input_tokens: 12, output_tokens: 30, native_metrics: { totalDurationNs: 1234567 } }, response_evidence: { version: 1, transportOutcome: "response_finished", boundary: "ndjson_done", finishReason: "stop", usage: { inputTokens: 12, outputTokens: 30 } } });
  const settings = resolveGenerationSettings(models()[0].capabilities, { maxOutputTokens: 32768, temperature: 0.4, topP: 0.8, topK: 40, seed: 7 }, { provider: "ollama_cloud" });
  const result = await executeProviderChat({ config, modelId: models()[0].modelId, messages: [{ role: "user", content: "Question" }], settings, operationKind, configuredRetries: 0 });
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  expect(bridge.invoke.mock.calls[0][1].request).toMatchObject({ provider: "ollama_cloud", providerConfigId: "cloud", credentialId: "opaque-bound-key", modelId: "qwen3:235b", maxOutputTokens: 32768, topP: 0.8, topK: 40, seed: 7 });
  expect(result).toMatchObject({ content: "Final", reasoningContent: "Thinking", usage: { inputTokens: 12, outputTokens: 30, nativeMetrics: { totalDurationNs: 1234567 } } });
  expect(result.execution?.attemptOutcomes?.[0]).toMatchObject({ outcome: "response_finished", validation: "accepted", responseEvidence: {boundary:"ndjson_done"} });
});
it("STOP before dispatch does not invoke the native command", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(executeProviderChat({ config, modelId: "qwen3:235b", messages: [{ role: "user", content: "Q" }], settings: { requested: {}, effective: {}, omitted: [] }, signal: controller.signal, configuredRetries: 0 })).rejects.toThrow();
  expect(bridge.invoke).not.toHaveBeenCalled();
});
it("Cloud IPC streaming preserves every internal delta and final metadata despite a failing preview",async()=>{
 const internal=vi.fn(),preview=vi.fn(()=>{throw new Error("preview failed");});
 bridge.invoke.mockImplementationOnce(async(_command,args)=>{
  expect(args.emitStreamEvents).toBe(true);
  args.onStream.onmessage({event:"started",data:{providerRequestId:"stream-native"}});
  for(let i=0;i<103;i++)args.onStream.onmessage({event:"contentDelta",data:{content:"x"}});
  args.onStream.onmessage({event:"finished",data:{finishReason:"stop"}});
  return {content:"x".repeat(103),reasoning_content:"private",finish_reason:"stop",actual_model:"qwen3:235b",usage:{output_tokens:103},response_evidence:{version:1,transportOutcome:"response_finished",boundary:"ndjson_done",finishReason:"stop"}};
 });
 const result=await executeProviderChat({config,modelId:"qwen3:235b",messages:[{role:"user",content:"Q"}],settings:resolveGenerationSettings(models()[0].capabilities,{maxOutputTokens:32768},{provider:"ollama_cloud"}),operationKind:"rv_session_viewer",configuredRetries:0,internalOnStreamEvent:internal,onStreamEvent:preview});
 expect(internal.mock.calls.filter(([event])=>event.event==="contentDelta")).toHaveLength(103);
 expect(result.content).toBe("x".repeat(103));expect(result.reasoningContent).toBe("private");expect(result.usage.outputTokens).toBe(103);
 expect(result.execution?.attemptOutcomes?.[0]).toMatchObject({outcome:"response_finished",validation:"accepted",responseEvidence:{boundary:"ndjson_done"}});
});
it.each(["none","high"] as const)("native IPC carries exact Qwen think selection %s and preserves replay details",async effort=>{
 const details=[{type:"thinking",thinking:[{type:"text",text:"private"}]},{type:"text",text:"Final"}];
 bridge.invoke.mockResolvedValueOnce({content:"Final",reasoning_content:"private",reasoning_details:details,finish_reason:"stop",actual_model:"qwen3:235b",usage:{}});
 const settings=resolveGenerationSettings(models()[0].capabilities,{reasoningEffort:effort,maxOutputTokens:32768,seed:0,topK:0},{provider:"ollama_cloud"});
 const result=await executeProviderChat({config,modelId:"qwen3:235b",messages:[{role:"user",content:"Q"}],settings,configuredRetries:0});
 expect(bridge.invoke.mock.calls[0][1].request).toMatchObject({reasoningTransportKind:"enabled_boolean",reasoningTransportValue:effort==="none"?"false":"true",maxOutputTokens:32768,topK:0,seed:0});
 expect(result.reasoningDetails).toEqual(details);expect(result.content).toBe("Final");
});
