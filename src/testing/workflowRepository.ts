import type { AppRepository } from "../storage/repository";
import type { WorkflowScope } from "../application/workflowOwnership";

/** Explicit ownership mock for domain fixtures. Never installed by production code.
 * Real repository ownership is exercised separately against SQLite and Web Locks.
 */
export function workflowTestRepository<T extends object>(repository:T):T {
  const port=repository as unknown as AppRepository;
  if(typeof port.withWorkflowOwnership==="function")return repository;
  const events: import("../sessions/types").SessionEventRecord[] = [];
  if(typeof port.appendSessionEvent!=="function")Object.assign(repository,{appendSessionEvent:async(sessionId:string,event:import("../sessions/types").SessionEventInput)=>{events.push({...event,sessionId,id:String(events.length),sequenceNumber:events.length+1,createdAt:"fixture"});}});
  if(typeof port.listSessionEvents!=="function")Object.assign(repository,{listSessionEvents:async(sessionId:string)=>events.filter(e=>e.sessionId===sessionId)});
  Object.assign(repository,{
    ...(typeof port.getWorkflowOwnership==="function"?{}:{getWorkflowOwnership:async()=>"idle"}),
    ...(typeof port.getWorkflowResearchProjectId==="function"?{}:{getWorkflowResearchProjectId:async()=>undefined}),
    ...(typeof port.getResearchExecutionTermination==="function"?{}:{getResearchExecutionTermination:async()=>null}),
    ...(typeof port.getWorkflowProfileId==="function"?{}:{getWorkflowProfileId:async()=>"fixture-profile"}),
    withWorkflowOwnership:async function<R>(this:AppRepository,scope:WorkflowScope,task:(owned:AppRepository,signal:AbortSignal)=>Promise<R>):Promise<R>{return task(this,scope.signal ?? new AbortController().signal);},
  });
  return repository;
}
