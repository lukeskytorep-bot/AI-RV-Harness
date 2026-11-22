import type { ProviderMessage } from "../providers/types";
import type { ResearchFrozenContextComposition } from "./types";

export interface ResearchContextSessionEvidence {
  version: 1;
  compositionSha256: string;
  applicationMessages: Array<{ role: "system"; origin: string; content: string; sha256: string }>;
}

export function researchContextProviderMessages(composition: ResearchFrozenContextComposition): ProviderMessage[] {
  if (composition.version !== 1 || !composition.compositionSha256 || !Array.isArray(composition.applicationMessages)) {
    throw new Error("Invalid frozen Research context composition.");
  }
  return composition.applicationMessages.map((message) => ({ role: "system", content: message.content }));
}

export function researchContextSessionEvidence(composition: ResearchFrozenContextComposition): ResearchContextSessionEvidence {
  researchContextProviderMessages(composition);
  return {
    version: 1,
    compositionSha256: composition.compositionSha256,
    applicationMessages: composition.applicationMessages.map((message) => ({ ...message })),
  };
}

export function assertResearchContextSessionEvidence(
  composition: ResearchFrozenContextComposition,
  evidence: ResearchContextSessionEvidence | undefined,
): void {
  if (!evidence || evidence.version !== 1 || evidence.compositionSha256 !== composition.compositionSha256) {
    throw new Error("Research Resume refused context-composition drift from Experiment Lock.");
  }
  if (evidence.applicationMessages.length !== composition.applicationMessages.length) {
    throw new Error("Research Resume refused context-message count drift from Experiment Lock.");
  }
  for (let index = 0; index < composition.applicationMessages.length; index += 1) {
    const expected = composition.applicationMessages[index];
    const actual = evidence.applicationMessages[index];
    if (actual.role !== expected.role || actual.origin !== expected.origin || actual.sha256 !== expected.sha256 || actual.content !== expected.content) {
      throw new Error(`Research Resume refused context-message drift at position ${index + 1}.`);
    }
  }
}
