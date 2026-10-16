// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {BrowserRepository} from "../../storage/browserRepository";
import {isRvSessionEnded} from "../../sessions/termination";
import {getCopy} from "../../i18n";
import {createDefaultSettings} from "../../startupDefaults";
const mocks=vi.hoisted(()=>({identities:vi.fn(),blind:vi.fn(),review:vi.fn()}));
vi.mock("../../components/AppDialogProvider",()=>({useAppDialogs:()=>({confirm:vi.fn(),information:vi.fn()})}));
vi.mock("../../storage",async original=>({...await original<object>(),isTauriRuntime:()=>true}));
vi.mock("../../aiCenter/viewerIdentitySelection",()=>({inspectViewerIdentities:async(input: unknown)=>({identities:await mocks.identities(input),issues:[]}),preferredViewerIdentityId:()=>"i",requireWorkspaceViewerRoute:async()=>undefined,viewerIdentityLabel:()=>"Viewer"}));
vi.mock("../../sessions/controller",async original=>({...await original<object>(),runAutomaticRcpSession:mocks.blind}));
vi.mock("../../sessions/postReveal",async original=>({...await original<object>(),runAutomaticPostRevealReview:mocks.review}));
import {RvSessionPanel} from "./RvSessionPanel";
for(const language of ["pl","en"] as const)for(const failure of [false,true])it(`S3.2 ${language}/saveFailure=${failure}: End uncertain historical RV preserves evidence and survives remount`,async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 const held=new Set<string>();vi.stubGlobal("navigator",{locks:{request:async(name:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}}});
 const repository=new BrowserRepository();const profile=await repository.createProfile({name:"P"});const workspace=await repository.createWorkspace({profileId:profile.id,name:"W",kind:"rv"});
 await repository.createRvSession({id:"s",workspaceId:workspace.id,profileId:profile.id,sessionCode:"HISTORY-END",runType:"automatic"});await repository.updatePreRevealTranscript("s","accepted blind evidence");await repository.updateRvSessionState("s","Revealed");
 await repository.appendSessionEvent("s",{eventType:"POST_REVEAL_REVIEW_CHECKPOINT",metadata:{stage:"viewer",status:"uncertain",attempt:2,requestSha256:"frozen"}});
 vi.spyOn(repository,"getSessionSnapshot").mockResolvedValue({providerConfigId:"pc",modelId:"m",modelRoute:"route",provider:"custom_openai",sessionLanguage:language,capabilitySnapshot:{}} as never);
 vi.spyOn(repository,"getReveal").mockResolvedValue({text:"accepted target",hash:"hash",artifactManifest:[]} as never);
 mocks.identities.mockResolvedValue([]);const before=await repository.getRvSession("s"),events=await repository.listSessionEvents("s");
 const host=document.createElement("div");document.body.append(host);let root=createRoot(host);const copy=getCopy(language);
 const endLabel=language==="pl"?"Zakończ sesję":"End session",resolveLabel=language==="pl"?"Oznacz próbę jako nieudaną":"Treat attempt as failed",endedLabel=language==="pl"?"Zakończona przez użytkownika":"Ended by user";
 const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes(label));
 const mount=async()=>{await act(async()=>root.render(<RvSessionPanel repository={repository} profile={profile} workspace={workspace} copy={copy} settings={{...createDefaultSettings(),interfaceLanguage:language}}/>));await act(async()=>host.querySelector<HTMLButtonElement>(".session-metadata-toggle")!.click());};
 try{
  await mount();await vi.waitFor(()=>expect(button(resolveLabel)).toBeTruthy());await vi.waitFor(()=>expect(button(endLabel)?.disabled).toBe(false));
  // Another owner makes both End and uncertain resolution read-only.
  held.add(`rvh.workflow.v1:${profile.id}`);await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2_050));});expect(button(endLabel)?.disabled).toBe(true);expect(button(resolveLabel)?.disabled).toBe(true);held.clear();await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2_050));});
  if(failure){const append=vi.spyOn(repository,"appendSessionEvent").mockRejectedValueOnce(new Error("marker save failed"));await act(async()=>button(endLabel)!.click());await vi.waitFor(()=>expect(host.textContent).toContain("marker save failed"));expect(await isRvSessionEnded(repository,"s")).toBe(false);expect(button(resolveLabel)).toBeTruthy();append.mockRestore();}
  await act(async()=>button(endLabel)!.click());await vi.waitFor(()=>expect(host.textContent).toContain(endedLabel));expect(button(endLabel)).toBeUndefined();expect(button(resolveLabel)).toBeUndefined();expect(await repository.getRvSession("s")).toEqual(before);expect((await repository.listSessionEvents("s")).slice(0,-1)).toEqual(events);
  await act(async()=>root.unmount());root=createRoot(host);await mount();await vi.waitFor(()=>expect(host.textContent).toContain(endedLabel));expect(button(endLabel)).toBeUndefined();expect(button(resolveLabel)).toBeUndefined();await act(async()=>host.querySelector<HTMLButtonElement>(".recent-session-open")!.click());await vi.waitFor(()=>expect(host.textContent).toContain("accepted target"));expect(host.querySelector(".save-only-button")).toBeNull();expect(host.querySelector<HTMLTextAreaElement>(".post-reveal-compose textarea")?.disabled).toBe(true);expect(mocks.blind).not.toHaveBeenCalled();expect(mocks.review).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();mocks.blind.mockReset();mocks.review.mockReset();}
}, 15_000);
