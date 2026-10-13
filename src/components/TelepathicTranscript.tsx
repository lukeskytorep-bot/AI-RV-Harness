import { Component } from "react";
import { readableTelepathicText, telepathicMessageTitle, uniqueTelepathicEvents } from "../telepathicExchange/displayProjection";
import { telepathicStageLabel } from "../telepathicExchange/stageLabels";
import { ArrowUp } from "lucide-react";
import { SafeMarkdown } from "./SafeMarkdown";
import type { TelepathicTranscriptEvent } from "../telepathicExchange/types";
import type { TelepathicCallPresentation } from "../telepathicExchange/executionPresentation";

class TranscriptMarkdownBoundary extends Component<{ content: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { content: string }) { if (previous.content !== this.props.content && this.state.failed) this.setState({ failed: false }); }
  render() { return this.state.failed ? <pre className="telepathic-raw-fallback">{this.props.content}</pre> : <SafeMarkdown content={this.props.content}/>; }
}

interface Props { seriesId: string; roundId?: string; leadId: string; participants: Array<{id:string;displayName:string}>; events: TelepathicTranscriptEvent[]; pl: boolean; legacy?: boolean; callPresentation?: Readonly<Record<string, TelepathicCallPresentation>>; }
export function TelepathicTranscript({seriesId,roundId,leadId,participants,events,pl,legacy,callPresentation}:Props) {
  const ordered=[...participants.filter(p=>p.id===leadId),...participants.filter(p=>p.id!==leadId)];
  const prefix=`telepathy-${encodeURIComponent(seriesId)}-${encodeURIComponent(roundId ?? "final")}`;
  const jump=(id:string)=>{ const target=document.getElementById(id); target?.scrollIntoView({block:"start",behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); target?.focus({preventScroll:true}); };
  const deliveryLabel = (event: TelepathicTranscriptEvent) => {
    if (event.kind !== "materials" || !["dispatched", "uncertain", "failed"].includes(event.providerCallStatus ?? "")) return "";
    // Only an explicit projection for this call can neutralize dispatched.
    // Uncertain/failed and orphaned dispatched retain the recovery label.
    const display = event.providerCallStatus === "dispatched" && event.providerCallId ? callPresentation?.[event.providerCallId] : undefined;
    const label = display === "waiting" ? (pl ? "Oczekiwanie na odpowiedź" : "Waiting for response")
      : display === "other" ? (pl ? "Praca trwa w innym oknie" : "Work is running in another window")
      : display === "checking" ? (pl ? "Sprawdzanie stanu wywołania" : "Checking call state")
      : (pl ? "wysłanie niepotwierdzone" : "delivery unconfirmed");
    return ` · ${label}`;
  };
  return <div className="telepathic-transcript">
    <nav className="telepathic-participant-nav" id={`${prefix}-nav`} tabIndex={-1} aria-label={pl ? "Uczestnicy" : "Participants"}>
      {ordered.map(p=><button type="button" key={p.id} onClick={()=>jump(`${prefix}-${encodeURIComponent(p.id)}`)}>{p.id===leadId ? `${pl?"Prowadzący":"Lead"} · ` : ""}{p.displayName}</button>)}
    </nav>
    {ordered.map((p,index)=><section className="telepathic-participant-section" key={p.id}>
      <h3 id={`${prefix}-${encodeURIComponent(p.id)}`} tabIndex={-1}>{p.id===leadId ? (pl?"Prowadzący":"Lead") : `${pl?"Uczestnik":"Participant"} ${index+1}`} — {p.displayName}
        <button type="button" className="telepathic-back" title={pl?"Wróć do listy uczestników":"Back to participants"} aria-label={pl?"Wróć do listy uczestników":"Back to participants"} onClick={()=>jump(`${prefix}-nav`)}><ArrowUp size={14}/></button>
      </h3>
      {uniqueTelepathicEvents(events).filter(e=>e.seriesId===seriesId && e.roundId===roundId && (e.authorId===p.id || e.recipientIds.includes(p.id))).sort((a,b)=>a.sequence-b.sequence).map(e=><article className="telepathic-transcript-message" key={e.id}>
        <strong className="telepathic-message-author">{telepathicMessageTitle(e,participants,leadId,pl)}</strong>
        <small>{e.authorId==="controller"?(pl?"Kontroler":"Controller"):participants.find(p=>p.id===e.authorId)?.displayName ?? e.authorId} → {e.recipientIds.map(id=>participants.find(p=>p.id===id)?.displayName ?? id).join(", ") || (pl?"zapis":"record")} · {telepathicStageLabel(e.stage,pl)}{e.kind==="materials"?` · ${pl?"Instrukcja":"Instruction"}`:""}{deliveryLabel(e)}{e.cycle ? ` · ${pl?"cykl":"cycle"} ${e.cycle}` : ""}</small>
        <TranscriptMarkdownBoundary content={readableTelepathicText(e,pl)}/>
      </article>)}
      {legacy&&<small>{pl?"Treść wysłanego pytania nie została zapisana w tej wersji.":"The sent instruction was not recorded in this version."}</small>}
    </section>)}
  </div>;
}
