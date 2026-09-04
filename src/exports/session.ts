import type { JudgeScoreRecord } from "../judge/types";
import type { RevealArtifactRecord, RevealInput, RvSession, TargetClarificationRecord } from "../sessions/types";
import { postRevealTranscriptMarkdown } from "../sessions/postRevealTranscript";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";
import { renderMarkdownExportDocument } from "./document";
import { writeExportPackage, type ExportArtifactCopy, type ExportTextFile } from "./native";

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
  const completeSession = completeSessionMarkdown({
    session,
    reveal,
    scores,
    clarifications,
    language,
    exportedAt,
    workspaceName: workspace?.name ?? session.workspaceId,
    profileName: profile?.name ?? snapshot?.identities?.aiIsBeDisplayName ?? session.profileId,
    protocol: snapshot ? `${snapshot.protocol.id} ${snapshot.protocol.version}` : undefined,
    viewerModel: snapshot?.modelRoute ?? snapshot?.modelId,
    monitorModel: snapshot?.monitor?.modelRoute ?? snapshot?.monitor?.modelId,
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

function completeSessionMarkdown(input: {
  session: RvSession;
  reveal: RevealInput | null;
  scores: JudgeScoreRecord[];
  clarifications: TargetClarificationRecord[];
  language: InterfaceLanguage;
  exportedAt: Date;
  workspaceName: string;
  profileName: string;
  protocol?: string;
  viewerModel?: string;
  monitorModel?: string;
}): string {
  const { session, reveal, scores, clarifications, language } = input;
  const pl = language === "pl";
  const judgeText = scores.length
    ? scores.map((score) => [
      `### Judge ${score.judgeIndex} — ${score.total}/10`,
      `- Model: ${score.modelRoute}`,
      `- ${pl ? "Najmocniejsze trafienia" : "Strongest matches"}: ${score.narrative.strongestMatches.join(" · ") || "—"}`,
      `- ${pl ? "Główne chybienia lub sprzeczności" : "Major misses or contradictions"}: ${score.narrative.majorMissesContradictions.join(" · ") || "—"}`,
      `- ${pl ? "Konfabulacje" : "Confabulation observations"}: ${score.narrative.confabulationObservations.join(" · ") || "—"}`,
      "",
      score.narrative.conciseRationale,
    ].join("\n")).join("\n\n")
    : (pl ? "W tej sesji nie użyto AI Judge'a." : "No AI Judge was used for this session.");
  const revealFiles = reveal?.artifactManifest?.length
    ? reveal.artifactManifest.map((artifact, index) => {
      const relativePath = `reveal_files/${String(index + 1).padStart(2, "0")}_${safePart(artifact.originalFileName)}`;
      return artifact.mimeType.startsWith("image/")
        ? `![${artifact.originalFileName}](${relativePath})\n\n- ${artifact.originalFileName} (${artifact.mimeType}, SHA-256: ${artifact.sha256})`
        : `- [${artifact.originalFileName}](${relativePath}) (${artifact.mimeType}, SHA-256: ${artifact.sha256})`;
    }).join("\n\n")
    : "—";
  const clarificationText = clarifications.length
    ? clarifications.map((item) => `### ${item.createdAt}\n\n${item.content}`).join("\n\n")
    : "—";
  const mode = session.runType === "automatic_monitor"
    ? (pl ? "RV z Monitorem" : "Monitored RV")
    : session.runType === "automatic"
      ? (pl ? "Automatyczna sesja RV" : "Automatic RV")
      : "Manual RV";
  const body = `## ${pl ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}

${session.preRevealTranscript.trim() || "—"}

## Target Reveal

${reveal?.text?.trim() || "—"}

### ${pl ? "Pliki Revealu" : "Reveal files"}

${revealFiles}

## ${pl ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}

${postRevealTranscriptMarkdown(session.postRevealTranscript, language) || "—"}

## ${pl ? "Ocena AI Judge" : "AI Judge evaluation"}

${judgeText}

## ${pl ? "Późniejsze doprecyzowania celu" : "Later target clarifications"}

${clarificationText}
`;
  return renderMarkdownExportDocument({
    language,
    title: `${session.sessionCode} — ${pl ? "pełny zapis sesji" : "complete session record"}`,
    metadata: {
      workspace: input.workspaceName,
      profile: input.profileName,
      mode,
      protocol: input.protocol,
      viewerModel: input.viewerModel,
      monitorModel: input.monitorModel,
      judgeModels: scores.map((score) => score.modelRoute),
      state: session.state,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      exportedAt: input.exportedAt,
    },
    body,
  });
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
