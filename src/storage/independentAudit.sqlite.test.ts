import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync,backup } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe,it,expect } from "vitest";
import { SqliteTelepathicExchangeRepository } from "./sqlite/telepathicExchangeRepository";
import { createTelepathicSeriesState } from "../telepathicExchange/engine";
import type { TelepathicSeriesConfig } from "../telepathicExchange/types";
import type { DatabaseTransactionStatement } from "./databaseNative";
import { setTelepathicArchived } from "../telepathicExchange/archive";
import { serializeTelepathicPlan } from "../telepathicExchange/persistence";
function database(db = new DatabaseSync(":memory:"), initialize = true) {
 if(initialize) {
 db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('w');");
 for(const file of ["028_telepathic_exchange_series.sql","029_telepathic_series_run_lease.sql"]) db.exec(readFileSync(new URL(`../../src-tauri/migrations/${file}`,import.meta.url),"utf8"));
 }
 const bind=(sql:string)=>sql.replace(/\$\d+/g,"?");
 const executeWrite=async(query:string,values:unknown[]=[])=>({rowsAffected:Number(db.prepare(bind(query)).run(...values as never[]).changes)});
 const transaction=async(statements:DatabaseTransactionStatement[])=>{db.exec("BEGIN IMMEDIATE");try {const result=[];for(const s of statements){const rows=(await executeWrite(s.query,s.values)).rowsAffected;if(s.query.startsWith("INSERT INTO telepathic_series ") && rows!==1)throw new Error("Stale telepathic archive revision conflict");result.push(rows);}db.exec("COMMIT");return result;}catch(error){db.exec("ROLLBACK");throw error;}};
 const repository=new SqliteTelepathicExchangeRepository({select:async<T>(query:string,values:unknown[]=[])=>db.prepare(bind(query)).all(...values as never[]) as T,executeWrite,executeTransaction:transaction,executeFencedTransaction:async({seriesId,leaseOwner,leaseVersion,statements})=>{
  const lease=db.prepare("SELECT id FROM telepathic_series WHERE id=? AND run_lease_owner=? AND run_lease_version=? AND run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").get(seriesId,leaseOwner,leaseVersion);
  if(!lease)throw new Error("Lost fence");return transaction(statements);
 }});
 return {db,repository};
}
const config:TelepathicSeriesConfig={schemaVersion:1,protocolVersion:"fixed_lead_v1",leadInstructionVersion:"v1",maxGuidanceCycles:3,seriesId:"sqlite",seriesWorkspaceId:"w",mode:"conversation_exchange",language:"en",roundCount:1,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"human_only",humanParticipantId:"lead"},participants:[{id:"lead",kind:"human",displayName:"Lead"},{id:"a",kind:"ai",displayName:"A",ai:{profileId:"p",profileName:"A",workspaceId:"w",aiIdentityId:"i",providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}}]};

describe("Independent audit SQL stale-write behavior",()=>{
 it("Stale archive revision must not regress a provider call despite rejected parent upsert",async()=>{
  const {db,repository}=database();try{
   const state=createTelepathicSeriesState(config);
   state.providerCalls=[{id:"call",seriesId:"sqlite",roundId:state.rounds[0].assignment.roundId,participantId:"a",callStage:"receiver_first",technicalAttempt:1,status:"dispatched",scopeKey:"k",requestSha256:"h",createdAt:"t",updatedAt:"t"}];
   await repository.saveTelepathicSeries(state);const stale=structuredClone(state);
   state.providerCalls[0].status="succeeded";state.providerCalls[0].responseText="accepted";await repository.withTelepathicSeriesLease("sqlite",()=>repository.saveTelepathicSeries(state));
   await setTelepathicArchived(repository,"sqlite",true);
   await repository.saveTelepathicSeries(stale).catch(error => { expect(String(error)).toMatch(/archive|revision|conflict|stale/i); });
   const loaded=(await repository.getTelepathicSeries("sqlite"))!;
   expect(loaded.archivedAt).toBeTruthy();expect(loaded.providerCalls[0].status).toBe("succeeded");expect(loaded.providerCalls[0].responseText).toBe("accepted");
  }finally{db.close();}
 });
});

it("SQLite preserves an intentionally empty sharing comment",async()=>{
 const {db,repository}=database();try{const state=createTelepathicSeriesState(config);state.rounds[0].reflectionsByParticipant.lead={participantId:"lead",role:"sender",reflection:"done",shareOthersConsent:"yes",sharedAnswersComment:""};await repository.saveTelepathicSeries(state);const loaded=(await repository.getTelepathicSeries("sqlite"))!;expect(loaded.rounds[0].reflectionsByParticipant.lead.sharedAnswersComment).toBe("");}finally{db.close();}
});

