import { useEffect, useState } from "react";
import type { AppRepository } from "../../storage/repository";
import type { ResearchProjectRecord } from "../../research/types";
import type { JudgeScoreRecord } from "../../judge/types";
import { currentJudgeCompletionId } from "../../research/judgeRequestRecovery";

interface Row { sessionId: string; anonymousId: string; scores: JudgeScoreRecord[]; missing: Array<{ index: number; reason?: string }>; }
export function ResearchPartialScores({ repository, project, pl, revision }: { repository: AppRepository; project: ResearchProjectRecord; pl: boolean; revision: string }) {
  const [rows, setRows] = useState<Row[]>([]), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [assignments, models] = await Promise.all([repository.listResearchAssignments(project.id), repository.listProviderModels()]);
        const next = await Promise.all(assignments.filter(a => a.sessionId).map(async assignment => {
          const [scores, events] = await Promise.all([repository.listJudgeScores(assignment.sessionId!), repository.listSessionEvents(assignment.sessionId!)]);
          const missing = project.config.judges.flatMap((judge, i) => {
            if (scores.some(score => score.judgeIndex === i + 1 && score.frozenAt)) return [];
            const route = models.find(m => m.providerConfigId === judge.providerConfigId && m.modelId === judge.modelId)?.route;
            const id = route ? currentJudgeCompletionId(events, route, i + 1) : undefined;
            const failure = events.filter(e => e.metadata?.modelRoute === route && e.metadata?.completionId === id && (e.metadata?.judgeIndex === i + 1 || !e.metadata?.judgeIndex)
              && (e.eventType === "RESEARCH_JUDGE_VALIDATION_BLOCK" || e.eventType === "RESEARCH_JUDGE_REQUEST_V1" && ["failed", "paused"].includes(String(e.metadata?.status)))).at(-1);
            return [{ index: i + 1, reason: failure?.content || (failure ? (pl ? "Nieukończone wywołanie dostawcy" : "Provider request incomplete") : undefined) }];
          });
          return { sessionId: assignment.sessionId!, anonymousId: assignment.anonymousSessionId, scores, missing };
        }));
        if (!cancelled) { setRows(next); setError(""); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    void load();
    return () => { cancelled = true; };
  }, [repository, project.id, project.state, revision, pl]);
  const expected = rows.length * project.config.judges.length, received = rows.reduce((n, row) => n + row.scores.length, 0);
  const complete = rows.filter(r => !r.missing.length).length, partial = rows.filter(r => r.missing.length && r.scores.length).length;
  return <section className="panel research-partial-scores">
    <strong>{pl ? "Oceny częściowe" : "Partial scores"}</strong>
    <p role="status">{pl ? "Sesje RV" : "RV sessions"}: {rows.length}. {pl ? "Oceny" : "Scores"}: {received}/{expected}. {pl ? "W pełni oceniono" : "Fully judged"}: {complete}; {pl ? "częściowo" : "partially"}: {partial}.</p>
    <p>{pl ? "Zapisane oceny są zachowane. To wyniki częściowe, nie końcowy ranking badania." : "Saved scores are retained. These are partial results, not the final study ranking."}</p>
    {error && <p role="alert">{error}</p>}
    {rows.map(row => <details key={row.sessionId}><summary><code>{row.anonymousId}</code> · {row.scores.length}/{project.config.judges.length}</summary>
      {row.scores.map(score => <div key={score.judgeRunId}><strong>J{score.judgeIndex} · {score.total}/10</strong><pre>{JSON.stringify({ scores: { gestalt: score.gestalt, verifiableFeatures: score.verifiableFeatures, activityFunctionEvent: score.activityFunctionEvent, confabulationControl: score.confabulationControl }, narrative: score.narrative }, null, 2)}</pre></div>)}
      {row.missing.map(slot => <p key={slot.index}>J{slot.index} ({project.config.judges[slot.index - 1].modelId}): {slot.reason || (pl ? "Oczekuje na ocenę" : "Awaiting evaluation")}</p>)}
    </details>)}
  </section>;
}
