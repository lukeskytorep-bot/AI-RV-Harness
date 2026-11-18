import { buildResearchLockPlan } from "../research/planner";
import { targetCodeConfig } from "./targetCodeFixture";
import type { RvSession } from "../sessions/types";
import type { JudgeScoreRecord } from "../judge/types";
export async function targetCodeResultsFixture(){
 const config=targetCodeConfig();config.repetitions=4;
 const plan=await buildResearchLockPlan("r",config);const sessions:RvSession[]=[],scoresBySession:Record<string,JudgeScoreRecord[]>={};
 for(const assignment of plan.assignments){
  const mapping=plan.mappings.find(m=>m.anonymousSessionId===assignment.anonymousSessionId)!;
  const mode=plan.conditions.find(c=>c.id===mapping.conditionId)!.conditionKey;
  const rep=Number(/^pair_tc(\d+)_/.exec(mapping.pairKey)![1]);const isA=mode==="with_code";const id=`s-${rep}-${isA?"A":"B"}`;
  assignment.sessionId=id;assignment.status="Judged";
  sessions.push({id,workspaceId:"w",profileId:"p",sessionCode:`RV-${rep}-${isA?"A":"B"}`,researchProjectId:"r",targetId:assignment.targetId,runType:"automatic",state:"Revealed",preRevealTranscript:"sealed evidence",preRevealHash:"hash",preRevealSealedAt:"sealed",postRevealTranscript:"",createdAt:"t",updatedAt:"t"});
  const total=(isA?[8,4,6,10]:[6,8,6,9])[rep-1];
  const components=total===10?[3,3,2,2]:total===9?[3,2,2,2]:total===8?[3,3,1,1]:total===6?[2,2,1,1]:[1,1,1,1];
  scoresBySession[id]=Array.from({length:!isA&&rep===4?1:2},(_,i)=>({id:`${id}-j${i+1}`,judgeRunId:`run-${id}-${i}`,judgeIndex:i+1,modelRoute:`judge-${i+1}`,total,gestalt:components[0],verifiableFeatures:components[1],activityFunctionEvent:components[2],confabulationControl:components[3],narrative:{strongestMatches:[],majorMissesContradictions:[],confabulationObservations:[],conciseRationale:"fixture"},frozenAt:"frozen",createdAt:"t"}));
 }
 return {...plan,sessions,scoresBySession,requiredJudges:2};
}
