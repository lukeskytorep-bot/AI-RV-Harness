// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { AiCenterScreen } from "./AiCenterScreen";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppRepository } from "../../storage/repository";

for(const language of ["en","pl"] as const)it(`T1 AiCenter ${language}: distinguishes failed memory updates from model NO_CHANGE`,async()=>{
 const environment=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};const previous=environment.IS_REACT_ACT_ENVIRONMENT;environment.IS_REACT_ACT_ENVIRONMENT=true;
 const identity={id:"ai",profileId:"p",role:"viewer",modelDisplayName:"Viewer",modelRoute:"route",provider:"custom_openai",credentialDisplay:"API",credentialFingerprint:"fingerprint",routeStatus:"available"};
 const settlements=[{kind:"field_guide",sessionId:"s",packetHash:"fg",auditId:"fg-audit",settlement:"failed_preserved",version:{id:"fg-v1",contentSha256:"hash"},attempts:2,status:"FAILED_CAPACITY",failureMessage:"Field capacity (3000/2048)"},{kind:"viewer_notes",sessionId:"s",packetHash:"vn",auditId:"vn-audit",settlement:"failed_preserved",version:null,attempts:2,status:"FAILED_PARSE",failureMessage:"Malformed JSON final response"}];
 const repository={listAiIdentities:vi.fn(async()=>[identity]),listMonitorRuns:vi.fn(async()=>[]),getViewerNoteBundle:vi.fn(async()=>({identity,settings:{capacityTokens:1024,defaultEnabled:true},versions:[],activationEvents:[],reflectionRuns:[{id:"vn-audit",status:"FAILED_PARSE",failureMessage:"Malformed JSON final response",createdAt:"2026-10-15T00:00:00Z",sourceSessionId:"s",sourceSnapshot:{sessionId:"s",sessionCode:"S",profileId:"p",capturedAt:"2026-10-15T00:00:00Z"}}]})),getFieldGuideBundle:vi.fn(async()=>({settings:{capacityTokens:2048},versions:[{id:"fg-v1",versionNumber:1,content:"guide",createdAt:"2026-10-15T00:00:00Z",sourceSnapshot:{sourceKind:"factory-baseline"}}],activationEvents:[]})),listFieldGuideLegacyBaselines:vi.fn(async()=>[]),listTrainingRuns:vi.fn(async()=>[{profileId:"p",learningSettlements:settlements}]),listArchivedTrainingRuns:vi.fn(async()=>[])} as unknown as AppRepository;
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{
   await act(async()=>{root.render(<AiCenterScreen settings={{...createDefaultSettings(),interfaceLanguage:language}} profiles={[{id:"p",name:"P",createdAt:"t",updatedAt:"t"}]} workspaces={[]} activeProfileId="p" workspaceFilterId={null} repository={repository} initialView="viewer-learning" monitorPanel={null} onProfileChange={()=>undefined}/>);});
   expect(host.textContent).toContain("Field capacity (3000/2048)");
   const tab=[...host.querySelectorAll("button")].find(b=>b.textContent===(language==="pl"?"Notatki Viewera":"Viewer Notes"))!;
   await act(async()=>tab.click());expect(host.textContent).toContain("Malformed JSON final response");expect(host.textContent).toContain(language==="pl"?"Aktualizacja nieudana — nadal brak zapisanej wersji":"Update failed — no saved version exists");expect(host.querySelector(".viewer-note-runs")?.textContent).not.toContain("NO_CHANGE");expect(host.querySelector(".viewer-note-runs details")?.hasAttribute("open")).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();environment.IS_REACT_ACT_ENVIRONMENT=previous;}
});
