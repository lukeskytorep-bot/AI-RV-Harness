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


for (const cacheCase of ["lost-cache", "cache-write-failure", "restored-store"] as const)
for (const [mode, language] of [["conversation", "en"], ["manual_rv", "en"], ["conversation", "pl"], ["manual_rv", "pl"]] as const) it(`S1 audit P1 durable End without cache: ${mode}/${language}/${cacheCase}`, async () => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  mock.eligible=[{identity:{id:"i",profileId:"profile",credentialFingerprint:"custom_openai:c",credentialDisplay:"c",providerConfigId:"p",provider:"custom_openai",modelId:"m",modelRoute:"m",modelDisplayName:"M",role:"viewer",routeStatus:"available",firstUsedAt:"t",lastUsedAt:"t",createdAt:"t",updatedAt:"t"},providerConfig:provider,model,trained:false}];
  localStorage.setItem("rvh.dev.providers",JSON.stringify([provider]));
  localStorage.setItem("rvh.dev.models",JSON.stringify([model]));
  let repository=new BrowserRepository(); const thread=await repository.createChatThread("w",mode,"Fixture");
  if (cacheCase === "cache-write-failure") {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key: string, value: string) {
      if (key.startsWith("rvh.pending-chat-turn.")) throw new Error("cache unavailable");
      return setItem.call(this, key, value);
    });
  }
  const settings={...createDefaultSettings(), interfaceLanguage:language};
  let finish!: () => void; let signal: AbortSignal | undefined;
  mock.chat.mockImplementation((request:Parameters<ProviderChatAttempt>[0]) => {
    signal=request.signal;
    return new Promise(resolve => {finish=()=>resolve({content:"LATE ANSWER",usage:{totalTokens:12},finishReason:"stop"});});
  });
  const container=document.createElement("div"); document.body.append(container); let root=createRoot(container);
  const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===label)!;
  const render=()=>root.render(<ChatPanel copy={getCopy(language)} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode={mode}/>);
  try {
    await act(async()=>{render();});
    expect(button("Stop").disabled).toBe(true);
    if(mode==="manual_rv") await act(async()=>{container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();});
    const textarea=container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"Target");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{button(getCopy(language).send).click();});
    expect(mock.chat).toHaveBeenCalledTimes(1); expect(signal?.aborted).toBe(false);
    await act(async()=>{button("Stop").click();});
    expect(signal?.aborted).toBe(true);
    expect(button(language==="pl"?"Zatrzymywanie…":"Stopping…").disabled).toBe(true);
    expect(button(language==="pl"?"Wznów":"Resume")).toBeUndefined();
    await act(async()=>{finish();});
    expect(container.textContent).not.toContain("LATE ANSWER");
    const durableBefore = await repository.listChatMessages(thread.id);
    if (cacheCase === "restored-store") {
      const db = Object.keys(localStorage).filter(key => key.startsWith("rvh.dev.")).map(key => [key, localStorage.getItem(key)!]);
      localStorage.clear();
      for (const [key, value] of db) localStorage.setItem(key, value);
      repository = new BrowserRepository();
    } else { localStorage.removeItem(`rvh.pending-chat-turn.${thread.id}`); }
    await act(async()=>root.unmount());
    root=createRoot(container);
    await act(async()=>{render();});
    expect(await repository.listChatMessages(thread.id)).toEqual(durableBefore);
    expect(localStorage.getItem(`rvh.pending-chat-turn.${thread.id}`)).toBeNull();
    expect(button(language==="pl"?"Wznów":"Resume").disabled).toBe(true);
    expect(container.textContent).toContain(language === "pl" ? "brakuje danych" : "details needed for safe resume are unavailable");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    expect(button(language==="pl"?"Zakończ":"End").disabled).toBe(false);
    await act(async()=>{button(language==="pl"?"Zakończ":"End").click();});
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
    expect(button(language==="pl"?"Wznów":"Resume")).toBeUndefined();
    const persisted=await new BrowserRepository().listChatMessages(thread.id);
    expect(persisted.map(m=>m.role)).toEqual(["user"]);
    expect(persisted[0].metadata?.responseRecovery?.state).toBe("ended");
    expect(mock.chat).toHaveBeenCalledTimes(1);
    await act(async()=>root.unmount());
    root=createRoot(container);
    await act(async()=>{render();});
    expect(button(language==="pl"?"Wznów":"Resume")).toBeUndefined();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
    if(mode==="manual_rv") await act(async()=>{container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();});
    const nextInput = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(nextInput,"New question");nextInput.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{button(getCopy(language).send).click();});
    await act(async()=>{finish();});
    const nextMessages = await repository.listChatMessages(thread.id);
    expect(nextMessages.map(message => message.role)).toEqual(["user", "user", "assistant"]);
    expect(nextMessages[0]).toEqual(persisted[0]);
    expect(nextMessages[1].content).toBe("New question");
    expect(mock.chat).toHaveBeenCalledTimes(2);
  } finally {await act(async()=>root.unmount());container.remove();}
});
