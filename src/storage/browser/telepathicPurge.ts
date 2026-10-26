import { emptyDeletionCounts, type DeletionPreview } from "../controlledPurge";
import { BrowserTelepathicExchangeRepository } from "./telepathicExchangeRepository";
import { TELEPATHIC_SERIES_KEY as KEY, readTelepathicCollection, withTelepathicCollectionWrite } from "./telepathicCollection";
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export const readTelepathicPurgeStates = readTelepathicCollection;
export function telepathicParentBlocked(storage:StorageLike,kind:"profile"|"workspace",id:string):boolean{
 const workspaces=JSON.parse(storage.getItem("rvh.dev.workspaces")??"[]") as Array<{id:string;profileId:string}>;
 const ids=new Set(kind==="workspace"?[id]:workspaces.filter(w=>w.profileId===id).map(w=>w.id));
 return readTelepathicPurgeStates(storage).some(s=>ids.has(s.config.seriesWorkspaceId)||s.config.participants.some(p=>p.ai&&(ids.has(p.ai.workspaceId)||kind==="profile"&&p.ai.profileId===id)));
}
export function telepathicBrowserPreview(storage:StorageLike,id:string):DeletionPreview{
 const s=readTelepathicPurgeStates(storage).find(s=>s.config.seriesId===id);if(!s)throw new Error("Telepathic series not found.");
 const counts=emptyDeletionCounts();counts.telepathicSeries=1;counts.telepathicParticipants=s.config.participants.length;counts.telepathicRounds=s.rounds.length;counts.telepathicTargets=s.rounds.filter(r=>r.target).length;
 counts.telepathicBlindSubmissions=s.rounds.reduce((n,r)=>n+Object.keys(r.blindByParticipant).length,0);counts.telepathicReflections=s.rounds.reduce((n,r)=>n+Object.keys(r.reflectionsByParticipant).length,0);counts.telepathicFinalReflections=Object.keys(s.finalReflections).length;counts.telepathicProviderCalls=s.providerCalls.length;counts.telepathicTranscriptEvents=s.transcript?.length??0;
 counts.telepathicAttachmentFilesPreserved=s.rounds.reduce((n,r)=>n+(r.target?.assets.length??0),0);
 const identityIds=new Set(s.config.participants.flatMap(p=>p.ai?[p.ai.aiIdentityId]:[]));const notes=JSON.parse(storage.getItem("rvh.dev.ai_note_versions")??"[]") as Array<{aiIdentityId:string}>;
 return {kind:"telepathic_series",id,label:`Telepathy · ${s.config.participants.map(p=>p.displayName).join(" · ")}`,archiveRevision:s.archiveRevision??0,archived:typeof s.archivedAt==="string"&&!!s.archivedAt.trim(),blockedReason:s.status==="running"?"Stop the active Telepathy series before deleting.":undefined,requiresPhrase:"DELETE",safetyBackupRecommended:true,viewerNotesPreserved:notes.filter(n=>identityIds.has(n.aiIdentityId)).length,viewerNotesDeleted:0,counts};
}
export async function previewBrowserTelepathicDelete(storage:StorageLike,id:string):Promise<DeletionPreview>{
 const preview=telepathicBrowserPreview(storage,id);
 if(!globalThis.navigator?.locks)return {...preview,blockedReason:"Permanent Delete requires Web Locks coordination. Use the desktop app or a browser supporting Web Locks."};
 const repo=new BrowserTelepathicExchangeRepository({storage:storage as Storage});
 if(await repo.getTelepathicSeriesLeaseState(id)!=="idle")preview.blockedReason="Telepathy is running in another operation or its ownership cannot be verified.";
 return preview;
}
export async function purgeBrowserTelepathicSeries(storage:StorageLike,id:string,expectedArchiveRevision?:number):Promise<void>{
 if(!globalThis.navigator?.locks)throw new Error("Permanent Delete requires Web Locks coordination.");
 const repo=new BrowserTelepathicExchangeRepository({storage:storage as Storage});
 await repo.withTelepathicSeriesLease(id,async()=>{
  await repo.assertTelepathicSeriesLease(id);
  await withTelepathicCollectionWrite(()=>{
  const preview=telepathicBrowserPreview(storage,id);if(!preview.archived)throw new Error("Permanent Delete is available only for an archived record.");if(preview.blockedReason)throw new Error(preview.blockedReason);
  if(!Number.isInteger(expectedArchiveRevision)||expectedArchiveRevision!==preview.archiveRevision)throw new Error("Telepathy changed after Deletion Preview.");
  // Fresh read and single-key commit under the shared collection lock.
  // The series lease is already held; no reverse lock acquisition.
  const before=storage.getItem(KEY);const next=readTelepathicPurgeStates(storage).filter(s=>s.config.seriesId!==id);
  try{storage.setItem(KEY,JSON.stringify(next));}catch(error){if(before!==null)storage.setItem(KEY,before);throw error;}
  });
 });
}
