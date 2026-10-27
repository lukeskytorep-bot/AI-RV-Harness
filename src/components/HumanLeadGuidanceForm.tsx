import { useState } from "react";
import { useTelepathicDraft } from "./useTelepathicDraft";
import { buildHumanLeadDecision } from "../telepathicExchange/leadGuidance";
import type { LeadGuidanceDecision } from "../telepathicExchange/types";

/** The parent keys this draft by series, round and cycle, never by checkpoint. */
export function HumanLeadGuidanceForm({cycle,participants,pl,disabled,onDecision,draftKey}: {
  draftKey?: string;
  cycle: 1|2|3;
  participants: Array<{id:string;displayName:string}>;
  pl:boolean;
  disabled:boolean;
  onDecision:(decision:LeadGuidanceDecision)=>void;
}) {
  const [draft,setDraft]=useTelepathicDraft(draftKey ? `${draftKey}:lead:${cycle}` : null);
  const [fallback,setFallback]=useState("");
  let fields: Record<string,string> = {};
  try {
    const parsed: unknown = JSON.parse(draft || fallback || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string,string] => typeof entry[1] === "string"));
  } catch { /* Ignore a damaged local draft. */ }
  const setFields = (update: (current: Record<string,string>) => Record<string,string>) => (draftKey ? setDraft : setFallback)(JSON.stringify(update(fields)));
  const activeIds=participants.map(p=>p.id);
  return <form className="panel telepathic-action-box telepathic-human-guidance" onSubmit={event=>{event.preventDefault();if(!disabled)onDecision(buildHumanLeadDecision(cycle,activeIds,fields));}}>
    <h3>{pl?"Prowadzenie":"Guidance"} · {cycle}/3</h3>
    <p>{pl?"Wpisz pytanie, aby kontynuować. Puste pole kończy udział odbiorcy w prowadzeniu tej rundy, bez usuwania go z serii.":"Enter a question to continue. An empty field ends the receiver’s guidance in this round, without removing them from the series."}</p>
    <fieldset disabled={disabled} className="telepathic-human-guidance-fields">
      {participants.map(p=><label key={p.id}><span>{pl?"Pytanie / instrukcja dla":"Question / instruction for"} {p.displayName}</span><textarea rows={3} maxLength={4000} value={fields[p.id]??""} onChange={e=>setFields(current=>({...current,[p.id]:e.target.value}))}/></label>)}
      <div className="telepathic-action-row telepathic-guidance-actions">
        <button type="submit" className="primary-button">{pl?"Wyślij pytania i kontynuuj":"Send questions and continue"}</button>
        <button type="button" className="secondary-button" onClick={()=>{if(!disabled)onDecision({cycle,finishRound:true,finishParticipantIds:[],individual:[]});}}>{pl?"Zakończ pytania i zamknij blind":"Finish guidance and seal blind"}</button>
      </div>
    </fieldset>
  </form>;
}
