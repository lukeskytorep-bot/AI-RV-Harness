import { researchJudgeRequestAvailability, researchJudgeRequestBlocked } from "./judgeRequestRecovery";
import type {AppRepository} from "../storage/repository";
import type {ProviderAttemptContext} from "../providers/requestExecutor";
import {withResearchExecution} from "./executionLifecycle";
const EVENT="RESEARCH_JUDGE_ATTEMPT";
export async function recordResearchJudgeAttempt(repository:AppRepository,sessionId:string,modelRoute:string,status:"pending"|"dispatched"|"completed"|"uncertain"|"failed",attempt?:ProviderAttemptContext):Promise<void>{
 await repository.appendSessionEvent(sessionId,{eventType:EVENT,role:"controller",metadata:{modelRoute,status,...(attempt?{logicalRequestId:attempt.logicalRequestId,physicalAttempt:attempt.physicalAttempt}:{}),...(status==="failed"?{reason:"operator_resolved_uncertain"}:{})}});
}
export async function getUncertainResearchJudges(repository:AppRepository,projectId:string):Promise<Array<{sessionId:string;modelRoute:string}>>{
 const out:Array<{sessionId:string;modelRoute:string}>=[];
 const project=await repository.getResearchProject(projectId);
 const models=project?.state==="Judging"?await repository.listProviderModels():[];
 const expected=project?.state==="Judging"?project.config.judges.map(judge=>models.find(model=>model.providerConfigId===judge.providerConfigId && model.modelId===judge.modelId)?.route):[];
 for(const assignment of await repository.listResearchAssignments(projectId)){
  if(!assignment.sessionId)continue;
  const [events,scores]=await Promise.all([repository.listSessionEvents(assignment.sessionId),repository.listJudgeScores(assignment.sessionId)]);
  const latest=new Map<string,string>();
  for(const event of events)if(event.eventType===EVENT && typeof event.metadata?.modelRoute==="string" && typeof event.metadata.status==="string")latest.set(event.metadata.modelRoute,event.metadata.status);
  for(const event of events)if(event.eventType==="RESEARCH_JUDGE_REQUEST_V1" && typeof event.metadata?.modelRoute==="string" && !latest.has(event.metadata.modelRoute))latest.set(event.metadata.modelRoute,"journal");
  if(expected.length){
   // Frozen scores are a prefix in the same order used by selectMissingJudgeSelections.
   // Consume each score once, even when several selected Judges share a route.
   const prefixValid=scores.length<=expected.length && scores.every((score,index)=>Boolean(score.frozenAt) && score.modelRoute===expected[index]);
   for(let index=0;index<expected.length;index++){
    if(prefixValid && index<scores.length)continue;
    const route=expected[index];
    if(!route){out.push({sessionId:assignment.sessionId,modelRoute:project!.config.judges[index].modelId});continue;}
    if(!prefixValid || researchJudgeRequestAvailability(events,route,index+1,{owner:repository.recoveryOwner ?? repository,sessionId:assignment.sessionId})==="blocked")out.push({sessionId:assignment.sessionId,modelRoute:route});
   }
  }else{
   // Compatibility for historical projects without a resolvable frozen selection.
   for(const [route]of latest)if(researchJudgeRequestBlocked(events,route) && !scores.some(score=>score.modelRoute===route && score.frozenAt))out.push({sessionId:assignment.sessionId,modelRoute:route});
  }
 }
 return out;
}
export async function resolveResearchJudgeAttempt(repository:AppRepository,projectId:string,sessionId:string,modelRoute:string):Promise<void>{
 await withResearchExecution(repository,projectId,undefined,async owned=>{
  if((await owned.getRvSession(sessionId))?.researchProjectId!==projectId)throw new Error("Research session ownership mismatch");
  const uncertain=await getUncertainResearchJudges(owned,projectId);
  if(uncertain.some(item=>item.sessionId===sessionId && item.modelRoute===modelRoute))await recordResearchJudgeAttempt(owned,sessionId,modelRoute,"failed");
 });
}
