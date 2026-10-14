import type { AppRepository } from "../storage/repository";
import { RV_END_EVENT, withWorkflow } from "../application/workflowOwnership";
export async function isRvSessionEnded(repository:Pick<AppRepository,"listSessionEvents">,sessionId:string):Promise<boolean> {return (await repository.listSessionEvents(sessionId)).some(event=>event.eventType===RV_END_EVENT);}
export async function endRvSession(repository:AppRepository,sessionId:string,endedAt=new Date().toISOString()):Promise<void> {
 const session=await repository.getRvSession(sessionId);if(!session)throw new Error("RV session not found");
 return withWorkflow(repository,{profileId:session.profileId,terminal:true,entity:{kind:"profile",id:session.profileId}},async owned=>{
  const current=await owned.getRvSession(sessionId);if(!current || current.archivedAt)throw new Error("Restore the RV session before ending it");
  if(current.researchProjectId)throw new Error("Research execution must be ended through its own project controls");
  if(await isRvSessionEnded(owned,sessionId))return;
  await owned.appendSessionEvent(sessionId,{eventType:RV_END_EVENT,role:"controller",metadata:{reason:"user_finished",endedAt}});
  if(!await isRvSessionEnded(owned,sessionId))throw new Error("RV end marker was not persisted");
 });
}
