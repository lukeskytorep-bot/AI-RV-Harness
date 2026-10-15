import { parseLeadDecisionResponse } from "./leadDecisionResponse";
import { sealBlindSubmission } from "./blind";
import { buildLeadDecisionPacket, guidanceInstructions, guidancePacket, validateLeadDecision } from "./leadGuidance";
import { recordTranscript } from "./transcript";
import type { TelepathicSeriesState, TelepathicRoundState, TelepathicParticipant, LeadGuidanceDecision } from "./types";
import type { TelepathicProviderPacket } from "./packets";

type Runtime = {
  invoke(participant: TelepathicParticipant, packet: TelepathicProviderPacket): Promise<string | null>;
  save(): Promise<void>;
  now(): string;
  checkStop(): void;
};
export function activeGuidanceIds(round: TelepathicRoundState): string[] {
  return round.assignment.receiverParticipantIds.filter(id => !round.guidance?.finishedParticipantIds.includes(id));
}
export function validateRoundLeadDecision(round: TelepathicRoundState, raw: unknown, cycle: 1 | 2 | 3): LeadGuidanceDecision {
  return validateLeadDecision(raw,cycle,activeGuidanceIds(round), [round.target?.content ?? "", round.assignment.targetGeography?.labelPl ?? "", round.assignment.targetGeography?.labelEn ?? ""]);
}
export async function ensureFixedLeadGuidance(state: TelepathicSeriesState, round: TelepathicRoundState, runtime: Runtime): Promise<boolean> {
  round.guidance ??= { decisions: [], finishedParticipantIds: [], closed: false };
  const lead = state.config.participants.find(p => p.id === round.assignment.senderParticipantId)!;
  if (round.assignment.receiverParticipantIds.some(id => !round.blindByParticipant[id]?.first)) return false;
  for (let cycle = 1; cycle <= 3 && !round.guidance.closed; cycle++) {
    runtime.checkStop();
    let decision = round.guidance.decisions.find(d => d.cycle === cycle);
    if (!decision) {
      if (lead.kind === "human") return false;
      const raw = await runtime.invoke(lead, buildLeadDecisionPacket(state, round, cycle as 1 | 2 | 3));
      if (!raw) throw new Error("Lead decision attempts exhausted.");
      decision = parseLeadDecisionResponse(raw, round, cycle as 1 | 2 | 3);
      round.guidance.decisions.push(decision);
      await runtime.save();
    }
    for (const id of decision.finishParticipantIds) if (!round.guidance.finishedParticipantIds.includes(id)) round.guidance.finishedParticipantIds.push(id);
    if (decision.broadcast) recordTranscript(state,{id:`${round.assignment.roundId}:guidance:${cycle}:broadcast`,roundId:round.assignment.roundId,stage:"receiver_guidance",kind:"instruction",authorId:lead.id,recipientIds:decision.broadcast.recipientIds,text:decision.broadcast.instruction,cycle:cycle as 1|2|3},runtime.now());
    const instructions = guidanceInstructions(decision);
    for (const { participantId, instruction } of instructions) {
      runtime.checkStop();
      const receiver = state.config.participants.find(p => p.id === participantId)!;
      const blind = round.blindByParticipant[participantId];
      if (blind.guidanceResponses?.some(r => r.cycle === cycle)) continue;
      if (!decision.broadcast?.recipientIds.includes(participantId)) recordTranscript(state, { id: `${round.assignment.roundId}:guidance:${cycle}:${participantId}`, roundId: round.assignment.roundId,
        stage: "receiver_guidance", kind: "instruction", authorId: lead.id, recipientIds: [participantId], text: instruction, cycle: cycle as 1 | 2 | 3 },runtime.now());
      await runtime.save();
      if (receiver.kind === "human") return false;
      const receiverInstruction = state.config.language === "pl" ? "Odpowiedz tylko nowymi percepcjami. Nie odgaduj celu." : "Respond with only new perceptions. Do not guess the target.";
      const text = await runtime.invoke(receiver, guidancePacket(state,round,participantId,`receiver_guidance:cycle:${cycle}:recipient:${participantId}`,
        `${receiverInstruction}\nOWN_BLIND_DATA: ${JSON.stringify({first:blind.first,responses:blind.guidanceResponses})}\nLEAD_INSTRUCTION: ${instruction}`, receiverInstruction));
      if (!text) throw new Error("Receiver guidance attempts exhausted; blind remains open.");
      blind.guidanceResponses ??= [];
      blind.guidanceResponses.push({ cycle: cycle as 1 | 2 | 3, instruction, response: text });
      await runtime.save();
    }
    if (decision.finishRound || cycle === 3 || !activeGuidanceIds(round).length) round.guidance.closed = true;
    await runtime.save();
  }
  if (!round.guidance.closed) return false;
  for (const id of round.assignment.receiverParticipantIds) {
    const blind = round.blindByParticipant[id];
    if (blind.status !== "sealed") round.blindByParticipant[id] = await sealBlindSubmission(blind,runtime.now());
  }
  await runtime.save();
  return true;
}
