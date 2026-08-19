import type { JudgeScoreRecord } from "../judge/types";
import type { RevealArtifactRecord, RevealInput, RvSession, SessionSnapshot, TargetClarificationRecord } from "../sessions/types";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";
import { writeExportPackage, type ExportArtifactCopy, type ExportTextFile } from "./native";

export async function exportSessionRecord(
  repository: AppRepository,
  workspaceId: string,
  sessionId: string,
  language: InterfaceLanguage,
  baseDirectory: string,
): Promise<string> {
  const [sessions, reveal, scores, snapshot, clarifications] = await Promise.all([
    repository.listRvSessions(workspaceId),
    repository.getReveal(sessionId),
    repository.listJudgeScores(sessionId),
    repository.getSessionSnapshot(sessionId),
    repository.listTargetClarifications(sessionId),
  ]);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(language === "pl" ? "Nie znaleziono sesji do zapisania." : "The session to save was not found.");

  const exportId = `RV_Session_${safePart(session.sessionCode)}_${timestampPart()}`;
  const artifactCopies = revealArtifactCopies(reveal);
  const completeSession = completeSessionMarkdown(session, reveal, scores, clarifications, language);
  const safeSnapshot = snapshot ? snapshotWithoutCredentialReference(snapshot) : null;
  const files: ExportTextFile[] = [
    { relativePath: "complete_session.md", content: completeSession },
    { relativePath: "session.json", content: jsonFile(session) },
    { relativePath: "session_snapshot.json", content: jsonFile(safeSnapshot) },
    { relativePath: "reveal.json", content: jsonFile(reveal) },
    { relativePath: "judge_scores.json", content: jsonFile(scores) },
    { relativePath: "target_clarifications.json", content: jsonFile(clarifications) },
  ];
  const manifestHash = await sha256Text(completeSession);
  files.push({
    relativePath: "manifest.json",
    content: jsonFile({
      schemaVersion: 1,
      exportType: "complete_session",
      sessionId: session.id,
      sessionCode: session.sessionCode,
      generatedAt: new Date().toISOString(),
      completeSessionSha256: manifestHash,
      revealArtifactCount: artifactCopies.length,
      rawApiKeysIncluded: false,
    }),
  });

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

function completeSessionMarkdown(
  session: RvSession,
  reveal: RevealInput | null,
  scores: JudgeScoreRecord[],
  clarifications: TargetClarificationRecord[],
  language: InterfaceLanguage,
): string {
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
    ? reveal.artifactManifest.map((artifact) => `- ${artifact.originalFileName} (${artifact.mimeType}, SHA-256: ${artifact.sha256})`).join("\n")
    : "—";
  const clarificationText = clarifications.length
    ? clarifications.map((item) => `### ${item.createdAt}\n\n${item.content}`).join("\n\n")
    : "—";
  return `# ${session.sessionCode} — ${pl ? "pełny zapis sesji" : "complete session record"}

- ${pl ? "Stan" : "State"}: ${session.state}
- ${pl ? "Utworzono" : "Created"}: ${session.createdAt}
- ${pl ? "Zakończono" : "Completed"}: ${session.completedAt ?? "—"}

## ${pl ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}

${session.preRevealTranscript.trim() || "—"}

## Target Reveal

${reveal?.text?.trim() || "—"}

### ${pl ? "Pliki Revealu" : "Reveal files"}

${revealFiles}

## ${pl ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}

${session.postRevealTranscript.trim() || "—"}

## ${pl ? "Ocena AI Judge" : "AI Judge evaluation"}

${judgeText}

## ${pl ? "Późniejsze doprecyzowania celu" : "Later target clarifications"}

${clarificationText}
`;
}

function revealArtifactCopies(reveal: RevealInput | null): ExportArtifactCopy[] {
  return (reveal?.artifactManifest ?? []).map((artifact: RevealArtifactRecord, index) => ({
    sourcePath: artifact.path,
    relativePath: `reveal_files/${String(index + 1).padStart(2, "0")}_${safePart(artifact.originalFileName)}`,
  }));
}

function snapshotWithoutCredentialReference(snapshot: SessionSnapshot): Record<string, unknown> {
  return { ...snapshot, credentialId: "[stored in the operating-system keychain; not exported]", credentialHint: undefined };
}

function safePart(value: string): string {
  const safe = value.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "session";
}

function timestampPart(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
