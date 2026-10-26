import { useEffect, useRef, useState } from "react";
import type { AppRepository } from "../../storage/repository";
import type { ResearchProjectRecord } from "../../research/types";
import type { ResearchEvaluation } from "../../research/evaluationTypes";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { createResearchEvaluation, evaluationSessionResults, runResearchEvaluation } from "../../research/evaluationEngine";
import { exportResearchEvaluation } from "../../exports/researchEvaluation";
import { chooseDirectory } from "../../storage/native";
import { modelRouteKeyFor } from "../../modelRoutes";
import { useWorkflowOwnership } from "../../components/useWorkflowOwnership";
import { isTauriRuntime } from "../../storage";

export function ResearchEvaluationPanels({repository,project,pl,sourceBusy=false,onBusyChange}:{repository:AppRepository;project:ResearchProjectRecord;pl:boolean;sourceBusy?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [panels,setPanels]=useState<ResearchEvaluation[]>([]),[models,setModels]=useState<ProviderModel[]>([]),[providers,setProviders]=useState<ProviderConfig[]>([]);
 const [custom,setCustom]=useState(false),[keys,setKeys]=useState<string[]>([""]),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(""),[exportPath,setExportPath]=useState("");
 const guard=useRef(false),abort=useRef<AbortController|null>(null);
 const ownership=useWorkflowOwnership(repository,`research:${project.id}`);
 const unavailable=sourceBusy || Boolean(busy) || ownership.unavailable || !isTauriRuntime();
 const refresh=async()=>{if(typeof repository.listResearchEvaluations==="function")setPanels(await repository.listResearchEvaluations(project.id));};
 useEffect(()=>{let closed=false;void (async()=>{try{const [ps,ms,cs]=await Promise.all([typeof repository.listResearchEvaluations==="function"?repository.listResearchEvaluations(project.id):Promise.resolve([]),repository.listProviderModels(),repository.listProviderConfigs()]);if(!closed){setPanels(ps);setModels(ms);setProviders(cs);}}catch(cause){if(!closed)setError(String(cause));}})();return()=>{closed=true;abort.current?.abort(new DOMException("Evaluation view closed","AbortError"));};},[repository,project.id]);
 const perform=async(id:string,work:(signal:AbortSignal)=>Promise<void>)=>{
  if(guard.current || unavailable)return;guard.current=true;const controller=new AbortController();abort.current=controller;setBusy(id);onBusyChange?.(true);setError("");
  try{await work(controller.signal);}catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
  finally{try{await refresh();}catch(cause){setError(String(cause));}abort.current=null;guard.current=false;setBusy(null);onBusyChange?.(false);}
 };
 const update=(p:ResearchEvaluation)=>setPanels(current=>current.some(x=>x.id===p.id)?current.map(x=>x.id===p.id?p:x):[...current,p]);
 const create=()=>perform("new",async signal=>{
  const judges=custom?keys.map(key=>{const model=models.find(m=>modelRouteKeyFor(m)===key);if(!model)throw new Error(pl?"Wybierz model dla każdego sędziego.":"Select a model for every Judge.");return{providerConfigId:model.providerConfigId,modelId:model.modelId};}):undefined;
  const panel=await createResearchEvaluation({repository,projectId:project.id,judges,signal});update(panel);
  await runResearchEvaluation({repository,projectId:project.id,evaluationId:panel.id,signal,onProgress:update});
 });
 return <section className="panel research-evaluation-panels"><strong>{pl?"Osobne panele oceniania":"Separate evaluation panels"}</strong>
  <p>{pl?"Oceń ponownie zachowane, ukończone sesje. Każdy panel ma własne wyniki; wcześniejsze oceny i zakończenie wykonania pozostają zachowane.":"Evaluate the preserved completed sessions again. Each panel has its own results; previous scores and execution termination remain preserved."}</p>
  <label>{pl?"Sędziowie nowego panelu":"Judges for the new panel"} <select disabled={unavailable} value={custom?"custom":"same"} onChange={e=>setCustom(e.target.value==="custom")}><option value="same">{pl?"Ci sami sędziowie — pełna nowa ocena":"Same Judges — full new evaluation"}</option><option value="custom">{pl?"Wybierz sędziów — pełna nowa ocena":"Select Judges — full new evaluation"}</option></select></label>
  {custom && <div><label>{pl?"Liczba sędziów":"Judge count"} <select disabled={unavailable} value={keys.length} onChange={e=>setKeys(current=>Array.from({length:Number(e.target.value)},(_,i)=>current[i]??""))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label>{keys.map((key,i)=><select key={i} data-model-route-role="judge" className="research-judge-select" value={key} onChange={event=>setKeys(current=>current.map((v,j)=>i===j?event.target.value:v))} disabled={unavailable}><option value="">{pl?"Sędzia":"Judge"} {i+1}</option>{models.filter(m=>providers.some(p=>p.id===m.providerConfigId && p.enabled && p.credentialId)).map(m=><option key={modelRouteKeyFor(m)} value={modelRouteKeyFor(m)}>{providers.find(p=>p.id===m.providerConfigId)?.label} · {m.displayName}</option>)}</select>)}</div>}
  <button className="secondary-button" disabled={unavailable || !custom && !project.config.judges.length} onClick={()=>void create()}>{pl?"Rozpocznij nowy panel oceniania":"Start a new evaluation panel"}</button>
  {busy && <button className="stop-button" disabled={abort.current?.signal.aborted} onClick={()=>abort.current?.abort(new DOMException("Evaluation stopped by user","AbortError"))}>STOP</button>}
  {error && <p role="alert">{error}</p>}{exportPath && <p>{exportPath}</p>}
  {panels.map((panel,index)=>{const received=Object.values(panel.scores).reduce((n,s)=>n+s.length,0),expected=panel.sources.length*panel.judges.length;return <details key={panel.id}><summary>{pl?"Panel":"Panel"} {index+1} · {panel.status} · {received}/{expected} · {panel.createdAt}</summary>
    <small><code>{panel.id}</code> · {panel.sources.length} {pl?"sesji":"sessions"}</small><p>{panel.judges.map((j,i)=>`J${i+1}: ${j.model.displayName} (${j.model.route})`).join(" · ")}</p>
    {panel.status!=="Complete" && <button disabled={unavailable} className="secondary-button" onClick={()=>void perform(panel.id,signal=>runResearchEvaluation({repository,projectId:project.id,evaluationId:panel.id,signal,completeMissing:true,onProgress:update}))}>{pl?"Dokończ brakujące w tym panelu":"Complete missing scores in this panel"}</button>}
    <button disabled={unavailable} className="secondary-button" onClick={()=>void perform("export",async()=>{const destination=await chooseDirectory(pl?"Wybierz folder eksportu panelu":"Choose evaluation export folder");if(destination)setExportPath(await exportResearchEvaluation(repository,project.id,panel.id,destination));})}>{pl?"Eksportuj ten panel":"Export this panel"}</button>
    {panel.status!=="Complete" && <p>{pl?"Wyniki częściowe; brakujące oceny nie są sukcesem.":"Partial scores; missing evaluations are not counted as success."}</p>}
    {panel.sources.map(source=><details key={source.sessionId}><summary><code>{source.anonymousSessionId}</code> · {panel.scores[source.sessionId]?.length??0}/{panel.judges.length}</summary>{panel.judges.map((_,i)=>!panel.scores[source.sessionId]?.some(s=>s.judgeIndex===i+1) && <p key={`missing-${i}`}>J{i+1}: {panel.events.filter(e=>e.sessionId===source.sessionId && e.metadata?.judgeIndex===i+1 && e.eventType==="RESEARCH_JUDGE_VALIDATION_BLOCK").at(-1)?.content || (pl?"Oczekuje na ocenę lub dokończenie":"Awaiting evaluation or completion")}</p>)}{(panel.scores[source.sessionId]??[]).map(score=><div key={score.id}><strong>J{score.judgeIndex}: {score.total}/10</strong><pre>{JSON.stringify(score.narrative,null,2)}</pre></div>)}</details>)}
    {panel.status==="Complete" && <div>{evaluationSessionResults(panel).map(row=><p key={row.anonymousSessionId}><code>{row.anonymousSessionId}</code> · {pl?"Średnia":"Mean"}: {row.mean.total}/10</p>)}</div>}
  </details>;})}
 </section>;
}
