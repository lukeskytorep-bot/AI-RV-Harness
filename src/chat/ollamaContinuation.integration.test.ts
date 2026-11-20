// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {BrowserRepository} from "../storage/browserRepository";
import {sendChatTurn} from "./engine";
import {clearAllConversationContinuationMemoryForTests} from "./continuationMemory";
import {normalizeModelDiscovery} from "../providers/capabilities";
const config={id:"cloud",provider:"ollama_cloud" as const,label:"Cloud",credentialId:"opaque",enabled:true,createdAt:"t",updatedAt:"t"};
const model=normalizeModelDiscovery(config,{models:[{name:"gpt-oss:120b"}]})[0];
const reasoningDetails=[{type:"thinking",thinking:[{type:"text",text:"private trace"}]},{type:"text",text:"Final"}];
afterEach(()=>{localStorage.clear();clearAllConversationContinuationMemoryForTests();});
it("reopens a Conversation with the same trace bound to its assistant message and requested thinking level",async()=>{
 localStorage.clear();let repository=new BrowserRepository();const thread=await repository.createChatThread("w","conversation","Cloud");
 const input={repository,threadId:thread.id,providerConfig:config,model,mode:"conversation" as const,language:"en" as const,requestedSettings:{reasoningEffort:"low" as const,maxOutputTokens:32768},resolveBindingEndpoint:async()=>"https://ollama.com"};
 const first=await sendChatTurn({...input,content:"First",chat:async request=>{expect(request.settings.reasoningResolution?.transport).toEqual({kind:"thinking_level",value:"low"});return {content:"Final",reasoningDetails,reasoningContent:"private trace",finishReason:"stop",usage:{}};}});
 expect((await repository.listChatMessageProviderStates(thread.id))[0].ownerId).toBe(first.assistant.id);
 clearAllConversationContinuationMemoryForTests();repository=new BrowserRepository();
 const second=vi.fn(async(request:Parameters<NonNullable<Parameters<typeof sendChatTurn>[0]["chat"]>>[0])=>{
  const previous=request.messages.find(m=>m.role==="assistant")!;
  expect(previous.content).toBe("Final");expect(previous.continuationState).toMatchObject({transport:"ollama-cloud",content:reasoningDetails});
  expect(request.messages.filter(m=>m.role!=="assistant").every(m=>!m.continuationState)).toBe(true);
  return {content:"Next",finishReason:"stop",usage:{}};
 });
 await sendChatTurn({...input,repository,content:"Second",chat:second});expect(second).toHaveBeenCalledTimes(1);
 const stop=new AbortController();stop.abort();
 await expect(sendChatTurn({...input,repository,content:"Stopped",signal:stop.signal,chat:second})).rejects.toMatchObject({name:"AbortError"});expect(second).toHaveBeenCalledTimes(1);
 expect((await repository.listChatMessages(thread.id)).map(m=>m.content)).toEqual(["First","Final","Second","Next"]);
});
