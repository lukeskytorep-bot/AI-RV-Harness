import type {
  TelepathicParticipant,
  TelepathicRoundAssignment,
  TelepathicSeriesConfig,
  TelepathicSeriesPlan,
} from "./types";

function assertUniqueParticipants(participants: TelepathicParticipant[]): void {
  const ids = participants.map((participant) => participant.id);
  if (new Set(ids).size !== ids.length) throw new Error("Telepathic participants must have unique IDs.");
}

function validateConfig(config: TelepathicSeriesConfig): void {
  assertUniqueParticipants(config.participants);
  if (!Number.isInteger(config.roundCount) || config.roundCount < 1) {
    throw new Error("Telepathic round count must be a positive integer.");
  }
  const aiParticipants = config.participants.filter((participant) => participant.kind === "ai");
  if (config.mode === "ai_ai_training") {
    if (aiParticipants.length !== config.participants.length) {
      throw new Error("AI-AI telepathic training cannot include a human participant.");
    }
    if (aiParticipants.length < 2 || aiParticipants.length > 6) {
      throw new Error("AI-AI telepathic training requires 2 to 6 AI Profiles.");
    }
    if (config.senderPolicy.kind === "human_only") {
      throw new Error("AI-AI telepathic training cannot use a human-only sender policy.");
    }
  } else if (config.participants.length < 2) {
    throw new Error("Telepathic exchange requires at least two participants.");
  }

  if (config.senderPolicy.kind === "human_only") {
    const { humanParticipantId } = config.senderPolicy;
    const participant = config.participants.find((item) => item.id === humanParticipantId);
    if (!participant || participant.kind !== "human") {
      throw new Error("Human-only sender policy must reference a human participant in the series.");
    }
  }
  if (config.senderPolicy.kind === "fixed_ai") {
    const { participantId } = config.senderPolicy;
    const participant = config.participants.find((item) => item.id === participantId);
    if (!participant || participant.kind !== "ai") {
      throw new Error("Fixed AI sender policy must reference an AI participant in the series.");
    }
  }
}

function senderForRound(config: TelepathicSeriesConfig, zeroBasedRound: number): TelepathicParticipant {
  if (config.senderPolicy.kind === "human_only") {
    const { humanParticipantId } = config.senderPolicy;
    return config.participants.find((participant) => participant.id === humanParticipantId)!;
  }
  if (config.senderPolicy.kind === "fixed_ai") {
    const { participantId } = config.senderPolicy;
    return config.participants.find((participant) => participant.id === participantId)!;
  }
  return config.participants[zeroBasedRound % config.participants.length];
}

export function planTelepathicSeries(config: TelepathicSeriesConfig): TelepathicSeriesPlan {
  validateConfig(config);
  const rounds: TelepathicRoundAssignment[] = Array.from({ length: config.roundCount }, (_, index) => {
    const sender = senderForRound(config, index);
    return {
      roundId: `${config.seriesId}:round:${index + 1}`,
      roundNumber: index + 1,
      senderParticipantId: sender.id,
      receiverParticipantIds: config.participants.filter((participant) => participant.id !== sender.id).map((participant) => participant.id),
    };
  });
  return { schemaVersion: 1, seriesId: config.seriesId, mode: config.mode, rounds };
}
