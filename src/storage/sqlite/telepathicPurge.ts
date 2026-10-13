import {emptyDeletionCounts,type DeletionPreview} from "../controlledPurge";
interface Dependencies{select<T>(sql:string,values?:unknown[]):Promise<T>;}
export function telepathicParentPurgeQuery(kind:"profile"|"workspace"):string{
 return kind==="workspace"?"SELECT COUNT(*) AS n FROM telepathic_series s WHERE s.series_workspace_id=$1 OR EXISTS (SELECT 1 FROM telepathic_participants p WHERE p.series_id=s.id AND p.workspace_id=$1)":"SELECT COUNT(*) AS n FROM telepathic_series s WHERE s.series_workspace_id IN (SELECT id FROM workspaces WHERE profile_id=$1) OR EXISTS (SELECT 1 FROM telepathic_participants p WHERE p.series_id=s.id AND (p.profile_id=$1 OR p.workspace_id IN (SELECT id FROM workspaces WHERE profile_id=$1)))";
}
export async function previewSqliteTelepathicDelete(d:Dependencies,id:string):Promise<DeletionPreview>{
 const row=(await d.select<Array<{status:string;plan_json:string;lease_blocked:number}>>("SELECT status, plan_json, CASE WHEN run_lease_owner IS NOT NULL AND (run_lease_expires_at IS NULL OR julianday(run_lease_expires_at) IS NULL OR run_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END AS lease_blocked FROM telepathic_series WHERE id=$1",[id]))[0];
 if(!row)throw new Error("Telepathic series not found.");const plan=JSON.parse(row.plan_json);const runtime=plan._runtime;if(runtime&&runtime.version!==1)throw new Error("Unsupported telepathic runtime version.");
 const participants=await d.select<Array<{display_name:string;final_reflection_text:string|null}>>("SELECT display_name, final_reflection_text FROM telepathic_participants WHERE series_id=$1 ORDER BY rowid",[id]);
 const counts=emptyDeletionCounts();counts.telepathicSeries=1;counts.telepathicParticipants=participants.length;counts.telepathicFinalReflections=participants.filter(p=>p.final_reflection_text!==null).length;
 for(const [key,sql] of [
  ["telepathicRounds","SELECT COUNT(*) AS n FROM telepathic_rounds WHERE series_id=$1"],
  ["telepathicTargets","SELECT COUNT(*) AS n FROM telepathic_targets WHERE round_id IN (SELECT id FROM telepathic_rounds WHERE series_id=$1)"],
  ["telepathicBlindSubmissions","SELECT COUNT(*) AS n FROM telepathic_blind_submissions WHERE round_id IN (SELECT id FROM telepathic_rounds WHERE series_id=$1)"],
  ["telepathicReflections","SELECT COUNT(*) AS n FROM telepathic_reflections WHERE round_id IN (SELECT id FROM telepathic_rounds WHERE series_id=$1)"],
  ["telepathicProviderCalls","SELECT COUNT(*) AS n FROM telepathic_provider_calls WHERE series_id=$1"],
 ] as const)counts[key]=Number((await d.select<Array<{n:number}>>(sql,[id]))[0]?.n??0);
 if(runtime?.transcript!==undefined&&!Array.isArray(runtime.transcript))throw new Error("Invalid Telepathy transcript.");counts.telepathicTranscriptEvents=runtime?.transcript?.length??0;
 for(const a of await d.select<Array<{assets_manifest_json:string}>>("SELECT assets_manifest_json FROM telepathic_targets WHERE round_id IN (SELECT id FROM telepathic_rounds WHERE series_id=$1)",[id])){const assets:unknown=JSON.parse(a.assets_manifest_json);if(!Array.isArray(assets))throw new Error("Invalid Telepathy attachments.");counts.telepathicAttachmentFilesPreserved+=assets.length;}
 const preserved=Number((await d.select<Array<{n:number}>>("SELECT COUNT(*) AS n FROM ai_note_versions WHERE ai_identity_id IN (SELECT ai_identity_id FROM telepathic_participants WHERE series_id=$1)",[id]))[0]?.n??0);
 return {kind:"telepathic_series",id,label:`Telepathy · ${participants.map(p=>p.display_name).join(" · ")}`,archiveRevision:runtime?.archiveRevision??0,archived:typeof runtime?.archivedAt==="string"&&!!runtime.archivedAt.trim(),blockedReason:row.status==="running"||row.lease_blocked?"Stop Telepathy execution or wait for its lease before deleting.":undefined,requiresPhrase:"DELETE",safetyBackupRecommended:true,viewerNotesPreserved:preserved,viewerNotesDeleted:0,counts};
}
