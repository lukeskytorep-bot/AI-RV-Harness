import { vi } from "vitest";
import { fixture } from "./researchJudgeRecoveryFixture";
import { assertEvaluationUpdate, type ResearchEvaluation } from "../research/evaluationTypes";
import { createResearchEvaluation, runResearchEvaluation } from "../research/evaluationEngine";
export function evaluationFixture() {
 const f=fixture(),panels=new Map<string,ResearchEvaluation>();f.project.lockedAt="t";
 const state={ended:false,changed:false};
 const marker={reason:"user_finished",endedAt:"t",stateAtEnd:"Judging",phase:"judging"} as const;
 f.repo.getResearchExecutionTermination=async()=>state.ended?marker:null;
 f.repo.getRvSession=vi.fn(async(id:string)=>({id,researchProjectId:"r",preRevealSealedAt:"t",preRevealHash:"hash",archivedAt:undefined})) as unknown as typeof f.repo.getRvSession;
 f.repo.getViewerEvidence=async()=>state.changed?"Changed evidence":"Original blind evidence";
 f.repo.listResearchEvaluations=async()=>structuredClone([...panels.values()]);
 f.repo.getResearchEvaluation=async(_project,id)=>structuredClone(panels.get(id)??null);
 f.repo.saveResearchEvaluation=vi.fn(async(record,expected)=>{assertEvaluationUpdate(panels.get(record.id)??null,record,expected);panels.set(record.id,structuredClone(record));});
 const create=(judges?:Parameters<typeof createResearchEvaluation>[0]["judges"])=>createResearchEvaluation({repository:f.repo,projectId:"r",judges});
 const run=(id:string,options:Partial<Parameters<typeof runResearchEvaluation>[0]>={})=>runResearchEvaluation({repository:f.repo,projectId:"r",evaluationId:id,chat:f.chat,...options});
 return {...f,panels,state,marker,create,run};
}

