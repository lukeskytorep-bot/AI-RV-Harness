import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
vi.setConfig({hookTimeout:60_000,testTimeout:60_000});
const bridge = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core", () => ({invoke:bridge.invoke}));
vi.mock("@tauri-apps/plugin-sql", () => ({default:{load:async()=>({close:async()=>undefined})}}));
import { SqliteRepository } from "./sqliteRepository";
import { runFieldGuideUpdate } from "../aiCenter/fieldGuideUpdate";
import { runViewerNoteReflection } from "../aiCenter/viewerNotes";
import { prepareFieldGuideForSession, viewerSystemPromptSnapshotFromFieldGuide } from "../aiCenter/fieldGuide";
import { prepareViewerNotesForSession } from "../aiCenter/viewerNotes";
import { sha256Text } from "../application/sha256";
import { executeTrainingRun } from "../features/training/trainingExecution";
import { serializePostRevealTurn } from "../sessions/postRevealTranscript";
import { supportedAutomaticPostRevealReviewRequests } from "../sessions/postReveal";
import type { ProviderModel } from "../providers/types";
import type { SessionSnapshot } from "../sessions/types";
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
function statement(input:{operation:string;values:unknown[]},ownedProject?:string){
 const query=writes.get(input.operation);if(!query)throw new Error(input.operation);
 if(input.operation.startsWith("settings_models_") && String(input.values[0]).match(/^rvh\.(workflow|research\.end)\.v1:/))throw new Error("Reserved ownership key");
 const indices:Record<string,number>={sessions_update_rv_sessions_01:2,sessions_update_rv_sessions_02:2,sessions_update_rv_sessions_03:2,sessions_insert_session_events_01:1,sessions_insert_target_clarifications_01:1,judge_insert_judge_runs_01:1,sessions_update_rv_sessions_04:3,sessions_insert_session_snapshots_01:0,sessions_insert_reveals_01:0};
 if(input.operation in indices && Number(scalar("SELECT COUNT(*) FROM session_events WHERE session_id=$1 AND event_type='RV_USER_FINISHED'",[input.values[indices[input.operation]]])))throw new Error("RV session was ended");
 const projectIndices:Record<string,number>={research_update_research_projects_01:1,research_update_research_projects_02:1,research_update_research_projects_03:2,research_update_research_projects_04:2,research_insert_research_conditions_01:1,research_insert_research_assignments_01:1,research_insert_blinding_mappings_01:1,research_insert_research_results_01:1,sessions_insert_rv_sessions_01:6,targets_insert_target_usage_01:3};
 let projectId=input.operation in projectIndices?input.values[projectIndices[input.operation]]:undefined;
 if(input.operation==="research_update_research_assignments_01")projectId=scalar("SELECT research_project_id FROM research_assignments WHERE id=$1",[input.values[2]]);
 else if(input.operation in indices)projectId=scalar("SELECT research_project_id FROM rv_sessions WHERE id=$1",[input.values[indices[input.operation]]]);
 if(input.operation==="judge_insert_judge_scores_01")projectId=scalar("SELECT s.research_project_id FROM judge_runs j JOIN rv_sessions s ON s.id=j.session_id WHERE j.id=$1",[input.values[1]]);
 if(projectId && Number(scalar("SELECT COUNT(*) FROM app_settings WHERE key='rvh.workflow.v1:research:' || $1 AND json_extract(value,'$.owner') IS NOT NULL AND json_extract(value,'$.expiresAt') > strftime('%Y-%m-%dT%H:%M:%fZ','now')",[projectId])) && ownedProject!==projectId)throw new Error("Research ownership is required");
 if(projectId && !["research_update_research_projects_01","research_update_research_projects_02"].includes(input.operation) && Number(scalar("SELECT COUNT(*) FROM app_settings WHERE key='rvh.research.end.v1:' || $1",[projectId])))throw new Error("Research execution was ended");
 return write(query,input.values);
}
function transaction<T>(fn:()=>T){db.exec("BEGIN IMMEDIATE");try{const value=fn();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}}
function guard(request:any){const key=`rvh.workflow.v1:${request.profileId}`;write(sql("UPDATE app_settings SET value=value"),[key]);
 if(Number(scalar(sql("SELECT COUNT(*) FROM app_settings WHERE key=$1 AND json_extract(value,'$.owner')=$2"),[key,request.owner,request.version]))!==1)throw new Error("Workflow ownership lost");
 const projectId=request.profileId.startsWith("research:")?request.profileId.slice(9):undefined;
 if(projectId){if(Number(scalar(sql("SELECT COUNT(*) FROM research_projects r JOIN workspaces"),[projectId]))!==1)throw new Error("Research was archived or removed");if(!request.entities.some((entity:any)=>entity.kind==="research" && entity.id===projectId && entity.allowEnded) && Number(scalar(sql("SELECT COUNT(*) FROM app_settings WHERE key='rvh.research.end.v1:'"),[projectId])))throw new Error("Research execution was ended");}
 else if(Number(scalar(sql("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at"),[request.profileId]))!==1)throw new Error("Profile unavailable");
 for(const entity of request.entities){if(entity.kind==="research")continue;const profile=entity.profileId ?? request.profileId;if(projectId && Number(scalar(sql("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at"),[profile]))!==1)throw new Error("Profile archived");if(entity.kind==="rv" && projectId && Number(scalar(sql("SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND research_project_id=$2"),[entity.id,projectId]))!==1)throw new Error("Research scope mismatch");const prefix=entity.kind==="training"?"SELECT COUNT(*) FROM training_runs WHERE id=$1":entity.kind==="rv"?"SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND profile_id=$2":"SELECT COUNT(*) FROM profiles WHERE id=$1 AND id=$2";if(Number(scalar(sql(prefix),[entity.id,profile]))!==1)throw new Error("Workflow was ended, archived or removed");}
}
async function ownership(request:any){const key=`rvh.workflow.v1:${request.profileId}`;
 if(request.action==="acquire")return transaction(()=>{write(sql("INSERT OR IGNORE INTO app_settings"),[key]);if(request.profileId.startsWith("research:")){if(Number(scalar(sql("SELECT COUNT(*) FROM research_projects r JOIN workspaces"),[request.profileId.slice(9)]))!==1)throw new Error("Research unavailable");}else if(Number(scalar(sql("SELECT COUNT(*) FROM profiles WHERE id=$1 AND archived_at"),[request.profileId]))!==1)throw new Error("Profile unavailable");const changed=write(sql("UPDATE app_settings SET value=json_set(value,'$.owner',$1"),[request.owner,key]);if(!changed)throw new Error("Work is running in another window");return{profileId:request.profileId,owner:request.owner,version:Number(scalar(sql("SELECT json_extract(value,'$.version')"),[key]))};});
 if(request.action==="renew")return write(sql("UPDATE app_settings SET value=json_set(value,'$.expiresAt'"),[key,request.owner,request.version])===1;
 if(request.action==="release")return write(sql("UPDATE app_settings SET value=json_set(value,'$.owner',NULL"),[key,request.owner,request.version])===1;
 if(request.action==="inspect"){const raw=scalar(sql("SELECT value FROM app_settings WHERE key=$1"),[key]);return{...(raw?JSON.parse(String(raw)):{}),active:Number(scalar(sql("SELECT COUNT(*) FROM app_settings WHERE key=$1 AND json_extract(value,'$.owner') IS NOT NULL"),[key]))===1};}
 if(request.action==="endResearch")return transaction(()=>{const id=request.profileId.slice(9);guard({...request,entities:[{kind:"research",id,allowEnded:true}]});const markerKey=`rvh.research.end.v1:${id}`;const existing=scalar(sql("SELECT value FROM app_settings WHERE key=$1"),[markerKey]);if(existing)return JSON.parse(String(existing));const state=String(scalar(sql("SELECT state FROM research_projects WHERE id=$1"),[id]));if(!["Locked","Running","Interrupted","SessionsComplete","Judging","ScoresFrozen","Unblinded"].includes(state))throw new Error("Research cannot be ended");const marker={reason:"user_finished",endedAt:request.endedAt,stateAtEnd:state,phase:["SessionsComplete","Judging"].includes(state)?"judging":["ScoresFrozen","Unblinded"].includes(state)?"finalization":"sessions"};write(sql("INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2"),[markerKey,JSON.stringify(marker)]);return marker;});
 return transaction(()=>{guard(request);if(request.action==="check")return true;
 if(request.postRevealFence){const fence=request.postRevealFence;const valid=scalar(sql("SELECT COUNT(*) FROM rv_sessions WHERE id=$1 AND post_reveal_review_lease_owner"),[fence.sessionId,fence.leaseOwner,fence.leaseVersion]);if(Number(valid)!==1)throw new Error("Review fence lost");}
 return request.statements.map((input:any)=>statement(input,request.profileId.startsWith("research:")?request.profileId.slice(9):undefined));});
}
beforeEach(async()=>{
 directory=mkdtempSync(join(tmpdir(),"rvh-owner-"));db=new DatabaseSync(join(directory,"source.sqlite"));db.exec("PRAGMA foreign_keys=ON");
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
const finished = (content: string) => ({content, usage:{}, responseEvidence:{version:1 as const,transportOutcome:"response_finished" as const,boundary:"body_read" as const}});
async function setup(corruptGuide = false) {
 const repository = await SqliteRepository.connect();
 const provider = await repository.createProviderConfig({id:"pc",provider:"custom_openai",label:"Fixture",credentialId:"key"});
 await repository.updateProviderConnectionStatus(provider.id,"ok");provider.lastStatus="ok";
 db.exec("UPDATE profiles SET credential_id='key'");
 const profile = (await repository.listProfiles())[0];
 const model: ProviderModel = {providerConfigId:provider.id,provider:"custom_openai",modelId:"m",displayName:"M",route:"custom_openai:m",capabilities:{inputModalities:["text"],outputModalities:["text"],supportsVision:false,supportsStreaming:true,reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:false,confidence:"unknown"},supportedParameters:[],contextTokens:262144,maxOutputTokens:65536,source:"provider",capturedAt:"t"},pricing:{},recommended:false,rawMetadata:{},refreshedAt:"t"};
 const fieldGuide = await prepareFieldGuideForSession({repository,profile,providerConfig:provider,model,language:"en"});
 const prompt = await viewerSystemPromptSnapshotFromFieldGuide(fieldGuide);
 const notes = await prepareViewerNotesForSession({repository,profileId:profile.id,providerConfig:provider,model,enabled:true});
 const snapshot = (sessionId:string, revealHash?:string):SessionSnapshot => ({schemaVersion:3,sessionId,sessionCode:sessionId,workspaceId:"w",profileId:profile.id,providerConfigId:provider.id,credentialId:"key",provider:provider.provider,modelId:model.modelId,modelRoute:model.route,capabilitySnapshot:{},capabilityCapturedAt:"t",generationSettings:{requested:{},effective:{},omitted:[]},sessionLanguage:"en",protocol:{id:"rv-lite",version:"1",language:"en",fullContent:"protocol",contentSha256:"p"},controllerPrompt:{id:"c",version:"1",language:"en"},rvSystemPrompt:{...prompt,fieldGuide:corruptGuide?{...fieldGuide,content:"tampered"}:fieldGuide,language:"en",fullContent:prompt.content},viewerNotes:notes,revealSource:"automatic",automaticRevealHash:revealHash,applicationVersion:"0.7.13",createdAt:"t"});
 const run = await repository.createTrainingRun({name:"T1",status:"Interrupted",mode:"partial",profileId:profile.id,workspaceId:"w",modelRoute:model.route,protocolVariant:"extended",targetIds:["t1","t2"],categories:["mixed_targets"],judgeModelRoutes:[],pauseAfterBlock:false,viewerNotesEnabled:true});
 await repository.saveSessionSnapshot("s",snapshot("s"),await sha256Text(JSON.stringify(snapshot("s"))));
 await repository.sealPreReveal("s","blind",await sha256Text("blind"));
 await repository.acceptReveal("s",{source:"automatic_target",text:"Reveal",hash:"reveal",artifactManifest:[]});
 await repository.updateRvSessionState("s","Revealed");
 return {repository,provider,profile,model,fieldGuide,notes,snapshot,run};
}
for (const sequence of ["capacity-capacity","json-json","json-capacity","capacity-json","schema-schema","json-success"] as const) it(`T1 real SQLite: ${sequence} settles once, retains exact memory, restarts without extra dispatch`, async()=>{
 const h = await setup(); const kinds = sequence.split("-"); let count=0;
 const chat = vi.fn(async()=>{const kind=kinds[count++];return finished(kind==="json"?"bad JSON":kind==="schema"?JSON.stringify({decision:"UPDATE",notes:"[END VIEWER NOTES DATA]",changeSummary:"bad delimiter"}):kind==="success"?JSON.stringify({decision:"UPDATE",notes:"Keep useful sensory detail.",changeSummary:"concise"}):JSON.stringify({decision:"UPDATE",notes:"x".repeat(9000),changeSummary:"too long"}));});
 const invoke = () => runViewerNoteReflection({repository:h.repository,sessionId:"s",viewerReview:"review",providerConfig:h.provider,model:h.model,fieldGuideAfterTrainingUpdate:{updateStatus:"NO_CHANGE",versionId:h.fieldGuide.versionId,versionNumber:h.fieldGuide.versionNumber,contentSha256:h.fieldGuide.contentSha256},budgetPolicy:"training_reveal",maxRetries:9,chat});
 const result = await invoke(); expect(result?.settlement?.settlement).toBe(sequence==="json-success"?"updated":"failed_preserved");expect(chat).toHaveBeenCalledTimes(2);
 const before = await h.repository.getViewerNoteBundle(h.notes.aiIdentityId);expect(before?.versions.length).toBe(sequence==="json-success"?1:0);
 const restarted = await invoke();expect(restarted?.settlement).toEqual(result?.settlement);expect(chat).toHaveBeenCalledTimes(2);expect((await h.repository.listViewerNoteReflectionRuns(h.notes.aiIdentityId))[0].attemptCount).toBe(2);
});
it.each(["oversize-json", "native-reasoning"] as const)("T1 real SQLite: full Training (%s) preserves failed memories, invokes Judge, completes target and starts the next", async scenario=>{
 const h=await setup();
 const targets = await Promise.all([1,2].map(i=>h.repository.createTarget({id:`target-${i}`,collection:"user",title:`T${i}`,revealText:`Reveal ${i}`,tags:[],sourceMetadata:{category:"mixed_targets"}})));
 await h.repository.updateTrainingRun(h.run.id,{activeTargetCheckpoint:null});
 // Freeze real target IDs in the new run; creation is the only target-plan mutation.
 const run=await h.repository.createTrainingRun({name:"Full T1",status:"Planned",mode:"partial",profileId:h.profile.id,workspaceId:"w",modelRoute:h.model.route,protocolVariant:"extended",targetIds:targets.map(t=>t.id),categories:["mixed_targets"],judgeModelRoutes:[],pauseAfterBlock:false,viewerNotesEnabled:true});
 const blind=vi.fn(async(request:any)=>{const id=request.sessionIdentity.id;await request.repository.createRvSession({id,sessionCode:request.sessionIdentity.sessionCode,workspaceId:"w",profileId:h.profile.id,runType:"automatic",targetId:request.automaticTarget.id});const snapshot={...h.snapshot(id,request.capturedAutomaticReveal.hash),rvSystemPrompt:{...request.rvSystemPrompt,fullContent:request.rvSystemPrompt.content},viewerNotes:request.viewerNotes};await request.repository.saveSessionSnapshot(id,snapshot,await sha256Text(JSON.stringify(snapshot)));await request.onSessionCreated(id,request.sessionIdentity.sessionCode);await request.repository.sealPreReveal(id,"blind",await sha256Text("blind"));await request.repository.acceptReveal(id,request.capturedAutomaticReveal);await request.repository.recordTargetUsage({targetId:request.automaticTarget.id,profileId:h.profile.id,sessionId:id});await request.repository.updateRvSessionState(id,"Revealed");return{sessionId:id,sessionCode:request.sessionIdentity.sessionCode,state:"Revealed",transcript:"blind"};});
 const review=vi.fn(async(request:any)=>{await request.repository.appendPostRevealTurn(request.sessionId,"user",supportedAutomaticPostRevealReviewRequests("en")[0]);return request.repository.appendPostRevealTurn(request.sessionId,"assistant","review");});
 const fgChat=vi.fn(async()=>{if(scenario==="native-reasoning")throw nativeReasoningFailure();return finished(JSON.stringify({decision:"UPDATE",fieldGuide:"x".repeat(9000),changeSummary:"too long"}));});
 const vnChat=vi.fn(async()=>{if(scenario==="native-reasoning")throw nativeReasoningFailure();return finished("bad JSON");});const judge=vi.fn(async()=>({scores:[],aggregate:null}));
 const outcome=await executeTrainingRun({repository:h.repository,initial:run,profile:h.profile,providerConfig:h.provider,model:h.model,judges:[{providerConfig:h.provider,model:h.model}],targets,language:"en",settings:{maxRetries:9,requestTimeoutMs:30000,sessionCodePrefix:"T"},dependencies:{runAutomaticRvLiteSession:blind,runAutomaticPostRevealReview:review,runFieldGuideUpdate:(request:Parameters<typeof runFieldGuideUpdate>[0])=>runFieldGuideUpdate({...request,chat:fgChat}),runViewerNoteReflection:(request:Parameters<typeof runViewerNoteReflection>[0])=>runViewerNoteReflection({...request,chat:vnChat}),runBlindJudging:judge} as any});
 expect(outcome.error).toBeUndefined();expect(outcome.run.status).toBe("Completed");expect(blind).toHaveBeenCalledTimes(2);expect(judge).toHaveBeenCalledTimes(2);expect(fgChat).toHaveBeenCalledTimes(4);expect(vnChat).toHaveBeenCalledTimes(4);
 const persisted=(await h.repository.listTrainingRuns()).find(r=>r.id===run.id)!;expect(persisted.learningSettlements?.filter(s=>s.settlement==="failed_preserved")).toHaveLength(4);expect((await h.repository.getViewerNoteBundle(h.notes.aiIdentityId))?.versions).toHaveLength(0);expect((await h.repository.getFieldGuideBundle(h.notes.aiIdentityId,"en"))?.activeVersion?.id).toBe(h.fieldGuide.versionId);
});
function reflectionInput(h:Awaited<ReturnType<typeof setup>>,chat:NonNullable<Parameters<typeof runViewerNoteReflection>[0]["chat"]>) {
 return {repository:h.repository,sessionId:"s",viewerReview:"review",providerConfig:h.provider,model:h.model,fieldGuideAfterTrainingUpdate:{updateStatus:"NO_CHANGE" as const,versionId:h.fieldGuide.versionId,versionNumber:h.fieldGuide.versionNumber,contentSha256:h.fieldGuide.contentSha256},budgetPolicy:"training_reveal" as const,maxRetries:9,chat};
}
it("T1 real SQLite: crash after the first durable candidate replays it and consumes only the remaining slot",async()=>{
 const h=await setup();const chat=vi.fn(async()=>finished("bad JSON"));
 const original=bridge.invoke.getMockImplementation()!;let crash=true;
 bridge.invoke.mockImplementation(async(...args:unknown[])=>{const result=await original(...args);const payload=JSON.stringify(args);if(crash && payload.includes("LEARNING_PHYSICAL_ATTEMPT") && payload.includes('\\"state\\":\\"finished\\"')){crash=false;throw new Error("simulated DB interruption after durable response");}return result;});
 await expect(runViewerNoteReflection(reflectionInput(h,chat))).rejects.toThrow("DB interruption");expect(chat).toHaveBeenCalledTimes(1);bridge.invoke.mockImplementation(original);
 expect((await runViewerNoteReflection(reflectionInput(h,chat)))?.settlement?.attempts).toBe(2);expect(chat).toHaveBeenCalledTimes(2);
 await runViewerNoteReflection(reflectionInput(h,chat));expect(chat).toHaveBeenCalledTimes(2);
});
it("T1 real SQLite: failure audit committed before settlement crash is recovered without redispatch",async()=>{
 const h=await setup();const chat=vi.fn(async()=>finished(JSON.stringify({decision:"UPDATE",notes:"x".repeat(9000),changeSummary:"too long"})));
 const original=bridge.invoke.getMockImplementation()!;
 bridge.invoke.mockImplementation(async(...args:unknown[])=>{if(JSON.stringify(args).includes("LEARNING_SETTLEMENT"))throw new Error("DB settlement unavailable");return original(...args);});
 await expect(runViewerNoteReflection(reflectionInput(h,chat))).rejects.toThrow("DB settlement");expect(chat).toHaveBeenCalledTimes(2);bridge.invoke.mockImplementation(original);
 expect((await runViewerNoteReflection(reflectionInput(h,chat)))?.settlement?.settlement).toBe("failed_preserved");expect(chat).toHaveBeenCalledTimes(2);
});
for(const stopAt of [1,2])it(`T1 real SQLite: Stop at dispatch ${stopAt} never settles as warning`,async()=>{
 const h=await setup();const controller=new AbortController();let calls=0;const chat=vi.fn(async()=>{if(++calls===stopAt)controller.abort(new Error("user Stop"));return finished("bad JSON");});
 await expect(runViewerNoteReflection({...reflectionInput(h,chat),signal:controller.signal})).rejects.toThrow("user Stop");expect(chat).toHaveBeenCalledTimes(stopAt);expect((await h.repository.listSessionEvents("s")).some(e=>e.eventType==="LEARNING_SETTLEMENT")).toBe(false);
});
it("T1 real SQLite: successful Field Guide is retained when notes fail",async()=>{
 const h=await setup();const fg=await runFieldGuideUpdate({repository:h.repository,trainingRun:h.run,sessionId:"s",postRevealReview:"review",providerConfig:h.provider,model:h.model,budgetPolicy:"training_reveal",chat:async()=>finished(JSON.stringify({decision:"UPDATE",fieldGuide:"Preserve sensory rhythm.",changeSummary:"refined"}))});expect(fg?.status).toBe("UPDATE");
 const version=(await h.repository.listFieldGuideVersions(h.notes.aiIdentityId,"en")).find(v=>v.id===fg?.audit.resultVersionId)!;
 const result=await runViewerNoteReflection({...reflectionInput(h,async()=>finished("bad JSON")),fieldGuideAfterTrainingUpdate:{updateStatus:"UPDATE",versionId:version.id,versionNumber:version.versionNumber,contentSha256:version.contentSha256}});expect(result?.settlement?.settlement).toBe("failed_preserved");expect((await h.repository.getFieldGuideBundle(h.notes.aiIdentityId,"en"))?.activeVersion?.id).toBe(version.id);
});
it("T1 real SQLite: completed API errors consume at most two requests even with maxRetries 9",async()=>{
 const h=await setup();const {ProviderCallError}=await import("../providers/providerError");
 const chat=vi.fn(async()=>{throw new ProviderCallError({code:"http_status",message:"API refused request (429)",phase:"validating_response",httpStatus:429,responseEvidence:{version:1,transportOutcome:"response_finished",boundary:"body_read"}});});
 const result=await runViewerNoteReflection(reflectionInput(h,chat));expect(result?.status).toBe("FAILED_PROVIDER");expect(result?.settlement?.attempts).toBe(2);expect(chat).toHaveBeenCalledTimes(2);await runViewerNoteReflection(reflectionInput(h,chat));expect(chat).toHaveBeenCalledTimes(2);
});
it("T1 real SQLite: local context preflight settles without a request",async()=>{
 const h=await setup();const chat=vi.fn();const result=await runViewerNoteReflection({...reflectionInput(h,chat),model:{...h.model,capabilities:{...h.model.capabilities,contextTokens:1}}});expect(result?.status).toBe("FAILED_OUTPUT_PREFLIGHT");expect(result?.settlement?.attempts).toBe(0);expect(chat).not.toHaveBeenCalled();
});
it("T1 real SQLite: ownership loss during a response is never a learning warning",async()=>{
 const h=await setup();const chat=vi.fn(async()=>{db.exec("UPDATE app_settings SET value=json_set(value,'$.owner','other') WHERE key='rvh.workflow.v1:p'");return finished("bad JSON");});
 await expect(runViewerNoteReflection(reflectionInput(h,chat))).rejects.toThrow(/ownership/i);expect(chat).toHaveBeenCalledTimes(1);expect(db.prepare("SELECT COUNT(*) AS n FROM session_events WHERE event_type='LEARNING_SETTLEMENT'").get()).toEqual({n:0});
});
it("T1 real SQLite: corrupt frozen Field Guide hash blocks before any request",async()=>{
 const h=await setup(true);const chat=vi.fn();await expect(runViewerNoteReflection(reflectionInput(h,chat))).rejects.toThrow(/hash mismatch/);expect(chat).not.toHaveBeenCalled();
});
it("T1 real SQLite: historical FAILED_CAPACITY is settled without another reflection",async()=>{
 const h=await setup();const chat=vi.fn(async()=>finished(JSON.stringify({decision:"UPDATE",notes:"x".repeat(9000),changeSummary:"too long"})));await runViewerNoteReflection(reflectionInput(h,chat));
 db.exec("DELETE FROM session_events WHERE event_type IN ('LEARNING_PHYSICAL_ATTEMPT','LEARNING_SETTLEMENT')");
 const recovered=await runViewerNoteReflection(reflectionInput(h,chat));expect(recovered?.status).toBe("FAILED_CAPACITY");expect(recovered?.settlement?.settlement).toBe("failed_preserved");expect(chat).toHaveBeenCalledTimes(2);
});
it("T1 real SQLite: existing Resume dialog resolves uncertainty without resetting the two-request cap",async()=>{
 const h=await setup();const {prepareTrainingRunResume}=await import("../features/training/trainingResumeRecovery");
 await h.repository.updateTrainingRun(h.run.id,{activeTargetCheckpoint:{targetId:"t1",sessionId:"s",stage:"field_guide_update_completed",fieldGuideAfterUpdate:{updateStatus:"NO_CHANGE",versionId:h.fieldGuide.versionId,versionNumber:h.fieldGuide.versionNumber,contentSha256:h.fieldGuide.contentSha256}}});
 const chat=vi.fn(async()=>{throw new Error("connection closed after dispatch");});const invoke=()=>runViewerNoteReflection(reflectionInput(h,chat));
 await expect(invoke()).rejects.toThrow("unconfirmed");await expect(invoke()).rejects.toThrow("unconfirmed");expect(chat).toHaveBeenCalledTimes(1);
 expect(await prepareTrainingRunResume({repository:h.repository,runId:h.run.id,fallbackLanguage:"en",confirmUncertainViewerReview:async()=>false})).toBeNull();
 for(let i=0;i<2;i++){
   await prepareTrainingRunResume({repository:h.repository,runId:h.run.id,fallbackLanguage:"en",confirmUncertainViewerReview:async()=>true});
   if(i===0)await expect(invoke()).rejects.toThrow("unconfirmed");
 }
 const result=await invoke();expect(result?.settlement?.settlement).toBe("failed_preserved");expect(result?.settlement?.attempts).toBe(2);expect(chat).toHaveBeenCalledTimes(2);
});
it("T1 real SQLite: reservation DB failure stops before dispatch and never becomes failed_preserved",async()=>{
 const h=await setup();db.exec("CREATE TRIGGER fixture_learning_write_error BEFORE INSERT ON session_events WHEN NEW.event_type='LEARNING_PHYSICAL_ATTEMPT' BEGIN SELECT RAISE(ABORT,'fixture DB reservation failure'); END;");
 const chat=vi.fn();await expect(runViewerNoteReflection(reflectionInput(h,chat))).rejects.toThrow(/DB reservation/);expect(chat).not.toHaveBeenCalled();expect((await h.repository.listViewerNoteReflectionRuns(h.notes.aiIdentityId))[0].status).toBe("PENDING");
});

import {executeLearningProposal,LearningProposalFailure} from "../aiCenter/learningExecution";
import {ProviderCallError} from "../providers/providerError";
import {prepareTrainingRunResume} from "../features/training/trainingResumeRecovery";

it.each(["field_guide","viewer_notes"] as const)("AUDITOR: completed local preflight settlement for %s resumes without uncertain-dispatch confirmation",async kind=>{
 const h=await setup();
 await h.repository.updateTrainingRun(h.run.id,{activeTargetCheckpoint:{targetId:"t1",sessionId:"s",stage:kind==="field_guide"?"review_completed":"field_guide_update_completed",fieldGuideAfterUpdate:{updateStatus:"NO_CHANGE",versionId:h.fieldGuide.versionId,versionNumber:h.fieldGuide.versionNumber,contentSha256:h.fieldGuide.contentSha256}}});
 const chat=vi.fn();
 const model={...h.model,capabilities:{...h.model.capabilities,contextTokens:1}};
 const result=kind==="viewer_notes"?await runViewerNoteReflection({...reflectionInput(h,chat),model}):await runFieldGuideUpdate({repository:h.repository,trainingRun:h.run,sessionId:"s",postRevealReview:"review",providerConfig:h.provider,model,budgetPolicy:"training_reveal",chat});
 expect(result?.settlement?.status).toBe("FAILED_OUTPUT_PREFLIGHT");expect(result?.settlement?.attempts).toBe(0);expect(chat).not.toHaveBeenCalled();
 const confirm=vi.fn(async()=>false);
 const resumed=await prepareTrainingRunResume({repository:h.repository,runId:h.run.id,fallbackLanguage:"en",confirmUncertainViewerReview:confirm});
 expect(confirm).not.toHaveBeenCalled();expect(resumed?.id).toBe(h.run.id);
});

it.each(["native_error","returned_value"] as const)("AUDITOR: output-only-reasoning recovery uses established instruction and exact cap for %s",async shape=>{
 const h=await setup();
 const model={...h.model,capabilities:{...h.model.capabilities,reasoning:{supported:true,supportsMaxTokens:true,efforts:["high"],confidence:"provider_metadata"}}} as ProviderModel;
 let n=0;
 const chat=vi.fn(async()=>{if(n++===0){if(shape==="native_error")throw new ProviderCallError({code:"unknown",message:"provider returned reasoning without a final assistant response [finish-reason=stop]",phase:"validating_response",responseEvidence:{version:1,transportOutcome:"response_finished",boundary:"sse_done"}});return {...finished(""),reasoningContent:"Reasoning only",finishReason:"stop"};}return {...finished("complete final answer"),finishReason:"stop"};});
 await executeLearningProposal({repository:h.repository,sessionId:"s",packetHash:"audit-recovery-"+shape,kind:"viewer_notes",config:h.provider,modelId:h.model.modelId,chat,
 analytical:{model,operationKind:"viewer_notes_reflection",learningObjectCapacityTokens:1024,budgetPolicy:"training_reveal",requestedSettings:{reasoningEffort:"high"},recoveryInstruction:"AUDIT RECOVERY INSTRUCTION",recoveryReasoningMaxTokens:10000,recoveryReasoningMaxTokensSupported:true},messages:[{role:"user",content:"Return the final answer"}],
 parse:response=>{if(!response.content.trim())throw new LearningProposalFailure("FAILED_PROVIDER","reasoning without a final assistant response",0);return response.content;},repairMessages:()=>[{role:"user",content:"Produce final content"}]});
 expect(chat).toHaveBeenCalledTimes(2);
 const second=(chat.mock.calls as unknown as Array<[any]>)[1][0];
 expect(second.messages.at(-1).content).toContain("AUDIT RECOVERY INSTRUCTION");
 expect(second.settings.effective.reasoningMaxTokens).toBe(10000);
});

it.each(["field_guide","viewer_notes"] as const)("AUDITOR: %s retries the native finished reasoning-only failure once and accepts the second response",async kind=>{
 const h=await setup();let count=0;
 const chat=vi.fn(async()=>{if(count++===0)throw new ProviderCallError({code:"unknown",message:"provider returned reasoning without a final assistant response [finish-reason=stop]",phase:"validating_response",responseEvidence:{version:1,transportOutcome:"response_finished",boundary:"sse_done"}});return finished(JSON.stringify(kind==="viewer_notes"?{decision:"NO_CHANGE",notes:null,changeSummary:"No useful update"}:{decision:"NO_CHANGE",fieldGuide:null,changeSummary:"No useful update"}));});
 const result=kind==="viewer_notes"?await runViewerNoteReflection(reflectionInput(h,chat)):await runFieldGuideUpdate({repository:h.repository,trainingRun:h.run,sessionId:"s",postRevealReview:"review",providerConfig:h.provider,model:h.model,budgetPolicy:"training_reveal",chat});
 expect(result?.status).toBe("NO_CHANGE");expect(result?.settlement?.settlement).toBe("model_no_change");expect(chat).toHaveBeenCalledTimes(2);
});
function nativeReasoningFailure() {
 return new ProviderCallError({code:"unknown",message:"provider returned reasoning without a final assistant response [finish-reason=stop]",phase:"validating_response",responseEvidence:{version:1,transportOutcome:"response_finished",boundary:"sse_done"}});
}
function recoveryInput(h:Awaited<ReturnType<typeof setup>>,chat:NonNullable<Parameters<typeof runViewerNoteReflection>[0]["chat"]>, packetHash="fix-recovery") {
 const model={...h.model,capabilities:{...h.model.capabilities,reasoning:{supported:true,supportsMaxTokens:true,efforts:["high" as const],confidence:"provider_metadata" as const}}};
 return {repository:h.repository,sessionId:"s",packetHash,kind:"viewer_notes" as const,config:h.provider,modelId:h.model.modelId,chat,
 analytical:{model,operationKind:"viewer_notes_reflection" as const,learningObjectCapacityTokens:1024,budgetPolicy:"training_reveal" as const,requestedSettings:{reasoningEffort:"high" as const},recoveryInstruction:"FIX OUTPUT RECOVERY",recoveryReasoningMaxTokens:10000,recoveryReasoningMaxTokensSupported:true},messages:[{role:"user" as const,content:"Return final output"}],
 parse:(response:import("../providers/types").ProviderChatResponse)=>{if(!response.content.trim())throw new LearningProposalFailure("FAILED_PROVIDER","provider returned reasoning without a final assistant response",0);return response.content;},repairMessages:()=>[{role:"user" as const,content:"Return final output"}]};
}
it("T1 FIX: restart after first finished typed error retains evidence, recovery instruction and supported cap",async()=>{
 const h=await setup();const chat=vi.fn<NonNullable<Parameters<typeof runViewerNoteReflection>[0]["chat"]>>().mockRejectedValueOnce(nativeReasoningFailure()).mockResolvedValue(finished("complete answer"));
 const original=bridge.invoke.getMockImplementation()!;let crash=true;
 bridge.invoke.mockImplementation(async(...args:unknown[])=>{const result=await original(...args);const payload=JSON.stringify(args);if(crash && payload.includes("LEARNING_PHYSICAL_ATTEMPT") && payload.includes('\\"state\\":\\"finished\\"')){crash=false;throw new Error("DB interruption after finished typed error");}return result;});
 await expect(executeLearningProposal(recoveryInput(h,chat))).rejects.toThrow("DB interruption");expect(chat).toHaveBeenCalledTimes(1);bridge.invoke.mockImplementation(original);
 const events=await h.repository.listSessionEvents("s");const terminal=events.find(e=>e.metadata?.state==="finished")!;
 expect(terminal.metadata?.responseEvidence).toMatchObject({boundary:"sse_done",transportOutcome:"response_finished"});expect(terminal.metadata?.outputRecoveryRequired).toBe(true);
 const confirm=vi.fn(async()=>false);
 await h.repository.updateTrainingRun(h.run.id,{activeTargetCheckpoint:{targetId:"t1",sessionId:"s",stage:"field_guide_update_completed"}});
 await prepareTrainingRunResume({repository:h.repository,runId:h.run.id,fallbackLanguage:"en",confirmUncertainViewerReview:confirm});expect(confirm).not.toHaveBeenCalled();
 const result=await executeLearningProposal(recoveryInput(h,chat));expect(result.attempts).toBe(2);expect(chat).toHaveBeenCalledTimes(2);
 const second=chat.mock.calls[1][0];expect(second.messages.at(-1)?.content).toContain("FIX OUTPUT RECOVERY");expect(second.settings.effective.reasoningMaxTokens).toBe(10000);
});
it("T1 FIX: HTTP 429 keeps user reasoning settings and does not receive output-recovery instruction",async()=>{
 const h=await setup();const chat=vi.fn<NonNullable<Parameters<typeof runViewerNoteReflection>[0]["chat"]>>().mockRejectedValueOnce(new ProviderCallError({code:"http_status",message:"API refused request (429)",phase:"validating_response",httpStatus:429,responseEvidence:{version:1,transportOutcome:"response_finished",boundary:"body_read"}})).mockResolvedValue(finished("complete answer"));
 await executeLearningProposal(recoveryInput(h,chat));const second=chat.mock.calls[1][0];expect(second.messages.at(-1)?.content).not.toContain("FIX OUTPUT RECOVERY");expect(second.settings.effective.reasoningMaxTokens).toBeUndefined();expect(second.settings.effective.reasoningEffort).toBe("high");
});
for(const kind of ["field_guide","viewer_notes"] as const)for(const boundary of ["audit-before-settlement","settlement-before-projection"] as const)it(`T1 FIX: ${kind} preflight ${boundary} resumes without confirmation or dispatch`,async()=>{
 const h=await setup();await h.repository.updateTrainingRun(h.run.id,{activeTargetCheckpoint:{targetId:"t1",sessionId:"s",stage:kind==="field_guide"?"review_completed":"field_guide_update_completed",fieldGuideAfterUpdate:{updateStatus:"NO_CHANGE",versionId:h.fieldGuide.versionId,versionNumber:h.fieldGuide.versionNumber,contentSha256:h.fieldGuide.contentSha256}}});
 const chat=vi.fn();const model={...h.model,capabilities:{...h.model.capabilities,contextTokens:1}};
 const invoke=()=>kind==="viewer_notes"?runViewerNoteReflection({...reflectionInput(h,chat),model}):runFieldGuideUpdate({repository:h.repository,trainingRun:h.run,sessionId:"s",postRevealReview:"review",providerConfig:h.provider,model,budgetPolicy:"training_reveal",chat});
 const original=bridge.invoke.getMockImplementation()!;
 bridge.invoke.mockImplementation(async(...args:unknown[])=>{const payload=JSON.stringify(args);if(boundary==="audit-before-settlement"?payload.includes("LEARNING_SETTLEMENT"):payload.includes("learningSettlements"))throw new Error("DB crash boundary");return original(...args);});
 await expect(invoke()).rejects.toThrow("DB crash boundary");bridge.invoke.mockImplementation(original);
 const confirm=vi.fn(async()=>false);const resumed=await prepareTrainingRunResume({repository:h.repository,runId:h.run.id,fallbackLanguage:"en",confirmUncertainViewerReview:confirm});expect(resumed?.id).toBe(h.run.id);expect(confirm).not.toHaveBeenCalled();
 expect((await invoke())?.settlement?.status).toBe("FAILED_OUTPUT_PREFLIGHT");expect(chat).not.toHaveBeenCalled();
});
it.each(["sessionId","kind","packetHash","auditId"] as const)("T1 FIX: mismatched settlement %s does not suppress genuine uncertainty",async mismatch=>{
 const h=await setup();await h.repository.updateTrainingRun(h.run.id,{activeTargetCheckpoint:{targetId:"t1",sessionId:"s",stage:"field_guide_update_completed"}});
 await expect(runViewerNoteReflection(reflectionInput(h,vi.fn(async()=>{throw new Error("unknown dispatch");})))).rejects.toThrow("unconfirmed");
 const audit=(await h.repository.listViewerNoteReflectionRuns(h.notes.aiIdentityId))[0];
 const settlement:Record<string,unknown>={sessionId:"s",kind:"viewer_notes",packetHash:audit.reflectionPacketSha256,auditId:audit.id,settlement:"failed_preserved",version:null,attempts:1,status:"FAILED_PROVIDER"};settlement[mismatch]="mismatch";
 await h.repository.appendSessionEvent("s",{eventType:"LEARNING_SETTLEMENT",metadata:{settlement}});
 const confirm=vi.fn(async()=>false);expect(await prepareTrainingRunResume({repository:h.repository,runId:h.run.id,fallbackLanguage:"en",confirmUncertainViewerReview:confirm})).toBeNull();expect(confirm).toHaveBeenCalledOnce();
});
async function t2Candidate(content:string, nativeValidation:"accepted"|"rejected"="accepted") {
 return {content,contentSha256:await sha256Text(content),byteLength:new TextEncoder().encode(content).length,omittedForSize:false,envelopeRemoved:false,nativeValidation};
}
it.each(["field_guide","viewer_notes"] as const)("T2 SQLite %s: native rejected final candidate remains available locally without another dispatch after settlement",async kind=>{
 const h=await setup();const raw='{"notes":"Do not print <think> markers. Żółć 🌍"}';const finalCandidate=await t2Candidate(raw,"rejected");
 const chat=vi.fn(async()=>{throw new ProviderCallError({code:"unknown",phase:"validating_response",message:"provider response reasoning_details must be an array or null",providerRequestId:"native-rejected",responseEvidence:{version:1,transportOutcome:"response_finished",boundary:"sse_done"},finalCandidate});});
 const invoke=()=>kind==="viewer_notes"?runViewerNoteReflection(reflectionInput(h,chat)):runFieldGuideUpdate({repository:h.repository,trainingRun:h.run,sessionId:"s",postRevealReview:"review",providerConfig:h.provider,model:h.model,budgetPolicy:"training_reveal",chat});
 const result=await invoke();expect(result?.settlement?.settlement).toBe("failed_preserved");expect(chat).toHaveBeenCalledTimes(2);
 const rejected=(await h.repository.listSessionEvents("s")).filter(e=>e.metadata?.validation==="native_rejected");expect(rejected).toHaveLength(2);
 for(const event of rejected){expect(event.metadata?.finalCandidate).toEqual(finalCandidate);expect(event.metadata?.attemptId).toEqual(expect.any(String));expect(event.metadata?.providerRequestId).toBe("native-rejected");expect(event.metadata?.transportRequestId).toBeUndefined();}
 expect(new Set(rejected.map(e=>e.metadata?.attemptId)).size).toBe(2);
 await invoke();expect(chat).toHaveBeenCalledTimes(2);expect((await h.repository.listSessionEvents("s")).filter(e=>e.metadata?.validation==="native_rejected")).toHaveLength(2);
});
it("T2 SQLite: invalid learning JSON retains native candidate and a separate validation result",async()=>{
 const h=await setup();const raw="Malformed final JSON with literal <think>data</think>";const finalCandidate=await t2Candidate(raw);const chat=vi.fn(async()=>({...finished(raw),finalCandidate,providerRequestId:"candidate-id",transportRequestId:"transport-id",reasoningContent:"PRIVATE"}));
 const result=await runViewerNoteReflection(reflectionInput(h,chat));expect(result?.status).toBe("FAILED_PARSE");const events=await h.repository.listSessionEvents("s");
 const candidates=events.filter(e=>e.metadata?.state==="finished");expect(candidates).toHaveLength(2);
 for(const event of candidates){expect((event.metadata?.response as {finalCandidate:unknown}).finalCandidate).toEqual(finalCandidate);expect(event.metadata?.transportRequestId).toBe("transport-id");expect(JSON.stringify(event.metadata)).not.toContain("PRIVATE");}
 const validations=events.filter(e=>e.eventType==="LEARNING_CANDIDATE_VALIDATION");expect(validations).toHaveLength(2);expect(validations.every(e=>e.metadata?.validation==="learning_rejected")).toBe(true);
 expect(validations.map(e=>e.metadata?.attemptId)).toEqual(candidates.map(e=>e.metadata?.attemptId));
});
it("T2 SQLite: corrupt candidate hash fails closed without creating memory or failed_preserved",async()=>{
 const h=await setup();const finalCandidate={...await t2Candidate("raw"),contentSha256:"0".repeat(64)};const chat=vi.fn(async()=>({...finished('{"decision":"NO_CHANGE","notes":null,"changeSummary":"ok"}'),finalCandidate}));
 await expect(runViewerNoteReflection(reflectionInput(h,chat))).rejects.toThrow("candidate content hash mismatch");expect(chat).toHaveBeenCalledTimes(1);expect((await h.repository.getViewerNoteBundle(h.notes.aiIdentityId))?.versions).toHaveLength(0);expect((await h.repository.listSessionEvents("s")).some(e=>e.eventType==="LEARNING_SETTLEMENT")).toBe(false);
});
it("T2 SQLite: Stop prevents candidate persistence even after a completed native response",async()=>{
 const h=await setup();const controller=new AbortController();const finalCandidate=await t2Candidate("final candidate");const chat=vi.fn(async()=>{controller.abort(new Error("user Stop"));return {...finished("final candidate"),finalCandidate};});
 await expect(runViewerNoteReflection({...reflectionInput(h,chat),signal:controller.signal})).rejects.toThrow("user Stop");expect((await h.repository.listSessionEvents("s")).some(e=>JSON.stringify(e.metadata).includes("finalCandidate"))).toBe(false);
});
