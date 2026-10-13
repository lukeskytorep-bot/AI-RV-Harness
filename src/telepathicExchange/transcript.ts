import { withReadableInstruction } from "./displayProjection";
import type { TelepathicSeriesState, TelepathicTranscriptEvent } from "./types";

export function recordTranscript(state: TelepathicSeriesState, event: Omit<TelepathicTranscriptEvent, "seriesId" | "sequence" | "createdAt">, timestamp: string): void {
  if (state.config.protocolVersion !== "fixed_lead_v1") return;
  state.transcript ??= [];
  if (state.transcript.some(e => e.id === event.id)) return;
  state.transcript.push({ ...event, seriesId: state.config.seriesId, sequence: state.transcript.length + 1, createdAt: timestamp });
}
export function visibleTranscript(state: TelepathicSeriesState): TelepathicTranscriptEvent[] {
  const human = state.config.participants.find(p => p.kind === "human");
  const recorded = state.transcript ?? legacyEvents(state);
  // Some historical/imported states kept accepted finals in the map without an
  // output event. Project those stored answers too, without rewriting history.
  const finalFallbacks: TelepathicTranscriptEvent[] = state.transcript === undefined ? [] : Object.entries(state.finalReflections)
    .filter(([authorId, text]) => typeof text === "string" && state.config.participants.some(p => p.id === authorId)
      && !recorded.some(e => e.stage === "series_reflection" && e.authorId === authorId && (e.kind === "reflection" || e.kind === "response")))
    .map(([authorId, text], index) => ({ id: `legacy:final:${authorId}`, seriesId: state.config.seriesId,
      sequence: Math.max(0, ...recorded.map(e => e.sequence)) + index + 1, stage: "series_reflection", kind: "reflection", authorId, recipientIds: [], text, createdAt: state.createdAt }));
  return [...recorded, ...finalFallbacks].filter(e => {
    if (!human || !e.roundId) return true;
    const round = state.rounds.find(r => r.assignment.roundId === e.roundId);
    if (state.transcript === undefined && !round?.revealedAt && ["reflection","shared_answers_comment"].includes(e.stage)) return false;
    return Boolean(round && (round.revealedAt || round.assignment.senderParticipantId === human.id ||
      ((e.authorId === human.id || e.recipientIds.includes(human.id)) && e.stage !== "lead_guidance")));
  }).map(e => withReadableInstruction(state, structuredClone(e)));
}

export function legacyEvents(state: { config: Pick<TelepathicSeriesState["config"],"seriesId"|"participants">;rounds:TelepathicSeriesState["rounds"];createdAt:string; finalReflections?:Record<string,string> }): TelepathicTranscriptEvent[] {
  const events: TelepathicTranscriptEvent[]=[];
  for(const round of state.rounds) {
    for(const p of state.config.participants) {
      const blind=round.blindByParticipant[p.id], reflection=round.reflectionsByParticipant[p.id];
      const records=[["receiver_first",blind?.first],["receiver_second",blind?.second],["reflection",reflection?.reflection],["shared_answers_comment",reflection?.sharedAnswersComment]];
      for(const [stage,text] of records) if(text) events.push({id:`legacy:${round.assignment.roundId}:${p.id}:${stage}`,seriesId:state.config.seriesId,roundId:round.assignment.roundId,sequence:events.length+1,stage:stage!,kind:"response",authorId:p.id,recipientIds:[],text,createdAt:state.createdAt});
      if(round.target&&p.id===round.assignment.senderParticipantId) events.push({id:`legacy:${round.assignment.roundId}:target`,seriesId:state.config.seriesId,roundId:round.assignment.roundId,sequence:events.length+1,stage:"sender_target",kind:"response",authorId:p.id,recipientIds:[],text:round.target.content,createdAt:state.createdAt});
    }
  }
  for (const [id,text] of Object.entries(state.finalReflections ?? {})) events.push({id:`legacy:final:${id}`,seriesId:state.config.seriesId,sequence:events.length+1,stage:"series_reflection",kind:"reflection",authorId:id,recipientIds:[],text,createdAt:state.createdAt});
  return events;
}
