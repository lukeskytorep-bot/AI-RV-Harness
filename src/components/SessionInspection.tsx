import { useEffect, useState } from "react";
import { Download, FileCheck2, LockKeyhole, Scale, Sparkles } from "lucide-react";
import { exportSessionRecord } from "../exports/session";
import { JudgeResults } from "./JudgeResults";
import { getCopy } from "../i18n";
import type { JudgeScoreRecord } from "../judge/types";
import type { RevealInput, RvSession, SessionSnapshot, TargetClarificationRecord } from "../sessions/types";
import { postRevealTranscriptMarkdown } from "../sessions/postRevealTranscript";
import { isTauriRuntime } from "../storage";
import { chooseDirectory } from "../storage/native";
import type { AppRepository } from "../storage/repository";
import type { InterfaceLanguage } from "../types";
import { SafeMarkdown } from "./SafeMarkdown";

export function SessionInspection({ repository, workspaceId, sessionId, language }: {
  repository: AppRepository;
  workspaceId: string;
  sessionId: string;
  language: InterfaceLanguage;
}) {
  const pl = language === "pl";
  const copy = getCopy(language);
  const [session, setSession] = useState<RvSession | null>(null);
  const [reveal, setReveal] = useState<RevealInput | null>(null);
  const [scores, setScores] = useState<JudgeScoreRecord[]>([]);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [clarifications, setClarifications] = useState<TargetClarificationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setReveal(null);
    setScores([]);
    setSnapshot(null);
    setClarifications([]);
    setError(null);
    void Promise.all([
      repository.listRvSessions(workspaceId),
      repository.getReveal(sessionId),
      repository.listJudgeScores(sessionId),
      repository.getSessionSnapshot(sessionId),
      repository.listTargetClarifications(sessionId),
    ]).then(([sessions, nextReveal, nextScores, nextSnapshot, nextClarifications]) => {
      if (cancelled) return;
      setSession(sessions.find((item) => item.id === sessionId) ?? null);
      setReveal(nextReveal);
      setScores(nextScores);
      setSnapshot(nextSnapshot);
      setClarifications(nextClarifications);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [repository, sessionId, workspaceId]);

  if (error) return <div className="provider-error">{error}</div>;
  if (!session) return <div className="session-inspection-loading">{pl ? "Wczytywanie sesji…" : "Loading session…"}</div>;

  const exportSession = async () => {
    const destination = await chooseDirectory(pl ? "Wybierz folder zapisu sesji" : "Choose where to save the session");
    if (!destination) return;
    setExporting(true);
    setError(null);
    setExportPath(null);
    try {
      setExportPath(await exportSessionRecord(repository, workspaceId, sessionId, language, destination));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };

  return <section className="session-inspection">
    <header><div><small>{session.sessionCode}</small><h3>{pl ? "Pełny zapis sesji" : "Complete session record"}</h3></div><div className="session-inspection-actions"><button className="secondary-button" disabled={!isTauriRuntime() || exporting} onClick={() => void exportSession()}><Download size={14} />{exporting ? (pl ? "Zapisywanie…" : "Saving…") : (pl ? "Zapisz sesję" : "Save session")}</button><span className={`status-chip ${session.state === "Completed" ? "ready" : "next"}`}>{session.state}</span></div></header>
    {exportPath && <div className="storage-success">{pl ? "Sesję zapisano" : "Session saved"}: {exportPath}</div>}
    {snapshot && <dl className="session-inspection-meta"><div><dt>{pl ? "Protokół" : "Protocol"}</dt><dd>{snapshot.protocol.id} · {snapshot.protocol.version}</dd></div><div><dt>{pl ? "Model" : "Model"}</dt><dd>{snapshot.modelRoute}</dd></div><div><dt>{pl ? "Język" : "Language"}</dt><dd>{snapshot.sessionLanguage.toUpperCase()}</dd></div></dl>}
    <article><h4><LockKeyhole size={15} />{pl ? "Zapieczętowana część ślepa — dokładne polecenia i odpowiedzi" : "Sealed blind record — exact instructions and responses"}</h4><SafeMarkdown content={session.preRevealTranscript || (pl ? "Brak transkryptu." : "No transcript.")} /></article>
    {reveal && <article className="session-reveal"><h4><FileCheck2 size={15} />Target Reveal</h4>{reveal.text && <SafeMarkdown content={reveal.text} />}{reveal.artifactManifest?.length ? <ul>{reveal.artifactManifest.map((artifact) => <li key={artifact.artifactId}>{artifact.originalFileName} · {artifact.mimeType}</li>)}</ul> : null}</article>}
    {clarifications.length > 0 && <article className="session-reveal"><h4><FileCheck2 size={15} />{pl ? "Późniejsze doprecyzowania celu" : "Later target clarifications"}</h4>{clarifications.map((item) => <SafeMarkdown key={item.id} content={item.content} />)}</article>}
    <article><h4><Sparkles size={15} />{pl ? "Opinia Viewera i rozmowa po Revealu" : "Viewer review and post-Reveal discussion"}</h4>{session.postRevealTranscript ? <SafeMarkdown content={postRevealTranscriptMarkdown(session.postRevealTranscript, language)} /> : <p>{pl ? "Nie zapisano rozmowy po Revealu." : "No post-Reveal discussion was recorded."}</p>}</article>
    <article><h4><Scale size={15} />{copy.judgeEvaluation}</h4>{scores.length ? <JudgeResults copy={copy} scores={scores} /> : <p>{pl ? "W tej sesji nie użyto AI Judge'a." : "No AI Judge was used for this session."}</p>}</article>
  </section>;
}
