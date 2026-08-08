export interface RevealEvidence {
  text?: string;
  imageRefs?: string[];
}

export interface JudgePacket {
  anonymousSessionId: string;
  preRevealEvidence: string;
  reveal: RevealEvidence;
  rubricVersion: string;
}

export interface JudgePacketInput extends JudgePacket {
  [extraField: string]: unknown;
}

/**
 * Research invariant: construct Judge payloads from an allowlist.
 * Never sanitize a Master Record by deleting a blacklist of known fields.
 */
export function buildJudgePacket(input: JudgePacketInput): JudgePacket {
  return {
    anonymousSessionId: input.anonymousSessionId,
    preRevealEvidence: input.preRevealEvidence,
    reveal: {
      ...(input.reveal.text !== undefined ? { text: input.reveal.text } : {}),
      ...(input.reveal.imageRefs !== undefined ? { imageRefs: [...input.reveal.imageRefs] } : {}),
    },
    rubricVersion: input.rubricVersion,
  };
}
