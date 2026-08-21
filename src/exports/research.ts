import { buildJudgePacket } from "../domain/judgePacket";
import { JUDGE_RUBRIC_VERSION, type JudgeScoreRecord } from "../judge/types";
import { getJudgePrompt } from "../judge/prompt";
import type { AppRepository } from "../storage/repository";
import type { RevealArtifactRecord, RvSession, TargetClarificationRecord } from "../sessions/types";
import { stableStringify } from "../research/planner";
import type { ResearchResults } from "../research/types";
import { postRevealTranscriptMarkdown } from "../sessions/postRevealTranscript";
import { writeExportPackage, type ExportArtifactCopy, type ExportTextFile } from "./native";

export async function exportResearchPackage(repository: AppRepository, projectId: string, baseDirectory?: string): Promise<{ directory: string; manifestHash: string }> {
  const project = await repository.getResearchProject(projectId);
  const results = await repository.getResearchResults(projectId);
  if (!project) throw new Error("Research project not found.");
  const saveOnly = project.config.judges.length === 0 && project.state === "SessionsComplete";
  const completedWithScores = project.state === "Complete" && Boolean(results);
  if (!saveOnly && !completedWithScores) throw new Error("Research sessions must be complete before export.");
  const [assignments, mappings, conditions, sessions] = await Promise.all([
    repository.listResearchAssignments(projectId), repository.listBlindingMappings(projectId), repository.listResearchConditions(projectId), repository.listRvSessions(project.workspaceId),
  ]);
  const projectSessions = sessions.filter((session) => session.researchProjectId === projectId);
  const assignedSessionIds = new Set(assignments.map((assignment) => assignment.sessionId).filter((id): id is string => Boolean(id)));
  const recoverySessions = projectSessions.filter((session) => !assignedSessionIds.has(session.id));
  const sessionById = new Map(projectSessions.map((session) => [session.id, session]));
  const mappingByAnonymous = new Map(mappings.map((mapping) => [mapping.anonymousSessionId, mapping]));
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
  const files: ExportTextFile[] = [];
  const artifactCopies: ExportArtifactCopy[] = [];
  const snapshots: Record<string, unknown> = {};
  const blindingKey: Array<Record<string, unknown>> = [];
  const privatePrefix = saveOnly ? "private_master/" : "";

  if (saveOnly) {
    files.push({ relativePath: "external_evaluation/JUDGE_SYSTEM_PROMPT.txt", content: `${getJudgePrompt(project.config.sessionLanguage)}\n` });
    files.push({ relativePath: "external_evaluation/HOW_TO_EVALUATE.md", content: externalEvaluationInstructions(project.config.sessionLanguage) });
    files.push({ relativePath: "external_evaluation/SCORE_RESPONSE_EXAMPLE.json", content: pretty({ scores: { gestalt: 0, verifiableFeatures: 0, activityFunctionEvent: 0, confabulationControl: 0 }, strongestMatches: [], majorMissesContradictions: [], confabulationObservations: [], conciseRationale: "" }) });
  }

  if (results) {
    files.push({ relativePath: "results/results.json", content: pretty(results) });
    files.push({ relativePath: "results/results.csv", content: resultsCsv(results) });
    files.push({ relativePath: "results/session_results.csv", content: sessionResultsCsv(results) });
  }
  files.push({ relativePath: `${privatePrefix}configuration/research_config.json`, content: pretty({ projectId: project.id, name: project.name, templateType: project.templateType, configHash: project.configHash, lockedAt: project.lockedAt, scoresFrozenAt: project.scoresFrozenAt, unblindedAt: project.unblindedAt, config: project.config }) });
  if (recoverySessions.length) {
    files.push({ relativePath: `${privatePrefix}master/recovery_sessions.json`, content: pretty(recoverySessions) });
    for (const session of recoverySessions) files.push({ relativePath: `${privatePrefix}master/recovery_sessions/${session.id}/pre_reveal.md`, content: session.preRevealTranscript });
  }

  for (const assignment of assignments) {
    if (!assignment.sessionId) continue;
    const session = sessionById.get(assignment.sessionId);
    if (!session) continue;
    const [reveal, viewerEvidence, snapshot, judgeScores, clarifications] = await Promise.all([
      repository.getReveal(session.id), repository.getViewerEvidence(session.id), repository.getSessionSnapshot(session.id), repository.listJudgeScores(session.id), repository.listTargetClarifications(session.id),
    ]);
    const base = `sessions/${assignment.anonymousSessionId}`;
    if (!saveOnly) {
      files.push({ relativePath: `${base}/pre_reveal.md`, content: session.preRevealTranscript });
      files.push({ relativePath: `${base}/viewer_evidence.md`, content: viewerEvidence });
      if (session.postRevealTranscript) files.push({ relativePath: `${base}/post_reveal.md`, content: postRevealTranscriptMarkdown(session.postRevealTranscript, project.config.sessionLanguage) });
      if (clarifications.length) files.push({ relativePath: `${base}/target_clarifications.json`, content: pretty({ label: "Supplementary analysis — after target clarification", records: clarifications }) });
    }
    if (snapshot) {
      snapshots[assignment.anonymousSessionId] = snapshot;
      if (!saveOnly) files.push({ relativePath: `${base}/session_snapshot.json`, content: pretty(snapshot) });
    }
    let exportedArtifacts: Array<{ artifactId: string; mimeType: string; size: number; sha256: string; exportedPath: string }> = [];
    if (reveal) {
      exportedArtifacts = (reveal.artifactManifest ?? []).map((artifact, index) => {
        const relativePath = artifactExportPath(assignment.anonymousSessionId, index, artifact, saveOnly);
        artifactCopies.push({ sourcePath: artifact.path, relativePath });
        return { artifactId: artifact.artifactId, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.sha256, exportedPath: relativePath };
      });
      if (!saveOnly) files.push({ relativePath: `${base}/reveal.json`, content: pretty({ source: reveal.source, text: reveal.text, hash: reveal.hash, artifacts: exportedArtifacts }) });
      const packet = buildJudgePacket({ anonymousSessionId: assignment.anonymousSessionId, preRevealEvidence: viewerEvidence, reveal: { ...(reveal.text ? { text: reveal.text } : {}), ...(exportedArtifacts.some((artifact) => artifact.mimeType.startsWith("image/")) ? { imageRefs: exportedArtifacts.filter((artifact) => artifact.mimeType.startsWith("image/")).map((_, index) => `reveal_image_${index + 1}`) } : {}) }, rubricVersion: JUDGE_RUBRIC_VERSION });
      files.push({ relativePath: `${saveOnly ? "external_evaluation" : "judge_packets"}/${assignment.anonymousSessionId}.json`, content: pretty(saveOnly ? { ...packet, artifactFiles: exportedArtifacts } : packet) });
      if (saveOnly) files.push({
        relativePath: `external_evaluation/${assignment.anonymousSessionId}.md`,
        content: humanJudgePacketMarkdown(assignment.anonymousSessionId, viewerEvidence, reveal.text ?? "", exportedArtifacts, project.config.sessionLanguage),
      });
    }
    if (!saveOnly) files.push({ relativePath: `judges/${assignment.anonymousSessionId}.json`, content: pretty(judgeScores) });
    files.push({
      relativePath: saveOnly ? `private_master/sessions/${assignment.anonymousSessionId}/complete_session.md` : `${base}/complete_session.md`,
      content: completeResearchSessionMarkdown({ anonymousSessionId: assignment.anonymousSessionId, session, revealText: reveal?.text ?? "", artifacts: exportedArtifacts, judgeScores, clarifications, language: project.config.sessionLanguage, saveOnly }),
    });

    const mapping = mappingByAnonymous.get(assignment.anonymousSessionId);
    const condition = mapping ? conditionById.get(mapping.conditionId) : undefined;
    if (mapping && condition) blindingKey.push({ anonymousSessionId: assignment.anonymousSessionId, conditionKey: condition.conditionKey, conditionLabel: condition.config.label, pairKey: mapping.pairKey, pairOrder: mapping.pairOrder ?? null, targetId: assignment.targetId });
  }

  files.push({ relativePath: `${privatePrefix}blinding/blinding_key.json`, content: pretty(blindingKey) });
  files.push({ relativePath: `${privatePrefix}blinding/blinding_key.md`, content: blindingKeyMarkdown(project.name, blindingKey, project.config.sessionLanguage) });
  files.push({ relativePath: `${privatePrefix}master/master_record.json`, content: pretty({ project: { id: project.id, workspaceId: project.workspaceId, templateType: project.templateType, state: project.state, config: project.config, configHash: project.configHash }, conditions, assignments, mappings, sessionSnapshots: snapshots }) });
  files.push({ relativePath: "summary.md", content: results ? summaryMarkdown(project.name, results) : saveOnlySummaryMarkdown(project.name, assignments.length) });
  files.push({ relativePath: "summary.csv", content: results ? sessionResultsCsv(results) : saveOnlySessionsCsv(assignments) });
  files.push({ relativePath: "summary.html", content: summaryHtml(project.name, project.config.sessionLanguage, results, assignments.length, saveOnly) });
  files.push({ relativePath: "README.md", content: researchReadme(project.name, assignments.length, project.config.sessionLanguage, saveOnly, Boolean(results)) });

  const manifestEntries = await Promise.all(files.map(async (file) => ({ path: file.relativePath, kind: "text", sha256: await sha256Text(file.content) })));
  for (const assignment of assignments) {
    if (!assignment.sessionId) continue;
    const reveal = await repository.getReveal(assignment.sessionId);
    for (let index = 0; index < (reveal?.artifactManifest?.length ?? 0); index += 1) {
      const artifact = reveal!.artifactManifest![index];
      manifestEntries.push({ path: artifactExportPath(assignment.anonymousSessionId, index, artifact, saveOnly), kind: "artifact", sha256: artifact.sha256 });
    }
  }
  const manifest = { schemaVersion: 1, projectId, generatedAt: new Date().toISOString(), entries: manifestEntries };
  const manifestContent = pretty(manifest);
  const manifestHash = await sha256Text(manifestContent);
  files.push({ relativePath: "manifest.json", content: manifestContent });
  const exportId = `RV_Harness_Research_${project.id.replace(/[^A-Za-z0-9_-]/g, "_")}_${Date.now()}`;
  const directory = await writeExportPackage({ exportId, files, artifactCopies, ...(baseDirectory?.trim() ? { destination: "external" as const, baseDirectory: baseDirectory.trim() } : {}) });
  await repository.recordExport(project.workspaceId, project.id, saveOnly ? "research_save_only_package" : "research_package", directory, manifestHash);
  return { directory, manifestHash };
}

function resultsCsv(results: ResearchResults): string {
  const header = ["condition_key", "condition_label", "n", "mean_total", "median_total", "stddev_total", "min_total", "max_total", "gestalt_mean", "features_mean", "activity_mean", "confabulation_mean"];
  const rows = results.conditions.map((condition) => [condition.conditionKey, condition.label, condition.n, condition.meanTotal, condition.medianTotal, condition.stdDevTotal, condition.minTotal, condition.maxTotal, condition.meanComponents.gestalt, condition.meanComponents.verifiableFeatures, condition.meanComponents.activityFunctionEvent, condition.meanComponents.confabulationControl]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function sessionResultsCsv(results: ResearchResults): string {
  const header = ["anonymous_session_id", "session_id", "target_id", "pair_key", "condition_key", "condition_label", "mean_total", "judge_count", "judge_total_range", "judge_total_stddev", "gestalt", "verifiable_features", "activity_function_event", "confabulation_control"];
  const rows = results.sessions.map((session) => [session.anonymousSessionId, session.sessionId, session.targetId, session.pairKey, session.conditionKey, session.conditionLabel, session.total, session.judgeCount, session.judgeTotalRange, session.judgeTotalStdDev, session.gestalt, session.verifiableFeatures, session.activityFunctionEvent, session.confabulationControl]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function summaryMarkdown(name: string, results: ResearchResults): string {
  const lines = [`# ${name}`, "", `Template: ${results.templateType}`, `Sessions: ${results.sessions.length}`, "", "## Conditions", "", "| Condition | n | Mean | Median | SD | Min | Max |", "|---|---:|---:|---:|---:|---:|---:|"];
  for (const condition of results.conditions) lines.push(`| ${escapePipe(condition.label)} | ${condition.n} | ${condition.meanTotal.toFixed(2)} | ${condition.medianTotal.toFixed(2)} | ${condition.stdDevTotal.toFixed(2)} | ${condition.minTotal.toFixed(1)} | ${condition.maxTotal.toFixed(1)} |`);
  return lines.join("\n") + "\n";
}

function saveOnlySummaryMarkdown(name: string, sessionCount: number): string {
  return [`# ${name}`, "", "Evaluation mode: Save only / external evaluation", `Anonymous sessions: ${sessionCount}`, "", "No AI Judge was run by AI RV Harness. See README.md before sharing files with an external evaluator."].join("\n") + "\n";
}

function saveOnlySessionsCsv(assignments: Array<{ anonymousSessionId: string; status: string; sessionId?: string }>): string {
  return [["anonymous_session_id", "status", "session_saved"], ...assignments.map((assignment) => [assignment.anonymousSessionId, assignment.status, assignment.sessionId ? "yes" : "no"])]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n") + "\r\n";
}

function completeResearchSessionMarkdown(input: {
  anonymousSessionId: string;
  session: RvSession;
  revealText: string;
  artifacts: Array<{ mimeType: string; sha256: string; exportedPath: string }>;
  judgeScores: JudgeScoreRecord[];
  clarifications: TargetClarificationRecord[];
  language: "pl" | "en";
  saveOnly: boolean;
}): string {
  const pl = input.language === "pl";
  const artifactPrefix = input.saveOnly ? "../../../" : `sessions/${input.anonymousSessionId}/`;
  const artifacts = readableArtifacts(input.artifacts, artifactPrefix);
  const judges = input.judgeScores.length
    ? input.judgeScores.map((score) => [`### Judge ${score.judgeIndex} — ${score.total}/10`, `- ${pl ? "Model" : "Model"}: ${score.modelRoute}`, `- ${pl ? "Najmocniejsze trafienia" : "Strongest matches"}: ${score.narrative.strongestMatches.join(" · ") || "—"}`, `- ${pl ? "Główne chybienia lub sprzeczności" : "Major misses or contradictions"}: ${score.narrative.majorMissesContradictions.join(" · ") || "—"}`, `- ${pl ? "Konfabulacje" : "Confabulation observations"}: ${score.narrative.confabulationObservations.join(" · ") || "—"}`, "", score.narrative.conciseRationale].join("\n")).join("\n\n")
    : (pl ? "W tej sesji nie użyto AI Judge'a." : "No AI Judge was used for this session.");
  const clarifications = input.clarifications.length
    ? input.clarifications.map((item) => `### ${item.createdAt}\n\n${item.content}`).join("\n\n")
    : "—";
  return `# ${input.anonymousSessionId} — ${pl ? "pełny zapis sesji" : "complete session record"}\n\n## ${pl ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}\n\n${input.session.preRevealTranscript.trim() || "—"}\n\n## Target Reveal\n\n${input.revealText.trim() || "—"}\n\n### ${pl ? "Pliki Revealu" : "Reveal files"}\n\n${artifacts || "—"}\n\n## ${pl ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}\n\n${postRevealTranscriptMarkdown(input.session.postRevealTranscript, input.language) || "—"}\n\n## AI Judge\n\n${judges}\n\n## ${pl ? "Starsze doprecyzowania celu" : "Legacy target clarifications"}\n\n${clarifications}\n`;
}

function humanJudgePacketMarkdown(anonymousSessionId: string, evidence: string, revealText: string, artifacts: Array<{ mimeType: string; sha256: string; exportedPath: string }>, language: "pl" | "en"): string {
  const pl = language === "pl";
  return `# ${anonymousSessionId} — ${pl ? "pakiet do zewnętrznej oceny" : "external evaluation packet"}\n\n## ${pl ? "Zapieczętowane dane blind" : "Sealed blind evidence"}\n\n${evidence.trim() || "—"}\n\n## Target Reveal\n\n${revealText.trim() || "—"}\n\n### ${pl ? "Pliki Revealu" : "Reveal files"}\n\n${readableArtifacts(artifacts, "external_evaluation/") || "—"}\n\n> ${pl ? "Warunek badawczy jest celowo ukryty. Nie otwieraj folderu private_master przed zamrożeniem ocen." : "The research condition is intentionally hidden. Do not open private_master before scores are frozen."}\n`;
}

function readableArtifacts(artifacts: Array<{ mimeType: string; sha256: string; exportedPath: string }>, stripPrefix: string): string {
  return artifacts.map((artifact, index) => {
    const path = stripPrefix === "../../../" ? `${stripPrefix}${artifact.exportedPath}` : artifact.exportedPath.replace(stripPrefix, "");
    return artifact.mimeType.startsWith("image/")
      ? `![Reveal ${index + 1}](${path})\n\n- ${artifact.mimeType} · SHA-256: ${artifact.sha256}`
      : `- [Reveal ${index + 1}](${path}) · ${artifact.mimeType} · SHA-256: ${artifact.sha256}`;
  }).join("\n\n");
}

function blindingKeyMarkdown(name: string, rows: Array<Record<string, unknown>>, language: "pl" | "en"): string {
  const pl = language === "pl";
  const lines = [`# ${pl ? "Klucz odślepienia" : "Blinding Key"} — ${name}`, "", pl ? "Otwórz ten plik dopiero po zamrożeniu wszystkich ocen. Łączy anonimowe sesje z rzeczywistymi warunkami badania." : "Open this file only after every score is frozen. It connects anonymous sessions with the actual research conditions.", "", `| ${pl ? "Sesja anonimowa" : "Anonymous session"} | ${pl ? "Warunek" : "Condition"} | Key | Pair | Order | Target |`, "|---|---|---|---|---:|---|"];
  for (const row of rows) lines.push(`| ${escapePipe(String(row.anonymousSessionId ?? "—"))} | ${escapePipe(String(row.conditionLabel ?? "—"))} | ${escapePipe(String(row.conditionKey ?? "—"))} | ${escapePipe(String(row.pairKey ?? "—"))} | ${escapePipe(String(row.pairOrder ?? "—"))} | ${escapePipe(String(row.targetId ?? "—"))} |`);
  return `${lines.join("\n")}\n`;
}

function researchReadme(name: string, sessionCount: number, language: "pl" | "en", saveOnly: boolean, hasResults: boolean): string {
  if (language === "pl") return [`# Jak czytać pakiet Research — ${name}`, "", `Pakiet zawiera ${sessionCount} sesji. Ten plik opisuje po kolei, gdzie znajduje się każda informacja.`, "", "## Najprostsza ścieżka dla człowieka", "", saveOnly ? "1. Pełne, czytelne sesje otwieraj w `private_master/sessions/<ID>/complete_session.md`." : "1. Pełne, czytelne sesje otwieraj w `sessions/<ID>/complete_session.md`.", "2. Każdy taki plik zawiera dokładne prompty i odpowiedzi z części blind, Target Reveal, opinię Viewera po Revealu oraz — jeśli użyto — ocenę AI Judge.", "3. Jeżeli Reveal zawierał obraz, rzeczywisty plik obrazu znajduje się obok pakietu i jest podlinkowany w Markdownzie.", hasResults ? "4. Podsumowanie wyników znajdziesz w `summary.md`, a dane tabelaryczne w folderze `results`." : "4. W tym pakiecie nie ma jeszcze wyników AI Judge; ocena została pozostawiona zewnętrznemu oceniającemu.", "", "## Pliki techniczne", "", "Pliki JSON pozostają dla AI, audytu i odtwarzalności badania. Człowiek nie musi ich czytać, aby przejrzeć sesje.", "", saveOnly ? "## Zewnętrzna ocena" : "## Pakiety Judge", "", saveOnly ? "Udostępnij oceniającemu wyłącznie folder `external_evaluation`. Każda sesja ma tam czytelny plik `.md`, techniczny `.json`, instrukcję oceny oraz rzeczywiste obrazy Revealu. Nie udostępniaj `private_master` przed zamrożeniem ocen." : "Folder `judge_packets` zawiera anonimowe pakiety techniczne użyte przez Judge'ów.", "", "## Klucz odślepienia", "", saveOnly ? "Po zamrożeniu ocen otwórz `private_master/blinding/blinding_key.md`. Pokazuje on prostą tabelę: anonimowa sesja → warunek → target. Obok pozostaje wersja JSON dla automatyzacji." : "Czytelna tabela znajduje się w `blinding/blinding_key.md`; wersja JSON służy automatyzacji.", "", "## Pozostałe katalogi", "", "- `configuration` — zamrożona konfiguracja badania.", "- `master` — techniczny rekord audytowy i ewentualne odzyskane sesje.", "- `manifest.json` — sumy kontrolne eksportu.", "- `summary.csv` i `summary.html` — dodatkowe formaty podsumowania.", ""].join("\n");
  return [`# How to read the Research package — ${name}`, "", `This package contains ${sessionCount} sessions. This file explains exactly where each kind of information is stored.`, "", "## Simplest path for a human reader", "", saveOnly ? "1. Open complete readable sessions in `private_master/sessions/<ID>/complete_session.md`." : "1. Open complete readable sessions in `sessions/<ID>/complete_session.md`.", "2. Each file contains the exact blind prompts and responses, Target Reveal, the Viewer's post-Reveal review, and the AI Judge evaluation when used.", "3. If a Reveal included an image, the real image file is included and linked from Markdown.", hasResults ? "4. Read `summary.md` for results and the `results` folder for tables." : "4. No internal AI Judge result is present; evaluation was left to an external evaluator.", "", "## Technical files", "", "JSON files remain for AI tools, audit, and reproducibility. A human does not need to read JSON to inspect the sessions.", "", saveOnly ? "## External evaluation" : "## Judge packets", "", saveOnly ? "Share only `external_evaluation` with the evaluator. Each session has a readable `.md`, a technical `.json`, instructions, and real Reveal images. Keep `private_master` private until scores are frozen." : "`judge_packets` contains the anonymous technical packets used by the Judges.", "", "## Blinding Key", "", saveOnly ? "After scores are frozen, open `private_master/blinding/blinding_key.md`. Its simple table maps anonymous session → condition → target. JSON remains beside it for automation." : "The readable table is `blinding/blinding_key.md`; JSON remains for automation.", "", "## Other folders", "", "- `configuration` — frozen research configuration.", "- `master` — technical audit record and any recovery sessions.", "- `manifest.json` — export checksums.", "- `summary.csv` and `summary.html` — additional summary formats.", ""].join("\n");
}

function summaryHtml(name: string, language: "pl" | "en", results: ResearchResults | null, sessionCount: number, saveOnly: boolean): string {
  const rows = results?.conditions.map((condition) => `<tr><td>${escapeHtml(condition.label)}</td><td>${condition.n}</td><td>${condition.meanTotal.toFixed(2)}</td><td>${condition.medianTotal.toFixed(2)}</td><td>${condition.stdDevTotal.toFixed(2)}</td></tr>`).join("") ?? "";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title><style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px;color:#172033}table{width:100%;border-collapse:collapse}th,td{padding:9px;border:1px solid #cbd5e1;text-align:left}th{background:#eef2ff}</style></head><body><h1>${escapeHtml(name)}</h1><p>${language === "pl" ? "Sesje" : "Sessions"}: ${sessionCount} · ${saveOnly ? (language === "pl" ? "ocena zewnętrzna" : "external evaluation") : "AI Judge"}</p>${results ? `<table><thead><tr><th>${language === "pl" ? "Warunek" : "Condition"}</th><th>n</th><th>${language === "pl" ? "Średnia" : "Mean"}</th><th>Median</th><th>SD</th></tr></thead><tbody>${rows}</tbody></table>` : ""}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function externalEvaluationInstructions(language: "pl" | "en"): string {
  if (language === "pl") {
    return ["# Jak ocenić zapisane sesje", "", "1. Ustaw zawartość `JUDGE_SYSTEM_PROMPT.txt` jako instrukcję systemową wybranego AI.", "2. Dla każdego anonimowego pliku `<anonymousSessionId>.json` rozpocznij osobny, czysty kontekst i przekaż cały JSON jako wiadomość użytkownika. Plik `.md` o tej samej nazwie jest jego czytelną wersją dla człowieka.", "3. Jeżeli istnieje folder `<anonymousSessionId>_artifacts`, dołącz znajdujące się w nim obrazy do tej samej wiadomości. Te same pliki są podlinkowane w odpowiadającym im Markdownzie.", "4. Zapisz odpowiedź AI dokładnie pod identyfikatorem `anonymousSessionId`. Oczekiwany format pokazuje `SCORE_RESPONSE_EXAMPLE.json`.", "5. Nie udostępniaj oceniającemu folderu `private_master`; zawiera on klucz odsłaniający warunki eksperymentu.", "", "Każda sesja powinna być oceniana niezależnie. Nie podawaj modelu Viewera, profilu, warunku testu ani kolejności uruchomienia.", ""].join("\n");
  }
  return ["# How to evaluate the saved sessions", "", "1. Use `JUDGE_SYSTEM_PROMPT.txt` as the selected AI's system instruction.", "2. For every anonymous `<anonymousSessionId>.json` file, start a fresh context and send the complete JSON as the user message. The `.md` file with the same name is its human-readable counterpart.", "3. If a matching `<anonymousSessionId>_artifacts` folder exists, attach its images to the same message. The same files are linked from the corresponding Markdown.", "4. Save the response under its `anonymousSessionId`. The required shape is shown in `SCORE_RESPONSE_EXAMPLE.json`.", "5. Do not share `private_master` with the evaluator; it contains the experiment's unblinding key.", "", "Evaluate every session independently. Do not disclose the Viewer model, Profile, tested condition, or execution order.", ""].join("\n");
}

function pretty(value: unknown): string { return JSON.stringify(value, null, 2) + "\n"; }
function csvCell(value: string | number): string { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function escapePipe(value: string): string { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
function extensionFor(artifact: RevealArtifactRecord): string { return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "text/plain": "txt", "text/markdown": "md" } as Record<string, string>)[artifact.mimeType] ?? "bin"; }
function artifactExportPath(anonymousSessionId: string, index: number, artifact: RevealArtifactRecord, saveOnly: boolean): string {
  const root = saveOnly ? `external_evaluation/${anonymousSessionId}_artifacts` : `sessions/${anonymousSessionId}/reveal_artifacts`;
  return `${root}/artifact_${index + 1}.${extensionFor(artifact)}`;
}
async function sha256Text(text: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""); }

export function exportMasterRecordWire(value: unknown): string {
  return stableStringify(value);
}
