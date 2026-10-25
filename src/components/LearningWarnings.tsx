import { learningWarningText, type LearningSettlement } from "../aiCenter/learningExecution";

/** Optional memory failures stay available without taking over the run controls. */
export function LearningWarnings({ settlements, pl }: { settlements: LearningSettlement[]; pl: boolean }) {
  const warnings = [...new Map(settlements.filter(value => value.settlement === "failed_preserved").map(value => [value.auditId, value])).values()];
  if (!warnings.length) return null;
  return <details className="learning-warnings muted">
    <summary>{pl ? `Nieudane aktualizacje pamięci: ${warnings.length}` : `Failed memory updates: ${warnings.length}`}</summary>
    <ul>{warnings.map(value => <li key={value.auditId}>{learningWarningText(value, pl)} <small>{pl ? "Sesja" : "Session"}: {value.sessionId}</small></li>)}</ul>
  </details>;
}
