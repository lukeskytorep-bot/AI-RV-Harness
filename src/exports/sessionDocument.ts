import { aggregateJudgeScores } from "../domain/scoring";
import type { JudgeScoreRecord } from "../judge/types";
import { postRevealTranscriptMarkdown } from "../sessions/postRevealTranscript";
import type { RvSession, TargetClarificationRecord } from "../sessions/types";
import type { InterfaceLanguage } from "../types";
import { renderMarkdownExportDocument } from "./document";
import type { StandardExportMetadata } from "./document/types";

export interface CompleteSessionMarkdownInput {
  title: string;
  language: InterfaceLanguage;
  session: RvSession;
  revealText: string;
  revealFilesMarkdown: string;
  scores: JudgeScoreRecord[];
  clarifications: TargetClarificationRecord[];
  metadata?: StandardExportMetadata;
}

export function renderCompleteSessionMarkdown(input: CompleteSessionMarkdownInput): string {
  const pl = input.language === "pl";
  const clarificationText = input.clarifications.length
    ? input.clarifications.map((item) => `### ${item.createdAt}\n\n${item.content}`).join("\n\n")
    : "—";
  const body = `## ${pl ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}

${input.session.preRevealTranscript.trim() || "—"}

## Target Reveal

${input.revealText.trim() || "—"}

### ${pl ? "Pliki Revealu" : "Reveal files"}

${input.revealFilesMarkdown.trim() || "—"}

## ${pl ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}

${postRevealTranscriptMarkdown(input.session.postRevealTranscript, input.language) || "—"}

## ${pl ? "Ocena AI Judge" : "AI Judge evaluation"}

${renderJudgeEvaluationMarkdown(input.scores, input.language)}

## ${pl ? "Późniejsze doprecyzowania celu" : "Later target clarifications"}

${clarificationText}`;

  if (input.metadata) {
    return renderMarkdownExportDocument({ language: input.language, title: input.title, metadata: input.metadata, body });
  }
  return `# ${input.title.trim()}\n\n${body.trim()}\n`;
}

export function renderJudgeEvaluationMarkdown(scores: JudgeScoreRecord[], language: InterfaceLanguage): string {
  const pl = language === "pl";
  if (!scores.length) return pl ? "W tej sesji nie użyto AI Judge'a." : "No AI Judge was used for this session.";
  const sections: string[] = [];

  if (scores.length > 1) {
    const aggregate = aggregateJudgeScores(scores);
    sections.push([
      `### ${pl ? "Podsumowanie wielu Judge’ów" : "Multiple-Judge summary"}`,
      `- ${pl ? "Średnia suma" : "Mean total"}: ${aggregate.mean.total.toFixed(2)} / 10`,
      `- ${pl ? "Mediana sumy" : "Median total"}: ${aggregate.medianTotal.toFixed(2)} / 10`,
      `- ${pl ? "Rozrzut sum" : "Total spread"}: ${aggregate.totalRange.toFixed(2)} · σ ${aggregate.totalStdDev.toFixed(2)}`,
    ].join("\n"));
  }

  sections.push(...scores.map((score) => [
    `### Judge ${score.judgeIndex} — ${score.total.toFixed(1)}/10`,
    `- ${pl ? "Model" : "Model"}: ${score.modelRoute}`,
    `- ${pl ? "Gestalt" : "Gestalt"}: ${score.gestalt.toFixed(1)}/3`,
    `- ${pl ? "Sprawdzalne cechy" : "Verifiable features"}: ${score.verifiableFeatures.toFixed(1)}/3`,
    `- ${pl ? "Aktywność / funkcja / zdarzenie" : "Activity / function / event"}: ${score.activityFunctionEvent.toFixed(1)}/2`,
    `- ${pl ? "Kontrola konfabulacji" : "Confabulation control"}: ${score.confabulationControl.toFixed(1)}/2`,
    "",
    `#### ${pl ? "Najmocniejsze trafienia" : "Strongest matches"}`,
    renderNarrativeList(score.narrative.strongestMatches),
    "",
    `#### ${pl ? "Główne chybienia lub sprzeczności" : "Major misses or contradictions"}`,
    renderNarrativeList(score.narrative.majorMissesContradictions),
    "",
    `#### ${pl ? "Obserwacje konfabulacji / AOL" : "Confabulation / AOL observations"}`,
    renderNarrativeList(score.narrative.confabulationObservations),
    "",
    `#### ${pl ? "Uzasadnienie" : "Rationale"}`,
    score.narrative.conciseRationale,
  ].join("\n")));

  return sections.join("\n\n");
}

function renderNarrativeList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "—";
}
