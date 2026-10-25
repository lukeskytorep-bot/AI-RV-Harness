import { readableTelepathicText, telepathicMessageTitle, uniqueTelepathicEvents } from "./displayProjection";
import { telepathicStageLabel } from "./stageLabels";
import { visibleTranscript } from "./transcript";
import type { TelepathicSeriesState } from "./types";

export function telepathicExportDocument(state: TelepathicSeriesState): string {
  const pl=state.config.language==="pl";
  const events=uniqueTelepathicEvents(visibleTranscript(state));
  const sections=[`# ${pl?"Seria telepatyczna":"Telepathic series"} ${state.config.seriesId}`];
  for(const round of state.rounds) {
    sections.push(`## ${pl?"Runda":"Round"} ${round.assignment.roundNumber}`);
    const ordered=[...state.config.participants.filter(p=>p.id===round.assignment.senderParticipantId),...state.config.participants.filter(p=>p.id!==round.assignment.senderParticipantId)];
    for(const p of ordered) {
      sections.push(`### ${p.id===round.assignment.senderParticipantId?(pl?"Prowadzący":"Lead"):(pl?"Uczestnik":"Participant")} — ${p.displayName}`);
      for(const e of events.filter(e=>e.roundId===round.assignment.roundId&&(e.authorId===p.id||e.recipientIds.includes(p.id)))) {
        // Encode each independent record in a fenced block longer than any fence
        // it contains; malformed Markdown cannot consume another participant.
        const text=readableTelepathicText(e,pl);
        const fence="`".repeat(Math.max(3,...(text.match(/`+/g) ?? []).map(m=>m.length+1)));
        sections.push(`#### ${telepathicMessageTitle(e,state.config.participants,round.assignment.senderParticipantId,pl)} · ${telepathicStageLabel(e.stage,pl)}`,`${fence}text\n${text}\n${fence}`);
      }
      if(!state.transcript) {
        sections.push(pl?"Treść wysłanego pytania nie została zapisana w tej wersji.":"The sent instruction was not recorded in this version.");

      }
    }
  }
  sections.push(`## ${pl?"Końcowe refleksje":"Final reflections"}`);
  for(const e of events.filter(e=>e.roundId===undefined)) { const text=readableTelepathicText(e,pl);const fence="`".repeat(Math.max(3,...(text.match(/`+/g)??[]).map(m=>m.length+1)));sections.push(`### ${telepathicMessageTitle(e,state.config.participants,state.plan.rounds[0]?.senderParticipantId ?? "",pl)}`,`${fence}text\n${text}\n${fence}`); }

  return sections.join("\n\n");
}
