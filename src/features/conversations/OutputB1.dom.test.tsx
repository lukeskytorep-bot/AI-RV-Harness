// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, afterEach } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { BrowserRepository } from "../../storage/browserRepository";
import { createDefaultSettings, applyStoredOutputSettings } from "../../startupDefaults";
import { getCopy } from "../../i18n";
import { savePendingChatTurn } from "../../chat/pendingTurn";
import type { EligibleViewerIdentity } from "../../aiCenter/viewerIdentitySelection";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { ProviderChatAttempt } from "../../providers/requestExecutor";
import type { ChatMode, Profile, Workspace } from "../../types";

const mock=vi.hoisted(()=>({chat:vi.fn(),eligible:[] as EligibleViewerIdentity[]}));
vi.mock("../../providers/native",async original=>({...await original<typeof import("../../providers/native")>(),providerChatAttempt:mock.chat}));
vi.mock("../../aiCenter/viewerIdentitySelection",async original=>({...await original<typeof import("../../aiCenter/viewerIdentitySelection")>(),inspectViewerIdentities:async()=>({identities:mock.eligible,issues:[]}),requireWorkspaceViewerRoute:async()=>mock.eligible[0].identity}));
vi.mock("../../aiCenter/fieldGuide",async original=>({...await original<typeof import("../../aiCenter/fieldGuide")>(),prepareFieldGuideForSession:async()=>({}),viewerSystemPromptSnapshotFromFieldGuide:async()=>({content:"FIXED MANUAL VIEWER PROMPT"})}));

const provider:ProviderConfig={id:"p",provider:"custom_openai",label:"Fixture",baseUrl:"https://example.test/v1",credentialId:"c",enabled:true,createdAt:"t",updatedAt:"t"};
const model:ProviderModel={providerConfigId:"p",provider:"custom_openai",modelId:"m",route:"m",displayName:"M",recommended:false,rawMetadata:{},pricing:{},refreshedAt:"t",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:false,confidence:"unknown"},supportedParameters:["max_tokens"],maxOutputTokens:65536,contextTokens:131072,source:"provider",capturedAt:"t"}};
const profile:Profile={id:"profile",name:"P",defaultViewerModelId:"m",createdAt:"t",updatedAt:"t"};
const workspace:Workspace={id:"w",profileId:"profile",name:"W",kind:"conversation",createdAt:"t",updatedAt:"t",lastOpenedAt:"t"};
afterEach(()=>{vi.restoreAllMocks();mock.chat.mockReset();localStorage.clear();});

for(const scenario of ["fresh-conversation","saved-conversation","old-conversation-upgrade","manual-send","manual-retry","manual-low-ceiling"] as const) {
 it(`B1 real ChatPanel + engine + Browser persistence: ${scenario}`,async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear();mock.chat.mockReset();
  const mode:ChatMode=scenario.startsWith("manual")?"manual_rv":"conversation";
  const selected=scenario==="manual-low-ceiling"?{...model,capabilities:{...model.capabilities,maxOutputTokens:8192}}:model;
  mock.eligible=[{identity:{id:"i",profileId:"profile",credentialFingerprint:"custom_openai:c",credentialDisplay:"c",providerConfigId:"p",provider:"custom_openai",modelId:"m",modelRoute:"m",modelDisplayName:"M",role:"viewer",routeStatus:"available",firstUsedAt:"t",lastUsedAt:"t",createdAt:"t",updatedAt:"t"},providerConfig:provider,model:selected,trained:false}];
  localStorage.setItem("rvh.dev.providers",JSON.stringify([provider]));
  localStorage.setItem("rvh.dev.models",JSON.stringify([selected]));
  const repository=new BrowserRepository();
  const settings=scenario==="saved-conversation"?applyStoredOutputSettings(createDefaultSettings(),{conversationMaxOutputTokens:8192,rvSessionMaxOutputTokens:8192,conversationOutputBudgetVersion:1}):scenario==="old-conversation-upgrade"?applyStoredOutputSettings(createDefaultSettings(),{conversationMaxOutputTokens:8192,rvSessionMaxOutputTokens:8192}):applyStoredOutputSettings(createDefaultSettings(),{});
  const thread=await repository.createChatThread("w",mode,"Fixture");
  if(scenario==="manual-retry"){
   await repository.appendChatMessage(thread.id,"user","Reveal: target is a tower");
   savePendingChatTurn({threadId:thread.id,mode,language:"en",providerConfigId:"p",modelId:"m",modelRoute:"m",aiIdentityId:"i",content:"Reveal: target is a tower",requestedSettings:{maxOutputTokens:8192},rvSystemPrompt:"FROZEN RETRY PROMPT",sourceIds:[],images:[],imageNames:[],createdAt:"old"});
  }
  const seen:Array<{requested:number|undefined;effective:number|undefined}>=[];
  mock.chat.mockImplementation(async(request:Parameters<ProviderChatAttempt>[0])=>{
   seen.push({requested:request.settings.requested.maxOutputTokens,effective:request.settings.effective.maxOutputTokens});
   return {content:seen.length===1&&scenario.startsWith("manual")?"partial":"complete",finishReason:seen.length===1&&scenario.startsWith("manual")?"length":"stop",usage:{}};
  });
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const button=(text:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes(text));
  try {
   await act(async()=>{root.render(<ChatPanel copy={getCopy("en")} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode={mode}/>);});
   if(scenario==="manual-retry") {
    expect(button("Resume")?.disabled).toBe(false);
    await act(async()=>{button("Resume")!.click();});
   } else {
    if(mode==="manual_rv") await act(async()=>{container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();});
    const input=container.querySelector<HTMLTextAreaElement>("textarea")!;expect(input.disabled).toBe(false);
    await act(async()=>{
     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Reveal: target is a tower");
     input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    expect(button(getCopy("en").send)?.disabled).toBe(false);
    await act(async()=>{button(getCopy("en").send)!.click();});
   }
   const budgets=(scenario==="fresh-conversation"||scenario==="old-conversation-upgrade")?[16384]:scenario==="saved-conversation"||scenario==="manual-low-ceiling"?[8192]:[32768,49152];
   expect(seen).toEqual(budgets.map(n=>({requested:n,effective:n})));
   const messages=await new BrowserRepository().listChatMessages(thread.id);
   expect(messages.filter(m=>m.role==="user")).toHaveLength(1);
   if(scenario==="manual-low-ceiling") {expect(messages.filter(m=>m.role==="assistant")).toHaveLength(0);expect(container.textContent).toContain("cannot provide a larger recovery budget");}
   else {expect(messages.at(-1)?.content).toBe("complete");expect(localStorage.getItem(`rvh.pending-chat-turn.${thread.id}`)).toBeNull();}
  } finally {await act(async()=>root.unmount());container.remove();}
 });
}
