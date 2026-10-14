// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {getCopy} from "../../i18n";
import {createDefaultSettings} from "../../startupDefaults";
import type {AppRepository} from "../../storage/repository";
const mocks=vi.hoisted(()=>({identities:vi.fn(),review:vi.fn(),blind:vi.fn()}));
vi.mock("../../components/AppDialogProvider",()=>({useAppDialogs:()=>({confirm:vi.fn(),information:vi.fn()})}));
vi.mock("../../storage",async importOriginal=>({...await importOriginal<object>(),isTauriRuntime:()=>true}));
vi.mock("../../aiCenter/viewerIdentitySelection",()=>({listEligibleViewerIdentities:mocks.identities,preferredViewerIdentityId:()=>"i",requireWorkspaceViewerRoute:async()=>undefined,viewerIdentityLabel:()=>"Viewer"}));
vi.mock("../../aiCenter/fieldGuide",async importOriginal=>({...await importOriginal<object>(),prepareFieldGuideForSession:async()=>({}),viewerSystemPromptSnapshotFromFieldGuide:async()=>({})}));
vi.mock("../../aiCenter/viewerNotes",async importOriginal=>({...await importOriginal<object>(),prepareViewerNotesForSession:async()=>({enabled:false})}));
vi.mock("../../sessions/controller",async importOriginal=>({...await importOriginal<object>(),runAutomaticRcpSession:mocks.blind}));
vi.mock("../../sessions/postReveal",async importOriginal=>({...await importOriginal<object>(),runAutomaticPostRevealReview:mocks.review}));
import {RvSessionPanel} from "./RvSessionPanel";
for(const language of ["pl","en"] as const)it(`S3.1 ${language}: existing RV Stop reaches automatic post-Reveal and stays stopping until settle`,async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);let release!:()=>void;let signal!:AbortSignal;
 const provider={id:"pc",provider:"custom_openai",credentialId:"k",enabled:true,label:"P"};const model={providerConfigId:"pc",provider:"custom_openai",modelId:"m",route:"route",displayName:"M",capabilities:{inputModalities:["text"],outputModalities:["text"],reasoning:{supported:false,efforts:[]},temperature:{supported:false},supportedParameters:[]},pricing:{}};
 mocks.identities.mockResolvedValue([{identity:{id:"i",displayName:"Viewer"},providerConfig:provider,model}]);
 mocks.blind.mockImplementation(async request=>{request.onProgress({sessionId:"s",state:"Revealed",transcript:"accepted blind"});return{sessionId:"s",state:"Revealed",transcript:"accepted blind"};});
 mocks.review.mockImplementation(request=>{signal=request.signal;return new Promise((_resolve,reject)=>{release=()=>reject(signal.reason);});});
 const repository={listProviderConfigs:async()=>[provider],listProviderModels:async()=>[model],listTargets:async()=>[{id:"t",collection:"user",sourceMetadata:{},title:"T",revealText:"target",tags:[],createdAt:"t",updatedAt:"t"}],listRvSessions:async()=>[],listSessionEvents:async()=>[],listCustomProtocols:async()=>[],getReveal:async()=>({text:"target",hash:"h",artifactManifest:[]}),getSessionSnapshot:async()=>({providerConfigId:"pc",modelId:"m",modelRoute:"route",provider:"custom_openai",capabilitySnapshot:{}}),listJudgeScores:async()=>[],listTargetClarifications:async()=>[]} as unknown as AppRepository;
 const copy=getCopy(language);const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes(text));
 try{
  await act(async()=>root.render(<RvSessionPanel repository={repository} profile={{id:"p",name:"P",credentialId:"k",createdAt:"t",updatedAt:"t"}} workspace={{id:"w",profileId:"p",name:"W",kind:"rv",createdAt:"t",updatedAt:"t",lastOpenedAt:"t"}} settings={{...createDefaultSettings(),interfaceLanguage:language,defaultRevealSource:"automatic"}} copy={copy}/>));
  await vi.waitFor(()=>expect(button(copy.startSession)?.disabled).toBe(false));await act(async()=>button(copy.startSession)!.click());await vi.waitFor(()=>expect(signal).toBeTruthy());
  expect(host.querySelectorAll(".stop-button")).toHaveLength(1);await act(async()=>button(copy.stopSession)!.click());expect(signal.aborted).toBe(true);
  expect(button(language==="pl"?"Zatrzymywanie…":"Stopping…")?.disabled).toBe(true);await act(async()=>release());
  await vi.waitFor(()=>expect(host.textContent).not.toContain(language==="pl"?"Zatrzymywanie…":"Stopping…"));expect(mocks.blind).toHaveBeenCalledTimes(1);expect(mocks.review).toHaveBeenCalledTimes(1);
 }finally{release?.();await act(async()=>root.unmount());host.remove();mocks.blind.mockReset();mocks.review.mockReset();}
});
