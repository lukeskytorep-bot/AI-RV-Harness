import type { AppRepository } from "../storage/repository";
export interface WorkflowEntity { kind: "training" | "rv" | "profile" | "research" | "research_evaluation"; id: string; profileId?:string; allowEnded?:boolean; }
/** profileId is the lock partition: a Profile id or research:<projectId>. Research entities carry their persisted Profile id separately. */
export interface WorkflowScope { profileId: string; entity: WorkflowEntity; signal?: AbortSignal; terminal?: boolean; }
export interface WorkflowToken { profileId: string; owner: string; version: number; }
export interface WorkflowContext extends WorkflowToken { entities: WorkflowEntity[]; closed: boolean; signal: AbortSignal; }
export const RV_END_EVENT = "RV_USER_FINISHED";
export async function assertRvNotEnded(repository: Pick<AppRepository,"listSessionEvents">, id: string): Promise<void> {
 if ((await repository.listSessionEvents(id)).some(event=>event.eventType===RV_END_EVENT)) throw new Error("RV session was ended by the user and cannot be resumed or changed.");
}
export async function withWorkflow<T>(repository: AppRepository, scope: WorkflowScope, task: (owned:AppRepository,signal?:AbortSignal)=>Promise<T>):Promise<T> {
 if(typeof repository.withWorkflowOwnership!=="function")throw new Error("Workflow ownership capability is required before any work can start.");
 return repository.withWorkflowOwnership(scope,task);
}

export async function withRvWorkflow<T>(repository:AppRepository,id:string,signal:AbortSignal|undefined,task:(owned:AppRepository,signal?:AbortSignal)=>Promise<T>):Promise<T> {
 if(typeof repository.getWorkflowProfileId!=="function")throw new Error("RV ownership requires the durable Profile identity capability.");
 const profileId=await repository.getWorkflowProfileId(id);
 const researchProjectId=await repository.getWorkflowResearchProjectId(id);
 return withWorkflow(repository,{profileId:researchProjectId?`research:${researchProjectId}`:profileId,entity:{kind:"rv",id,profileId},signal},task);
}
export async function withAutomaticWorkflow<T extends {repository:object;profileId:string;signal?:AbortSignal;resumeSession?:{id:string};initializationExistingSession?:{id:string};sessionIdentity?:{id:string};researchProjectId?:string},R>(input:T,task:(input:T)=>Promise<R>):Promise<R> {
 const repository=input.repository as AppRepository;
 const existing=input.resumeSession ?? input.initializationExistingSession ?? (input.sessionIdentity && typeof repository.getRvSession==="function" ? await repository.getRvSession(input.sessionIdentity.id) : undefined);
 return existing ? withRvWorkflow(repository,existing.id,input.signal,(repository,signal)=>task({...input,repository,signal})) : withWorkflow(input.repository as AppRepository,{profileId:input.researchProjectId?`research:${input.researchProjectId}`:input.profileId,entity:{kind:"profile",id:input.profileId,profileId:input.profileId},signal:input.signal},(repository,signal)=>task({...input,repository,signal}));
}
