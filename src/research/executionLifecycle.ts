import type {AppRepository} from "../storage/repository";
import {withWorkflow,type WorkflowScope} from "../application/workflowOwnership";
import type {ResearchProjectRecord} from "./types";
export interface ResearchExecutionTermination {reason:"user_finished";endedAt:string;stateAtEnd:ResearchProjectRecord["state"];phase:"sessions"|"judging"|"finalization";}
export const researchTerminationKey=(id:string)=>`rvh.research.end.v1:${id}`;
export const researchScope=(id:string,signal?:AbortSignal):WorkflowScope=>({profileId:`research:${id}`,entity:{kind:"research",id},signal});
export function canEndResearchExecution(project:ResearchProjectRecord):boolean{return !project.archivedAt && !(project.state==="SessionsComplete" && project.config.judges.length===0) && ["Locked","Running","Interrupted","SessionsComplete","Judging","ScoresFrozen","Unblinded"].includes(project.state);}
export function researchTermination(project:ResearchProjectRecord,endedAt:string):ResearchExecutionTermination {
 return {reason:"user_finished",endedAt,stateAtEnd:project.state,phase:["SessionsComplete","Judging"].includes(project.state)?"judging":["ScoresFrozen","Unblinded"].includes(project.state)?"finalization":"sessions"};
}
export async function withResearchExecution<T>(repository:AppRepository,id:string,signal:AbortSignal|undefined,task:(owned:AppRepository,signal?:AbortSignal)=>Promise<T>):Promise<T>{
 return withWorkflow(repository,researchScope(id,signal),task);
}

export function validateResearchTermination(value:unknown):ResearchExecutionTermination {
 const marker=value as Partial<ResearchExecutionTermination>|null;
 if(!marker || marker.reason!=="user_finished" || typeof marker.endedAt!=="string" || !marker.endedAt.trim() || !["sessions","judging","finalization"].includes(marker.phase??"") || !["Locked","Running","Interrupted","SessionsComplete","Judging","ScoresFrozen","Unblinded"].includes(marker.stateAtEnd??""))throw new Error("Invalid Research execution termination marker");
 return marker as ResearchExecutionTermination;
}
