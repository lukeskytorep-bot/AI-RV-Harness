import { useEffect, useState } from "react";

import {
  parseResearchContextRequestEvidenceEvents,
  summarizeResearchContextRequestEvidence,
  type ResearchContextRequestEvidenceRecord,
} from "../../research/contextRequestEvidence";
import type { AppRepository } from "../../storage/repository";

export function ResearchContextEvidencePanel({ repository, sessionId, pl }: { repository: AppRepository; sessionId: string; pl: boolean }) {
  const [records, setRecords] = useState<ResearchContextRequestEvidenceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecords([]);
    setError(null);
    void repository.listSessionEvents(sessionId).then((events) => {
      if (!cancelled) setRecords(parseResearchContextRequestEvidenceEvents(events));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [repository, sessionId]);

  const summary = summarizeResearchContextRequestEvidence(records);
  return <section className="panel research-context-evidence">
    <div className="research-section-head">
      <strong>{pl ? "Dowód requestów Context & Instructions" : "Context & Instructions request evidence"}</strong>
      <small>{summary.physicalAttempts} {pl ? "fizycznych prób" : "physical attempts"}</small>
    </div>
    {error && <div className="provider-error">{error}</div>}
    {!error && records.length === 0 && <p>{pl ? "Brak zapisanych rekordów request evidence dla tej sesji." : "No request evidence records are stored for this session."}</p>}
    {records.length > 0 && <>
      <div className="research-lock-controls">
        <span><small>{pl ? "Logiczne requesty" : "Logical requests"}</small><strong>{summary.logicalRequests}</strong></span>
        <span><small>{pl ? "Fizyczne próby" : "Physical attempts"}</small><strong>{summary.physicalAttempts}</strong></span>
        <span><small>{pl ? "Retry transportu" : "Transport retries"}</small><strong>{summary.transportRetries}</strong></span>
        <span><small>{pl ? "Próby recovery" : "Recovery attempts"}</small><strong>{summary.recoveryAttempts}</strong></span>
      </div>
      <div className="research-component-results">
        {records.map((record) => <details key={record.eventId}>
          <summary>
            {record.stepId ?? (pl ? "krok nieznany" : "unknown step")} · {pl ? "próba" : "attempt"} {record.physicalAttempt ?? "?"} · {record.evidence.messagesSha256.slice(0, 12)}…
          </summary>
          <small>
            logicalRequestId: {record.logicalRequestId ?? "—"} · physicalAttemptId: {record.physicalAttemptId ?? "—"} · recoveryLevel: {record.recoveryLevel ?? "—"} · semanticAttempt: {record.semanticAttempt ?? "—"}
          </small>
          {record.evidence.messages.map((message) => <div key={`${record.eventId}-${message.index}`}>
            <small>{message.index + 1}. {message.role} · {message.sha256.slice(0, 12)}…</small>
            <pre>{message.content}</pre>
          </div>)}
        </details>)}
      </div>
    </>}
  </section>;
}
