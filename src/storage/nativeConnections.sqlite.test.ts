import { DatabaseSync } from "node:sqlite";
import { mkdtempSync,readFileSync,readdirSync,rmSync,copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it,expect } from "vitest";
import { SqliteNativeConnectionsRepository, NATIVE_CONNECTION_SQL } from "./sqlite/nativeConnectionsRepository";
import { freezeNativeConnection } from "../providers/nativeConnectionIdentity";
import { operationForWriteQuery } from "./databaseWriteOperations";
const migrationRoot=new URL("../../src-tauri/migrations/",import.meta.url);
const migrations=readdirSync(migrationRoot).filter(n=>/^\d{3}.*sql$/.test(n)).sort();
const migration=(n:number)=>readFileSync(new URL(migrations[n-1],migrationRoot),"utf8");
function apply(db:DatabaseSync,from:number,to:number){for(let n=from;n<=to;n++)db.exec(`BEGIN IMMEDIATE;${migration(n)}\nCOMMIT;`);}
function roots(db:DatabaseSync){const typed=(db.prepare("PRAGMA table_info(workspaces)").all() as {name:string}[]).some(c=>c.name==="kind");db.exec(`INSERT INTO profiles(id,display_name,created_at,updated_at) VALUES('p','P','t','t'); INSERT INTO workspaces(id,profile_id,name,created_at,updated_at,last_opened_at) VALUES('w','p','W','t','t','t'); ${typed?"UPDATE workspaces SET kind='rv' WHERE id='w';":""} INSERT INTO rv_sessions(id,workspace_id,profile_id,session_code,state,run_type,created_at,updated_at) VALUES('s','w','p','RV-OLD','Draft','automatic','t','t'); INSERT INTO session_snapshots(id,session_id,snapshot_json,snapshot_hash,created_at) VALUES('ss','s','{\"schemaVersion\":1,\"old\":true}','immutable-hash','t');`);}
function seedMemory(db:DatabaseSync){
 db.exec("INSERT INTO rv_sessions(id,workspace_id,profile_id,session_code,state,run_type,created_at,updated_at) VALUES('s2','w','p','RV-OLD-2','Draft','automatic','t','t');");
 db.exec("INSERT INTO ai_identities(id,profile_id,credential_fingerprint,credential_display,provider_config_id,provider,normalized_base_url,model_id,model_route,model_display_name,role,first_used_at,last_used_at,created_at,updated_at) VALUES('old-ai','p','real-old-fingerprint','old display','legacy','openrouter','https://old.invalid','m','openrouter:m','M','viewer','t','t','t','t'); INSERT INTO ai_note_settings(ai_identity_id,updated_at) VALUES('old-ai','t');");
 for(let n=1;n<=2;n++){
  const previous=n===1?null:`note-${n-1}`,baseHash=n===1?null:`hash-${n-1}`;
  db.prepare("INSERT INTO ai_note_reflection_runs(id,ai_identity_id,source_session_id,source_workspace_id,source_snapshot_json,reflection_packet_sha256,packet_json,status,created_at) VALUES(?, 'old-ai',?,'w','{\"preserved\":true}','packet','{}','UPDATE','t')").run(`reflection-${n}`,n===1?"s":"s2");
  db.prepare("INSERT INTO ai_note_versions(id,ai_identity_id,version_number,content,content_sha256,estimated_tokens,estimator_version,capacity_tokens_at_creation,source_session_id,source_workspace_id,source_snapshot_json,protocol_id,session_run_type,change_summary,base_version_id,base_content_sha256,reflection_run_id,reflection_packet_sha256,model_route_snapshot,generation_settings_json,created_at) VALUES(?,'old-ai',?,?,?,1,'conservative-char-v1',1024,'s','w','{\"preserved\":true}','rv-lite','automatic','history',?,?,?,'packet','openrouter:m','{}','t')").run(`note-${n}`,n,`Unicode łuk ${n}`,`hash-${n}`,previous,baseHash,`reflection-${n}`);
  db.prepare("INSERT INTO ai_note_activation_events(id,ai_identity_id,from_version_id,to_version_id,activation_source,workspace_id,source_session_id,created_at) VALUES(?,'old-ai',?,?,'model_update','w','s','t')").run(`activation-${n}`,previous,`note-${n}`);
  db.prepare("UPDATE ai_note_settings SET active_version_id=? WHERE ai_identity_id='old-ai'").run(`note-${n}`);
 }
 db.exec("INSERT INTO field_guide_settings(ai_identity_id,language,updated_at) VALUES('old-ai','en','t');");
 for(let n=1;n<=2;n++){
  db.prepare("INSERT INTO field_guide_versions(id,ai_identity_id,language,version_number,content,content_sha256,estimated_tokens,estimator_version,capacity_tokens_at_creation,source_session_id,source_snapshot_json,previous_version_id,created_at) VALUES(?,'old-ai','en',?,?,?,1,'conservative-char-v1',2048,'s','{\"source\":true}',?,'t')").run(`fg-${n}`,n,`Guide ${n}`,`fg-hash-${n}`,n===1?null:`fg-${n-1}`);
  db.prepare("INSERT INTO field_guide_activation_events(id,ai_identity_id,language,from_version_id,to_version_id,activation_source,created_at) VALUES(?,'old-ai','en',?,?,'training_reflection','t')").run(`fg-activation-${n}`,n===1?null:`fg-${n-1}`,`fg-${n}`);
  db.prepare("UPDATE field_guide_settings SET active_version_id=? WHERE ai_identity_id='old-ai' AND language='en'").run(`fg-${n}`);
 }
 db.exec("INSERT INTO field_guide_legacy_baselines(id,profile_id,original_content,source_profile_updated_at,resolution_status,created_at) VALUES('baseline','p','legacy content','t','unresolved','t');");
}
function seededProviders(db:DatabaseSync){for(const [i,provider] of ["openrouter","google","openai","anthropic","zai","deepseek","mistral","blackbox","custom_openai"].entries()){
 db.prepare("INSERT INTO credentials_metadata(id,provider,label,fingerprint,created_at,updated_at) VALUES(?,?,'label','fingerprint','t','t')").run(`c-${i}`,provider);
 db.prepare("INSERT INTO provider_configs(id,provider,label,credential_id,base_url,created_at,updated_at) VALUES(?,?,'label',?,'https://old.invalid/v1','t','t')").run(`pc-${i}`,provider,`c-${i}`);
 db.prepare("INSERT INTO model_registry(provider_config_id,provider,model_id,display_name,route,capability_json,pricing_json,recommended,raw_metadata_json,refreshed_at,favorite) VALUES(?,?,'model','Model','route','{}','{}',1,'{\"old\":true}','t',1)").run(`pc-${i}`,provider);
}}
function dump(db:DatabaseSync){return Object.fromEntries((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(({name})=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));}
function equalOldColumns(before:ReturnType<typeof dump>,db:DatabaseSync){for(const [table,rows] of Object.entries(before)){
 const current=db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();expect(current).toHaveLength(rows.length);
 rows.forEach((row,i)=>{for(const [key,value] of Object.entries(row))expect(current[i][key],`${table}.${key}`).toEqual(value);});
}}
it.each([19,31,34])("upgrades v%s with row IDs, source references, hashes, memory lineage and triggers preserved",version=>{
 const db=new DatabaseSync(":memory:");try{db.exec("PRAGMA foreign_keys=ON");apply(db,1,version);roots(db);seededProviders(db);if(version>=31)seedMemory(db);
 const before=dump(db);apply(db,version+1,34);const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
 apply(db,35,35);equalOldColumns(before,db);
 for(const trigger of triggers)expect(db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger.name as string)).toEqual({sql:trigger.sql});
 expect(db.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
 if(version>=31){expect(()=>db.exec("DELETE FROM ai_note_versions WHERE id='note-1'")).toThrow(/append-only/);expect(()=>db.exec("UPDATE field_guide_versions SET content='corrupt' WHERE id='fg-1'")).toThrow(/append-only/);}
 }finally{db.close();}
});
it("rolls back DDL, trigger suspension and data on a failed migration, then can retry",()=>{
 const db=new DatabaseSync(":memory:");try{db.exec("PRAGMA foreign_keys=ON");apply(db,1,34);roots(db);seedMemory(db);const before=dump(db),schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
 db.exec("BEGIN IMMEDIATE");expect(()=>db.exec(migration(35).replace("CREATE TABLE profile_native_connection_routes", "SELECT * FROM injected_missing_table; CREATE TABLE profile_native_connection_routes"))).toThrow();db.exec("ROLLBACK");
 expect(dump(db)).toEqual(before);expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).toEqual(schema);apply(db,35,35);equalOldColumns(before,db);
 }finally{db.close();}
});
it("persists a genuinely keyless pending route and separate AI identity across close/reopen/backup restore; rejects forged bindings",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"rvh-native-identity-"));let db:DatabaseSync|undefined;
 try{
 const path=join(dir,"db.sqlite");db=new DatabaseSync(path);db.exec("PRAGMA foreign_keys=ON");apply(db,1,35);roots(db);
 const bind=(query:string,values:unknown[]=[])=>{const args:unknown[]=[];const sql=query.replace(/\$(\d+)/g,(_,n)=>{args.push(values[Number(n)-1]);return "?";});return {sql,args};};
 const repository=()=>new SqliteNativeConnectionsRepository({select:async<T>(q:string,v?:unknown[])=>{const b=bind(q,v);return db!.prepare(b.sql).all(...b.args as never[]) as T;},executeTransaction:async statements=>{db!.exec("BEGIN IMMEDIATE");try{for(const s of statements){expect(operationForWriteQuery(s.query)).toMatch(/^native_connection_/);const b=bind(s.query,s.values);db!.prepare(b.sql).run(...b.args as never[]);}db!.exec("COMMIT");}catch(e){db!.exec("ROLLBACK");throw e;}}});
 const c=await repository().createPendingKeylessConnection({id:"native",label:"Local",baseUrl:"http://LOCALHOST:11434/"});const snapshot=freezeNativeConnection(c);
 expect(c.authMode).toBe("none");expect(db.prepare("SELECT COUNT(*) AS n FROM credentials_metadata").get()).toEqual({n:0});
 await repository().bindPendingNativeProfile("p",snapshot);
 const ai=await repository().ensurePendingNativeAiIdentity({profileId:"p",binding:snapshot,modelId:"fixture:latest",modelDisplayName:"Fixture"});
 expect(await repository().ensurePendingNativeAiIdentity({profileId:"p",binding:snapshot,modelId:"fixture:latest",modelDisplayName:"Fixture"})).toEqual(ai);
 expect(db.prepare("SELECT credential_id,credential_hint,enabled FROM provider_configs WHERE id='native'").get()).toEqual({credential_id:null,credential_hint:null,enabled:0});
 expect(db.prepare("SELECT credential_fingerprint,credential_display FROM ai_identities WHERE id=?").get(ai.id)).toEqual({credential_fingerprint:null,credential_display:null});
 await expect(repository().bindPendingNativeProfile("p",{...snapshot,authMode:"bearer"})).rejects.toThrow(/changed/);
 await expect(repository().ensurePendingNativeAiIdentity({profileId:"p",binding:{...snapshot,connectionRevision:2},modelId:"fixture",modelDisplayName:"Fixture"})).rejects.toThrow(/changed/);
 expect(()=>db!.exec("UPDATE provider_configs SET enabled=1 WHERE id='native'")).toThrow(/CHECK/);
 expect(()=>db!.exec("UPDATE ai_identities SET connection_revision=2 WHERE identity_kind='connection'")).toThrow(/immutable/);
 db.close();db=undefined;copyFileSync(path,join(dir,"restored.sqlite"));db=new DatabaseSync(join(dir,"restored.sqlite"));db.exec("PRAGMA foreign_keys=ON");
 expect(await repository().getPendingNativeProfile("p")).toEqual(snapshot);expect(await repository().getPendingNativeAiIdentity(ai.id)).toEqual(ai);
 const second=await repository().createPendingKeylessConnection({id:"other",label:"Local again",baseUrl:c.baseUrl});expect(second.connectionIdentityId).not.toBe(c.connectionIdentityId);
 expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
it("registers every new write and never treats nullable legacy credentials as keyless",()=>{for(const query of Object.values(NATIVE_CONNECTION_SQL))expect(operationForWriteQuery(query)).toMatch(/^native_connection_/);const db=new DatabaseSync(":memory:");try{db.exec("PRAGMA foreign_keys=ON");apply(db,1,35);expect(()=>db.exec("INSERT INTO provider_configs(id,provider,label,credential_id,enabled,created_at,updated_at) VALUES('bad','custom_openai','bad',NULL,1,'t','t')")).toThrow();expect(()=>db.exec("INSERT INTO provider_configs(id,provider,label,base_url,enabled,created_at,updated_at,auth_mode) VALUES('bad','ollama_native','bad','http://localhost:11434',0,'t','t','none')")).toThrow();}finally{db.close();}});
it("036 preserves old data and native routes and rolls back failed hosted migration", () => {
 const db=new DatabaseSync(":memory:");try {
  db.exec("PRAGMA foreign_keys=ON");apply(db,1,35);roots(db);seedMemory(db);seededProviders(db);
  db.exec("INSERT INTO provider_configs(id,provider,label,base_url,enabled,auth_mode,connection_identity_id,connection_revision,created_at,updated_at) VALUES('local','ollama_native','Local','http://localhost:11434',0,'none','local-identity',1,'t','t'); INSERT INTO profile_native_connection_routes(profile_id,provider_config_id,connection_identity_id,connection_revision,normalized_endpoint,created_at) VALUES('p','local','local-identity',1,'http://localhost:11434','t'); UPDATE provider_configs SET connection_revision=2 WHERE id='local';");
  const before=dump(db);db.exec("BEGIN IMMEDIATE");expect(()=>db.exec(migration(36).replace("CREATE INDEX idx_provider_configs_provider", "SELECT * FROM injected_036_failure; CREATE INDEX idx_provider_configs_provider"))).toThrow();db.exec("ROLLBACK");expect(dump(db)).toEqual(before);
  apply(db,36,36);equalOldColumns(before,db);expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  db.exec("INSERT INTO credentials_metadata(id,provider,label,created_at,updated_at) VALUES('cloud-key','ollama_cloud','Cloud','t','t'); INSERT INTO provider_configs(id,provider,label,credential_id,created_at,updated_at) VALUES('cloud','ollama_cloud','Cloud','cloud-key','t','t');");
  expect(db.prepare("SELECT enabled,auth_mode FROM provider_configs WHERE id='cloud'").get()).toEqual({enabled:1,auth_mode:"legacy_credential"});
  expect(()=>db.exec("DELETE FROM ai_note_versions WHERE id='note-1'")).toThrow(/append-only/);
 } finally {db.close();}
});
