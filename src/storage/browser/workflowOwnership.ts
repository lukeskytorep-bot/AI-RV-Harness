import { registerAbortOwnership } from "../../application/abortOwnership";
import { assertRvNotEnded, type WorkflowScope } from "../../application/workflowOwnership";
import type { AppRepository } from "../repository";
const owners=new Map<string,object>();
const evaluationWriters=new WeakMap<object,{projectId:string;closed:boolean}>();
export function assertBrowserEvaluationWriter(repository:object,projectId:string):void {
 const writer=evaluationWriters.get(repository);if(!writer || writer.closed || writer.projectId!==projectId)throw new Error("Research evaluation ownership is required.");
}
const contexts=new WeakMap<object,{profileId:string;closed:boolean;signal:AbortSignal}>();
async function guard(repository:AppRepository,scope:WorkflowScope):Promise<void> {
 const projectId=scope.profileId.startsWith("research:")?scope.profileId.slice(9):undefined;
 const profileId=scope.entity.profileId ?? scope.profileId;
 if(projectId){
  const project=await repository.getResearchProject(projectId);
  if(!project || project.archivedAt)throw new Error("Research project was archived or removed");
  const workspace=(await repository.listWorkspaces()).find(row=>row.id===project.workspaceId);
  if(!workspace || !(await repository.listProfiles()).some(row=>row.id===workspace.profileId && !row.archivedAt))throw new Error("Research parent was archived or removed");
  if(scope.entity.kind!=="research_evaluation" && !scope.entity.allowEnded && await repository.getResearchExecutionTermination(projectId))throw new Error("Research execution was ended by the user");
 }else if(!(await repository.listProfiles()).some(profile=>profile.id===scope.profileId && !profile.archivedAt))throw new Error("Active workflow Profile not found");
 if(scope.entity.kind==="research_evaluation" && (!projectId || scope.entity.id!==projectId))throw new Error("Research evaluation scope mismatch");
 if(scope.entity.kind==="profile" && !(await repository.listProfiles()).some(row=>row.id===scope.entity.id && !row.archivedAt))throw new Error("Active workflow Profile not found");
 if(scope.entity.kind==="rv"){if(!(await repository.listProfiles()).some(row=>row.id===profileId && !row.archivedAt))throw new Error("RV participant Profile was archived or removed");const session=await repository.getRvSession(scope.entity.id);if(!session || session.profileId!==profileId || session.archivedAt || projectId && session.researchProjectId!==projectId)throw new Error("RV workflow was archived or removed");await assertRvNotEnded(repository,scope.entity.id);}
 if(scope.entity.kind==="training") {const run=(await repository.listTrainingRuns()).find(run=>run.id===scope.entity.id);if(!run || run.profileId!==scope.profileId || run.archivedAt || run.termination)throw new Error("Training workflow was ended, archived or removed");}
}
export async function browserOwnershipState(repository:object,profileId:string):Promise<"idle"|"local"|"other"|"unknown"> {
 if(owners.has(profileId))return owners.get(profileId)===repository?"local":"other";
 const locks=globalThis.navigator?.locks;if(!locks)return "unknown";
 try{return await locks.request(`rvh.workflow.v1:${profileId}`,{mode:"exclusive",ifAvailable:true},lock=>lock?"idle":"other");}catch{return "unknown";}
}
export async function ownBrowserWorkflow<T>(repository:AppRepository,scope:WorkflowScope,task:(owned:AppRepository,signal:AbortSignal)=>Promise<T>):Promise<T> {
 const parent=contexts.get(repository);
 const run=async()=>{
  const settled=new AbortController();const signals=[scope.signal,parent?.signal,settled.signal].filter((signal):signal is AbortSignal=>Boolean(signal));const signal=AbortSignal.any(signals);
  const context={profileId:scope.profileId,closed:false,signal};let createdSession:string|undefined;let createdProfile:string|undefined;
  const check=async()=>{if(context.closed || parent?.closed)throw new Error("Workflow ownership has settled; late work is refused");await guard(repository,scope);if(createdSession)await guard(repository,{...scope,entity:{kind:"rv",id:createdSession,profileId:createdProfile}});};
  await check();
  const owned=new Proxy(repository,{get(base,key){if(key==="recoveryOwner")return base.recoveryOwner ?? base;if(key==="withWorkflowOwnership")return (nested:WorkflowScope,callback:(owned:AppRepository,signal:AbortSignal)=>Promise<unknown>)=>ownBrowserWorkflow(owned,nested,callback);const value=Reflect.get(base,key);if(scope.entity.kind==="research_evaluation" && !String(key).startsWith("list") && !String(key).startsWith("get") && key!=="saveResearchEvaluation")return async()=>{throw new Error("Research evaluation cannot change source work.");};if(typeof value!=="function")return value;return async(...args:unknown[])=>{if(!String(key).startsWith("list") && !String(key).startsWith("get"))await check();const result=await Reflect.apply(value,base,args);if(key==="createRvSession"){createdSession=(result as {id:string}).id;createdProfile=(result as {profileId:string}).profileId;}return result;};}});
  const evaluationWriter=scope.entity.kind==="research_evaluation"?{projectId:scope.entity.id,closed:false}:undefined;
  if(evaluationWriter)evaluationWriters.set(repository,evaluationWriter);
  contexts.set(owned,context);registerAbortOwnership(signal,async()=>{await check();if(scope.entity.allowEnded)await guard(repository,{...scope,entity:{...scope.entity,allowEnded:false}});});
  try{return await task(owned,signal);}finally{if(evaluationWriter){evaluationWriter.closed=true;evaluationWriters.delete(repository);}context.closed=true;settled.abort(new DOMException("Workflow settled","AbortError"));}
 };
 if(parent){if(scope.terminal)throw new Error("End requires the active workflow to settle first");if(parent.profileId!==scope.profileId || parent.closed)throw new Error("Invalid browser workflow scope");return run();}
 const locks=globalThis.navigator?.locks;if(!locks)throw new Error("Cross-tab workflow ownership requires Web Locks; execution is unavailable.");
 return locks.request(`rvh.workflow.v1:${scope.profileId}`,{mode:"exclusive",ifAvailable:true},async lock=>{if(!lock || owners.has(scope.profileId))throw new Error("Work for this Profile is running in another window");owners.set(scope.profileId,repository);try{return await run();}finally{owners.delete(scope.profileId);}});
}
