// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {SettingsScreen} from "./SettingsScreen";
import {AppDialogProvider} from "../../components/AppDialogProvider";
import {BrowserTelepathicExchangeRepository} from "../../storage/browser/telepathicExchangeRepository";
import {previewBrowserTelepathicDelete,purgeBrowserPermanentDelete} from "../../storage/browser/controlledPurge";
import {createTelepathicSeriesState} from "../../telepathicExchange/engine";
import {setTelepathicArchived} from "../../telepathicExchange/archive";
import {createDefaultSettings} from "../../startupDefaults";
import {getCopy} from "../../i18n";
import type {AppRepository} from "../../storage/repository";
vi.mock("../../components/ProviderSettings",()=>({ProviderSettings:()=>null}));
for(const pl of [false,true])for(const action of ['cancel','delete','restore-after-preview'] as const)it(`${pl?'PL':'EN'} Settings permanent Telepathy delete ${action}: preview, phrase, no premature deletion`,async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();
 const held=new Set<string>();vi.stubGlobal('navigator',{locks:{request:async<R,>(name:string,_options:unknown,task:(lock:unknown|null)=>Promise<R>)=>{if(held.has(name))return task(null);held.add(name);try{return await task({name});}finally{held.delete(name);}}}});
 const store=new BrowserTelepathicExchangeRepository();const ai=(id:string)=>({id,kind:'ai' as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:'w',aiIdentityId:id,providerConfigId:'c',credentialId:'SECRET',credentialFingerprint:'SECRET',modelId:'m',route:'m'}});
 const state=createTelepathicSeriesState({schemaVersion:1,seriesId:'delete',seriesWorkspaceId:'w',mode:'ai_ai_training',language:'en',participants:[ai('a'),ai('b')],roundCount:1,protocolVersion:'fixed_lead_v1',leadInstructionVersion:'v1',maxGuidanceCycles:3,topic:'any',discloseTopicToReceivers:false,senderPolicy:{kind:'fixed_ai',participantId:'a'}});state.archivedAt='t';state.archiveRevision=1;state.status='paused';await store.saveTelepathicSeries(state);
 const purge=vi.fn(async(id:string,revision:number)=>{await purgeBrowserPermanentDelete(localStorage,'telepathic_series',id,revision);});
 const repository=Object.assign(store,{previewPermanentDelete:async()=>previewBrowserTelepathicDelete(localStorage,'delete'),purgeTelepathicSeries:purge,listProviderConfigs:async()=>[],listProviderModels:async()=>[],listArchivedProfiles:async()=>[],listArchivedWorkspaces:async()=>[],listArchivedChatThreads:async()=>[],listArchivedRvSessions:async()=>[],listArchivedTrainingRuns:async()=>[],listArchivedResearchProjects:async()=>[],listArchivedTargets:async()=>[]}) as unknown as AppRepository;
 const copy=getCopy(pl?'pl':'en'),host=document.createElement('div');document.body.append(host);const root=createRoot(host),changed=vi.fn(async()=>{});
 const wait=(check:()=>unknown)=>vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,0));});await check();},{timeout:4000});
 try{
  await act(async()=>root.render(<AppDialogProvider><SettingsScreen copy={copy} settings={createDefaultSettings()} workspaces={[]} repository={repository} onDataChanged={changed} onChange={()=>{}}/></AppDialogProvider>));
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('.settings-tabs button')].find(b=>b.textContent===copy.storage)!.click());await wait(()=>expect(host.querySelector('.telepathic-archive-group')).not.toBeNull());
  await act(async()=>host.querySelector<HTMLButtonElement>('.telepathic-archive-group .danger-button')!.click());await wait(()=>expect(document.body.querySelector('[role=dialog]')).not.toBeNull());
  const dialog=()=>document.body.querySelector<HTMLElement>('[role=dialog]')!;
  expect(dialog().textContent).toContain('Deletion Preview');expect(dialog().textContent).not.toContain('SECRET');expect(purge).not.toHaveBeenCalled();expect(await store.getTelepathicSeries('delete')).not.toBeNull();
  const confirm=()=>dialog().querySelector<HTMLButtonElement>('.app-dialog-actions .danger-button')??[...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===(pl?'Usuń trwale':'Delete permanently'))!;
  expect(confirm().disabled).toBe(true);
  if(action==='cancel'){
   await act(async()=>dialog().querySelector<HTMLButtonElement>('.modal-heading button')!.click());expect(purge).not.toHaveBeenCalled();expect(await store.getTelepathicSeries('delete')).not.toBeNull();
  }else{
   if(action==='restore-after-preview')await setTelepathicArchived(store,'delete',false);
   await act(async()=>{const input=dialog().querySelector<HTMLInputElement>('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'DELETE');input.dispatchEvent(new Event('input',{bubbles:true}));});
   expect(confirm().disabled).toBe(false);await act(async()=>confirm().click());
   if(action==='delete'){await wait(()=>expect(changed).toHaveBeenCalledTimes(1));expect(await store.getTelepathicSeries('delete')).toBeNull();expect(host.querySelector('.telepathic-archive-group')).toBeNull();expect(purge).toHaveBeenCalledWith('delete',1);}
   else{await wait(()=>expect(dialog().querySelector('[role=alert]')).not.toBeNull());expect(await store.getTelepathicSeries('delete')).not.toBeNull();expect(changed).not.toHaveBeenCalled();}
  }
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
