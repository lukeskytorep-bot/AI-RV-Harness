import { assertAbortOwnership } from "../application/abortOwnership";
import { sha256Text } from "../application/sha256";
import type { WorkflowScope } from "../application/workflowOwnership";
import { aggregateJudgeScores, computeJudgeTotal } from "../domain/scoring";
import { JudgeResponseValidationError, runResearchEvaluationJudging, type JudgeSelection, type RunJudgingInput } from "../judge/engine";
import type { FrozenJudgeResultInput } from "../judge/types";
import { analyticalBudgetPolicyForSnapshot } from "../providers/outputRecovery";
import type { ProviderChatResponse } from "../providers/types";
import type { SessionEventInput } from "../sessions/types";
import type { AppRepository } from "../storage/repository";
import { createId, nowIso } from "../storage/repository";
import { assertEvaluationUpdate, type ResearchEvaluation } from "./evaluationTypes";
import { createResearchJudgeRequestRecovery, currentJudgeCompletionId, RESEARCH_JUDGE_COMPLETION_AUTH, researchJudgeRequestAvailability, ResearchJudgeCheckpointError, ResearchJudgeSlotFailure } from "./judgeRequestRecovery";
import { stableStringify } from "./planner";
import { selectMissingResearchJudges } from "./judgeSlots";
import type { ResearchJudgeDefinition } from "./types";

export const evaluationScope = (projectId: string, signal?: AbortSignal): WorkflowScope => ({ profileId: `research:${projectId}`, entity: { kind: "research_evaluation", id: projectId }, signal });
const owners = new WeakMap<object, Map<string, object>>();
function panelOwner(repository: AppRepository, panelId: string): object {
  const root = repository.recoveryOwner ?? repository;
  let panels = owners.get(root); if (!panels) { panels = new Map(); owners.set(root, panels); }
  let owner = panels.get(panelId); if (!owner) { owner = {}; panels.set(panelId, owner); }
  return owner;
}
function routeIdentity(j: JudgeSelection): string {
  const p = j.providerConfig, m = j.model;
  return stableStringify(JSON.parse(JSON.stringify({ id: p.id, provider: p.provider, baseUrl: p.baseUrl, credentialId: p.credentialId,
    credentialFingerprint: p.credentialFingerprint, outputTokenField: p.customOutputTokenField,
    modelId: m.modelId, route: m.route, providerConfigId: m.providerConfigId,
    capabilities: { ...m.capabilities, capturedAt: undefined } })));
}
async function sourceHash(repository: AppRepository, sessionId: string): Promise<string> {
  const [session, evidence, reveal, snapshot] = await Promise.all([repository.getRvSession(sessionId), repository.getViewerEvidence(sessionId), repository.getReveal(sessionId), repository.getSessionSnapshot(sessionId)]);
  if (!session?.preRevealSealedAt || !session.preRevealHash || !reveal || !snapshot || !evidence.trim() || session.archivedAt) throw new Error("Evaluation requires preserved sealed sessions, evidence, snapshot and Reveal.");
  return sha256Text(stableStringify(JSON.parse(JSON.stringify({ sessionId, researchProjectId: session.researchProjectId, profileId:session.profileId, sealedAt: session.preRevealSealedAt, sealedHash: session.preRevealHash, evidence, reveal, language: snapshot.sessionLanguage }))));
}

export async function createResearchEvaluation(input: { repository: AppRepository; projectId: string; judges?: ResearchJudgeDefinition[]; signal?: AbortSignal }): Promise<ResearchEvaluation> {
  return input.repository.withWorkflowOwnership(evaluationScope(input.projectId,input.signal), async (repository,signal) => {
    await assertAbortOwnership(signal);
    const project = await repository.getResearchProject(input.projectId);
    if (!project || project.archivedAt || !project.lockedAt) throw new Error("A locked preserved Research project is required.");
    const definitions = input.judges ?? project.config.judges;
    if (!definitions.length || definitions.length > 3) throw new Error("Select between one and three Judges.");
    const [models, providers, assignments] = await Promise.all([repository.listProviderModels(),repository.listProviderConfigs(),repository.listResearchAssignments(project.id)]);
    const judges = definitions.map(d => {
      const model = models.find(m=>m.providerConfigId===d.providerConfigId && m.modelId===d.modelId), providerConfig=providers.find(p=>p.id===d.providerConfigId);
      if(!model || !providerConfig?.enabled || !providerConfig.credentialId)throw new Error("Judge route is unavailable.");
      return structuredClone({model,providerConfig});
    });
    const sources: ResearchEvaluation["sources"] = [];
    for (const a of [...assignments].sort((a,b)=>a.judgeOrder-b.judgeOrder)) {
      if (!a.sessionId || !["SessionComplete","Judged"].includes(a.status)) continue;
      const session = await repository.getRvSession(a.sessionId);
      if (session?.researchProjectId !== project.id) throw new Error("Evaluation source project mismatch.");
      const reveal=await repository.getReveal(a.sessionId);
      if(reveal?.artifactManifest?.some(a=>a.mimeType.startsWith("image/")) && judges.some(j=>!j.model.capabilities.supportsVision || !j.model.capabilities.inputModalities.includes("image")))throw new Error("Every evaluation Judge must support the preserved Reveal images.");
      sources.push({sessionId:a.sessionId,anonymousSessionId:a.anonymousSessionId,sourceSha256:await sourceHash(repository,a.sessionId)});
    }
    if (!sources.length) throw new Error("No completed preserved sessions are available for evaluation.");
    const record: ResearchEvaluation = {schemaVersion:1,id:createId("evaluation"),projectId:project.id,revision:1,createdAt:nowIso(),language:project.config.sessionLanguage,status:"Ready",timeoutMs:project.config.sessionPolicy?.requestTimeoutMs,budgetPolicy:project.config.judgeOutputPolicy?analyticalBudgetPolicyForSnapshot(project.config.judgeOutputPolicy):"legacy_analytical",judges,sources,scores:{},events:[]};
    await assertAbortOwnership(signal); await repository.saveResearchEvaluation(record,0); return record;
  });
}

export async function runResearchEvaluation(input: { repository: AppRepository; projectId: string; evaluationId: string; signal?: AbortSignal; completeMissing?: boolean;
  chat?: RunJudgingInput["chat"]; loadImage?: RunJudgingInput["loadImage"]; onProgress?: (panel: ResearchEvaluation) => void }): Promise<void> {
  return input.repository.withWorkflowOwnership(evaluationScope(input.projectId,input.signal),async(repository,signal)=>{
    let panel=await repository.getResearchEvaluation(input.projectId,input.evaluationId);
    if(!panel)throw new Error("Research evaluation not found.");
    if(panel.status==="Complete")return;
    const owner=panelOwner(repository,panel.id);
    const save=async(candidate:ResearchEvaluation)=>{
      const next=JSON.parse(JSON.stringify(candidate)) as ResearchEvaluation;
      const before=panel!; assertEvaluationUpdate(before,next,before.revision);
      try {await repository.saveResearchEvaluation(next,before.revision);}
      catch(cause){
        // An uncertain commit is inspected, never blindly retried or repurchased.
        let persisted:ResearchEvaluation|null;
        try {persisted=await repository.getResearchEvaluation(next.projectId,next.id);}catch{throw new ResearchJudgeCheckpointError(cause);}
        if(!persisted || stableStringify(persisted)!==stableStringify(next))throw new ResearchJudgeCheckpointError(cause);
      }
      panel=next;input.onProgress?.(structuredClone(panel));
    };
    const mutate=async(patch:Partial<ResearchEvaluation>)=>save({...panel!,...patch,revision:panel!.revision+1});
    const [models,providers]=await Promise.all([repository.listProviderModels(),repository.listProviderConfigs()]);
    for(const frozen of panel.judges){
      const model=models.find(m=>m.providerConfigId===frozen.model.providerConfigId && m.modelId===frozen.model.modelId),providerConfig=providers.find(p=>p.id===frozen.providerConfig.id);
      if(!model || !providerConfig?.enabled || routeIdentity({model,providerConfig})!==routeIdentity(frozen))throw new Error("Frozen evaluation Judge route or configuration changed.");
    }
    // Verify every immutable source before any paid request.
    for(const source of panel.sources){await assertAbortOwnership(signal);if(await sourceHash(repository,source.sessionId)!==source.sourceSha256)throw new Error("Frozen evaluation source changed.");}
    await mutate({status:"Running"});
    const append=async(sessionId:string,event:SessionEventInput)=>{
      const record={...structuredClone(event),sessionId,id:createId("evaluation_event"),sequenceNumber:panel!.events.length+1,createdAt:nowIso()};
      await mutate({events:[...panel!.events,record]});
    };
    // This adapter exposes only source reads and panel writes. No original session,
    // assignment, Judge score or project termination setter is reachable.
    const adapter={
      getReveal:(id:string)=>repository.getReveal(id),getViewerEvidence:(id:string)=>repository.getViewerEvidence(id),getSessionSnapshot:(id:string)=>repository.getSessionSnapshot(id),
      listJudgeScores:async(id:string)=>structuredClone(panel!.scores[id]??[]),
      listSessionEvents:async(id:string)=>structuredClone(panel!.events.filter(e=>e.sessionId===id)),appendSessionEvent:append,
      recordFrozenJudgeResults:async(items:FrozenJudgeResultInput[])=>{
        const next=structuredClone(panel!.scores),records=items.map(({run,score})=>{
          if(next[run.sessionId]?.some(s=>s.judgeIndex===run.judgeIndex))throw new Error("Evaluation slot is already frozen.");
          const result={...score,judgeIndex:run.judgeIndex,modelRoute:run.modelRoute,total:computeJudgeTotal(score),frozenAt:nowIso(),createdAt:nowIso()};
          next[run.sessionId]=[...(next[run.sessionId]??[]),result].sort((a,b)=>a.judgeIndex-b.judgeIndex);return result;
        });
        await mutate({scores:next});return records;
      },
      recordFrozenJudgeResult:async(run:FrozenJudgeResultInput["run"],score:FrozenJudgeResultInput["score"]) => (await adapter.recordFrozenJudgeResults([{run,score}]))[0],
    };
    let fatal=false;
    try {
      for(const source of panel.sources){
        for(const {judge,judgeIndex} of selectMissingResearchJudges(panel!.scores[source.sessionId]??[],panel!.judges).map(judge=>({judge,judgeIndex:panel!.judges.indexOf(judge)+1}))){
          await assertAbortOwnership(signal);
          const route=judge.model.route;
          const events=()=>panel!.events.filter(e=>e.sessionId===source.sessionId);
          const blocked=researchJudgeRequestAvailability(events(),route,judgeIndex,{owner,sessionId:source.sessionId})==="blocked";
          const run=()=>runResearchEvaluationJudging({repository:adapter,sessionId:source.sessionId,language:panel!.language,anonymousSessionId:source.anonymousSessionId,judges:[judge],signal,
            researchPolicy:{judgeIndex,onNormalization:async trace=>{
              if(!events().some(e=>e.eventType==="RESEARCH_JUDGE_NORMALIZED" && e.metadata?.judgeIndex===judgeIndex && e.metadata?.sourceSha256===trace.sourceSha256 && e.metadata?.completionId===currentJudgeCompletionId(events(),route,judgeIndex)))await append(source.sessionId,{eventType:"RESEARCH_JUDGE_NORMALIZED",role:"controller",metadata:{...trace,modelRoute:route,judgeIndex,completionId:currentJudgeCompletionId(events(),route,judgeIndex)}});
            }},
            recoverRequest:createResearchJudgeRequestRecovery({repository:adapter as unknown as AppRepository,owner,sessionId:source.sessionId,modelRoute:route,judgeIndex,allowValidationReplay:true,allowLegacyResponse:false,signal}),
            budgetPolicy:panel!.budgetPolicy,timeoutMs:panel!.timeoutMs,chat:input.chat,loadImage:input.loadImage,streamWorkflowContext:"research"});
          const failure=async(cause:JudgeResponseValidationError|ResearchJudgeSlotFailure)=>{
            if(cause instanceof JudgeResponseValidationError){
              const completionId=currentJudgeCompletionId(events(),route,judgeIndex);
              if(!events().some(e=>e.eventType==="RESEARCH_JUDGE_VALIDATION_BLOCK" && e.metadata?.judgeIndex===judgeIndex && e.metadata?.completionId===completionId && e.content===cause.message))await append(source.sessionId,{eventType:"RESEARCH_JUDGE_VALIDATION_BLOCK",role:"controller",content:cause.message,metadata:{modelRoute:route,judgeIndex,completionId}});
            }
          };
          try{await run();}
          catch(cause){
            await assertAbortOwnership(signal);
            if(!(cause instanceof JudgeResponseValidationError) && !(cause instanceof ResearchJudgeSlotFailure))throw cause;
            await failure(cause);
            if(input.completeMissing && blocked){
              const previousId=currentJudgeCompletionId(events(),route,judgeIndex);
              const previous=events().filter(e=>e.metadata?.modelRoute===route && e.metadata?.judgeIndex===judgeIndex && e.metadata?.completionId===previousId && (e.eventType==="RESEARCH_JUDGE_VALIDATION_BLOCK" || e.eventType==="RESEARCH_JUDGE_REQUEST_V1" && ["failed","paused","dispatched"].includes(String(e.metadata?.status)))).at(-1);
              if(!previous)throw new Error("Completion requires a prior evaluation failure.");
              await append(source.sessionId,{eventType:RESEARCH_JUDGE_COMPLETION_AUTH,role:"controller",metadata:{version:1,completionId:createId("evaluation_completion"),previousId,previousFailureEventId:previous.id,modelRoute:route,judgeIndex}});
              try{await run();}catch(retryCause){await assertAbortOwnership(signal);if(!(retryCause instanceof JudgeResponseValidationError) && !(retryCause instanceof ResearchJudgeSlotFailure))throw retryCause;await failure(retryCause);}
            }
          }
        }
      }
    }catch(cause){fatal=true;throw cause;}
    finally{
      // A failed checkpoint must never start another write in an outer handler.
      // Running is resumable after restart; source execution remains unchanged.
      if(!fatal){const complete=panel!.sources.every(s=>panel!.scores[s.sessionId]?.length===panel!.judges.length);await mutate({status:complete?"Complete":"Incomplete"});}
    }
  });
}

export function evaluationSessionResults(panel:ResearchEvaluation){
  if(panel.status!=="Complete")throw new Error("Panel results require every score to be frozen.");
  return panel.sources.map(source=>({anonymousSessionId:source.anonymousSessionId,...aggregateJudgeScores(panel.scores[source.sessionId])}));
}
