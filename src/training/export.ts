import { writeExportPackage } from "../exports/native";
import type { AppRepository } from "../storage/repository";
import type { TargetRecord } from "../targets/types";
import { localizedTargetTitle } from "../targets/localization";
import { TRAINING_CATEGORY_LABELS, type TrainingCategory } from "../targets/bundled";
import type { InterfaceLanguage } from "../types";
import type { TrainingRunRecord } from "./types";

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
    files.push(
      { relativePath: `sessions/${folder}/viewer_transcript.md`, content: `${session.preRevealTranscript.trim()}\n` },
      { relativePath: `sessions/${folder}/target_reveal.json`, content: `${JSON.stringify({ targetId, title, category, reveal }, null, 2)}\n` },
      { relativePath: `sessions/${folder}/judge_scores.json`, content: `${JSON.stringify(scores, null, 2)}\n` },
      { relativePath: `reveals/${folder}.json`, content: `${JSON.stringify({ targetId, title, category, reveal }, null, 2)}\n` },
      { relativePath: `judges/${folder}.json`, content: `${JSON.stringify(scores, null, 2)}\n` },
    );
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

  for (const category of run.categories) {
    const categoryRows = resultRows.filter((item) => item.category === category);
    const totals = categoryRows.flatMap((item) => item.scores.map((score) => score.total));
    files.push({
      relativePath: `category_results/${category}.json`,
      content: `${JSON.stringify({
        category,
        label: TRAINING_CATEGORY_LABELS[category][language],
        sessions: categoryRows.length,
        meanJudgeScore: mean(totals),
        results: categoryRows,
      }, null, 2)}\n`,
    });
  }

  const blockResults = [...new Set(resultRows.map((item) => item.block))].map((block) => {
    const items = resultRows.filter((item) => item.block === block);
    return { block, sessions: items.length, meanJudgeScore: mean(items.flatMap((item) => item.scores.map((score) => score.total))), results: items };
  });
  const judgeResults = run.judgeModelRoutes.map((modelRoute, judgeIndex) => {
    const totals = resultRows.flatMap((item) => item.scores.filter((score) => score.judgeIndex === judgeIndex || score.modelRoute === modelRoute).map((score) => score.total));
    return { judgeIndex, modelRoute, sessions: totals.length, meanScore: mean(totals) };
  });

  const manifest = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    application: "AI RV Harness",
    run,
    contentLicense: "CC BY 4.0",
    codeLicense: "MIT",
    apiKeysIncluded: false,
    results: {
      meanJudgeScore: mean(resultRows.flatMap((item) => item.scores.map((score) => score.total))),
      blocks: blockResults.map(({ results: _results, ...summary }) => summary),
      judges: judgeResults,
    },
  };
  files.unshift(
    { relativePath: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { relativePath: "checkpoint/state.json", content: `${JSON.stringify(run, null, 2)}\n` },
    { relativePath: "category_results/blocks.json", content: `${JSON.stringify(blockResults, null, 2)}\n` },
    { relativePath: "category_results/judges.json", content: `${JSON.stringify(judgeResults, null, 2)}\n` },
    {
      relativePath: "summary.md",
      content: `# ${run.name}\n\n- Run: ${run.runNumber}\n- Status: ${run.status}\n- Mode: ${run.mode}\n- RV Lite: ${run.protocolVariant}\n- Completed: ${run.completedTargetIds.length}/${run.targetIds.length}\n- Judges: ${run.judgeModelRoutes.length}\n- Created: ${run.createdAt}\n\n| # | Session | Category | Target | Mean Judge score |\n|---:|---|---|---|---:|\n${rows.join("\n")}\n`,
    },
  );
  const exportId = `Training_${String(run.runNumber).padStart(3, "0")}_${run.createdAt.slice(0, 10)}`;
  const directory = await writeExportPackage({ exportId, files, destination: "training", overwriteExisting: true, ...(baseDirectory?.trim() ? { baseDirectory: baseDirectory.trim() } : {}) });
  if (recordInDatabase) await repository.recordExport(run.workspaceId, undefined, "training_run", directory, await sha256Text(JSON.stringify(manifest)));
  return directory;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "session";
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
