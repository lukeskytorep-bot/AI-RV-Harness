import { useEffect, useState } from "react";

import {
  parseResearchContextRequestEvidenceEvents,
  summarizeResearchContextRequestEvidence,
  RESEARCH_CONTEXT_REQUEST_EVIDENCE_EVENT,
  type ResearchContextRequestEvidenceRecord,
} from "../../research/contextRequestEvidence";
import type { AppRepository } from "../../storage/repository";

type LoadResult = { repository: AppRepository; sessionId: string; revision: number } & (
  | { status: "ready"; records: ResearchContextRequestEvidenceRecord[]; ignored: number }
  | { status: "error"; error: string }
);

export function ResearchContextEvidencePanel({ repository, sessionId, pl }: { repository: AppRepository; sessionId: string; pl: boolean }) {
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    void repository.listSessionEvents(sessionId).then((events) => {
      const ownEvents = events.filter((event) => event.sessionId === sessionId);
      const records = parseResearchContextRequestEvidenceEvents(ownEvents);
      const ignored = events.filter((event) => event.eventType === RESEARCH_CONTEXT_REQUEST_EVIDENCE_EVENT).length - records.length;
      if (!cancelled) setLoaded({ repository, sessionId, revision, status: "ready", records, ignored });
    }).catch((cause) => {
      if (!cancelled) setLoaded({ repository, sessionId, revision, status: "error", error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { cancelled = true; };
  }, [repository, sessionId, revision]);

  // Never show the preceding session's records while loading a new selection.
  const current = loaded?.repository === repository && loaded.sessionId === sessionId && loaded.revision === revision ? loaded : null;
  const records = current?.status === "ready" ? current.records : [];
  const summary = summarizeResearchContextRequestEvidence(records);
  const roleLabel = (role: string) => !pl ? role : role === "user" ? "użytkownik" : role === "assistant" ? "asystent" : role;
  return <section className="panel research-context-evidence" aria-busy={!current}>
    <div className="research-section-head">
      <strong>{pl ? "Kontekst i instrukcje: dowody wywołań" : "Context & Instructions request evidence"}</strong>
      <button type="button" disabled={!current} onClick={() => setRevision((value) => value + 1)}>{pl ? "Odśwież" : "Refresh"}</button>
      {current?.status === "ready" && <small>{summary.physicalAttempts} {pl ? "fizycznych prób" : "physical attempts"}</small>}
    </div>
    <p className="research-evidence-note">{pl ? "Zapisy logicznych wiadomości przed próbą wysłania. Nie potwierdzają wysłania, odbioru przez serwer ani zgodności z końcowym żądaniem HTTP. Wyświetlane skróty pochodzą z zapisów; ten podgląd nie weryfikuje ich kryptograficznie." : "Logical messages recorded before a dispatch attempt. These records do not prove dispatch, server receipt, or the final HTTP payload. Displayed hashes come from stored records; this view does not verify them cryptographically."}</p>
    {!current && <p role="status">{pl ? "Wczytywanie dowodów wywołań…" : "Loading request evidence…"}</p>}
    {current?.status === "error" && <div className="provider-error" role="alert"><strong>{pl ? "Nie udało się wczytać dowodów wywołań." : "Could not load request evidence."}</strong><div>{current.error}</div></div>}
    {current?.status === "ready" && current.ignored > 0 && records.length > 0 && <p role="status">{pl ? "Pominięte nieczytelne lub obce zapisy dowodów:" : "Unreadable or unrelated evidence records omitted:"} {current.ignored}</p>}
    {current?.status === "ready" && records.length === 0 && <p role="status">{current.ignored > 0
      ? (pl ? `Brak czytelnych dowodów dla tej sesji. Pominięto ${current.ignored} zapisów.` : `No readable evidence for this session. ${current.ignored} records omitted.`)
      : (pl ? "Brak zapisanych dowodów wywołań dla tej sesji." : "No request evidence records are stored for this session.")}</p>}
    {records.length > 0 && <>
      <div className="research-lock-controls">
        <span><small>{pl ? "Logiczne wywołania" : "Logical requests"}</small><strong>{summary.logicalRequests}</strong></span>
        <span><small>{pl ? "Fizyczne próby" : "Physical attempts"}</small><strong>{summary.physicalAttempts}</strong></span>
        <span><small>{pl ? "Ponowienia transportu" : "Transport retries"}</small><strong>{summary.transportRetries}</strong></span>
        <span><small>{pl ? "Próby odzyskiwania" : "Recovery attempts"}</small><strong>{summary.recoveryAttempts}</strong></span>
      </div>
      <div className="research-component-results">
        {records.map((record) => <details key={record.eventId}>
          <summary>
            {record.stepId ?? (pl ? "krok nieznany" : "unknown step")} · {pl ? "próba" : "attempt"} {record.physicalAttempt ?? "?"} · {record.evidence.messagesSha256.slice(0, 12)}…
          </summary>
          <dl className="research-evidence-metadata">
            <dt>{pl ? "ID wywołania logicznego" : "Logical request ID"}</dt><dd>{record.logicalRequestId ?? "—"}</dd>
            <dt>{pl ? "ID próby fizycznej" : "Physical attempt ID"}</dt><dd>{record.physicalAttemptId ?? "—"}</dd>
            <dt>{pl ? "Poziom odzyskiwania" : "Recovery level"}</dt><dd>{record.recoveryLevel ?? "—"}</dd>
            <dt>{pl ? "Próba semantyczna" : "Semantic attempt"}</dt><dd>{record.semanticAttempt ?? "—"}</dd>
            <dt>{pl ? "Żądany limit tokenów wyjścia" : "Requested output token limit"}</dt><dd>{record.evidence.requestedMaxOutputTokens ?? "—"}</dd>
            <dt>{pl ? "Efektywny limit tokenów wyjścia" : "Effective output token limit"}</dt><dd>{record.evidence.effectiveMaxOutputTokens ?? "—"}</dd>
            <dt>SHA-256</dt><dd><code>{record.evidence.messagesSha256}</code></dd>
          </dl>
          {record.evidence.messages.map((message, index) => <div key={`${record.eventId}-${index}`}>
            <small>{message.index + 1}. {roleLabel(message.role)} · SHA-256: <code>{message.sha256}</code></small>
            <pre>{message.content}</pre>
          </div>)}
        </details>)}
      </div>
    </>}
  </section>;
}
