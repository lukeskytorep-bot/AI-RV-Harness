import { writeExportPackage } from "../exports/native";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "../targets/types";
import { localizedTargetTitle } from "../targets/localization";
import { TRAINING_CATEGORY_LABELS, type TrainingCategory } from "../targets/bundled";
import type { InterfaceLanguage } from "../types";
import type { TrainingRunRecord } from "./types";
import { postRevealTranscriptMarkdown } from "../sessions/postRevealTranscript";

export async function exportTrainingRun(
  repository: AppRepository,
  run: TrainingRunRecord,
  targets: TargetRecord[],
  language: InterfaceLanguage,
  baseDirectory?: string,
  recordInDatabase = true,
): Promise<string> {
  const sessions = await repository.listRvSessions(run.workspaceId);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const files: Array<{ relativePath: string; content: string }> = [];
  const artifactCopies: Array<{ sourcePath: string; relativePath: string }> = [];
  const rows: string[] = [];
  const resultRows: Array<{
    position: number;
    block: number;
    sessionCode: string;
    targetId: string;
    title: string;
    category?: TrainingCategory;
    scores: Array<{ judgeIndex: number; modelRoute: string; total: number }>;
  }> = [];

  for (let index = 0; index < run.sessionIds.length; index += 1) {
    const sessionId = run.sessionIds[index];
    const targetId = run.completedTargetIds[index];
    const session = sessionById.get(sessionId);
    const target = targetById.get(targetId);
    if (!session || !target) continue;
    const folder = `${String(index + 1).padStart(3, "0")}_${safeName(session.sessionCode)}`;
    const [reveal, scores] = await Promise.all([
      repository.getReveal(session.id),
      repository.listJudgeScores(session.id),
    ]);
    const category = target.sourceMetadata.category as TrainingCategory | undefined;
    const title = localizedTargetTitle(target, language);
    const revealText = reveal?.text?.trim() || (language === "pl" ? "Reveal zawiera wyłącznie załączone pliki." : "The Reveal contains attached files only.");
    const judgeMarkdown = scores.length
      ? scores.map((score) => `### Judge ${score.judgeIndex} — ${score.total}/10\n\n${score.narrative.conciseRationale}\n\n- ${language === "pl" ? "Najmocniejsze trafienia" : "Strongest matches"}: ${score.narrative.strongestMatches.join("; ") || "—"}\n- ${language === "pl" ? "Główne chybienia" : "Major misses"}: ${score.narrative.majorMissesContradictions.join("; ") || "—"}`).join("\n\n")
      : language === "pl" ? "W tej sesji nie użyto AI Judge'a." : "No AI Judge was used for this session.";
    const revealFiles = (reveal?.artifactManifest ?? []).map((artifact, artifactIndex) => {
      const relativePath = `reveal_files/${String(artifactIndex + 1).padStart(2, "0")}_${safeName(artifact.originalFileName)}`;
      artifactCopies.push({ sourcePath: artifact.path, relativePath: `sessions/${folder}/${relativePath}` });
      return artifact.mimeType.startsWith("image/")
        ? `![${artifact.originalFileName}](${relativePath})\n\n- ${artifact.mimeType} · SHA-256: ${artifact.sha256}`
        : `- [${artifact.originalFileName}](${relativePath}) · ${artifact.mimeType} · SHA-256: ${artifact.sha256} · ${artifactIndex + 1}`;
    }).join("\n\n");
    files.push({
      relativePath: `sessions/${folder}/complete_session.md`,
      content: `# ${session.sessionCode} — ${title}\n\n## ${language === "pl" ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}\n\n${session.preRevealTranscript.trim()}\n\n## Target Reveal\n\n${revealText}\n\n### ${language === "pl" ? "Pliki Revealu" : "Reveal files"}\n\n${revealFiles || "—"}\n\n## ${language === "pl" ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}\n\n${postRevealTranscriptMarkdown(session.postRevealTranscript, language) || "—"}\n\n## AI Judge\n\n${judgeMarkdown}\n`,
    });
    resultRows.push({
      position: index + 1,
      block: run.mode === "full" ? Math.floor(index / 7) + 1 : 1,
      sessionCode: session.sessionCode,
      targetId,
      title,
      ...(category ? { category } : {}),
      scores: scores.map((score) => ({ judgeIndex: score.judgeIndex, modelRoute: score.modelRoute, total: score.total })),
    });
    rows.push(`| ${index + 1} | ${session.sessionCode} | ${category ? TRAINING_CATEGORY_LABELS[category][language] : "—"} | ${title} | ${scores.length ? (scores.reduce((sum, score) => sum + score.total, 0) / scores.length).toFixed(2) : "—"} |`);
  }

  const judgeResults = run.judgeModelRoutes.map((modelRoute, judgeIndex) => {
    const oneBasedJudgeIndex = judgeIndex + 1;
    const totals = resultRows.flatMap((item) => item.scores.filter((score) => score.judgeIndex === oneBasedJudgeIndex || score.modelRoute === modelRoute).map((score) => score.total));
    return { judgeIndex: oneBasedJudgeIndex, modelRoute, sessions: totals.length, meanScore: mean(totals) };
  });
  const judgeSummary = judgeResults.length
    ? judgeResults.map((judge) => `- Judge ${judge.judgeIndex}: ${judge.modelRoute} · ${judge.sessions} ${language === "pl" ? "sesji" : "sessions"} · ${language === "pl" ? "średnia" : "mean"} ${judge.meanScore ?? "—"}`).join("\n")
    : (language === "pl" ? "- W tym treningu nie użyto AI Judge'a." : "- No AI Judge was used in this training run.");
  const summary = `# ${run.name}\n\n- ${language === "pl" ? "Numer treningu" : "Training run"}: ${run.runNumber}\n- ${language === "pl" ? "Stan" : "Status"}: ${run.status}\n- ${language === "pl" ? "Tryb" : "Mode"}: ${run.mode}\n- RV Lite: ${run.protocolVariant}\n- ${language === "pl" ? "Zakończono" : "Completed"}: ${run.completedTargetIds.length}/${run.targetIds.length}\n- ${language === "pl" ? "Utworzono" : "Created"}: ${run.createdAt}\n- ${language === "pl" ? "Łączna średnia AI Judge" : "Overall AI Judge mean"}: ${mean(resultRows.flatMap((item) => item.scores.map((score) => score.total))) ?? "—"}\n\n## AI Judge\n\n${judgeSummary}\n\n## ${language === "pl" ? "Sesje" : "Sessions"}\n\n| # | Session | Category | Target | Mean Judge score |\n|---:|---|---|---|---:|\n${rows.join("\n")}\n\n${language === "pl" ? "Każda sesja znajduje się w katalogu `sessions` jako jeden czytelny plik `complete_session.md`. Jeśli Reveal zawierał obraz, rzeczywisty plik obrazu znajduje się w podfolderze `reveal_files` danej sesji." : "Every session is stored under `sessions` as one readable `complete_session.md`. If the Reveal contained an image, the real image file is stored in that session's `reveal_files` folder."}\n`;
  files.unshift({ relativePath: "summary.md", content: summary });
  const exportId = `Training_${String(run.runNumber).padStart(3, "0")}_${run.createdAt.slice(0, 10)}`;
  const directory = await writeExportPackage({ exportId, files, artifactCopies, destination: "training", overwriteExisting: true, ...(baseDirectory?.trim() ? { baseDirectory: baseDirectory.trim() } : {}) });
  if (recordInDatabase) await repository.recordExport(run.workspaceId, undefined, "training_run", directory, await sha256Text(summary));
  return directory;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80) || "session";
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
