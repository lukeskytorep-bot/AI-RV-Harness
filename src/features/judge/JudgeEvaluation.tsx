import { useEffect, useState } from "react";
import { Check, Database, ShieldCheck } from "lucide-react";

import { aggregateJudgeScores } from "../../domain/scoring";
import type { getCopy } from "../../i18n";
import { runBlindJudging, selectMissingJudgeSelections } from "../../judge/engine";
import type { JudgingResult } from "../../judge/types";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { OrdinaryBatchSessionResult } from "../../sessions/batch";
import { isTauriRuntime } from "../../storage";
import type { AppRepository } from "../../storage/repository";
import type { InterfaceLanguage } from "../../types";
import { JudgeResults } from "../../components/JudgeResults";

export interface JudgeEvaluationProps {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository | null;
  sessionId: string;
  language: InterfaceLanguage;
  models: ProviderModel[];
  providerConfigs: ProviderConfig[];
  defaultModelKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
  onCompleted?: () => void;
}

export function JudgeEvaluation({ copy, repository, sessionId, language, models, providerConfigs, defaultModelKey, maxRetries, timeoutMs, onCompleted }: JudgeEvaluationProps) {
  const [judgeCount, setJudgeCount] = useState(1);
  const [selections, setSelections] = useState([defaultModelKey ?? "", "", ""]);
  const [result, setResult] = useState<JudgingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [addingJudges, setAddingJudges] = useState(false);
  const keyFor = (model: ProviderModel) => `${model.providerConfigId}::${model.modelId}`;
  const keyForRoute = (route: string) => {
    const model = models.find((item) => item.route === route);
    return model ? keyFor(model) : "";
  };
  const activeSelections = selections.slice(0, judgeCount).map((key) => models.find((model) => keyFor(model) === key) ?? null);
  const ready = activeSelections.every(Boolean) && activeSelections.length === judgeCount;

  useEffect(() => {
    setJudgeCount(1);
    setSelections([defaultModelKey ?? "", "", ""]);
    setAddingJudges(false);
  }, [defaultModelKey, sessionId]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    if (!repository) return () => { cancelled = true; };
    void repository.listJudgeScores(sessionId).then((scores) => {
      if (cancelled || !scores.length) return;
      setResult({ anonymousSessionId: "stored", scores, aggregate: aggregateJudgeScores(scores) });
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [repository, sessionId]);

  const evaluate = async () => {
    if (!repository || !ready || busy) return;
    const judges = activeSelections.map((model) => {
      const concreteModel = model as ProviderModel;
      const providerConfig = providerConfigs.find((provider) => provider.id === concreteModel.providerConfigId);
      if (!providerConfig) throw new Error("Judge provider connection is missing.");
      return { providerConfig, model: concreteModel };
    });
    setBusy(true);
    setError(null);
    setCompleted(0);
    try {
      const existing = await repository.listJudgeScores(sessionId);
      const missingJudges = selectMissingJudgeSelections(existing, judges);
      const next = missingJudges.length
        ? await runBlindJudging({ repository, sessionId, language, judges: missingJudges, maxRetries, timeoutMs, onProgress: (done) => setCompleted(existing.length + done) })
        : { anonymousSessionId: "stored", scores: existing, aggregate: aggregateJudgeScores(existing) };
      await repository.updateRvSessionState(sessionId, "Completed");
      setResult(next);
      setAddingJudges(false);
      onCompleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addAnotherJudge = () => {
    if (!result || result.scores.length >= 3 || busy) return;
    const existingKeys = result.scores.map((score) => keyForRoute(score.modelRoute));
    if (existingKeys.some((key) => !key)) {
      setError(language === "pl"
        ? "Nie można dodać Judge’a: trasa jednego z zapisanych Judge’ów nie jest już dostępna. Przywróć tę samą konfigurację modelu."
        : "Cannot add a Judge because a stored Judge route is no longer available. Restore the same model configuration first.");
      return;
    }
    const nextCount = result.scores.length + 1;
    setJudgeCount(nextCount);
    setSelections(Array.from({ length: 3 }, (_, index) => existingKeys[index] ?? (index === result.scores.length ? defaultModelKey ?? "" : "")));
    setAddingJudges(true);
    setError(null);
  };

  return <section className="judge-evaluation">
    <div className="judge-heading"><span><ShieldCheck size={18} /></span><div><strong>{copy.judgeEvaluation}</strong><p>{copy.judgeLead}</p></div></div>
    {(!result || addingJudges) && <>
      <div className="judge-config">
        <label><span>{copy.judgeCount}</span><select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))} disabled={busy || Boolean(result)}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
        {Array.from({ length: judgeCount }, (_, index) => <label key={index}><span>{copy.judgeModel} {index + 1}</span><select value={selections[index]} onChange={(event) => setSelections((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} disabled={busy || Boolean(result && index < result.scores.length)}><option value="">{copy.selectModel}</option>{models.map((model) => { const provider = providerConfigs.find((item) => item.id === model.providerConfigId); return <option key={keyFor(model)} value={keyFor(model)}>{provider?.label ?? model.provider} · {model.displayName}</option>; })}</select></label>)}
      </div>
      <div className="judge-actions"><small>{busy ? `${copy.judging} ${completed}/${judgeCount}` : copy.judgeRequiresModels}</small><button className="primary-button" disabled={!isTauriRuntime() || !ready || busy} onClick={() => void evaluate()}>{busy ? copy.judging : copy.runJudges}</button></div>
    </>}
    {result && <>
      <JudgeResults copy={copy} scores={result.scores} />
      {!addingJudges && result.scores.length < 3 && <button className="secondary-button" disabled={busy} onClick={addAnotherJudge}>{language === "pl" ? "Dodaj kolejnego Judge’a" : "Add another Judge"}</button>}
    </>}
    {error && <div className="provider-error">{error}</div>}
  </section>;
}

export interface BatchEvaluationProps extends Omit<JudgeEvaluationProps, "sessionId"> {
  sessions: OrdinaryBatchSessionResult[];
}

export function BatchEvaluation({ copy, repository, sessions, language, models, providerConfigs, defaultModelKey, maxRetries, timeoutMs, onCompleted }: BatchEvaluationProps) {
  const eligible = sessions.filter((session) => session.state === "Revealed" || session.state === "Completed");
  const [judgeCount, setJudgeCount] = useState(1);
  const [selections, setSelections] = useState([defaultModelKey ?? "", "", ""]);
  const [results, setResults] = useState<Array<{ sessionCode: string; result: JudgingResult }>>([]);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [savedOnly, setSavedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyFor = (model: ProviderModel) => `${model.providerConfigId}::${model.modelId}`;
  const activeSelections = selections.slice(0, judgeCount).map((key) => models.find((model) => keyFor(model) === key) ?? null);
  const ready = activeSelections.length === judgeCount && activeSelections.every(Boolean);

  useEffect(() => {
    setJudgeCount(1);
    setSelections([defaultModelKey ?? "", "", ""]);
  }, [defaultModelKey, sessions]);

  const saveOnly = async () => {
    if (!repository || busy) return;
    setBusy(true); setError(null);
    try {
      for (const session of eligible) await repository.updateRvSessionState(session.sessionId, "Completed");
      setSavedOnly(true);
      onCompleted?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const evaluate = async () => {
    if (!repository || !ready || busy || !eligible.length) return;
    setBusy(true); setError(null); setCompleted(0); setSavedOnly(false); setResults([]);
    try {
      const judges = activeSelections.map((model) => {
        const concreteModel = model as ProviderModel;
        const providerConfig = providerConfigs.find((provider) => provider.id === concreteModel.providerConfigId);
        if (!providerConfig) throw new Error("Judge provider connection is missing.");
        return { providerConfig, model: concreteModel };
      });
      const reveals = await Promise.all(eligible.map((session) => repository.getReveal(session.sessionId)));
      const imageRequired = reveals.some((reveal) => reveal?.artifactManifest?.some((artifact) => artifact.mimeType.startsWith("image/")));
      if (imageRequired && judges.some((judge) => !judge.model.capabilities.supportsVision || !judge.model.capabilities.inputModalities.includes("image"))) {
        throw new Error("Vision Judge preflight failed: every selected Judge route must advertise image input support.");
      }
      const nextResults: Array<{ sessionCode: string; result: JudgingResult }> = [];
      for (let index = 0; index < eligible.length; index += 1) {
        const session = eligible[index];
        const existing = await repository.listJudgeScores(session.sessionId);
        const missingJudges = selectMissingJudgeSelections(existing, judges);
        const result = missingJudges.length
          ? await runBlindJudging({ repository, sessionId: session.sessionId, language, judges: missingJudges, maxRetries, timeoutMs })
          : { anonymousSessionId: "stored", scores: existing, aggregate: aggregateJudgeScores(existing) };
        if (result.scores.length !== judgeCount) throw new Error("Judge score set is incomplete after recovery.");
        await repository.updateRvSessionState(session.sessionId, "Completed");
        nextResults.push({ sessionCode: session.sessionCode, result });
        setResults([...nextResults]);
        setCompleted(index + 1);
      }
      onCompleted?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <section className="judge-evaluation batch-evaluation"><div className="judge-heading"><span><Database size={18} /></span><div><strong>{copy.batchEvaluation}</strong><p>{copy.batchEvaluationLead}</p></div></div><div className="batch-session-summary">{sessions.map((session) => <span key={session.sessionId}><code>{session.sessionCode}</code><small>{session.state}</small></span>)}</div>{!results.length && !savedOnly && <><div className="judge-config"><label><span>{copy.judgeCount}</span><select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))} disabled={busy}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>{Array.from({ length: judgeCount }, (_, index) => <label key={index}><span>{copy.judgeModel} {index + 1}</span><select value={selections[index]} onChange={(event) => setSelections((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} disabled={busy}><option value="">{copy.selectModel}</option>{models.map((model) => { const provider = providerConfigs.find((item) => item.id === model.providerConfigId); return <option key={keyFor(model)} value={keyFor(model)}>{provider?.label ?? model.provider} · {model.displayName}</option>; })}</select></label>)}</div><div className="batch-evaluation-actions"><button className="secondary-button" disabled={busy || !eligible.length} onClick={() => void saveOnly()}>{copy.saveOnly}</button><button className="primary-button" disabled={!isTauriRuntime() || !ready || busy || !eligible.length} onClick={() => void evaluate()}>{busy ? `${copy.judging} ${completed}/${eligible.length}` : copy.runBatchJudges}</button></div></>}{savedOnly && <div className="reveal-success"><Check size={16} /><div><strong>{copy.batchSaved}</strong><p>{copy.completedSessions}: {eligible.length}</p></div></div>}{results.length > 0 && <div className="batch-score-table">{results.map(({ sessionCode, result }) => <div key={sessionCode}><code>{sessionCode}</code><strong>{result.aggregate.mean.total.toFixed(2)} / 10</strong><small>{result.scores.length} Judge</small></div>)}</div>}{error && <div className="provider-error">{error}</div>}</section>;
}
