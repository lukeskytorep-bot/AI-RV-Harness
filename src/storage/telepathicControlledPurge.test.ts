import {DatabaseSync,backup} from "node:sqlite";
import {readFileSync,readdirSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {expect,it,vi,afterEach} from "vitest";
import {createTelepathicSeriesState} from "../telepathicExchange/engine";
import {SqliteTelepathicExchangeRepository} from "./sqlite/telepathicExchangeRepository";
import {SqliteControlledPurge} from "./sqlite/controlledPurge";
import {BrowserTelepathicExchangeRepository} from "./browser/telepathicExchangeRepository";
import {previewBrowserPermanentDelete,purgeBrowserPermanentDelete,previewBrowserTelepathicDelete} from "./browser/controlledPurge";
import {setTelepathicArchived} from "../telepathicExchange/archive";
import type {TelepathicSeriesState} from "../telepathicExchange/types";
const native=readFileSync("src-tauri/src/database.rs","utf8");
const bridge=vi.hoisted(()=>({purge:vi.fn()}));
vi.mock("./databaseNative",()=>({executeControlledPurgeNative:bridge.purge}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();bridge.purge.mockReset();});
class MemoryStorage implements Storage{data=new Map<string,string>();get length(){return this.data.size;}getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}key(i:number){return [...this.data.keys()][i]??null;}clear(){this.data.clear();}}
function locks() {
 const held = new Set<string>();
 const queues = new Map<string, Array<() => void>>();
 const events: string[] = [];
 vi.stubGlobal("navigator", { locks: { request: <R>(name: string, options: {ifAvailable?: boolean}, callback: (lock: unknown | null) => R | Promise<R>): Promise<R> => {
  return new Promise<R>((resolve, reject) => {
   if (held.has(name) && options.ifAvailable) { Promise.resolve(callback(null)).then(resolve,reject); return; }
   const run = () => {
    held.add(name); events.push(`enter:${name}`);
    let result: R | Promise<R>;
    try { result = callback({name}); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(resolve,reject).finally(() => {
     events.push(`exit:${name}`); held.delete(name);
     const next = queues.get(name)?.shift(); if (next) next();
    });
   };
   if (held.has(name)) { events.push(`queue:${name}`); const queue=queues.get(name)??[]; queue.push(run); queues.set(name,queue); }
   else run();
  });
 } } });
 return events;
}
function fixture(id="one"):TelepathicSeriesState{
 const ai=(id:string)=>({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:"i",providerConfigId:"c",credentialId:"SECRET_KEY",credentialFingerprint:"SECRET_FINGERPRINT",modelId:"m",route:"m"}});
 const s=createTelepathicSeriesState({schemaVersion:1,seriesId:id,seriesWorkspaceId:"w",mode:"ai_ai_training",language:"en",participants:[ai("a"),ai("b")],roundCount:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"a"}});
 s.status="paused";s.archivedAt="2026-10-13T00:00:00Z";s.archiveRevision=1;
 const r=s.rounds[0];r.target={schemaVersion:1,roundId:r.assignment.roundId,senderParticipantId:"a",content:"SECRET_TARGET",assets:[{artifactId:"asset",kind:"image",originalFileName:"secret.png",mimeType:"image/png",size:1,sha256:"hash",path:"SECRET_PATH"}],contentSha256:"hash",status:"locked",lockedAt:"t"};
 r.blindByParticipant.b={participantId:"b",first:"SECRET_BLIND",status:"sealed",providerAttemptCount:1,contentSha256:"hash",sealedAt:"t"};r.reflectionsByParticipant.b={participantId:"b",role:"receiver",reflection:"SECRET_REFLECTION"};s.finalReflections.b="SECRET_FINAL";
 s.providerCalls=[{id:`${id}-call`,seriesId:id,roundId:r.assignment.roundId,participantId:"b",callStage:"receiver_first",technicalAttempt:1,status:"succeeded",scopeKey:"scope",requestSha256:"hash",createdAt:"t",updatedAt:"t",responseText:"SECRET_RESPONSE"}];
 s.transcript=[{id:"event",seriesId:id,roundId:r.assignment.roundId,sequence:1,stage:"receiver_first",kind:"response",authorId:"b",recipientIds:[],text:"SECRET_TRANSCRIPT",createdAt:"t"}];return s;
}
function sqlite(){
 const db=new DatabaseSync(":memory:");const folder=new URL("../../src-tauri/migrations/",import.meta.url);
 for(const f of readdirSync(folder).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL(f,folder),"utf8"));
 db.exec("INSERT INTO profiles(id,display_name,created_at,updated_at,archived_at) VALUES('p','P','t','t','t'); INSERT INTO workspaces(id,profile_id,name,created_at,updated_at,last_opened_at,archived_at) VALUES('w','p','W','t','t','t','t');");
 const bind=(q:string)=>q.replace(/\$\d+/g,'?');
 const select=async<T>(q:string,v:unknown[]=[])=>db.prepare(bind(q)).all(...v as never[]) as T;
 const write=async(q:string,v:unknown[]=[])=>({rowsAffected:Number(db.prepare(bind(q)).run(...v as never[]).changes)});
 const repo=new SqliteTelepathicExchangeRepository({select,executeWrite:write,executeTransaction:async statements=>{db.exec('BEGIN IMMEDIATE');try{const counts=[];for(const s of statements)counts.push((await write(s.query,s.values)).rowsAffected);db.exec('COMMIT');return counts;}catch(e){db.exec('ROLLBACK');throw e;}},executeFencedTransaction:async()=>{throw Error('No fixture leased writes');}});
 return {db,repo,preview:new SqliteControlledPurge({select})};
}
// Executes the actual SQL literals of the Rust command on real SQLite. This is
// an SQL-contract test, not a claim that Rust/IPC was executed in this runtime.
function nativeSqlDelete(db:DatabaseSync,id:string,revision:number){
 const archive=native.match(/"telepathic_series" => "([^"]+)"/)![1];
 const version="SELECT COALESCE(json_extract(plan_json,'$._runtime.archiveRevision'),0) FROM telepathic_series WHERE id=$1";expect(native).toContain(version);
 const lease=[...native.matchAll(/query_scalar\("([^"]+)"\)/g)].map(m=>m[1]).find(s=>s.startsWith("SELECT COUNT(*) FROM telepathic_series WHERE id=$1 AND (status='running'"))!;
 const deletion=native.match(/purge_exec\(&mut tx, "(DELETE FROM telepathic_series [^"]+)"/)![1];
 const scalar=(q:string)=>Object.values(db.prepare(q.replace(/\$1/g,"?")).get(id)??{})[0];
 db.exec('BEGIN IMMEDIATE');try{
  if(scalar(archive)!==1)throw Error('not archived');if(scalar(version)!==revision)throw Error('revision');if(scalar(lease)!==0)throw Error('active lease');
  db.exec("DELETE FROM controlled_purge_context; INSERT INTO controlled_purge_context VALUES(1,'test','t');");db.prepare(deletion.replace(/\$1/g,"?")).run(id);db.exec('DELETE FROM controlled_purge_context; COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
it("Browser deletes exactly one archived series under Web Locks, preserves globals and external attachment data",async()=>{
 locks();const storage=new MemoryStorage(),repo=new BrowserTelepathicExchangeRepository({storage});await repo.saveTelepathicSeries(fixture());await repo.saveTelepathicSeries(fixture("two"));storage.setItem('rvh.dev.ai_note_versions',JSON.stringify([{id:'notes',aiIdentityId:'i',content:'LEARNING'}]));storage.setItem('external-assets','FILE');
 const before=await repo.getTelepathicSeries('two'),p=await previewBrowserTelepathicDelete(storage,'one');expect(JSON.stringify(p)).not.toContain('SECRET');expect(p.counts.telepathicProviderCalls).toBe(1);expect(p.counts.telepathicAttachmentFilesPreserved).toBe(1);expect(p.viewerNotesPreserved).toBe(1);
 await purgeBrowserPermanentDelete(storage,'telepathic_series','one',p.archiveRevision);expect(await repo.getTelepathicSeries('one')).toBeNull();expect(await repo.getTelepathicSeries('two')).toEqual(before);expect(storage.getItem('external-assets')).toBe('FILE');expect(storage.getItem('rvh.dev.ai_note_versions')).toContain('LEARNING');
});
for(const scenario of ['unarchived','restored','rearchived','owner','running','no-locks','write-fault','malformed'] as const)it(`Browser ${scenario} cannot purge silently`,async()=>{
 locks();const storage=new MemoryStorage(),repo=new BrowserTelepathicExchangeRepository({storage});await repo.saveTelepathicSeries(fixture());const p=await previewBrowserTelepathicDelete(storage,'one');let held:Promise<void>|undefined,release!:()=>void;
 if(scenario==='unarchived'||scenario==='restored')await setTelepathicArchived(repo,'one',false);
 if(scenario==='rearchived'){await setTelepathicArchived(repo,'one',false);await setTelepathicArchived(repo,'one',true);}
 if(scenario==='running'){const s=fixture();s.status='running';await repo.saveTelepathicSeries(s);}
 if(scenario==='owner'){held=repo.withTelepathicSeriesLease('one',()=>new Promise<void>(r=>{release=r;}));await new Promise(r=>setTimeout(r,0));expect((await previewBrowserTelepathicDelete(storage,'one')).blockedReason).toBeTruthy();}
 if(scenario==='no-locks')vi.stubGlobal('navigator',{});
 if(scenario==='malformed')storage.setItem('rvh.dev.telepathic_series_v1','bad-json');
 const before=storage.getItem('rvh.dev.telepathic_series_v1');if(scenario==='write-fault')vi.spyOn(storage,'setItem').mockImplementationOnce(()=>{throw Error('write failure');});
 try{await expect(purgeBrowserPermanentDelete(storage,'telepathic_series','one',p.archiveRevision)).rejects.toThrow();expect(storage.getItem('rvh.dev.telepathic_series_v1')).toBe(before);}finally{if(held){release();await held;}}
});
it("Browser parent deletion is blocked by Telepathy references, including participant snapshots",async()=>{
 const storage=new MemoryStorage();storage.setItem('rvh.dev.profiles',JSON.stringify([{id:'p',name:'P',archivedAt:'t'}]));storage.setItem('rvh.dev.workspaces',JSON.stringify([{id:'w',profileId:'p',name:'W',archivedAt:'t'}]));await new BrowserTelepathicExchangeRepository({storage}).saveTelepathicSeries(fixture());
 for(const [kind,id] of [['profile','p'],['workspace','w']] as const){expect(previewBrowserPermanentDelete(storage,kind,id).blockedReason).toContain('Telepathy');expect(()=>purgeBrowserPermanentDelete(storage,kind,id)).toThrow('Telepathy');}
});
it("SQLite preview is secret-free and frontend forwards the frozen revision to the one native command",async()=>{
 const f=sqlite();try{await f.repo.saveTelepathicSeries(fixture());const p=await f.preview.preview('telepathic_series','one');expect(JSON.stringify(p)).not.toContain('SECRET');expect(p.counts.telepathicTranscriptEvents).toBe(1);expect(p.counts.telepathicAttachmentFilesPreserved).toBe(1);await f.preview.purge('telepathic_series','one',p.archiveRevision);expect(bridge.purge).toHaveBeenCalledWith('telepathic_series','one',1);await expect(f.preview.purge('telepathic_series','one',0)).rejects.toThrow('changed');}finally{f.db.close();}
});
for(const scenario of ['success','restore','revision','lease','null-expiry','bad-expiry','expired','running','rollback'] as const)it(`real SQLite native SQL ${scenario}, cascade/integrity and rollback`,async()=>{
 const f=sqlite();try{await f.repo.saveTelepathicSeries(fixture());await f.repo.saveTelepathicSeries(fixture('two'));const before=(await f.repo.getTelepathicSeries('two'))!;
  if(scenario==='restore')f.db.exec("UPDATE telepathic_series SET plan_json=json_remove(plan_json,'$._runtime.archivedAt') WHERE id='one'");
  if(scenario==='revision')f.db.exec("UPDATE telepathic_series SET plan_json=json_set(plan_json,'$._runtime.archiveRevision',2) WHERE id='one'");
  if(['lease','null-expiry','bad-expiry','expired'].includes(scenario))f.db.prepare("UPDATE telepathic_series SET run_lease_owner='owner',run_lease_expires_at=? WHERE id='one'").run(scenario==='lease'?'2999-01-01T00:00:00Z':scenario==='expired'?'2000-01-01T00:00:00Z':scenario==='bad-expiry'?'bad':null);
  if(scenario==='running')f.db.exec("UPDATE telepathic_series SET status='running' WHERE id='one'");
  if(scenario==='rollback')f.db.exec("CREATE TRIGGER injected BEFORE DELETE ON telepathic_targets BEGIN SELECT RAISE(ABORT,'fault'); END;");
  if(scenario==='success'||scenario==='expired'){nativeSqlDelete(f.db,'one',1);expect(await f.repo.getTelepathicSeries('one')).toBeNull();for(const table of ['telepathic_participants','telepathic_rounds','telepathic_targets','telepathic_blind_submissions','telepathic_reflections','telepathic_provider_calls'])expect(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n).toBe(table==='telepathic_participants'?2:1);}else{expect(()=>nativeSqlDelete(f.db,'one',1)).toThrow();expect(await f.repo.getTelepathicSeries('one')).not.toBeNull();}
  expect(await f.repo.getTelepathicSeries('two')).toEqual(before);expect(f.db.prepare('SELECT COUNT(*) n FROM controlled_purge_context').get()!.n).toBe(0);expect(f.db.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});
it("SQLite backup restores a deleted series and its evidence; parent preview is blocked",async()=>{
 const f=sqlite();const directory=mkdtempSync(join(tmpdir(),'tele-purge-'));try{await f.repo.saveTelepathicSeries(fixture());for(const [kind,id] of [['profile','p'],['workspace','w']] as const)expect((await f.preview.preview(kind,id)).blockedReason).toContain('Telepathy');await backup(f.db,join(directory,'backup.db'));nativeSqlDelete(f.db,'one',1);const restored=new DatabaseSync(join(directory,'backup.db'));try{expect(restored.prepare('SELECT COUNT(*) n FROM telepathic_series').get()!.n).toBe(1);expect(restored.prepare('SELECT plan_json FROM telepathic_series').get()!.plan_json).toContain('SECRET_TRANSCRIPT');expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});}finally{restored.close();}}finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

const collectionLock = "rvh-telepathic-collection:v1";
const seriesKey = "rvh.dev.telepathic_series_v1";

for (const scenario of ["save-save", "purge-save", "save-purge", "purge-purge"] as const) {
 it(`AUDIT: shared collection serializes ${scenario} across repository adapters`, async () => {
  const events=locks();
  const storage=new MemoryStorage();
  const first=new BrowserTelepathicExchangeRepository({storage});
  const other=new BrowserTelepathicExchangeRepository({storage});
  await first.saveTelepathicSeries(fixture());
  await first.saveTelepathicSeries(fixture("two"));
  events.length=0;
  const originalSet=storage.setItem.bind(storage);
  let injected=false;
  let second: Promise<void> | undefined;
  const updated=fixture("two"); updated.finalReflections.b="NEW OTHER TAB ANSWER";
  vi.spyOn(storage,"setItem").mockImplementation((key,value)=>{
   if(key===seriesKey&&!injected){
    injected=true;
    // Another tab requests a commit exactly after the first read and before
    // its setItem. The scheduler must queue it until the collection releases.
    second=scenario.endsWith("purge")
     ? purgeBrowserPermanentDelete(storage,"telepathic_series","two",1) as Promise<void>
     : other.withTelepathicSeriesLease("two",()=>other.saveTelepathicSeries(updated));
    expect(events.filter(e=>e===`enter:${collectionLock}`)).toHaveLength(1);
   }
   originalSet(key,value);
  });
  if(scenario.startsWith("purge")) await purgeBrowserPermanentDelete(storage,"telepathic_series","one",1);
  else {
   const updatedOne=fixture(); updatedOne.finalReflections.b="NEW FIRST TAB ANSWER";
   await first.withTelepathicSeriesLease("one",()=>first.saveTelepathicSeries(updatedOne));
  }
  expect(injected).toBe(true); await second;
  expect(events.filter(e=>e.endsWith(collectionLock))).toEqual([
   `enter:${collectionLock}`,`queue:${collectionLock}`,`exit:${collectionLock}`,
   `enter:${collectionLock}`,`exit:${collectionLock}`,
  ]);
  const one=await first.getTelepathicSeries("one"),two=await first.getTelepathicSeries("two");
  if(scenario.startsWith("purge")) expect(one).toBeNull();
  else expect(one?.finalReflections.b).toBe("NEW FIRST TAB ANSWER");
  if(scenario.endsWith("purge")) expect(two).toBeNull();
  else expect(two?.finalReflections.b).toBe("NEW OTHER TAB ANSWER");
 });
}
it("AUDIT: save fails closed on malformed shared collection",async()=>{
 locks(); const storage=new MemoryStorage(); storage.setItem(seriesKey,"broken-json");
 await expect(new BrowserTelepathicExchangeRepository({storage}).saveTelepathicSeries(fixture())).rejects.toThrow();
 expect(storage.getItem(seriesKey)).toBe("broken-json");
});

it("AUDIT: collection lock is released while a series lease waits for a provider",async()=>{
 const events=locks(),storage=new MemoryStorage(),repo=new BrowserTelepathicExchangeRepository({storage});
 let release!:()=>void,ready!:()=>void;
 const waiting=new Promise<void>(r=>{ready=r;});
 const provider=new Promise<void>(r=>{release=r;});
 const running=repo.withTelepathicSeriesLease("one",async()=>{
  await repo.saveTelepathicSeries(fixture()); ready(); await provider;
 });
 await waiting;
 try {
  await new BrowserTelepathicExchangeRepository({storage}).withTelepathicSeriesLease("two",()=>new BrowserTelepathicExchangeRepository({storage}).saveTelepathicSeries(fixture("two")));
  expect(await repo.getTelepathicSeries("two")).not.toBeNull();
  expect(events.filter(e=>e===`queue:${collectionLock}`)).toHaveLength(0);
 } finally {release();await running;}
});
