import { buildJudgePacket } from "../domain/judgePacket";
import { JUDGE_RUBRIC_VERSION } from "../judge/types";
import { getJudgePrompt } from "../judge/prompt";
import type { AppRepository } from "../storage/repository";
import type { RevealArtifactRecord } from "../sessions/types";
import { stableStringify } from "../research/planner";
import type { ResearchResults } from "../research/types";
import { parsePostRevealTranscript } from "../sessions/postRevealTranscript";
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
      if (session.postRevealTranscript) files.push({ relativePath: `${base}/post_reveal.md`, content: postRevealMarkdown(session.postRevealTranscript) });
      if (clarifications.length) files.push({ relativePath: `${base}/target_clarifications.json`, content: pretty({ label: "Supplementary analysis — after target clarification", records: clarifications }) });
    }
    if (snapshot) {
      snapshots[assignment.anonymousSessionId] = snapshot;
      if (!saveOnly) files.push({ relativePath: `${base}/session_snapshot.json`, content: pretty(snapshot) });
    }
    if (reveal) {
      const exportedArtifacts = (reveal.artifactManifest ?? []).map((artifact, index) => {
        const relativePath = artifactExportPath(assignment.anonymousSessionId, index, artifact, saveOnly);
        artifactCopies.push({ sourcePath: artifact.path, relativePath });
        return { artifactId: artifact.artifactId, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.sha256, exportedPath: relativePath };
      });
      if (!saveOnly) files.push({ relativePath: `${base}/reveal.json`, content: pretty({ source: reveal.source, text: reveal.text, hash: reveal.hash, artifacts: exportedArtifacts }) });
      const packet = buildJudgePacket({ anonymousSessionId: assignment.anonymousSessionId, preRevealEvidence: viewerEvidence, reveal: { ...(reveal.text ? { text: reveal.text } : {}), ...(exportedArtifacts.some((artifact) => artifact.mimeType.startsWith("image/")) ? { imageRefs: exportedArtifacts.filter((artifact) => artifact.mimeType.startsWith("image/")).map((_, index) => `reveal_image_${index + 1}`) } : {}) }, rubricVersion: JUDGE_RUBRIC_VERSION });
      files.push({ relativePath: `${saveOnly ? "external_evaluation" : "judge_packets"}/${assignment.anonymousSessionId}.json`, content: pretty(saveOnly ? { ...packet, artifactFiles: exportedArtifacts } : packet) });
    }
    if (!saveOnly) files.push({ relativePath: `judges/${assignment.anonymousSessionId}.json`, content: pretty(judgeScores) });
    if (!saveOnly) {
      const judgeMarkdown = judgeScores.length
        ? judgeScores.map((score) => `### Judge ${score.judgeIndex} — ${score.total}/10\n\n${score.narrative.conciseRationale}`).join("\n\n")
        : project.config.sessionLanguage === "pl" ? "W tej sesji nie użyto AI Judge'a." : "No AI Judge was used for this session.";
      files.push({
        relativePath: `${base}/complete_session.md`,
        content: `# ${assignment.anonymousSessionId}\n\n## ${project.config.sessionLanguage === "pl" ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}\n\n${session.preRevealTranscript.trim()}\n\n## Target Reveal\n\n${reveal?.text?.trim() || "—"}\n\n## ${project.config.sessionLanguage === "pl" ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}\n\n${session.postRevealTranscript.trim() || "—"}\n\n## AI Judge\n\n${judgeMarkdown}\n`,
      });
    }

    const mapping = mappingByAnonymous.get(assignment.anonymousSessionId);
    const condition = mapping ? conditionById.get(mapping.conditionId) : undefined;
    if (mapping && condition) blindingKey.push({ anonymousSessionId: assignment.anonymousSessionId, conditionKey: condition.conditionKey, conditionLabel: condition.config.label, pairKey: mapping.pairKey, pairOrder: mapping.pairOrder ?? null, targetId: assignment.targetId });
  }

  files.push({ relativePath: `${privatePrefix}blinding/blinding_key.json`, content: pretty(blindingKey) });
  files.push({ relativePath: `${privatePrefix}master/master_record.json`, content: pretty({ project: { id: project.id, workspaceId: project.workspaceId, templateType: project.templateType, state: project.state, config: project.config, configHash: project.configHash }, conditions, assignments, mappings, sessionSnapshots: snapshots }) });
  files.push({ relativePath: "summary.md", content: results ? summaryMarkdown(project.name, results) : saveOnlySummaryMarkdown(project.name, assignments.length) });
  files.push({ relativePath: "summary.csv", content: results ? sessionResultsCsv(results) : saveOnlySessionsCsv(assignments) });
  files.push({ relativePath: "summary.html", content: summaryHtml(project.name, project.config.sessionLanguage, results, assignments.length, saveOnly) });
  if (saveOnly) files.push({ relativePath: "README.md", content: saveOnlyReadme(project.name, assignments.length) });

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

function saveOnlyReadme(name: string, sessionCount: number): string {
  return [`# External evaluation package — ${name}`, "", `This package contains ${sessionCount} anonymous session packet(s). AI Judge was optional and was not run inside AI RV Harness.`, "", "## What to share", "", "Share only the `external_evaluation` folder with another AI or human Judge. It includes the blind packets, a ready-to-use Judge system prompt, scoring instructions, and any referenced Reveal images. The tested condition labels are not included.", "", "## What to keep private until scoring is finished", "", "Do not share `private_master` with the evaluator. It contains the configuration, condition mapping, and Blinding Key.", "", "After external scores are frozen, you may use `private_master/blinding/blinding_key.json` to connect anonymous sessions to conditions.", ""].join("\n");
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
    return ["# Jak ocenić zapisane sesje", "", "1. Ustaw zawartość `JUDGE_SYSTEM_PROMPT.txt` jako instrukcję systemową wybranego AI.", "2. Dla każdego pliku `BlindSession_*.json` rozpocznij osobny, czysty kontekst i przekaż cały JSON jako wiadomość użytkownika.", "3. Jeżeli obok JSON istnieje folder `BlindSession_*_artifacts`, dołącz znajdujące się w nim obrazy do tej samej wiadomości.", "4. Zapisz odpowiedź AI dokładnie pod identyfikatorem `anonymousSessionId`. Oczekiwany format pokazuje `SCORE_RESPONSE_EXAMPLE.json`.", "5. Nie udostępniaj oceniającemu folderu `private_master`; zawiera on klucz odsłaniający warunki eksperymentu.", "", "Każda sesja powinna być oceniana niezależnie. Nie podawaj modelu Viewera, profilu, warunku testu ani kolejności uruchomienia.", ""].join("\n");
  }
  return ["# How to evaluate the saved sessions", "", "1. Use `JUDGE_SYSTEM_PROMPT.txt` as the selected AI's system instruction.", "2. For every `BlindSession_*.json`, start a fresh context and send the complete JSON as the user message.", "3. If a matching `BlindSession_*_artifacts` folder exists, attach its images to the same message.", "4. Save the response under its `anonymousSessionId`. The required shape is shown in `SCORE_RESPONSE_EXAMPLE.json`.", "5. Do not share `private_master` with the evaluator; it contains the experiment's unblinding key.", "", "Evaluate every session independently. Do not disclose the Viewer model, Profile, tested condition, or execution order.", ""].join("\n");
}

function pretty(value: unknown): string { return JSON.stringify(value, null, 2) + "\n"; }
function csvCell(value: string | number): string { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function escapePipe(value: string): string { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
function postRevealMarkdown(transcript: string): string {
  const turns = parsePostRevealTranscript(transcript);
  if (!turns.length) return transcript;
  return turns.map((turn) => `## ${turn.role === "user" ? "User" : "Viewer"}\n\n${turn.content}\n`).join("\n");
}
function extensionFor(artifact: RevealArtifactRecord): string { return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "text/plain": "txt", "text/markdown": "md" } as Record<string, string>)[artifact.mimeType] ?? "bin"; }
function artifactExportPath(anonymousSessionId: string, index: number, artifact: RevealArtifactRecord, saveOnly: boolean): string {
  const root = saveOnly ? `external_evaluation/${anonymousSessionId}_artifacts` : `sessions/${anonymousSessionId}/reveal_artifacts`;
  return `${root}/artifact_${index + 1}.${extensionFor(artifact)}`;
}
async function sha256Text(text: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""); }

export function exportMasterRecordWire(value: unknown): string {
  return stableStringify(value);
}
