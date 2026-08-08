import { buildJudgePacket } from "../domain/judgePacket";
import { JUDGE_RUBRIC_VERSION } from "../judge/types";
import type { AppRepository } from "../storage/repository";
import type { RevealArtifactRecord } from "../sessions/types";
import { stableStringify } from "../research/planner";
import type { ResearchResults } from "../research/types";
import { parsePostRevealTranscript } from "../sessions/postRevealTranscript";
import { writeExportPackage, type ExportArtifactCopy, type ExportTextFile } from "./native";

export async function exportResearchPackage(repository: AppRepository, projectId: string): Promise<{ directory: string; manifestHash: string }> {
  const project = await repository.getResearchProject(projectId);
  const results = await repository.getResearchResults(projectId);
  if (!project || project.state !== "Complete" || !results) throw new Error("Research must be complete before full-package export.");
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

  files.push({ relativePath: "results/results.json", content: pretty(results) });
  files.push({ relativePath: "results/results.csv", content: resultsCsv(results) });
  files.push({ relativePath: "results/session_results.csv", content: sessionResultsCsv(results) });
  files.push({ relativePath: "configuration/research_config.json", content: pretty({ projectId: project.id, name: project.name, templateType: project.templateType, configHash: project.configHash, lockedAt: project.lockedAt, scoresFrozenAt: project.scoresFrozenAt, unblindedAt: project.unblindedAt, config: project.config }) });
  if (recoverySessions.length) {
    files.push({ relativePath: "master/recovery_sessions.json", content: pretty(recoverySessions) });
    for (const session of recoverySessions) files.push({ relativePath: `master/recovery_sessions/${session.id}/pre_reveal.md`, content: session.preRevealTranscript });
  }

  for (const assignment of assignments) {
    if (!assignment.sessionId) continue;
    const session = sessionById.get(assignment.sessionId);
    if (!session) continue;
    const [reveal, viewerEvidence, snapshot, judgeScores, clarifications] = await Promise.all([
      repository.getReveal(session.id), repository.getViewerEvidence(session.id), repository.getSessionSnapshot(session.id), repository.listJudgeScores(session.id), repository.listTargetClarifications(session.id),
    ]);
    const base = `sessions/${assignment.anonymousSessionId}`;
    files.push({ relativePath: `${base}/pre_reveal.md`, content: session.preRevealTranscript });
    files.push({ relativePath: `${base}/viewer_evidence.md`, content: viewerEvidence });
    if (session.postRevealTranscript) files.push({ relativePath: `${base}/post_reveal.md`, content: postRevealMarkdown(session.postRevealTranscript) });
    if (clarifications.length) files.push({ relativePath: `${base}/target_clarifications.json`, content: pretty({ label: "Supplementary analysis — after target clarification", records: clarifications }) });
    if (snapshot) {
      snapshots[assignment.anonymousSessionId] = snapshot;
      files.push({ relativePath: `${base}/session_snapshot.json`, content: pretty(snapshot) });
    }
    if (reveal) {
      const exportedArtifacts = (reveal.artifactManifest ?? []).map((artifact, index) => {
        const relativePath = `${base}/reveal_artifacts/artifact_${index + 1}.${extensionFor(artifact)}`;
        artifactCopies.push({ sourcePath: artifact.path, relativePath });
        return { artifactId: artifact.artifactId, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.sha256, exportedPath: relativePath };
      });
      files.push({ relativePath: `${base}/reveal.json`, content: pretty({ source: reveal.source, text: reveal.text, hash: reveal.hash, artifacts: exportedArtifacts }) });
      const packet = buildJudgePacket({ anonymousSessionId: assignment.anonymousSessionId, preRevealEvidence: viewerEvidence, reveal: { ...(reveal.text ? { text: reveal.text } : {}), ...(exportedArtifacts.some((artifact) => artifact.mimeType.startsWith("image/")) ? { imageRefs: exportedArtifacts.filter((artifact) => artifact.mimeType.startsWith("image/")).map((_, index) => `reveal_image_${index + 1}`) } : {}) }, rubricVersion: JUDGE_RUBRIC_VERSION });
      files.push({ relativePath: `judge_packets/${assignment.anonymousSessionId}.json`, content: pretty(packet) });
    }
    files.push({ relativePath: `judges/${assignment.anonymousSessionId}.json`, content: pretty(judgeScores) });

    const mapping = mappingByAnonymous.get(assignment.anonymousSessionId);
    const condition = mapping ? conditionById.get(mapping.conditionId) : undefined;
    if (mapping && condition) blindingKey.push({ anonymousSessionId: assignment.anonymousSessionId, conditionKey: condition.conditionKey, conditionLabel: condition.config.label, pairKey: mapping.pairKey, pairOrder: mapping.pairOrder ?? null, targetId: assignment.targetId });
  }

  files.push({ relativePath: "blinding/blinding_key.json", content: pretty(blindingKey) });
  files.push({ relativePath: "master/master_record.json", content: pretty({ project: { id: project.id, workspaceId: project.workspaceId, templateType: project.templateType, state: project.state, config: project.config, configHash: project.configHash }, conditions, assignments, mappings, sessionSnapshots: snapshots }) });
  files.push({ relativePath: "summary.md", content: summaryMarkdown(project.name, results) });

  const manifestEntries = await Promise.all(files.map(async (file) => ({ path: file.relativePath, kind: "text", sha256: await sha256Text(file.content) })));
  for (const assignment of assignments) {
    if (!assignment.sessionId) continue;
    const reveal = await repository.getReveal(assignment.sessionId);
    for (let index = 0; index < (reveal?.artifactManifest?.length ?? 0); index += 1) {
      const artifact = reveal!.artifactManifest![index];
      manifestEntries.push({ path: `sessions/${assignment.anonymousSessionId}/reveal_artifacts/artifact_${index + 1}.${extensionFor(artifact)}`, kind: "artifact", sha256: artifact.sha256 });
    }
  }
  const manifest = { schemaVersion: 1, projectId, generatedAt: new Date().toISOString(), entries: manifestEntries };
  const manifestContent = pretty(manifest);
  const manifestHash = await sha256Text(manifestContent);
  files.push({ relativePath: "manifest.json", content: manifestContent });
  const exportId = `RV_Harness_Research_${project.id.replace(/[^A-Za-z0-9_-]/g, "_")}_${Date.now()}`;
  const directory = await writeExportPackage({ exportId, files, artifactCopies });
  await repository.recordExport(project.workspaceId, project.id, "research_package", directory, manifestHash);
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

function pretty(value: unknown): string { return JSON.stringify(value, null, 2) + "\n"; }
function csvCell(value: string | number): string { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function escapePipe(value: string): string { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
function postRevealMarkdown(transcript: string): string {
  const turns = parsePostRevealTranscript(transcript);
  if (!turns.length) return transcript;
  return turns.map((turn) => `## ${turn.role === "user" ? "User" : "Viewer"}\n\n${turn.content}\n`).join("\n");
}
function extensionFor(artifact: RevealArtifactRecord): string { return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "text/plain": "txt", "text/markdown": "md" } as Record<string, string>)[artifact.mimeType] ?? "bin"; }
async function sha256Text(text: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""); }

export function exportMasterRecordWire(value: unknown): string {
  return stableStringify(value);
}
