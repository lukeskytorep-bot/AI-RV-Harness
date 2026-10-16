import { individualLeadCommand, leadDecisionContract, LEAD_INSTRUCTION_VERSION, LEGACY_LEAD_INSTRUCTION_VERSION } from "./leadGuidance";
import * as packets from "./packets";
import { buildReceiverSecondLookPrompt, receiverRevealInstruction, senderRevealInstruction, missingRevealInstruction, sharedAnswersInstruction, seriesReflectionInstruction } from "./prompts";
import type { TelepathicSeriesState, TelepathicTranscriptEvent } from "./types";

/** Only known, versioned packet shapes may supply a legacy instruction. Nothing
 * is removed from evidence. Unrecognized material is unavailable, not guessed. */
export function withReadableInstruction(state: TelepathicSeriesState, event: TelepathicTranscriptEvent): TelepathicTranscriptEvent {
  if (event.kind !== "materials" || event.display !== undefined) return event;
  if (state.config.protocolVersion !== "fixed_lead_v1" || ![LEAD_INSTRUCTION_VERSION, LEGACY_LEAD_INSTRUCTION_VERSION].includes(state.config.leadInstructionVersion ?? "")) return event;
  const call = state.providerCalls.find(call => call.id === event.providerCallId);
  if (!call || call.seriesId !== event.seriesId || call.callStage !== event.stage
    || (call.roundId === "series-complete" ? event.roundId !== undefined : call.roundId !== event.roundId)
    || event.recipientIds.length !== 1 || event.recipientIds[0] !== call.participantId) return event;
  const participant = state.config.participants.find(p => p.id === call.participantId);
  const round = state.rounds.find(r => r.assignment.roundId === call.roundId);
  const content = Array.isArray(call.requestMessages) ? call.requestMessages.find(m => m?.role === "user")?.content : undefined;
  if (!participant || typeof participant.displayName !== "string" || !participant.displayName || typeof content !== "string") return event;
  const language = state.config.language, pl = language === "pl";
  const scope = { language, seriesId: call.seriesId, roundId: call.roundId, participantId: participant.id, name: participant.displayName };
  let instruction: string | undefined;
  const exact = (packet: packets.TelepathicProviderPacket) => {
    if (packet.messages[0]?.content === content) instruction = packet.display?.instruction;
  };
  const tail = (prefix: string, fragment: string) => {
    if (content.startsWith(prefix) && content.endsWith(`. ${fragment}`)) instruction = fragment;
  };
  try {
  switch (call.callStage) {
    case "sender_target":
      if (round) exact(packets.buildSenderTargetPacket({ ...scope, roundNumber: round.assignment.roundNumber,
        topicLabel: state.config.topic.replaceAll("_", " "), geographyLabel: pl ? round.assignment.targetGeography?.labelPl : round.assignment.targetGeography?.labelEn }));
      break;
    case "sender_transmission_confirmation": exact(packets.buildSenderTransmissionConfirmationPacket(scope)); break;
    case "receiver_first":
      if (round) exact(packets.buildReceiverFirstPacket({ ...scope, roundNumber: round.assignment.roundNumber,
        topicLabel: state.config.topic.replaceAll("_", " "), discloseTopic: state.config.discloseTopicToReceivers }));
      break;
    case "receiver_second": {
      const fragment = buildReceiverSecondLookPrompt(language, { name: participant.displayName });
      if (content.startsWith("OWN_FIRST_BLIND_RECORD:\n") && content.endsWith(`\n\n${fragment}`)) instruction = fragment;
      break;
    }
    case "receiver_reveal":
      tail(pl ? `Dziękuję za udział, ${participant.displayName}. Część blind została zakończona i zapieczętowana. Teraz ujawniamy cel: `
        : `Thank you for taking part, ${participant.displayName}. The blind phase is finished and sealed. The target is now revealed: `, receiverRevealInstruction(language));
      if (!instruction) tail(pl ? "Twoja odpowiedź blind nie została zapisana po dwóch próbach. Cel został ujawniony: "
        : "Your blind response was not saved after two attempts. The target has been revealed: ", missingRevealInstruction(language));
      break;
    case "sender_reveal":
      tail(pl ? `Dziękuję, ${participant.displayName}. Cel, który przygotowałeś(-aś), został ujawniony wszystkim odbiorcom: `
        : `Thank you, ${participant.displayName}. The target you prepared has now been revealed to all receivers: `, senderRevealInstruction(language)); break;
    case "sharing_consent":
      exact(packets.buildSharingConsentPacket({ ...scope, participantNames: state.config.participants.filter(p => p.id !== participant.id).map(p => p.displayName) })); break;
    case "shared_answers_comment":
      tail(pl ? `Dziękuję, ${participant.displayName}. Oto dostępne odpowiedzi innych uczestników tej rundy, z nazwami i etapami: `
        : `Thank you, ${participant.displayName}. Here are the available answers from others in this round, labeled by participant and stage: `, sharedAnswersInstruction(language)); break;
    case "series_reflection":
      tail(pl ? `Dziękuję, ${participant.displayName}. Wszystkie rundy serii zostały zakończone.`
        : `Thank you, ${participant.displayName}. All rounds in this series are complete.`, seriesReflectionInstruction(language)); break;
    default:
      if (/^lead_guidance:cycle:[123]$/.test(call.callStage)) {
        const cycle = Number(call.callStage.at(-1)) as 1|2|3;
        if (state.config.leadInstructionVersion === LEAD_INSTRUCTION_VERSION) {
          const command = individualLeadCommand(language);
          if (content.startsWith(`${command}\n${leadDecisionContract(cycle, LEAD_INSTRUCTION_VERSION)}\nEXAMPLE: `) && content.includes("\nCURRENT_ROUND_DATA:\n")) instruction = command;
          break;
        }
        const command = pl ? "Zdecyduj o następnym cyklu. Możesz zakończyć teraz. Zwróć wyłącznie JSON." : "Decide the next guidance cycle. You may finish now. Return only JSON.";
        if (content.startsWith(`${command}\nCONTRACT: {"cycle":${cycle},"finishRound":boolean,"finishParticipantIds":string[],"broadcast":{"recipientIds":string[],"instruction":string},"individual":[{"participantId":string,"instruction":string}]}\nCURRENT_ROUND_DATA:\n`)) instruction = command;
      } else if (/^receiver_guidance:cycle:[123]:recipient:/.test(call.callStage)) {
        const command = pl ? "Odpowiedz tylko nowymi percepcjami. Nie odgaduj celu." : "Respond with only new perceptions. Do not guess the target.";
        if (content.startsWith(`${command}\nOWN_BLIND_DATA: `) && content.includes("\nLEAD_INSTRUCTION: ")) instruction = command;
      }
  }
  } catch { return event; } // Partial legacy metadata is unavailable, never guessed.
  return instruction === undefined ? event : { ...event, display: { version: 1, instruction } };
}

export function readableTelepathicText(event: TelepathicTranscriptEvent, pl: boolean): string {
  if (event.kind !== "materials") return event.text;
  return event.display?.version === 1 && typeof event.display.instruction === "string" ? event.display.instruction
    : pl ? "Czytelna instrukcja nie jest dostępna w tym zapisie. Pełne materiały zachowano w dowodach wywołania."
      : "A readable instruction is unavailable in this record. Full materials remain in the call evidence.";
}

export function uniqueTelepathicEvents(events: TelepathicTranscriptEvent[]): TelepathicTranscriptEvent[] {
  return [...new Map(events.map(event => [`${event.seriesId}\0${event.id}`, event])).values()].sort((a, b) => a.sequence - b.sequence);
}

export function telepathicMessageTitle(event: TelepathicTranscriptEvent, participants: Array<{id:string;displayName:string}>, leadId: string, pl: boolean): string {
  const name = participants.find(p => p.id === event.authorId)?.displayName ?? event.authorId;
  if (event.kind === "notice" && event.stage.startsWith("lead_guidance:cycle:") && (event.decisionRejectionReason || event.text.startsWith("[REJECTED DECISION"))) return `${pl ? "Odrzucona decyzja" : "Rejected decision"} — ${name}`;
  if (event.authorId === "controller") return pl ? "Kontroler programu" : "Program controller";
  if (event.stage === "series_reflection") return `${pl ? "Refleksja końcowa" : "Final reflection"} — ${name}`;
  if ((event.kind === "reflection" || event.stage === "reflection")) return `${pl ? "Refleksja po Revealu" : "Post-Reveal reflection"} — ${name}`;
  if (event.kind === "instruction") return `${event.authorId === leadId ? (pl ? "Prowadzący" : "Lead") : (pl ? "Instrukcja" : "Instruction")} — ${name}`;
  return `${pl ? "Odpowiedź" : "Response"} — ${event.authorId === leadId ? `${pl ? "Prowadzący" : "Lead"} — ` : ""}${name}`;
}
