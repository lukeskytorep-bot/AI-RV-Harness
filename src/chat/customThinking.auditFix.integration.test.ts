// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {BrowserRepository} from "../storage/browserRepository";
import {normalizeModelDiscovery} from "../providers/capabilities";
import {sendChatTurn} from "./engine";
import {clearAllConversationContinuationMemoryForTests, ConversationContinuationBreakError} from "./continuationMemory";

const config = {id:"custom-audit",provider:"custom_openai" as const,label:"Custom",credentialId:"cred",baseUrl:"https://example.test/v1",customCompatibilityProfile:"llama_cpp" as const,enabled:true,createdAt:"t",updatedAt:"t"};
const model = normalizeModelDiscovery(config,{models:[{name:"gemma"}]})[0];
const endpoint = "https://example.test/v1";
afterEach(()=>{localStorage.clear();clearAllConversationContinuationMemoryForTests();});

it("Custom Generic conversation does not resolve a native endpoint", async()=>{
  const repository=new BrowserRepository();
  const thread=await repository.createChatThread("w","conversation","Generic");
  const endpointSpy=vi.fn(async()=>{throw new Error("Unexpected native endpoint lookup");});
  await sendChatTurn({repository,threadId:thread.id,mode:"conversation",language:"en",providerConfig:{...config,customCompatibilityProfile:"generic"},model,content:"Hello",resolveBindingEndpoint:endpointSpy,chat:async()=>({content:"Hi",usage:{}})});
  expect(endpointSpy).not.toHaveBeenCalled();
});

it("captures only native reasoning_content, reopens, then requires text-only consent for Off", async()=>{
  let repository=new BrowserRepository();
  const thread=await repository.createChatThread("w","conversation","Custom");
  const input={threadId:thread.id,mode:"conversation" as const,language:"en" as const,providerConfig:config,model,resolveBindingEndpoint:async()=>endpoint};
  await sendChatTurn({...input,repository,content:"First",requestedSettings:{customReasoningMode:"on" as const,customCompatibilityProfile:"llama_cpp" as const},chat:async()=>({content:"Visible",reasoningContent:"Hidden",reasoningSource:"openai_reasoning_content",usage:{}})});
  expect((await repository.listChatMessageProviderStates(thread.id))).toHaveLength(1);
  clearAllConversationContinuationMemoryForTests();
  repository=new BrowserRepository();
  const request=vi.fn(async (_request: Parameters<NonNullable<Parameters<typeof sendChatTurn>[0]["chat"]>>[0])=>({content:"Next",usage:{}}));
  await expect(sendChatTurn({...input,repository,content:"Second",requestedSettings:{customReasoningMode:"off" as const,customCompatibilityProfile:"llama_cpp" as const},chat:request})).rejects.toBeInstanceOf(ConversationContinuationBreakError);
  expect(request).not.toHaveBeenCalled();
  await sendChatTurn({...input,repository,content:"Second",requestedSettings:{customReasoningMode:"off" as const,customCompatibilityProfile:"llama_cpp" as const},allowTextOnlyContinuation:true,chat:request});
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0].messages.every((message:{continuationState?:unknown})=>!message.continuationState)).toBe(true);
  expect(await repository.listChatMessageProviderStates(thread.id)).toHaveLength(0);
});

it("never stores thinking extracted from tagged content",async()=>{
  const repository=new BrowserRepository();const thread=await repository.createChatThread("w","conversation","Tagged");
  await sendChatTurn({repository,threadId:thread.id,mode:"conversation",language:"en",providerConfig:config,model,content:"First",requestedSettings:{customReasoningMode:"on",customCompatibilityProfile:"llama_cpp"},resolveBindingEndpoint:async()=>endpoint,chat:async()=>({content:"Visible",reasoningContent:"Tagged",reasoningSource:"tagged_content",usage:{}})});
  expect(await repository.listChatMessageProviderStates(thread.id)).toHaveLength(0);
});

for (const savedProfile of ["generic", undefined] as const) {
  it(`requires text-only confirmation for persisted ${savedProfile ?? "missing"} profile even when live connection is llama_cpp`, async()=>{
    let repository=new BrowserRepository();
    const thread=await repository.createChatThread("w","conversation","Frozen profile");
    const input={threadId:thread.id,mode:"conversation" as const,language:"en" as const,providerConfig:config,model,resolveBindingEndpoint:async()=>endpoint};
    await sendChatTurn({...input,repository,content:"First",requestedSettings:{customReasoningMode:"on",customCompatibilityProfile:"llama_cpp"},chat:async()=>({content:"Visible",reasoningContent:"Native secret",reasoningSource:"openai_reasoning_content",usage:{}})});
    expect(await repository.listChatMessageProviderStates(thread.id)).toHaveLength(1);
    clearAllConversationContinuationMemoryForTests();
    repository=new BrowserRepository();
    const request=vi.fn(async (_request: Parameters<NonNullable<Parameters<typeof sendChatTurn>[0]["chat"]>>[0])=>({content:"Next",usage:{}}));
    const requestedSettings={customReasoningMode:"on" as const,...(savedProfile===undefined?{}:{customCompatibilityProfile:savedProfile})};
    await expect(sendChatTurn({...input,repository,content:"Second",requestedSettings,chat:request})).rejects.toBeInstanceOf(ConversationContinuationBreakError);
    expect(request).not.toHaveBeenCalled();
    await sendChatTurn({...input,repository,content:"Second",requestedSettings,allowTextOnlyContinuation:true,chat:request});
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].messages.every((message:{continuationState?:unknown})=>!message.continuationState)).toBe(true);
    expect(await repository.listChatMessageProviderStates(thread.id)).toHaveLength(0);
  });
}

it("restores native thinking with a saved llama_cpp profile even when the live connection profile changed",async()=>{
  let repository=new BrowserRepository();
  const thread=await repository.createChatThread("w","conversation","Frozen llama profile");
  const input={threadId:thread.id,mode:"conversation" as const,language:"en" as const,providerConfig:config,model,resolveBindingEndpoint:async()=>endpoint,requestedSettings:{customReasoningMode:"on" as const,customCompatibilityProfile:"llama_cpp" as const}};
  await sendChatTurn({...input,repository,content:"First",chat:async()=>({content:"Visible",reasoningContent:"Native secret",reasoningSource:"openai_reasoning_content",usage:{}})});
  expect(await repository.listChatMessageProviderStates(thread.id)).toHaveLength(1);
  clearAllConversationContinuationMemoryForTests();
  repository=new BrowserRepository();
  const request=vi.fn(async (_request: Parameters<NonNullable<Parameters<typeof sendChatTurn>[0]["chat"]>>[0])=>({content:"Next",usage:{}}));
  await sendChatTurn({...input,repository,providerConfig:{...config,customCompatibilityProfile:"generic"},content:"Second",chat:request});
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0].messages.some((message:{continuationState?:unknown})=>Boolean(message.continuationState))).toBe(true);
});

it("does not capture native thinking when the saved profile is Generic or missing", async()=>{
  for (const savedProfile of ["generic",undefined] as const) {
    const repository=new BrowserRepository();
    const thread=await repository.createChatThread("w","conversation","No capture");
    const requestedSettings={customReasoningMode:"on" as const,...(savedProfile===undefined?{}:{customCompatibilityProfile:savedProfile})};
    await sendChatTurn({repository,threadId:thread.id,mode:"conversation",language:"en",providerConfig:config,model,content:"First",requestedSettings,resolveBindingEndpoint:async()=>{throw new Error("Native endpoint lookup for a Generic route");},chat:async()=>({content:"Visible",reasoningContent:"Native secret",reasoningSource:"openai_reasoning_content",usage:{}})});
    expect(await repository.listChatMessageProviderStates(thread.id)).toHaveLength(0);
  }
});
