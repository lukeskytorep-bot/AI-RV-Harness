import type { AppRepository } from "../storage/repository";
import { evaluationSessionResults } from "../research/evaluationEngine";
import { writeExportPackage } from "./native";

/** Each directory and each exported row names its own panel. Never pool panels. */
export async function exportResearchEvaluation(repository:AppRepository,projectId:string,evaluationId:string,baseDirectory?:string):Promise<string>{
 const panel=await repository.getResearchEvaluation(projectId,evaluationId);
 if(!panel)throw new Error("Research evaluation not found.");
 const received=Object.values(panel.scores).reduce((n,scores)=>n+scores.length,0),expected=panel.sources.length*panel.judges.length;
 const view={evaluationId:panel.id,sourceProjectId:panel.projectId,createdAt:panel.createdAt,partial:panel.status!=="Complete",received,expected,
   judges:panel.judges.map((j,i)=>({judgeIndex:i+1,provider:j.model.provider,modelId:j.model.modelId,modelRoute:j.model.route})),
   sessions:panel.sources.map(s=>({anonymousSessionId:s.anonymousSessionId,sourceSha256:s.sourceSha256,scores:panel.scores[s.sessionId]??[]})),
   ...(panel.status==="Complete"?{results:evaluationSessionResults(panel)}:{})};
 const cell=(v:unknown)=>`"${String(v).replaceAll('"','""')}"`;
 const rows=panel.sources.flatMap(s=>(panel.scores[s.sessionId]??[]).map(score=>[panel.id,s.anonymousSessionId,score.judgeIndex,score.gestalt,score.verifiableFeatures,score.activityFunctionEvent,score.confabulationControl,score.total]));
 const csv=[["evaluation_id","anonymous_session_id","judge_index","gestalt","verifiable_features","activity_function_event","confabulation_control","total"],...rows].map(r=>r.map(cell).join(",")).join("\r\n")+"\r\n";
 const pl=panel.language==="pl";
 const readme=`# ${panel.id}\n\n${pl?"Osobny panel oceniania zachowanych sesji. Wyników różnych paneli nie łączymy.":"Separate evaluation of preserved sessions. Results from different panels are not pooled."}\n\n${panel.status==="Complete"?(pl?"Panel kompletny":"Panel complete"):(pl?"Wyniki częściowe — nie są końcowym wynikiem panelu":"Partial scores — not final panel results")}: ${received}/${expected}.\n\n${pl?"Pełny zapis i identyfikatory techniczne znajdują się w private_master. Zachowaj ten folder jako prywatny.":"Full records and internal identities are in private_master. Keep that folder private."}\n`;
 return writeExportPackage({exportId:`RV_Harness_Evaluation_${panel.id}_${Date.now()}`,files:[{relativePath:"README.md",content:readme},{relativePath:"evaluation/scores.json",content:JSON.stringify(view,null,2)},{relativePath:"evaluation/scores.csv",content:csv},{relativePath:"private_master/evaluation_record.json",content:JSON.stringify(panel,null,2)}],...(baseDirectory?{destination:"external" as const,baseDirectory}:{})});
}
