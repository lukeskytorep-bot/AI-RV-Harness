import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SqliteSessionsRepository } from "./sqlite/sessionsRepository";
import { runAutomaticRvLiteSession, type AutomaticRvLiteRunInput } from "../sessions/rvLiteController";
import { getRvLite } from "../resources/protocolRegistry";
import { createSessionReplay } from "../sessions/resumeReplay";
import type { AppRepository } from "./repository";

function database(db=new DatabaseSync(":memory:"),initialize=true) {
 if(initialize){const migrations=new URL("../../src-tauri/migrations/",import.meta.url);for(const file of readdirSync(migrations).filter(f=>f.endsWith(".sql")).sort())db.exec(readFileSync(new URL(file,migrations),"utf8"));
 db.exec("INSERT INTO profiles(id,display_name,created_at,updated_at) VALUES ('u','Profile','now','now'); INSERT INTO workspaces(id,profile_id,name,created_at,updated_at,last_opened_at) VALUES ('w','u','Workspace','now','now','now');");}
 // Keep numbered bindings intact: repeated $1 must bind to the same value.
 const statement=(query:string,values:unknown[]=[])=>{const numbered=query.replace(/\$(\d+)/g,"?$1");return {stmt:db.prepare(numbered),params:Object.fromEntries(values.map((value,index)=>[String(index+1),value]))};};
 const repository=new SqliteSessionsRepository({isResearchScoresFrozen:async()=>false,select:async<T>(query:string,values:unknown[]=[])=>{const {stmt,params}=statement(query,values);return stmt.all(params as never) as T;},executeWrite:async(query,values=[])=>{const {stmt,params}=statement(query,values);return {rowsAffected:Number(stmt.run(params as never).changes)};},executeTransaction:async statements=>{db.exec("BEGIN IMMEDIATE");try{const rows=statements.map(s=>{const{stmt,params}=statement(s.query,s.values);return Number(stmt.run(params as never).changes);});db.exec("COMMIT");return rows;}catch(error){db.exec("ROLLBACK");throw error;}}});
 return {db,repository};
}
function input(repository:SqliteSessionsRepository):AutomaticRvLiteRunInput{return {repository:Object.assign(repository,{recordTargetUsage:vi.fn()}) as unknown as AppRepository,workspaceId:"w",profileId:"u",providerConfig:{id:"p",provider:"openrouter",label:"P",credentialId:"c",enabled:true,createdAt:"now",updatedAt:"now"},model:{providerConfigId:"p",provider:"openrouter",modelId:"m",displayName:"M",route:"openrouter:m",pricing:{},recommended:false,rawMetadata:{},refreshedAt:"now",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:false,confidence:"unknown"},supportedParameters:[],maxOutputTokens:65536,contextTokens:131072,source:"provider",capturedAt:"now"}},protocol:getRvLite("pl","core"),sessionLanguage:"pl",requestedSettings:{maxOutputTokens:1024},sessionFocus:{version:1,first:"location",second:"event"},maxRetries:0};}
describe("directed sessions real SQLite and backup",()=>{
 it("blocks early Reveal and seal, restores a two-part snapshot/checkpoints, and resumes without duplicate calls",async()=>{
  const {db,repository}=database();const directory=mkdtempSync(join(tmpdir(),"directed-backup-"));let calls=0;
  try {
   const abort=new AbortController();const result=await runAutomaticRvLiteSession({...input(repository),signal:abort.signal,chat:async()=>{calls++;if(calls===5)abort.abort();return {content:`Dowód ${calls}`,finishReason:"stop",usage:{totalTokens:100,costUsd:0.1}};}});
   expect(result.state).toBe("Interrupted");
   await expect(repository.acceptReveal(result.sessionId,{source:"external_text",text:"early",hash:"hash"})).rejects.toThrow(/complete/);
   await expect(repository.sealPreReveal(result.sessionId,result.transcript,"hash")).rejects.toThrow(/complete/);
   await backup(db,join(directory,"backup.sqlite"));
   const restoredDb=new DatabaseSync(join(directory,"backup.sqlite"));try {
    const restored=database(restoredDb,false).repository,session=(await restored.getRvSession(result.sessionId))!,snapshot=(await restored.getSessionSnapshot(session.id))!;
    expect(snapshot.sessionFocus).toEqual({version:1,first:"location",second:"event"});
    const events=await restored.listSessionEvents(session.id);expect(events.filter(e=>e.eventType==="FOCUS_PASS_COMPLETED")).toHaveLength(1);
    const replay=await createSessionReplay({repository:input(restored).repository as AppRepository,session,events,liveChat:async()=>({content:`Dowód ${++calls}`,finishReason:"stop",usage:{totalTokens:100,costUsd:0.1}})});
    const final=await runAutomaticRvLiteSession({...input(restored),repository:replay.repository,resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});
    expect(calls).toBe(8);expect(final.state).toBe("AwaitingReveal");expect(await restored.getViewerEvidence(session.id)).toBe(final.transcript);
    await expect(restored.saveSessionSnapshot(session.id,snapshot,"hash")).rejects.toThrow(/immutable|UNIQUE/);
    await restored.acceptReveal(session.id,{source:"external_text",text:"accepted",hash:"hash"});expect((await restored.getRvSession(session.id))?.state).toBe("Revealed");
    expect(restoredDb.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});
   } finally {restoredDb.close();}
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
 });
});
