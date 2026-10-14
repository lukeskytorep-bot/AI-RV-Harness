import { registerAbortOwnership } from "../../application/abortOwnership";
import { workflowOwnershipNative } from "../databaseNative";
import type { WorkflowContext, WorkflowScope, WorkflowToken } from "../../application/workflowOwnership";
export async function ownSqliteWorkflow<T>(scope:WorkflowScope, makeRepository:(context:WorkflowContext)=>import("../repository").AppRepository, task:(repository:import("../repository").AppRepository,signal:AbortSignal)=>Promise<T>, onOwner:(owner:string|null)=>void):Promise<T> {
 const token=await workflowOwnershipNative<WorkflowToken>({action:"acquire",profileId:scope.profileId,owner:crypto.randomUUID()});
 const lost=new AbortController();const signal=scope.signal?AbortSignal.any([scope.signal,lost.signal]):lost.signal;
 const context:WorkflowContext={...token,entities:[scope.entity],closed:false,signal};onOwner(token.owner);
 registerAbortOwnership(signal,async()=>{if(context.closed)throw new Error("Workflow ownership has settled");await workflowOwnershipNative({action:"check",...token,entities:context.entities.map(entity=>({...entity,allowEnded:false}))});});
 let renewal:Promise<unknown>=Promise.resolve();
 const timer=setInterval(()=>{renewal=renewal.then(async()=>{if(context.closed)return;const valid=await workflowOwnershipNative<boolean>({action:"renew",...token});if(!valid)throw new Error("Workflow ownership lost");}).catch(cause=>lost.abort(cause));},10000);
 try {
  await workflowOwnershipNative({action:"check",...token,entities:context.entities});
  return await task(makeRepository(context),signal);
 } finally {
  clearInterval(timer);context.closed=true;lost.abort(new DOMException("Workflow settled","AbortError"));await renewal;try{await workflowOwnershipNative({action:"release",...token});}finally{onOwner(null);}
 }
}
