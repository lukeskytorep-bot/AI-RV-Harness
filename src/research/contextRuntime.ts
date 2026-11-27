import type { ProviderMessage } from "../providers/types";
import type { ResearchConfig, ResearchContextBlockKey, ResearchContextConditionDesign, ResearchFrozenContextComposition, ResearchResults } from "./types";

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

// Validate results against Experiment Lock without rewriting stored results.
export function withResearchSelectedBlocks(results: ResearchResults, config: ResearchConfig): ResearchResults {
  if (results.templateType !== "context_instructions") return results;
  const compositions = new Map(config.conditions.map(({ key, contextComposition }) => [key, contextComposition]));
  const validateSelection = (key: string, mode: ResearchContextConditionDesign["mode"] | undefined,
    hash: string | undefined, saved: ResearchContextBlockKey[] | undefined) => {
    const composition = compositions.get(key);
    const design = composition?.design;
    if (mode !== "selected_only" && design?.mode !== "selected_only" && saved === undefined) return undefined;
    if (mode === "selected_only" && design?.mode === "selected_only" && hash && composition?.compositionSha256 === hash) {
      const expected = design.blocks;
      if (saved === undefined || (Array.isArray(saved) && saved.length === expected.length && expected.every((block) => saved.includes(block)))) {
        return { blocks: [...expected] };
      }
    }
    return { mismatch: true as const };
  };
  return {
    ...results,
    conditions: results.conditions.map((condition) => {
      const selection = validateSelection(condition.conditionKey, condition.contextMode, condition.compositionSha256, condition.contextSelectedBlocks);
      return selection ? { ...condition, contextSelectedBlocks: selection.blocks, contextSelectedBlocksMismatch: selection.mismatch } : condition;
    }),
    sessions: results.sessions.map((session) => {
      const audit = session.contextAudit;
      if (!audit) return session;
      const selection = validateSelection(session.conditionKey, audit.mode, audit.compositionSha256, audit.selectedBlocks);
      return selection ? { ...session, contextAudit: { ...audit, selectedBlocks: selection.blocks, selectedBlocksMismatch: selection.mismatch } } : session;
    }),
  };
}
