import { leadDecisionErrorMessage } from "../telepathicExchange/leadDecisionResponse";
import { Component, useEffect, useId, useRef } from "react";
import { readableTelepathicText, telepathicMessageTitle, uniqueTelepathicEvents } from "../telepathicExchange/displayProjection";
import { telepathicStageLabel } from "../telepathicExchange/stageLabels";
import { ArrowUp } from "lucide-react";
import { SafeMarkdown } from "./SafeMarkdown";
import { TooltipButton } from "./TooltipButton";
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
  const instanceId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLHeadingElement>());
  useEffect(()=>{
    if(containerRef.current)containerRef.current.scrollTop=0;
    if(navRef.current)navRef.current.scrollTop=0;
  },[seriesId,roundId]);
  const prefix=`telepathy-${encodeURIComponent(instanceId)}-${encodeURIComponent(seriesId)}-${encodeURIComponent(roundId ?? "final")}`;
  const jump=(participantId?:string)=>{
    const container=containerRef.current;
    const target=participantId ? sectionRefs.current.get(participantId) : navRef.current;
    if (!container || !target) return;
    if(!participantId && navRef.current)navRef.current.scrollTop=0;
    const navHeight=navRef.current?.getBoundingClientRect().height ?? 0;
    const top=participantId ? Math.max(0,container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - navHeight - 8) : 0;
    container.scrollTo({top,behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    target.focus({preventScroll:true});
  };
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
  return <div className="telepathic-transcript" ref={containerRef}>
    <nav ref={navRef} className="telepathic-participant-nav" id={`${prefix}-nav`} tabIndex={-1} aria-label={pl ? "Uczestnicy" : "Participants"}>
      {ordered.map(p=><TooltipButton key={p.id} className={`telepathic-nav-button ${p.id===leadId ? "telepathic-nav-lead" : ""}`} label={`${pl?"Przejdź do":"Go to"} ${p.id===leadId ? (pl?"prowadzącego":"lead") : (pl?"uczestnika":"participant")} — ${p.displayName}`} ariaControls={`${prefix}-${encodeURIComponent(p.id)}`} onClick={()=>jump(p.id)}>{p.id===leadId ? `${pl?"Prowadzący":"Lead"} · ` : ""}{p.displayName}</TooltipButton>)}
    </nav>
    {ordered.map((p,index)=><section className="telepathic-participant-section" key={p.id}>
      <h3 ref={node=>{if(node)sectionRefs.current.set(p.id,node);else sectionRefs.current.delete(p.id);}} id={`${prefix}-${encodeURIComponent(p.id)}`} tabIndex={-1}><span>{p.id===leadId ? (pl?"Prowadzący":"Lead") : `${pl?"Uczestnik":"Participant"} ${index+1}`} — {p.displayName}</span>
        <TooltipButton className="telepathic-back" label={`${pl?"Wróć do listy uczestników":"Back to participants"} — ${p.displayName}`} ariaControls={`${prefix}-nav`} onClick={()=>jump()}><ArrowUp size={16}/></TooltipButton>
      </h3>
      {uniqueTelepathicEvents(events).filter(e=>e.seriesId===seriesId && e.roundId===roundId && (e.authorId===p.id || e.recipientIds.includes(p.id))).sort((a,b)=>a.sequence-b.sequence).map(e=><article className={`telepathic-transcript-message ${e.authorId==="controller" ? "telepathic-message-controller" : e.authorId===leadId ? "telepathic-message-lead" : "telepathic-message-participant"}`} key={e.id}>
        <strong className="telepathic-message-author">{telepathicMessageTitle(e,participants,leadId,pl)}</strong>
        <small>{e.authorId==="controller"?(pl?"Kontroler":"Controller"):participants.find(p=>p.id===e.authorId)?.displayName ?? e.authorId} → {e.recipientIds.map(id=>participants.find(p=>p.id===id)?.displayName ?? id).join(", ") || (pl?"zapis":"record")} · {telepathicStageLabel(e.stage,pl)}{e.kind==="materials"?` · ${pl?"Instrukcja":"Instruction"}`:""}{deliveryLabel(e)}{e.cycle ? ` · ${pl?"cykl":"cycle"} ${e.cycle}` : ""}</small>
        {e.kind === "notice" && e.stage.startsWith("lead_guidance:cycle:") && (e.decisionRejectionReason || e.text.startsWith("[REJECTED DECISION"))
          ? <><p role="status">{leadDecisionErrorMessage(e.decisionRejectionReason ?? "Invalid lead decision",pl)}</p>
            <details><summary>{pl ? "Szczegóły odrzuconej decyzji" : "Rejected decision details"}</summary><pre className="telepathic-raw-fallback">{e.text}</pre></details></>
          : <TranscriptMarkdownBoundary content={readableTelepathicText(e,pl)}/> }
      </article>)}
      {legacy&&<small>{pl?"Treść wysłanego pytania nie została zapisana w tej wersji.":"The sent instruction was not recorded in this version."}</small>}
    </section>)}
  </div>;
}
