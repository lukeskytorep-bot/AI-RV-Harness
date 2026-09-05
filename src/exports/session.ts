import type { RevealArtifactRecord, RevealInput } from "../sessions/types";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";
import { writeExportPackage, type ExportArtifactCopy, type ExportTextFile } from "./native";
import { renderCompleteSessionMarkdown } from "./sessionDocument";

export async function exportSessionRecord(
  repository: AppRepository,
  workspaceId: string,
  sessionId: string,
  language: InterfaceLanguage,
  baseDirectory: string,
  exportedAt = new Date(),
): Promise<string> {
  const [sessions, reveal, scores, clarifications, snapshot, workspaces, profiles] = await Promise.all([
    repository.listRvSessions(workspaceId),
    repository.getReveal(sessionId),
    repository.listJudgeScores(sessionId),
    repository.listTargetClarifications(sessionId),
    repository.getSessionSnapshot(sessionId),
    repository.listWorkspaces(),
    repository.listProfiles(),
  ]);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(language === "pl" ? "Nie znaleziono sesji do zapisania." : "The session to save was not found.");

  const workspace = workspaces.find((item) => item.id === session.workspaceId);
  const profile = profiles.find((item) => item.id === session.profileId);
  const exportId = `RV_Session_${safePart(session.sessionCode)}_${timestampPart(exportedAt)}`;
  const artifactCopies = revealArtifactCopies(reveal);
  const mode = session.runType === "automatic_monitor"
    ? (language === "pl" ? "RV z Monitorem" : "Monitored RV")
    : session.runType === "automatic"
      ? (language === "pl" ? "Automatyczna sesja RV" : "Automatic RV")
      : "Manual RV";
  const completeSession = renderCompleteSessionMarkdown({
    title: `${session.sessionCode} — ${language === "pl" ? "pełny zapis sesji" : "complete session record"}`,
    language,
    session,
    revealText: reveal?.text ?? "",
    revealFilesMarkdown: revealFilesMarkdown(reveal),
    scores,
    clarifications,
    metadata: {
      workspace: workspace?.name ?? session.workspaceId,
      profile: profile?.name ?? snapshot?.identities?.aiIsBeDisplayName ?? session.profileId,
      mode,
      protocol: snapshot ? `${snapshot.protocol.id} ${snapshot.protocol.version}` : undefined,
      viewerModel: snapshot?.modelRoute ?? snapshot?.modelId,
      monitorModel: snapshot?.monitor?.modelRoute ?? snapshot?.monitor?.modelId,
      judgeModels: scores.map((score) => score.modelRoute),
      state: session.state,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      exportedAt,
    },
  });
  const files: ExportTextFile[] = [
    { relativePath: "complete_session.md", content: completeSession },
  ];
  const manifestHash = await sha256Text(completeSession);

  const directory = await writeExportPackage({
    exportId,
    files,
    artifactCopies,
    destination: "external",
    baseDirectory: baseDirectory.trim(),
    overwriteExisting: false,
  });
  await repository.recordExport(workspaceId, session.researchProjectId, "complete_session", directory, manifestHash);
  return directory;
}

function revealFilesMarkdown(reveal: RevealInput | null): string {
  if (!reveal?.artifactManifest?.length) return "—";
  return reveal.artifactManifest.map((artifact, index) => {
    const relativePath = `reveal_files/${String(index + 1).padStart(2, "0")}_${safePart(artifact.originalFileName)}`;
    return artifact.mimeType.startsWith("image/")
      ? `![${artifact.originalFileName}](${relativePath})\n\n- ${artifact.originalFileName} (${artifact.mimeType}, SHA-256: ${artifact.sha256})`
      : `- [${artifact.originalFileName}](${relativePath}) (${artifact.mimeType}, SHA-256: ${artifact.sha256})`;
  }).join("\n\n");
}

function revealArtifactCopies(reveal: RevealInput | null): ExportArtifactCopy[] {
  return (reveal?.artifactManifest ?? []).map((artifact: RevealArtifactRecord, index) => ({
    sourcePath: artifact.path,
    relativePath: `reveal_files/${String(index + 1).padStart(2, "0")}_${safePart(artifact.originalFileName)}`,
  }));
}

function safePart(value: string): string {
  const safe = value.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "session";
}

function timestampPart(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
