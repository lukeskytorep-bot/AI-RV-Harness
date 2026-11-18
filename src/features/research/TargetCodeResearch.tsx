import { useState } from "react";
import { getCopy } from "../../i18n";
import { getRvLite } from "../../resources/protocolRegistry";
import { renderResearchTargetCodeSteps, targetCodePolicy, TARGET_CODE_VERSION, TARGET_CODE_TEMPLATES_SHA256 } from "../../resources/rvLiteTargetCode";
import type { TargetCodeComparison, TargetCodeSessionResult } from "../../research/targetCodeResults";
import type { AppRepository } from "../../storage/repository";
import type { InterfaceLanguage } from "../../types";
import { SessionInspection } from "../../components/SessionInspection";

export function TargetCodePreview({ language, name }: { language: InterfaceLanguage; name: string }) {
  const copy = getCopy(language);
  return <section className="research-form-section"><strong>{copy.targetCodePresence}</strong><p>{copy.targetCodeLead}</p>
    <small>{TARGET_CODE_VERSION} · SHA-256 {TARGET_CODE_TEMPLATES_SHA256}</small>
    <p>{language === "pl" ? "Podgląd czterech promptów. Kod demonstracyjny A: RV-PREVIEW-0001. Właściwa nazwa profilu i kod zostaną podstawione przy sesji." : "Four-prompt preview. A demonstration code: RV-PREVIEW-0001. The actual profile name and code are rendered for each session."}</p>
    {(["with_code", "without_code"] as const).map(mode=><details key={mode}><summary>{mode === "with_code" ? copy.targetCodeWith : copy.targetCodeWithout}</summary>{renderResearchTargetCodeSteps(getRvLite(language,"extended"), name,"RV-PREVIEW-0001",targetCodePolicy(mode)).map((text,index)=><details key={index}><summary>Prompt {index+1}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{text}</pre></details>)}</details>)}
  </section>;
}

export function TargetCodeResultsView({ comparison, repository, language }: { comparison:TargetCodeComparison; repository:AppRepository; language:InterfaceLanguage }) {
  const pl = language === "pl", copy = getCopy(language), s = comparison.summary;
  const [selected,setSelected] = useState<{sessionId:string;workspaceId:string}|null>(null);
  const [error,setError] = useState("");
  const [page,setPage] = useState(0);
  const value = (v:number|undefined) => v === undefined ? "—" : v.toFixed(2);
  const inspect = async (id:string) => { try { const session = await repository.getRvSession(id); if(!session) throw new Error(pl?"Nie znaleziono sesji.":"Session not found."); setSelected({sessionId:id,workspaceId:session.workspaceId});setError(""); } catch(e) {setError(String(e));} };
  const side = (session:TargetCodeSessionResult|undefined) => session ? <>
    {session.sessionId ? <button className="secondary-button" onClick={()=>void inspect(session.sessionId!)}>{session.sessionCode ?? session.sessionId}</button> : "—"}
    <div>{value(session.aggregate?.total)} / 10</div>
    {!session.aggregate && <small>{pl?"Brak pełnej oceny":"Not fully scored"} · {session.status}</small>}
    {session.scores.length>0 && <details><summary>{pl?"Oceny i składowe":"Scores and components"}</summary>{session.scores.map(score=><p key={score.id}>J{score.judgeIndex}: {score.total}/10 · {score.gestalt}/3 + {score.verifiableFeatures}/3 + {score.activityFunctionEvent}/2 + {score.confabulationControl}/2 · {score.modelRoute}</p>)}<small>{pl?"Gestalt · cechy weryfikowalne · aktywność/funkcja/zdarzenie · kontrola konfabulacji":"Gestalt · verifiable features · activity/function/event · confabulation control"}</small></details>}
  </> : "—";
  return <section className="research-form-section"><h3>{copy.targetCodePresence}</h3>
    <p>{pl?"Średnie ze wszystkich w pełni ocenionych sesji":"Means of all fully scored sessions"}: A {value(s.meanA)} (n={s.scoredA}) · B {value(s.meanB)} (n={s.scoredB})</p>
    <p>{pl?"Pełne pary / niepełne pary":"Complete / incomplete pairs"}: {s.completePairs} / {s.missingPairs} · {pl?"Średnia różnica A−B w pełnych parach":"Mean A−B in complete pairs"}: {value(s.meanPairedDifference)} · A / {pl?"remis":"tie"} / B: {s.winsA} / {s.ties} / {s.winsB}</p>
    <div className="research-results-table-wrap"><table><thead><tr><th>{pl?"Cel / powtórzenie":"Target / repetition"}</th><th>{copy.targetCodeWith}</th><th>{copy.targetCodeWithout}</th><th>A−B</th><th>{pl?"Wynik pary":"Pair outcome"}</th></tr></thead><tbody>{comparison.pairs.slice(page*100,(page+1)*100).map(p=><tr key={p.pairKey}><td>{p.targetId} / {p.repetition}</td><td>{side(p.a)}</td><td>{side(p.b)}</td><td>{value(p.difference)}</td><td>{p.winner==="missing"?(pl?"Brak pełnej pary":"Incomplete pair"):p.winner==="tie"?(pl?"Remis":"Tie"):p.winner}</td></tr>)}</tbody></table></div>
    {comparison.pairs.length>100 && <div className="research-stage-actions"><button className="secondary-button" disabled={page===0} onClick={()=>setPage(page-1)}>←</button><span>{page+1} / {Math.ceil(comparison.pairs.length/100)}</span><button className="secondary-button" disabled={(page+1)*100>=comparison.pairs.length} onClick={()=>setPage(page+1)}>→</button></div>}
    {error && <p role="alert">{error}</p>}
    {selected && <section><button className="secondary-button" onClick={()=>setSelected(null)}>{pl?"Zamknij szczegóły":"Close details"}</button><SessionInspection repository={repository} workspaceId={selected.workspaceId} sessionId={selected.sessionId} language={language} /></section>}
  </section>;
}
