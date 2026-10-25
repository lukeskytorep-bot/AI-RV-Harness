// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPanel } from "../features/conversations/ChatPanel";
import { RvSessionPanel } from "../features/rvSessions/RvSessionPanel";
import { BrowserRepository } from "../storage/browserRepository";
import { getCopy } from "../i18n";
import { createDefaultSettings } from "../startupDefaults";
import { notifyProviderRoutesChanged } from "../providers/changes";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { Profile, Workspace } from "../types";
const runtime = vi.hoisted(() => ({ desktop: true }));
const fp = vi.hoisted(() => vi.fn(async (id: string) => `native-${id}`));
vi.mock("../providers/native", async original => ({ ...await original<object>(), credentialIdentityFingerprint: fp }));
vi.mock("../storage", async original => ({ ...await original<object>(), isTauriRuntime: () => runtime.desktop }));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); runtime.desktop = true; fp.mockReset().mockImplementation(async id => `native-${id}`); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function fixture(surface: "conversation" | "manual_rv" | "rv", language: "en" | "pl") {
 const repository = new BrowserRepository();
 vi.spyOn(repository,"getWorkflowOwnership").mockResolvedValue("idle");
 const created = await repository.createProfile({ name: "Viewer" });
 let profile: Profile = { ...created, credentialId: "key-one", defaultViewerModelId: "same" };
 let workspace = await repository.createWorkspace({ profileId: profile.id, name: "Work", kind: surface === "rv" ? "rv" : "conversation" });
 const configs: ProviderConfig[] = ["one","two"].map((id,index)=>({ id, credentialId:`key-${id}`, credentialFingerprint:`metadata-${id}`,provider:index ? "openrouter":"custom_openai",label:id,enabled:true,baseUrl:index?undefined:"https://custom.example/v1",createdAt:"t",updatedAt:"t",lastStatus:"ok" }));
 const models: ProviderModel[] = configs.map(config=>({providerConfigId:config.id,provider:config.provider,modelId:"same",route:`${config.id}:same`,displayName:"Same",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:true,confidence:"unknown"},supportedParameters:[],source:"provider",capturedAt:"t"},pricing:{},recommended:false,rawMetadata:{},refreshedAt:"t"}));
 const configRead = vi.spyOn(repository,"listProviderConfigs").mockImplementation(async()=>configs);
 vi.spyOn(repository,"listProviderModels").mockImplementation(async()=>models);
 const identities = await Promise.all(configs.map((config,index)=>repository.ensureAiIdentity({profileId:profile.id,credentialFingerprint:`native-${config.credentialId}`,credentialDisplay:"redacted",providerConfigId:config.id,provider:config.provider,baseUrl:config.baseUrl,modelId:"same",modelRoute:models[index].route,modelDisplayName:"Same",role:"viewer"})));
 const copy = getCopy(language); const settings = {...createDefaultSettings(),interfaceLanguage:language,defaultRevealSource:"external" as const};
 const render = async(nextProfile=profile,nextWorkspace:Workspace=workspace)=>{profile=nextProfile;workspace=nextWorkspace;await act(async()=>root.render(surface === "rv" ? <RvSessionPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository}/> : <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode={surface}/>));};
 const select = ()=>host.querySelector<HTMLSelectElement>(`select[aria-label="${copy.viewerRouteSelect}"]`)!;
 const wait = async(assert:()=>void)=>{await act(async()=>{await vi.waitFor(assert);});};
 const retry = async()=>{const b=[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===copy.viewerRouteRetry)!;expect(b).toBeTruthy();await act(async()=>b.click());};
 return {repository,profile,workspace,configs,models,identities,configRead,copy,render,select,wait,retry};
}
for(const surface of ["conversation","manual_rv","rv"] as const) for(const language of ["pl","en"] as const) {
 it(`${surface}/${language}: same model selects Profile connection, permits manual choice and switches without restart`,async()=>{
  const f=await fixture(surface,language);await f.render();await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
  if(surface!=="rv") expect(host.querySelector<HTMLTextAreaElement>(".composer textarea")?.disabled).toBe(false);
  else expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===f.copy.startSession)?.disabled).toBe(false);
  await act(async()=>{f.select().value=f.identities[1].id;f.select().dispatchEvent(new Event("change",{bubbles:true}));});expect(f.select().value).toBe(f.identities[1].id);
  await act(async()=>window.dispatchEvent(new Event("focus")));await f.wait(()=>expect(f.select().value).toBe(f.identities[1].id));
  await f.render({...f.profile,credentialId:"key-two"});await f.wait(()=>expect(f.select().value).toBe(f.identities[1].id));
  await f.render({...f.profile,credentialId:"key-one"});await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
 });
 it(`${surface}/${language}: native read failure is visible and retry restores route without identity writes`,async()=>{
  const f=await fixture(surface,language);fp.mockRejectedValue(new Error("private keychain detail"));const ensure=vi.spyOn(f.repository,"ensureAiIdentity");
  await f.render();await f.wait(()=>expect(host.textContent).toContain(f.copy.viewerRouteFingerprint));
  expect(host.textContent).not.toContain(f.copy.configureProviderFirst);expect(host.textContent).not.toContain("private keychain detail");
  fp.mockImplementation(async id=>`native-${id}`);await f.retry();await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));expect(ensure).not.toHaveBeenCalled();
 });
}
for(const surface of ["conversation","manual_rv","rv"] as const) {
 it(`${surface}: config change under same ID and key rebind revalidate, never migrate learning`,async()=>{
  const f=await fixture(surface,"en");await f.render();await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
  const before=await f.repository.listAiIdentities(f.profile.id);const ensure=vi.spyOn(f.repository,"ensureAiIdentity");
  f.configs[0]={...f.configs[0],baseUrl:"https://changed.example/v1"};
  await act(async()=>notifyProviderRoutesChanged());await f.wait(()=>expect(f.select().value).toBe(""));
  // A second allowed route remains selectable; no false missing-provider banner.
  expect(host.textContent).not.toContain(f.copy.configureProviderFirst);
  expect(host.textContent).toContain(f.copy.viewerRouteBinding);
  f.configs[0]={...f.configs[0],baseUrl:"https://custom.example/v1"};
  await act(async()=>window.dispatchEvent(new Event("focus")));await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
  fp.mockImplementation(async id=>id==="key-one"?"rebound-hmac":`native-${id}`);
  await act(async()=>notifyProviderRoutesChanged());await f.wait(()=>expect(f.select().value).toBe(""));
  expect(await f.repository.listAiIdentities(f.profile.id)).toEqual(before);expect(ensure).not.toHaveBeenCalled();
 });
 it(`${surface}: rejected load is visible and retry works`,async()=>{
  const f=await fixture(surface,"en");f.configRead.mockRejectedValueOnce(new Error("database down"));await f.render();await f.wait(()=>expect(host.textContent).toContain(f.copy.viewerRouteLoadFailed));
  await f.retry();await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
 });
 it(`${surface}: late load cannot populate another Profile or Workspace`,async()=>{
  const f=await fixture(surface,"en");let release!:(configs:ProviderConfig[])=>void;
  f.configRead.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await f.render();
  const profile=await f.repository.createProfile({name:"Other"});const workspace=await f.repository.createWorkspace({profileId:profile.id,name:"Other",kind:surface==="rv"?"rv":"conversation"});
  await f.render({...profile,credentialId:"key-two",defaultViewerModelId:"same"},workspace);await f.wait(()=>expect(host.textContent).toContain(f.copy.viewerRouteIdentity));
  await act(async()=>release(f.configs));expect(f.select().value).toBe("");expect(f.select().querySelectorAll("option")).toHaveLength(1);
 });
}

for(const surface of ["conversation","manual_rv","rv"] as const) {
 it(`${surface}: Browser reads its metadata identity without native IPC`,async()=>{
  runtime.desktop=false;const f=await fixture(surface,"en");
  f.configs.forEach(config=>{config.credentialFingerprint=`native-${config.credentialId}`;});
  await f.render();await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));expect(fp).not.toHaveBeenCalled();
 });
 it(`${surface}: a real missing connection asks to configure a provider`,async()=>{
  const f=await fixture(surface,"en");f.configRead.mockResolvedValue([]);await f.render();await f.wait(()=>expect(host.textContent).toContain(f.copy.configureProviderFirst));
  expect(f.select().disabled).toBe(true);expect(host.textContent).not.toContain(f.copy.viewerRouteFingerprint);
 });
 it(`${surface}: ambiguous same-model routes ask for Viewer selection`,async()=>{
  const f=await fixture(surface,"en");f.models.push({...f.models[0],route:"one:alias"});
  await f.repository.ensureAiIdentity({profileId:f.profile.id,providerConfigId:"one",provider:"custom_openai",baseUrl:f.configs[0].baseUrl,credentialFingerprint:"native-key-one",credentialDisplay:"redacted",modelId:"same",modelRoute:"one:alias",modelDisplayName:"Alias",role:"viewer"});
  await f.render();await f.wait(()=>expect(host.textContent).toContain(f.copy.viewerRouteAmbiguous));expect(f.select().value).toBe("");expect(f.select().disabled).toBe(false);
  expect(host.textContent).not.toContain(f.copy.configureProviderFirst);
 });
}

for(const surface of ["conversation","manual_rv","rv"] as const) it(`${surface}: missing cached model is distinguished from a missing provider`,async()=>{
 const f=await fixture(surface,"en");f.models.splice(0,1);await f.render();await f.wait(()=>expect(host.textContent).toContain(f.copy.viewerRouteModel));
 expect(host.textContent).not.toContain(f.copy.configureProviderFirst);expect(f.select().value).toBe("");
});

function rvReasoning() { return [...host.querySelectorAll<HTMLSelectElement>("select")].find(select=>[...select.options].some(option=>option.value==="high"))!; }
function rvTemperature() { return host.querySelector<HTMLInputElement>('input[type="number"][step="0.1"]')!; }
async function manualRvGeneration() {
 await act(async()=>{
  rvReasoning().value="high";rvReasoning().dispatchEvent(new Event("change",{bubbles:true}));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(rvTemperature(),"0.2");
  rvTemperature().dispatchEvent(new Event("input",{bubbles:true}));
 });
}
async function generationFixture() {
 const f=await fixture("rv","en");
 f.models[0].capabilities.reasoning={supported:true,efforts:["low","high"],confidence:"provider_metadata"};
 await f.render();await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));await manualRvGeneration();return f;
}
for(const refresh of ["focus","notification","visibility","retry"] as const) it(`RV unchanged route preserves manual reasoning and temperature after ${refresh}`,async()=>{
 const f=await generationFixture();
 if(refresh==="retry") {
  f.configRead.mockRejectedValueOnce(new Error("temporary read failure"));
  await act(async()=>notifyProviderRoutesChanged());await f.wait(()=>expect(host.textContent).toContain(f.copy.viewerRouteLoadFailed));await f.retry();
 } else await act(async()=>{
  if(refresh==="focus") window.dispatchEvent(new Event("focus"));
  if(refresh==="notification") notifyProviderRoutesChanged();
  if(refresh==="visibility") {vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");document.dispatchEvent(new Event("visibilitychange"));}
 });
 await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
 expect(rvReasoning().value).toBe("high");expect(rvTemperature().value).toBe("0.2");
});
it("RV preserves manual values while keeping Start blocked during deferred revalidation",async()=>{
 const f=await generationFixture();let release!:(configs:ProviderConfig[])=>void;
 f.configRead.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 await act(async()=>window.dispatchEvent(new Event("focus")));
 expect(f.select().value).toBe("");expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===f.copy.startSession)?.disabled).toBe(true);
 await act(async()=>release(f.configs));await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
 expect(rvReasoning().value).toBe("high");expect(rvTemperature().value).toBe("0.2");
});
it("RV applies changed Profile generation defaults on the same Viewer",async()=>{
 const f=await generationFixture();await f.render({...f.profile,defaultViewerReasoningEffort:"low",defaultViewerTemperature:0.6});
 await f.wait(()=>expect(rvReasoning().value).toBe("low"));expect(rvTemperature().value).toBe("0.6");
});
it("RV actual Viewer and connection changes initialize compatible defaults",async()=>{
 const f=await generationFixture();f.models[1].capabilities.temperature={supported:false,confidence:"provider_metadata"};
 await act(async()=>{f.select().value=f.identities[1].id;f.select().dispatchEvent(new Event("change",{bubbles:true}));});
 expect(rvTemperature().disabled).toBe(true);expect(rvTemperature().value).toBe("");
 const reasoning=host.querySelector<HTMLSelectElement>(".generation-grid select")!;expect(reasoning.value).toBe("");
 await f.render({...f.profile,credentialId:"key-one"});
 await act(async()=>{f.select().value=f.identities[0].id;f.select().dispatchEvent(new Event("change",{bubbles:true}));});
 expect(rvReasoning().value).toBe("");expect(rvTemperature().value).toBe("0.9");
});
it("RV same-model metadata refresh preserves manual values while disabling unsupported temperature",async()=>{
 const f=await generationFixture();f.models[0].capabilities.reasoning={supported:false,efforts:[],confidence:"provider_metadata"};f.models[0].capabilities.temperature={supported:false,confidence:"provider_metadata"};
 await act(async()=>notifyProviderRoutesChanged());await f.wait(()=>expect(f.select().value).toBe(f.identities[0].id));
 expect(host.querySelector<HTMLSelectElement>(".generation-grid select")!.value).toBe("");expect(rvTemperature().value).toBe("0.2");expect(rvTemperature().disabled).toBe(true);
});
it("RV a different model initializes Profile defaults compatible with its supported efforts",async()=>{
 const f=await generationFixture();
 const other={...f.models[0],modelId:"different",route:"one:different",capabilities:{...f.models[0].capabilities,reasoning:{supported:true,efforts:["low" as const],confidence:"provider_metadata" as const}}};
 f.models.push(other);
 const identity=await f.repository.ensureAiIdentity({profileId:f.profile.id,providerConfigId:"one",provider:"custom_openai",baseUrl:f.configs[0].baseUrl,credentialFingerprint:"native-key-one",credentialDisplay:"redacted",modelId:other.modelId,modelRoute:other.route,modelDisplayName:"Different",role:"viewer"});
 await f.render({...f.profile,defaultViewerModelId:other.modelId,defaultViewerReasoningEffort:"low",defaultViewerTemperature:0.6});
 await f.wait(()=>expect(f.select().value).toBe(identity.id));
 expect(host.querySelector<HTMLSelectElement>(".generation-grid select")!.value).toBe("low");expect(rvTemperature().value).toBe("0.6");
});
