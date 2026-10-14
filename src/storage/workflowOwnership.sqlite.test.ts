import {DatabaseSync,backup} from "node:sqlite";
import {readFileSync,readdirSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
// Real file-backed SQLite setup and execution can exceed Vitest defaults on Windows CI.
// Scope the allowance to these integration tests; application deadlines are unchanged.
vi.setConfig({hookTimeout:60_000,testTimeout:60_000});
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:bridge.invoke}));
vi.mock("@tauri-apps/plugin-sql",()=>({default:{load:async()=>({close:async()=>undefined})}}));
import {SqliteRepository} from "./sqliteRepository";
import {endRvSession,isRvSessionEnded} from "../sessions/termination";
import {runAutomaticRcpSession,submitExternalReveal} from "../sessions/controller";
import {createSessionReplay} from "../sessions/resumeReplay";
import {getRvLite} from "../resources/protocolRegistry";
import {runAutomaticRvLiteSession} from "../sessions/rvLiteController";
import {runAutomaticCustomSession} from "../sessions/customController";
import {runAutomaticTelepathicSession,resumeTelepathicManualQuestionStage} from "../sessions/telepathicController";
import {runAutomaticPostRevealReview,sendPostRevealTurn,sendMonitorPostRevealReview} from "../sessions/postReveal";
import {resolveUncertainPostRevealReviewStage} from "../sessions/postRevealRecovery";
import {runBlindJudging} from "../judge/engine";
import {runFieldGuideUpdate} from "../aiCenter/fieldGuideUpdate";
import {runViewerNoteReflection} from "../aiCenter/viewerNotes";
import {endTrainingRun} from "../features/training/trainingTermination";
import {assertAbortOwnership} from "../application/abortOwnership";
import type {AppRepository} from "./repository";
const native=readFileSync(new URL("../../src-tauri/src/workflow_ownership.rs",import.meta.url),"utf8").split("#[cfg(test)]")[0];
const sqls=[...native.matchAll(/sqlx::query(?:_scalar)?\("((?:\\.|[^"\\])*)"\)/g)].map(match=>JSON.parse('"'+match[1]+'"') as string);
sqls.push(...[...native.matchAll(/let query="((?:\\.|[^"\\])*)"/g)].map(match=>JSON.parse('"'+match[1]+'"') as string));
const sql=(prefix:string)=>{const matches=sqls.filter(query=>query.startsWith(prefix));if(!matches.length)throw new Error(prefix);return matches[0];};
const registry=readFileSync(new URL("./databaseWriteOperations.ts",import.meta.url),"utf8");
const writes=new Map([...registry.matchAll(/\["((?:\\.|[^"\\])*)", "([a-z0-9_]+)"\]/g)].map(match=>[match[2],JSON.parse('"'+match[1]+'"') as string]));
let db:DatabaseSync;let directory:string;
function bind(query:string,values:unknown[]=[]){const bound:unknown[]=[];return{query:query.replace(/\$(\d+)/g,(_all,index)=>{const value=values[Number(index)-1];bound.push(typeof value==="boolean"?Number(value):value && typeof value==="object"?JSON.stringify(value):value??null);return"?";}),bound};}
function select(query:string,values:unknown[]=[]){const prepared=bind(query,values);return db.prepare(prepared.query).all(...prepared.bound as never[]);}
function scalar(query:string,values:unknown[]=[]){return Object.values(select(query,values)[0]??{})[0];}
function write(query:string,values:unknown[]=[]){const prepared=bind(query,values);return Number(db.prepare(prepared.query).run(...prepared.bound as never[]).changes);}
function statement(input:{operation:string;values:unknown[]}){
 const query=writes.get(input.operation);if(!query)throw new Error(input.operation);
 if(input.operation.startsWith("settings_models_") && String(input.values[0]).startsWith("rvh.workflow.v1:"))throw new Error("Reserved ownership key");
 const indices:Record<string,number>={sessions_update_rv_sessions_01:2,sessions_update_rv_sessions_02:2,sessions_update_rv_sessions_03:2,sessions_insert_session_events_01:1,sessions_insert_target_clarifications_01:1,sessions_update_rv_sessions_04:3,sessions_insert_session_snapshots_01:0,sessions_insert_reveals_01:0};
 if(input.operation in indices && Number(scalar("SELECT COUNT(*) FROM session_events WHERE session_id=$1 AND event_type='RV_USER_FINISHED'",[input.values[indices[input.operation]]])))throw new Error("RV session was ended");
 return write(query,input.values);
}
function transaction<T>(fn:()=>T){db.exec("BEGIN IMMEDIATE");try{const value=fn();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}}
function guard(request:any){const key=`rvh.workflow.v1:${request.profileId}`;write(sql("UPDATE app_settings SET value=value"),[key]);
 if(Number(scalar(sql("SELECT COUNT(*) FROM app_settings WHERE key=$1 AND json_extract(value,'$.owner')=$2"),[key,request.owner,request.version]))!==1)throw new Error("Workflow ownership lost");
 if(Number(scalar(sql("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at"),[request.profileId]))!==1)throw new Error("Profile unavailable");
 for(const entity of request.entities){const prefix=entity.kind==="training"?"SELECT COUNT(*) FROM training_runs WHERE id=$1":entity.kind==="rv"?"SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND profile_id=$2":"SELECT COUNT(*) FROM profiles WHERE id=$1 AND id=$2";if(Number(scalar(sql(prefix),[entity.id,request.profileId]))!==1)throw new Error("Workflow was ended, archived or removed");}
}
async function ownership(request:any){const key=`rvh.workflow.v1:${request.profileId}`;
 if(request.action==="acquire")return transaction(()=>{write(sql("INSERT OR IGNORE INTO app_settings"),[key]);if(Number(scalar(sql("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at"),[request.profileId]))!==1)throw new Error("Profile unavailable");const changed=write(sql("UPDATE app_settings SET value=json_set(value,'$.owner',$1"),[request.owner,key]);if(!changed)throw new Error("Work is running in another window");return{profileId:request.profileId,owner:request.owner,version:Number(scalar(sql("SELECT json_extract(value,'$.version')"),[key]))};});
 if(request.action==="renew")return write(sql("UPDATE app_settings SET value=json_set(value,'$.expiresAt'"),[key,request.owner,request.version])===1;
 if(request.action==="release")return write(sql("UPDATE app_settings SET value=json_set(value,'$.owner',NULL"),[key,request.owner,request.version])===1;
 if(request.action==="inspect"){const raw=scalar(sql("SELECT value FROM app_settings WHERE key=$1"),[key]);return{...(raw?JSON.parse(String(raw)):{}),active:Number(scalar(sql("SELECT COUNT(*) FROM app_settings WHERE key=$1 AND json_extract(value,'$.owner') IS NOT NULL"),[key]))===1};}
 return transaction(()=>{guard(request);if(request.action==="check")return true;
 if(request.postRevealFence){const fence=request.postRevealFence;const valid=scalar(sql("SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND post_reveal_review_lease_owner"),[fence.sessionId,fence.leaseOwner,fence.leaseVersion]);if(Number(valid)!==1)throw new Error("Review fence lost");}
 return request.statements.map(statement);});
}
beforeEach(async()=>{
 directory=mkdtempSync(join(tmpdir(),"rvh-owner-"));db=new DatabaseSync(join(directory,"source.sqlite"));
 // Keep foreign keys enabled before BEGIN; migration PRAGMAs cannot enable them inside it.
 db.exec("PRAGMA foreign_keys=ON");
 const migrations=new URL("../../src-tauri/migrations/",import.meta.url);
 // A single committed fixture transaction avoids hundreds of durable autocommits on Windows.
 transaction(()=>{for(const file of readdirSync(migrations).filter(file=>file.endsWith(".sql")).sort())db.exec(readFileSync(new URL(file,migrations),"utf8"));});
 expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1});
 db.exec("INSERT INTO profiles(id,display_name,created_at,updated_at) VALUES('p','P','t','t'); INSERT INTO workspaces(id,profile_id,name,kind,created_at,updated_at,last_opened_at) VALUES('w','p','W','rv','t','t','t');");
 bridge.invoke.mockImplementation(async(command:string,args:any)=>{if(command==="database_initialize")return;if(command==="database_select_readonly")return select(args.query,args.values);if(command==="database_workflow_ownership")return ownership(args.request);if(command==="database_execute_write")return{rowsAffected:transaction(()=>statement(args.statement))};if(command==="database_execute_write_batch")return transaction(()=>args.statements.map(statement));throw new Error(command);});
 const repository=await SqliteRepository.connect();await repository.createRvSession({id:"s",sessionCode:"S",workspaceId:"w",profileId:"p",runType:"automatic"});await repository.updateRvSessionState("s","Interrupted");await repository.appendSessionEvent("s",{eventType:"VIEWER_OUTPUT_ATTEMPT",role:"controller",metadata:{technicalAttempt:2,status:"uncertain",requestSha256:"frozen-hash",usage:{totalTokens:29}}});await repository.updatePreRevealTranscript("s","accepted blind");
});
afterEach(()=>{vi.useRealTimers();db.close();rmSync(directory,{recursive:true,force:true});bridge.invoke.mockReset();});
it("real SQLite: second repository cannot End while owner is active; late global learning writes are fenced",async()=>{
 const first=await SqliteRepository.connect();const second=await SqliteRepository.connect();let release!:()=>void;let ready!:()=>void;let owned!:AppRepository;let signal!:AbortSignal;const started=new Promise<void>(resolve=>{ready=resolve;});
 const task=first.withWorkflowOwnership({profileId:"p",entity:{kind:"rv",id:"s"}},async(repository,currentSignal)=>{owned=repository;signal=currentSignal;ready();await new Promise<void>(resolve=>{release=resolve;});});
 await started;try{expect(await first.getWorkflowOwnership("p")).toBe("local");expect(await second.getWorkflowOwnership("p")).toBe("other");await expect(endRvSession(second,"s")).rejects.toThrow(/another window/);
 db.exec("UPDATE app_settings SET value=json_set(value,'$.expiresAt','2000-01-01T00:00:00.000Z') WHERE key='rvh.workflow.v1:p'");await endRvSession(second,"s");await expect(assertAbortOwnership(signal)).rejects.toThrow(/ownership lost/);
 const before=select("SELECT * FROM ai_identities");await expect(owned.ensureAiIdentity({profileId:"p",credentialFingerprint:"f",credentialDisplay:"K",providerConfigId:"pc",provider:"custom_openai",modelId:"m",modelRoute:"m",modelDisplayName:"M",role:"viewer"})).rejects.toThrow(/ownership lost/);expect(select("SELECT * FROM ai_identities")).toEqual(before);
 await expect(owned.updatePreRevealTranscript("s","late stale text")).rejects.toThrow(/ownership lost/);
 }finally{release();await task;}
 expect((await second.getRvSession("s"))!.preRevealTranscript).toBe("accepted blind");expect(await isRvSessionEnded(second,"s")).toBe(true);expect(await second.getWorkflowOwnership("p")).toBe("idle");
});
it("real SQLite: End survives backup and every direct RV execution/resolution API rejects before model work",async()=>{
 const repository=await SqliteRepository.connect();const before=await repository.getRvSession("s");const events=await repository.listSessionEvents("s");await endRvSession(repository,"s","end");await endRvSession(repository,"s","second");expect(await repository.getRvSession("s")).toEqual(before);expect((await repository.listSessionEvents("s")).slice(0,-1)).toEqual(events);expect((await repository.listSessionEvents("s")).filter(event=>event.eventType==="RV_USER_FINISHED")).toHaveLength(1);
 await backup(db,join(directory,"backup.sqlite"));db.close();db=new DatabaseSync(join(directory,"backup.sqlite"));const restored=await SqliteRepository.connect();const session=(await restored.getRvSession("s"))!;const chat=vi.fn();
 const common={repository:restored,profileId:"p",sessionId:"s",resumeSession:session,session,chat};
 const calls=[()=>runAutomaticRcpSession(common as never),()=>runAutomaticRvLiteSession(common as never),()=>runAutomaticCustomSession(common as never),()=>runAutomaticTelepathicSession(common as never),()=>resumeTelepathicManualQuestionStage(common as never),()=>runAutomaticPostRevealReview(common as never),()=>sendPostRevealTurn(common as never),()=>sendMonitorPostRevealReview(common as never),()=>resolveUncertainPostRevealReviewStage({...common,stage:"viewer"} as never),()=>runBlindJudging(common as never),()=>runFieldGuideUpdate(common as never),()=>runViewerNoteReflection(common as never),()=>submitExternalReveal(restored,"s","late reveal"),()=>runAutomaticRvLiteSession({...common,resumeSession:undefined,initializationExistingSession:session} as never),()=>runAutomaticRcpSession({...common,resumeSession:undefined,sessionIdentity:{id:"s",sessionCode:"S"}} as never)];
 for(const call of calls)await expect(call()).rejects.toThrow(/ended/);expect(chat).not.toHaveBeenCalled();expect(await restored.getRvSession("s")).toEqual(before);expect(db.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
 await restored.archiveRvSession("s");await restored.restoreRvSession("s");expect(await isRvSessionEnded(restored,"s")).toBe(true);
});
it("real SQLite: Training End preserves ledger under the same profile owner and guards late writes",async()=>{
 const repository=await SqliteRepository.connect();const run=await repository.createTrainingRun({name:"T",status:"Interrupted",mode:"partial",profileId:"p",workspaceId:"w",modelRoute:"pc::m",protocolVariant:"core",targetIds:["t"],categories:[],judgeModelRoutes:[],pauseAfterBlock:false});
 let owned!:AppRepository;await repository.withWorkflowOwnership({profileId:"p",entity:{kind:"training",id:run.id}},async scoped=>{owned=scoped;await scoped.updateTrainingRun(run.id,{error:"partial work"});await expect(endTrainingRun(await SqliteRepository.connect(),run.id)).rejects.toThrow(/another window/);});
 await endTrainingRun(repository,run.id,"end");const ended=(await repository.listTrainingRuns())[0];expect(ended.termination).toEqual({reason:"user_finished",endedAt:"end"});expect(ended.errors).toEqual(["partial work"]);await expect(owned.updateTrainingRun(run.id,{status:"Running"})).rejects.toThrow(/ended|settled/);expect((await repository.listTrainingRuns())[0]).toEqual(ended);
});
it("real SQLite: heartbeat loss aborts the live signal and no subsequent callback can dispatch",async()=>{
 vi.useFakeTimers();const repository=await SqliteRepository.connect();let release!:()=>void;let ready!:()=>void;let signal!:AbortSignal;const started=new Promise<void>(resolve=>{ready=resolve;});
 const work=repository.withWorkflowOwnership({profileId:"p",entity:{kind:"rv",id:"s"}},async(_owned,current)=>{signal=current;ready();await new Promise<void>(resolve=>{release=resolve;});});
 await started;try{db.exec("UPDATE app_settings SET value=json_set(value,'$.expiresAt','2000-01-01T00:00:00.000Z') WHERE key='rvh.workflow.v1:p'");await vi.advanceTimersByTimeAsync(10000);expect(signal.aborted).toBe(true);await expect(assertAbortOwnership(signal)).rejects.toThrow(/ownership lost/);}finally{release();await work;}
 expect((await repository.getRvSession("s"))?.preRevealTranscript).toBe("accepted blind");
});
it("real SQLite: a failed owned batch rolls back its earlier global write",async()=>{
 const repository=await SqliteRepository.connect();await repository.withWorkflowOwnership({profileId:"p",entity:{kind:"rv",id:"s"}},async()=>{
  const check=[...bridge.invoke.mock.calls].reverse().find(call=>call[0]==="database_workflow_ownership" && call[1].request.action==="check")![1].request;
  await expect(bridge.invoke("database_workflow_ownership",{request:{...check,action:"write",statements:[{operation:"settings_models_insert_app_settings_01",values:["global-learning-fixture","accepted","t"]},{operation:"settings_models_insert_app_settings_01",values:[null,"failure","t"]}]}})).rejects.toThrow();
  expect(select("SELECT * FROM app_settings WHERE key='global-learning-fixture'")).toEqual([]);
 });
});
it("real SQLite facade: fenced Resume keeps replay and does not repeat accepted blind output",async()=>{
 const repository=await SqliteRepository.connect();const config={id:"pc",provider:"custom_openai",label:"P",credentialId:"key",enabled:true,createdAt:"t",updatedAt:"t"} as const;
 const model={providerConfigId:"pc",provider:"custom_openai",modelId:"m",displayName:"M",route:"custom_openai:m",pricing:{},recommended:false,rawMetadata:{},refreshedAt:"t",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:false,confidence:"unknown"},supportedParameters:[],maxOutputTokens:65536,contextTokens:131072,source:"provider",capturedAt:"t"}} as never;
 const common={repository,workspaceId:"w",profileId:"p",providerConfig:config,model,protocol:getRvLite("en","core"),sessionLanguage:"en" as const,requestedSettings:{maxOutputTokens:16384},maxRetries:0};const stop=new AbortController();
 const initial=await runAutomaticRvLiteSession({...common,signal:stop.signal,chat:async()=>{stop.abort();return{content:"accepted first step",finishReason:"stop",usage:{totalTokens:11}};}});expect(initial.state).toBe("Interrupted");
 const session=(await repository.getRvSession(initial.sessionId))!,snapshot=(await repository.getSessionSnapshot(session.id))!;
 const live=vi.fn(async()=>({content:"resumed distinct evidence",finishReason:"stop",usage:{totalTokens:12}}));const replay=await createSessionReplay({repository,session,events:await repository.listSessionEvents(session.id),liveChat:live});expect(replay.replayedResponseCount).toBe(1);
 const result=await runAutomaticRvLiteSession({...common,repository:replay.repository,resumeSession:session,resumeContinuationRoute:snapshot.continuationRoute,chat:replay.chat});expect(result.stopReason ?? result.state).toBe("AwaitingReveal");expect(result.transcript.match(/accepted first step/g)).toHaveLength(1);expect(live).toHaveBeenCalled();expect(await repository.getWorkflowOwnership("p")).toBe("idle");
 await expect(replay.repository.updatePreRevealTranscript(session.id,"late bypass")).rejects.toThrow(/settled/);expect((await repository.getRvSession(session.id))?.preRevealTranscript).toBe(result.transcript);
});
