import {it,expect} from "vitest";
import {ollamaThinkingCapability} from "./ollamaThinking";
import {resolveGenerationSettings,normalizeModelDiscovery} from "./capabilities";
import {captureOllamaContinuationState,validateOllamaReplayForRequest} from "./ollamaContinuation";
import {prepareProviderContinuationState,restoreProviderContinuationState} from "../storage/providerContinuationState";
import {captureSessionContinuationRoute,captureSessionContinuationState} from "../sessions/providerContinuation";
const config={id:"cloud",provider:"ollama_cloud" as const,label:"Cloud",credentialId:"opaque",enabled:true,createdAt:"t",updatedAt:"t"};
const content=[{type:"thinking",thinking:[{type:"text",text:"private trace"}]},{type:"text",text:"Final"}];
const model=normalizeModelDiscovery(config,{models:[{name:"gpt-oss:120b"}]})[0];
it("model-specific levels, booleans and Auto map to native wire values without changing budgets or explicit sampler zeroes",()=>{
 for(const [name,effort,kind,value] of [["gpt-oss:120b","low","thinking_level","low"],["gpt-oss:20b","high","thinking_level","high"],["qwen3:235b","none","enabled_boolean","false"],["qwen3:235b","high","enabled_boolean","true"]] as const){
  const settings=resolveGenerationSettings({...model.capabilities,reasoning:ollamaThinkingCapability(name)},{reasoningEffort:effort,maxOutputTokens:49152,topK:0,topP:0,seed:0},{provider:"ollama_cloud"});
  expect(settings.reasoningResolution?.transport).toEqual({kind,value});expect(settings.effective).toMatchObject({maxOutputTokens:49152,topK:0,topP:0,seed:0});
 }
 expect(resolveGenerationSettings(model.capabilities,{maxOutputTokens:32768},{provider:"ollama_cloud"}).reasoningResolution).toBeUndefined();
 expect(ollamaThinkingCapability("unknown").efforts).toEqual([]);
 expect(ollamaThinkingCapability("unknown",{values:["low","high"]}).efforts).toEqual(["low","high"]);
 expect(ollamaThinkingCapability("unknown",{values:[false]}).supported).toBe(false);
 expect(normalizeModelDiscovery(config,{models:[{name:"gpt-oss:120b",thinking:{values:[false]}}]})[0].capabilities.reasoning.supported).toBe(false);
});
it("durable state round trip preserves trace and denies changed provider, credential, model or endpoint",async()=>{
 const captured=captureOllamaContinuationState({config,requestedModelId:model.modelId,normalizedEndpoint:"https://ollama.com",content,visibleContent:"Final"});
 expect(captured.state).toBeTruthy();if(!captured.state)throw Error("capture failed");
 const row=await prepareProviderContinuationState(captured.state);
 const restored=await restoreProviderContinuationState({ownerId:"message",format:row.format,formatVersion:row.formatVersion,transport:row.transport,replayFingerprintJson:row.replayFingerprintJson,payloadJson:row.payloadJson,payloadSha256:row.payloadSha256,payloadSizeBytes:row.payloadSizeBytes,createdAt:"t"});
 expect(restored.state).toEqual(captured.state);
 const input={state:restored.state,config,requestedModelId:model.modelId,normalizedEndpoint:"https://ollama.com"};
 expect(validateOllamaReplayForRequest(input).ok).toBe(true);
 for(const change of [{requestedModelId:"other"},{normalizedEndpoint:"https://other.test"},{config:{...config,credentialId:"rotated"}},{config:{...config,provider:"custom_openai" as const}}])expect(validateOllamaReplayForRequest({...input,...change}).ok).toBe(false);
 await expect(restoreProviderContinuationState({...row,ownerId:"message",createdAt:"t",payloadJson:row.payloadJson+" "})).rejects.toThrow();
});
it("frozen session capture retains thinking bound to the exact assistant text; plain and legacy results stay text-only",()=>{
 const route=captureSessionContinuationRoute(config,model)!;
 expect(route.transport).toBe("ollama-cloud");
 expect(captureSessionContinuationState({providerConfig:config,model,route,response:{content:"Final",reasoningDetails:content,usage:{}}}).state).toBeTruthy();
 expect(captureSessionContinuationState({providerConfig:config,model,route,response:{content:"mutated",reasoningDetails:content,usage:{}}}).issue).toBeTruthy();
 expect(captureSessionContinuationState({providerConfig:config,model,response:{content:"Final",reasoningDetails:content,usage:{}}})).toEqual({});
 expect(captureSessionContinuationState({providerConfig:config,model,route,response:{content:"Final",usage:{}}})).toEqual({});
});
