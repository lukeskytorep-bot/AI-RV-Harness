import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, Check, CircleStop, Database, Download, FileCheck2, GraduationCap, Play, ShieldCheck } from "lucide-react";
import type { getCopy } from "../../i18n";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { resolveSessionLanguage } from "../../domain/localization";
import { findCredentialScopedModelByRouteKey, findModelByRouteKey, modelRouteKeyFor, resolveViewerDefault } from "../../modelRoutes";
import { ModelRouteSelect } from "../../components/ModelRouteSelect";
import { PageHeader } from "../../components/PageHeader";
import { useAppDialogs } from "../../components/AppDialogProvider";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import { resolveTechnicalWorkspaceForProfile } from "../../application/technicalWorkspace";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import type { AppRepository } from "../../storage/repository";
import { isTauriRuntime } from "../../storage";
import { chooseDirectory } from "../../storage/native";
import {
  TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
  validateFactoryTrainingPack,
  type TrainingCategory,
} from "../../targets/bundled";
import type { TargetRecord, TargetUsageRecord } from "../../targets/types";
import { localizedTargetTitle } from "../../targets/localization";
import {
  baselineTrainingViewerCallsPerSession,
  buildTrainingAvailability,
  FACTORY_CURRICULUM_ID,
  FACTORY_CURRICULUM_VERSION,
  FACTORY_ROUND_SIZE,
  maxFullTrainingRounds,
  limitingFactoryCategory,
  planFactoryTrainingRun,
  selectPartialTrainingTargets,
} from "../../training/curriculum";
import { exportTrainingRun } from "../../training/export";
import type { TrainingRunRecord } from "../../training/types";
import type { AppSettings, Profile, Workspace } from "../../types";
import { SessionInspection } from "../../components/SessionInspection";
import { executeTrainingRun } from "./trainingExecution";

type Copy = ReturnType<typeof getCopy>;
type Mode = "full" | "partial";

export function factoryPackAllowsTrainingMode(mode: "full" | "partial", packValid: boolean): boolean {
  return mode !== "full" || packValid;
}

export function TrainingScreen({ copy, settings, profiles, workspaces, repository }: {
  copy: Copy;
  settings: AppSettings;
  profiles: Profile[];
  workspaces: Workspace[];
  repository: AppRepository | null;
}) {
  const pl = settings.interfaceLanguage === "pl";
  const dialogs = useAppDialogs();
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const text = labels(pl);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const technicalWorkspace = resolveTechnicalWorkspaceForProfile(workspaces, profileId);
  const workspaceId = technicalWorkspace?.id ?? "";
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [targetUsage, setTargetUsage] = useState<TargetUsageRecord[]>([]);
  const [runs, setRuns] = useState<TrainingRunRecord[]>([]);
  const [mode, setMode] = useState<Mode>("full");
  const [roundCount, setRoundCount] = useState(1);
  const [variant, setVariant] = useState<"core" | "extended">("extended");
  const [counts, setCounts] = useState<Partial<Record<TrainingCategory, number>>>(() => Object.fromEntries(TRAINING_CATEGORIES.map((category) => [category, 0])));
  const [myTargetsCount, setMyTargetsCount] = useState(0);
  const [judgeCount, setJudgeCount] = useState(0);
  const [judgeRoutes, setJudgeRoutes] = useState(["", "", ""]);
  const [pauseAfterBlock, setPauseAfterBlock] = useState(false);
  const [viewerNotesEnabled, setViewerNotesEnabled] = useState(true);
  const [activeRun, setActiveRun] = useState<TrainingRunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [progressLine, setProgressLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<{ workspaceId: string; sessionId: string } | null>(null);
  const pauseRequested = useRef(false);
  const executionAbort = useRef<AbortController | null>(null);

  const refresh = async () => {
    if (!repository) return;
    const [nextProviders, nextModels, nextTargets, nextUsage, nextRuns] = await Promise.all([
      repository.listProviderConfigs(),
      repository.listProviderModels(),
      repository.listTargets(),
      repository.listTargetUsage(),
      repository.listTrainingRuns(),
    ]);
    setProviders(nextProviders);
    setModels(nextModels);
    setTargets(nextTargets);
    setTargetUsage(nextUsage);
    setRuns(nextRuns);
  };

  useEffect(() => { void refresh().catch((cause) => setError(errorText(cause))); }, [repository]);
  useEffect(() => () => executionAbort.current?.abort(), []);
  const provider = providers.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const viewerModels = models.filter((item) => item.providerConfigId === provider?.id);
  const viewerModelId = resolveViewerDefault(profile, provider, viewerModels);
  const viewerModel = viewerModels.find((item) => item.modelId === viewerModelId) ?? null;
  const pack = validateFactoryTrainingPack();
  const availability = useMemo(
    () => buildTrainingAvailability(targets, targetUsage, profileId, settings.targetRepeatPolicy),
    [profileId, settings.targetRepeatPolicy, targetUsage, targets],
  );
  const maxRounds = maxFullTrainingRounds(availability);
  const partialSessionCount = TRAINING_CATEGORIES.reduce((sum, category) => sum + Math.max(0, Math.floor(counts[category] ?? 0)), 0) + Math.max(0, Math.floor(myTargetsCount));
  const plannedSessionCount = mode === "full" ? roundCount * FACTORY_ROUND_SIZE : partialSessionCount;
  const partialSelectionValid = TRAINING_CATEGORIES.every((category) => Math.max(0, Math.floor(counts[category] ?? 0)) <= availability.categories[category].available)
    && Math.max(0, Math.floor(myTargetsCount)) <= availability.myTargets.available;
  const fullSelectionValid = roundCount >= 1 && roundCount <= maxRounds;
  const limitingCategory = mode === "full" ? limitingFactoryCategory(availability) : undefined;
  const selectedJudges = judgeRoutes.slice(0, judgeCount).map((key) => findCredentialScopedModelByRouteKey(key, profile?.credentialId, providers, models));
  const ready = Boolean(
    repository && profile && workspaceId && provider?.lastStatus === "ok" && viewerModel && plannedSessionCount > 0
    && selectedJudges.every(Boolean) && isTauriRuntime() && factoryPackAllowsTrainingMode(mode, pack.valid)
    && (mode === "full" ? fullSelectionValid : partialSelectionValid),
  );
  const baselineViewerCalls = plannedSessionCount * baselineTrainingViewerCallsPerSession(viewerNotesEnabled);


  const startNew = async () => {
    if (!repository || !profile || !viewerModel || !provider || !ready) return;
    if (mode === "full" && !pack.valid) {
      setError(`${text.packError}${pack.errors.length ? ` ${pack.errors.join(", ")}` : ""}`);
      return;
    }
    setError(null);
    const [latestTargets, latestUsage] = await Promise.all([repository.listTargets(), repository.listTargetUsage()]);
    let selectedTargets: TargetRecord[];
    let fullPlan: ReturnType<typeof planFactoryTrainingRun> | undefined;
    try {
      if (mode === "full") {
        fullPlan = planFactoryTrainingRun({
          targets: latestTargets,
          usage: latestUsage,
          profileId: profile.id,
          roundCount,
          repeatPolicy: settings.targetRepeatPolicy,
        });
        const byId = new Map(latestTargets.map((target) => [target.id, target]));
        selectedTargets = fullPlan.targetIds.map((id) => byId.get(id)).filter((target): target is TargetRecord => Boolean(target));
        if (selectedTargets.length !== fullPlan.targetIds.length) throw new Error("Factory Training planner selected a target that is unavailable in storage.");
      } else {
        selectedTargets = selectPartialTrainingTargets(latestTargets, counts, myTargetsCount, {
          usage: latestUsage,
          profileId: profile.id,
          repeatPolicy: settings.targetRepeatPolicy,
        });
      }
    } catch (cause) {
      setError(trainingSelectionError(cause, settings.interfaceLanguage));
      return;
    }
    if (!selectedTargets.length) { setError(text.targetsRequired); return; }

    const now = new Date();
    const run = await repository.createTrainingRun({
      name: `${text.trainingRun} ${runs.length + 1} · ${now.toLocaleDateString()}`,
      status: "Running",
      mode,
      profileId: profile.id,
      workspaceId,
      modelRoute: modelRouteKeyFor(viewerModel),
      protocolVariant: variant,
      ...(mode === "full" && fullPlan ? {
        curriculumId: FACTORY_CURRICULUM_ID,
        curriculumVersion: FACTORY_CURRICULUM_VERSION,
        plannerVersion: fullPlan.plannerVersion,
        roundSize: fullPlan.roundSize,
        roundCount: fullPlan.roundCount,
      } : {}),
      targetRepeatPolicy: settings.targetRepeatPolicy,
      targetIds: selectedTargets.map((target) => target.id),
      categories: [...new Set(selectedTargets.map((target) => target.sourceMetadata.category).filter((category): category is TrainingCategory => TRAINING_CATEGORIES.includes(category as TrainingCategory)))],
      judgeModelRoutes: judgeRoutes.slice(0, judgeCount),
      pauseAfterBlock: mode === "full" && roundCount > 1 ? pauseAfterBlock : false,
      viewerNotesEnabled,
      executionSnapshot: {
        language,
        generationSettings: profileGenerationDefaults(profile, viewerModel),
        transport: {
          maxRetries: settings.maxRetries,
          requestTimeoutMs: settings.requestTimeoutMs,
          sessionCodePrefix: settings.sessionCodePrefix,
          maxSessionCostUsd: settings.maxSessionCostUsd,
        },
      },
    });
    setActiveRun(run);
    setRuns((current) => [run, ...current]);
    setTargets(latestTargets);
    setTargetUsage(latestUsage);
    await execute(run, latestTargets);
  };

  const execute = async (initial: TrainingRunRecord, targetCatalogue: TargetRecord[] = targets) => {
    if (!repository) return;
    const runProfile = profiles.find((item) => item.id === initial.profileId);
    const runProvider = providers.find((item) => item.credentialId === runProfile?.credentialId);
    const runModel = findModelByRouteKey(initial.modelRoute, models);
    if (!runProfile || !runProvider || !runModel) { setError(text.routeMissing); return; }
    const judges = initial.judgeModelRoutes.map((key) => {
      const model = findModelByRouteKey(key, models);
      const providerConfig = providers.find((item) => item.id === model?.providerConfigId);
      if (!model || !providerConfig) throw new Error(text.judgeMissing);
      return { model, providerConfig };
    });
    pauseRequested.current = false;
    const controller = new AbortController();
    executionAbort.current = controller;
    setBusy(true); setError(null); setExportMessage(null); setActiveRun({ ...initial, status: "Running" });
    let usageRefreshCount = initial.completedTargetIds.length;
    try {
      const outcome = await executeTrainingRun({
        repository,
        initial,
        profile: runProfile,
        providerConfig: runProvider,
        model: runModel,
        judges,
        targets: targetCatalogue,
        language,
        settings,
        signal: controller.signal,
        shouldPause: () => pauseRequested.current,
        onRunChange: (nextRun) => {
          setActiveRun(nextRun);
          if (nextRun.completedTargetIds.length > usageRefreshCount) {
            usageRefreshCount = nextRun.completedTargetIds.length;
            void repository.listTargetUsage().then(setTargetUsage).catch(() => undefined);
          }
        },
        onProgress: ({ index, total, target, sessionProgress }) => setProgressLine(`${text.session} ${index + 1}/${total} · ${localizedTargetTitle(target, language)}${sessionProgress ? ` · ${sessionProgress.state}${sessionProgress.phase ? ` · ${text.step} ${sessionProgress.phase}/4` : ""}` : ""}`),
      });
      if (outcome.run.status === "Paused") setProgressLine(text.pausedCheckpoint);
      if (outcome.run.status === "Completed") setProgressLine(text.completed);
      if (outcome.error) setError(outcome.error);
      await refresh();
    } finally {
      if (executionAbort.current === controller) executionAbort.current = null;
      setBusy(false);
    }
  };

  const archiveExisting = async (run: TrainingRunRecord) => {
    if (!repository) return;
    const confirmed = await dialogs.confirm({
      title: text.archiveTraining,
      description: text.archiveTrainingLead,
      details: [`#${run.runNumber} · ${run.name}`, `${run.sessionIds?.length ?? 0} ${text.sessions.toLowerCase()}`],
      confirmLabel: text.archive,
      cancelLabel: copy.cancel,
      severity: "warning",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await repository.archiveTrainingRun(run.id);
      if (activeRun?.id === run.id) setActiveRun(null);
      if (expandedRunId === run.id) setExpandedRunId(null);
      if (selectedSession && run.sessionIds.includes(selectedSession.sessionId)) setSelectedSession(null);
      await refresh();
    } catch (cause) { setError(errorText(cause)); }
  };

  const exportExisting = async (run: TrainingRunRecord) => {
    if (!repository || !isTauriRuntime() || !run.sessionIds?.length) return;
    const destination = await chooseDirectory(text.chooseExportFolder);
    if (!destination) return;
    setError(null);
    try {
      const directoryPath = await exportTrainingRun(repository, run, targets, language, destination);
      await repository.updateTrainingRun(run.id, { directoryPath });
      setExportMessage(`${text.exported}: ${directoryPath}`);
      await refresh();
    } catch (cause) { setError(errorText(cause)); }
  };

  return <div className="page training-page">
    <PageHeader title={text.training} subtitle={text.lead} />
    <TrainingHelpPanel pl={pl} packTotal={pack.total} packValid={pack.valid} />
    <div className="training-layout">
      <section className="panel training-config">
        <TrainingSection title={text.identity}>
          <div className="training-grid"><label>{text.aiIsBe}<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{aiIsBeDisplayName(item)}</option>)}</select></label></div>
          <div className="training-viewer-row">
            <div className="training-viewer-model-card" role="group" aria-label={text.viewerModel}>
              <span>{text.viewerModel}</span>
              <strong>{provider?.label ?? text.noProvider}</strong>
              <small>{viewerModel?.displayName ?? text.noModel}</small>
            </div>
            <label className="training-viewer-notes-card" title={text.viewerNotesHelp}>
              <input type="checkbox" checked={viewerNotesEnabled} onChange={(event) => setViewerNotesEnabled(event.target.checked)} />
              <span><strong>{text.useViewerNotes}</strong><small>{text.enabledByDefault}</small></span>
            </label>
          </div>
        </TrainingSection>
        <TrainingSection title={text.protocol}><div className="training-choice-row"><button className={variant === "core" ? "active" : ""} onClick={() => setVariant("core")}><FileCheck2 size={18} /><span><strong>RV Lite Core</strong><small>{text.coreLead}</small></span></button><button className={variant === "extended" ? "active" : ""} onClick={() => setVariant("extended")}><GraduationCap size={18} /><span><strong>RV Lite Extended</strong><small>{text.extendedLead}</small></span></button></div></TrainingSection>
        <TrainingSection title={text.scope}><div className="training-choice-row"><button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}><Database size={18} /><span><strong>{text.full}</strong><small>{text.fullLead}</small></span></button><button className={mode === "partial" ? "active" : ""} onClick={() => setMode("partial")}><ShieldCheck size={18} /><span><strong>{text.partial}</strong><small>{text.partialLead}</small></span></button></div></TrainingSection>
        {mode === "full" && <TrainingSection title={text.rounds}>
          <div className="training-round-control">
            <label><span>{text.roundCount}</span><input type="number" min={1} max={Math.max(1, maxRounds)} value={roundCount} onChange={(event) => setRoundCount(Math.max(1, Math.min(10, Math.floor(Number(event.target.value) || 1))))} /></label>
            <small>{text.roundRange} · {text.dynamicMaximum}: {maxRounds}</small>
          </div>
          <div className="training-category-grid training-availability-grid">{TRAINING_CATEGORIES.map((category) => <div className="training-availability-item" key={category}><span>{TRAINING_CATEGORY_LABELS[category][settings.interfaceLanguage]}<small>{formatTrainingAvailability(availability.categories[category], settings.targetRepeatPolicy, pl)}</small></span></div>)}<div className="training-availability-item training-my-targets"><span>{text.user}<small>{formatTrainingAvailability(availability.myTargets, settings.targetRepeatPolicy, pl)} · {text.partialOnly}</small></span></div></div>
          {!fullSelectionValid && <div className="training-requirement-note"><ShieldCheck size={15} /><span>{maxRounds === 0 ? `${text.noRoundsAvailable}${limitingCategory ? ` ${TRAINING_CATEGORY_LABELS[limitingCategory][settings.interfaceLanguage]}.` : ""} ${text.noRoundsGuidance}` : `${text.roundLimit}${limitingCategory ? ` ${TRAINING_CATEGORY_LABELS[limitingCategory][settings.interfaceLanguage]}` : ""}.`}</span></div>}
        </TrainingSection>}
        {mode === "partial" && <TrainingSection title={text.categories}><div className="training-category-grid">{TRAINING_CATEGORIES.map((category) => { const pool = availability.categories[category]; return <label key={category}><span>{TRAINING_CATEGORY_LABELS[category][settings.interfaceLanguage]}<small>{formatTrainingAvailability(pool, settings.targetRepeatPolicy, pl)}</small></span><input type="number" min={0} max={pool.available} value={counts[category] ?? 0} onChange={(event) => setCounts((current) => ({ ...current, [category]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} /></label>; })}<label className="training-my-targets"><span>{text.user}<small>{formatTrainingAvailability(availability.myTargets, settings.targetRepeatPolicy, pl)}</small></span><input type="number" min={0} max={availability.myTargets.available} value={myTargetsCount} onChange={(event) => setMyTargetsCount(Math.max(0, Math.floor(Number(event.target.value) || 0)))} /></label></div></TrainingSection>}
        <TrainingSection title="AI Judge"><div className="training-grid two"><label>{text.judgeCount}<select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))}><option value={0}>0 · {text.none}</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>{Array.from({ length: judgeCount }, (_, index) => <label key={index}>Judge {index + 1}<ModelRouteSelect role="judge" profile={profile} providers={providers} models={models} value={judgeRoutes[index]} onChange={(next) => setJudgeRoutes((current) => current.map((value, itemIndex) => itemIndex === index ? next : value))} emptyLabel={text.selectModel} /></label>)}</div></TrainingSection>
        <TrainingSection title={text.execution}>{mode === "full" && roundCount > 1 && <label className="training-check"><input type="checkbox" checked={pauseAfterBlock} onChange={(event) => setPauseAfterBlock(event.target.checked)} /><span><strong>{text.pauseRounds}</strong><small>{text.pauseRoundsLead}</small></span></label>}<div className="training-preflight"><span><small>{text.sessions}</small><strong>{plannedSessionCount}</strong></span><span><small>{text.viewerCalls}</small><strong>{baselineViewerCalls}</strong></span><span><small>{text.judgeCalls}</small><strong>{plannedSessionCount * judgeCount}</strong></span><span><small>{text.curriculum}</small><strong>{mode === "full" ? `${FACTORY_CURRICULUM_ID}:${FACTORY_CURRICULUM_VERSION} · ${roundCount}×${FACTORY_ROUND_SIZE}` : text.partial}</strong></span><span><small>{text.repeatPolicy}</small><strong>{settings.targetRepeatPolicy === "avoid_profile" ? text.avoidProfile : text.allowRepeat}</strong></span><span><small>{text.costCeiling}</small><strong>{settings.maxSessionCostUsd > 0 ? `≤ $${(plannedSessionCount * settings.maxSessionCostUsd).toFixed(2)} ${text.rvOnly}` : text.notConfigured}</strong></span></div><small className="training-preflight-note">{text.viewerCallNote}</small></TrainingSection>
        <div className="training-actions">{busy ? <><button className="secondary-button" onClick={() => { pauseRequested.current = true; }}><CircleStop size={15} />{text.pauseAfterSession}</button><span>{progressLine}</span></> : <span className="disabled-action-help" title={!workspaceId ? text.workspaceRequired : plannedSessionCount <= 0 ? text.targetsRequired : !fullSelectionValid && mode === "full" ? text.noRoundsAvailable : undefined}><button className="primary-button" disabled={!ready} onClick={() => void startNew()}><Play size={15} />{mode === "full" ? `${text.startFull} · ${plannedSessionCount}` : `${text.startPartial} · ${plannedSessionCount}`}</button></span>}</div>
        {!workspaceId && <div className="training-requirement-note"><ShieldCheck size={15} /><span>{text.workspaceRequired}</span></div>}
        {error && <div className="provider-error">{error}</div>}{exportMessage && <div className="storage-success"><Check size={14} />{exportMessage}</div>}
      </section>
      <aside className="training-runs panel"><div className="panel-header"><span><Database size={18} /></span><h2>{text.history}</h2></div>{activeRun && <div className="active-training-run"><strong>{activeRun.name}</strong><span>{activeRun.completedTargetIds.length}/{activeRun.targetIds.length}</span><progress max={activeRun.targetIds.length} value={activeRun.completedTargetIds.length} /><small>{progressLine || activeRun.status}</small></div>}<div className="training-run-list">{runs.map((run) => <article key={run.id} className={expandedRunId === run.id ? "expanded" : ""}><div className="training-run-meta"><strong>#{run.runNumber} · {run.name}</strong><small>{run.status} · {run.completedTargetIds.length}/{run.targetIds.length} · Lite {run.protocolVariant}</small></div>{(run.status === "Paused" || run.status === "Interrupted" || run.status === "Running") && !busy && run.currentIndex < run.targetIds.length && <button className="secondary-button training-resume-button" onClick={() => void execute(run)}><Play size={13} />{text.resume}</button>}<div className="training-run-actions">{Boolean(run.sessionIds?.length) && <button className="secondary-button" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)}>{text.showSessions}</button>}{Boolean(run.sessionIds?.length) && <button className="secondary-button" title={text.export} onClick={() => void exportExisting(run)}><Download size={14} />{text.saveTraining}</button>}<button className="secondary-button" disabled={busy && activeRun?.id === run.id} title={text.archiveTraining} onClick={() => void archiveExisting(run)}><Archive size={14} />{text.archive}</button></div>{expandedRunId === run.id && <div className="training-session-links">{run.sessionIds.map((sessionId, index) => <button key={sessionId} className={selectedSession?.sessionId === sessionId ? "active" : ""} onClick={() => setSelectedSession({ workspaceId: run.workspaceId, sessionId })}>{text.session} {index + 1} · {run.completedTargetIds[index] ?? sessionId}</button>)}</div>}</article>)}</div>{!runs.length && <p className="recent-session-empty">{text.noRuns}</p>}</aside>
    </div>
    {selectedSession && repository && <SessionInspection repository={repository} workspaceId={selectedSession.workspaceId} sessionId={selectedSession.sessionId} language={language} />}
  </div>;
}

function TrainingHelpPanel({ pl, packTotal, packValid }: { pl: boolean; packTotal: number; packValid: boolean }) {
  return <details className="training-help-panel">
    <summary>
      <span className="training-help-title"><GraduationCap size={20} /><strong>{pl ? "Jak działa AI Training?" : "How does AI Training work?"}</strong></span>
      <span className={packValid ? "status-chip ready" : "status-chip next"}>{packTotal}/94</span>
    </summary>
    <div className="training-help-content">{pl ? <PolishTrainingHelp /> : <EnglishTrainingHelp />}</div>
  </details>;
}

function PolishTrainingHelp() {
  return <>
    <p>AI Training pozwala Viewerowi zdobywać doświadczenie podczas kontrolowanych sesji RV i na tej podstawie rozwijać własny Field Guide oraz Viewer Notes. Każda sesja treningowa jest wykonywana jako pełna sesja blind, a cel zostaje ujawniony dopiero po zakończeniu i zapieczętowaniu części ślepej.</p>
    <section><h3>Full Training</h3><p>Jeden przebieg Full Training składa się z 8 sesji — po jednej z każdej fabrycznej kategorii celów. Dla każdego przebiegu aplikacja losuje zarówno cel z każdej kategorii, jak i kolejność wszystkich ośmiu sesji.</p><p>Możesz wybrać od 1 do 10 przebiegów:</p><ul><li>1 przebieg — 8 sesji;</li><li>2 przebiegi — 16 sesji;</li><li>5 przebiegów — 40 sesji;</li><li>10 przebiegów — 80 sesji.</li></ul><p>Wszystkie cele i ich kolejność są ustalane oraz zapisywane przed rozpoczęciem treningu. Jeżeli trening zostanie przerwany, funkcja Resume kontynuuje dokładnie ten sam plan — cele nie są ponownie losowane.</p><p>Cele dodane przez użytkownika nie uczestniczą w Full Training. Aby trenować z własnymi celami, użyj Partial Training.</p></section>
    <section><h3>Powtarzanie celów</h3><p>Domyślnie aplikacja unika celów, które były już wcześniej używane przez wybrany Profil. Ustawienie to można zmienić w Settings.</p><p>Przy każdej kategorii widoczna jest informacja, ile celów pozostało do wykorzystania, na przykład:</p><p><strong>Pozostało 5 z 10</strong></p><p>Pierwsza liczba oznacza liczbę celów, których wybrany Profil jeszcze nie używał, a druga — wszystkie cele dostępne w tej kategorii.</p><p>Jeżeli zezwolisz na ponowne używanie celów, cała pula stanie się ponownie dostępna i licznik może pokazywać na przykład:</p><p><strong>Dostępne 10 z 10</strong></p><p>Aplikacja nie włączy powtórek po cichu. Jeżeli przy włączonym unikaniu powtórek w jednej z wymaganych kategorii zabraknie celu, otrzymasz informację, która kategoria wymaga nowych celów albo zmiany ustawienia.</p></section>
    <section><h3>Pauza i Resume</h3><p>Trening można zatrzymać po zakończeniu aktualnej sesji. Przy treningu obejmującym kilka przebiegów można również włączyć automatyczną pauzę po każdym pełnym przebiegu, czyli po każdych 8 sesjach.</p><p>Każda ukończona część jest zapisywana w trwałym checkpoincie. Po użyciu Resume aplikacja nie powtarza ukończonych sesji, analiz ani zaakceptowanych aktualizacji.</p></section>
    <section><h3>Jak Viewer uczy się po sesji?</h3><p>Po zakończeniu części blind i ujawnieniu celu Viewer przechodzi przez następujące etapy:</p><ol><li><strong>Post-Reveal Review</strong> — porównuje zapieczętowany zapis sesji z ujawnionym celem i ocenia, co było trafne, częściowo trafne albo nietrafne.</li><li><strong>Field Guide Update</strong> — sprawdza, czy doświadczenia z tej sesji uzasadniają zmianę jego osobistego Field Guide.</li><li><strong>Viewer Notes Reflection</strong> — zapisuje praktyczne obserwacje i doświadczenia, które mogą pomóc mu w kolejnych sesjach.</li><li><strong>AI Judge</strong> — jeżeli został włączony, ocenia zakończoną sesję, ale nie zmienia Field Guide ani Viewer Notes.</li></ol></section>
    <section><h3>Field Guide</h3><p>Field Guide opisuje, w jaki sposób dany Viewer osobiście odbiera i rozróżnia elementy pola — na przykład osoby, struktury, góry, wodę, ruch albo aktywność.</p><p>Podczas aktualizacji Viewer otrzymuje dokładny Field Guide użyty w zakończonej sesji, własną analizę tej sesji oraz odpowiednią wersję AI Field Perception Lexicon. Leksykon pomaga mu zrozumieć i uporządkować zaobserwowane wrażenia, ale nie zastępuje jego własnego doświadczenia.</p><p>Viewer może:</p><ul><li>zachować dotychczasowy Field Guide bez zmian;</li><li>poprawić wskazówki, które okazały się mylące;</li><li>opisać nowe wrażenia, odczucia lub zaobserwowane elementy pola;</li><li>usunąć rozróżnienia, które nie pomagają mu w kolejnych sesjach.</li></ul><p>Field Guide nie służy do zapisywania ogólnych instrukcji protokołu, historii sesji ani zwykłych notatek proceduralnych.</p></section>
    <section><h3>Viewer Notes</h3><p>Viewer Notes są osobistymi notatkami roboczymi Viewera. Mogą zawierać praktyczne obserwacje dotyczące jego sposobu pracy, popełnionych błędów, skutecznych strategii oraz rzeczy, o których powinien pamiętać podczas przyszłych sesji.</p><p>Podczas Reflection Viewer otrzymuje również swój aktualny Field Guide oraz dokładny system prompt użyty w zakończonej sesji. Dzięki temu może unikać powtarzania w Viewer Notes informacji, które są już zapisane w Field Guide, Locked Core Identity, Locked Base Vocabulary albo instrukcjach protokołu.</p><p>Field Guide i Viewer Notes są dwoma oddzielnymi pakietami wiedzy i nie powinny wzajemnie kopiować swojej zawartości.</p></section>
    <section><h3>Gdzie wykorzystywane są wyniki treningu?</h3><p>Wytrenowane Field Guide i Viewer Notes mogą być używane w kolejnych RV Sessions oraz w kontrolowanych badaniach Research.</p><p>Poza Training są one używane wyłącznie w zapisanej lub zamrożonej postaci. Zwykła RV Session ani Research nie mogą samodzielnie aktualizować Field Guide lub Viewer Notes.</p><p>Research może porównywać działanie wybranych wersji, ale nie zmienia ich w trakcie eksperymentu. Wcześniejsze wersje można przeglądać i przywracać przy użyciu kontrolowanej historii w AI Center.</p><p>Field Guide i Viewer Notes są rozwijane przez Viewera, dlatego nie są przeznaczone do bezpośredniej ręcznej edycji. Użytkownik zachowuje kontrolę nad wyborem pojemności, historią wersji, przywracaniem wcześniejszych wersji oraz całym Profilem.</p></section>
  </>;
}

function EnglishTrainingHelp() {
  return <>
    <p>AI Training allows the Viewer to gain experience through controlled RV sessions and use that experience to develop its own Field Guide and Viewer Notes. Each training session is performed as a complete blind session, and the target is revealed only after the blind portion has ended and been sealed.</p>
    <section><h3>Full Training</h3><p>One Full Training round consists of 8 sessions — one from each factory target category. For every round, the application randomizes both the target selected from each category and the order of all eight sessions.</p><p>You can select from 1 to 10 rounds:</p><ul><li>1 round — 8 sessions;</li><li>2 rounds — 16 sessions;</li><li>5 rounds — 40 sessions;</li><li>10 rounds — 80 sessions.</li></ul><p>All targets and their order are determined and saved before Training begins. If Training is interrupted, Resume continues the exact same plan — the targets are not randomized again.</p><p>User-added targets are not included in Full Training. To train with your own targets, use Partial Training.</p></section>
    <section><h3>Reusing targets</h3><p>By default, the application avoids targets that have already been used by the selected Profile. This behavior can be changed in Settings.</p><p>Each category shows how many targets remain available for use, for example:</p><p><strong>5 of 10 remaining</strong></p><p>The first number is the number of targets that the selected Profile has not used yet, and the second is the total number of targets available in that category.</p><p>If you allow targets to be reused, the entire pool becomes available again and the counter may show, for example:</p><p><strong>10 of 10 available</strong></p><p>The application will not silently enable reuse. If a required category has no remaining target while target reuse is disabled, you will be told which category requires new targets or a change in Settings.</p></section>
    <section><h3>Pause and Resume</h3><p>Training can be paused after the current session has finished. When Training contains multiple rounds, you can also enable an automatic pause after every complete round, which means after every 8 sessions.</p><p>Every completed part is saved in a durable checkpoint. After Resume is used, the application does not repeat completed sessions, analyses, or accepted updates.</p></section>
    <section><h3>How does the Viewer learn after a session?</h3><p>After the blind portion has ended and the target has been revealed, the Viewer proceeds through the following stages:</p><ol><li><strong>Post-Reveal Review</strong> — compares the sealed session record with the revealed target and evaluates what was accurate, partly accurate, or inaccurate.</li><li><strong>Field Guide Update</strong> — determines whether the experience from this session justifies changing its personal Field Guide.</li><li><strong>Viewer Notes Reflection</strong> — records practical observations and experiences that may help in future sessions.</li><li><strong>AI Judge</strong> — when enabled, evaluates the completed session but does not modify the Field Guide or Viewer Notes.</li></ol></section>
    <section><h3>Field Guide</h3><p>The Field Guide describes how a particular Viewer personally perceives and distinguishes elements of the field — for example people, structures, mountains, water, movement, or activity.</p><p>During an update, the Viewer receives the exact Field Guide used in the completed session, its own review of that session, and the appropriate version of the AI Field Perception Lexicon. The Lexicon helps it understand and organize the observed impressions, but it does not replace the Viewer's own experience.</p><p>The Viewer may:</p><ul><li>keep the existing Field Guide unchanged;</li><li>correct guidance that proved misleading;</li><li>describe new impressions, sensations, or observed elements of the field;</li><li>remove distinctions that do not help in future sessions.</li></ul><p>The Field Guide is not intended for general protocol instructions, session history, or ordinary procedural notes.</p></section>
    <section><h3>Viewer Notes</h3><p>Viewer Notes are the Viewer's personal working notes. They may contain practical observations about its way of working, mistakes it has made, effective strategies, and things it should remember during future sessions.</p><p>During Reflection, the Viewer also receives its current Field Guide and the exact system prompt used in the completed session. This helps it avoid repeating in Viewer Notes information that is already contained in the Field Guide, Locked Core Identity, Locked Base Vocabulary, or protocol instructions.</p><p>The Field Guide and Viewer Notes are two separate knowledge packages and should not copy each other's content.</p></section>
    <section><h3>Where are Training results used?</h3><p>The trained Field Guide and Viewer Notes may be used in later RV Sessions and controlled Research experiments.</p><p>Outside Training, they are used only in their saved or frozen form. A regular RV Session or Research experiment cannot independently update the Field Guide or Viewer Notes.</p><p>Research can compare the performance of selected versions but does not modify them during an experiment. Earlier versions can be reviewed and restored through the controlled history in AI Center.</p><p>The Field Guide and Viewer Notes are developed by the Viewer and are therefore not intended for direct manual editing. The user retains control over capacity selection, version history, restoring earlier versions, and the entire Profile.</p></section>
  </>;
}

function TrainingSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="training-section"><h3>{title}</h3>{children}</section>;
}

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

function formatTrainingAvailability(pool: { total: number; remaining: number; available: number }, repeatPolicy: AppSettings["targetRepeatPolicy"], pl: boolean): string {
  if (repeatPolicy === "avoid_profile") return pl ? `Pozostało ${pool.remaining} z ${pool.total}` : `${pool.remaining} of ${pool.total} remaining`;
  return pl ? `Dostępne ${pool.total} z ${pool.total}` : `${pool.total} of ${pool.total} available`;
}

function trainingSelectionError(cause: unknown, language: AppSettings["interfaceLanguage"]): string {
  const message = errorText(cause);
  for (const category of TRAINING_CATEGORIES) {
    if (!message.startsWith(`${category}:`)) continue;
    const label = TRAINING_CATEGORY_LABELS[category][language];
    return `${label}:${message.slice(category.length + 1)}`;
  }
  if (message.startsWith("my_targets:")) return `${language === "pl" ? "Moje cele" : "My Targets"}:${message.slice("my_targets:".length)}`;
  return message;
}

function labels(pl: boolean) {
  return pl ? {
    training: "Trening AI", lead: "Kontrolowane serie treningowe RV Lite na fabrycznych i własnych celach treningowych.", viewerModel: "Model Viewera", useViewerNotes: "Użyj Viewer Notes", enabledByDefault: "Domyślnie włączone", viewerNotesHelp: "Notatki są używane w sesji i mogą zostać zaktualizowane po Revealu i własnej ocenie Viewera. Monitor i Judge są wykluczeni.", packError: "Pakiet fabryczny nie zawiera kompletnego zestawu 94 celów:", trainingRun: "Trening", identity: "AI IS-BE", aiIsBe: "AI IS-BE", noModel: "Brak modelu Viewer", noProvider: "Brak połączenia profilu", protocol: "Wariant protokołu Lite", coreLead: "Cztery podstawowe kroki.", extendedLead: "Cztery kroki z pogłębianiem pomiędzy krokiem 3 i 4.", scope: "Zakres treningu", full: "Full Training", fullLead: "1–10 przebiegów, po jednej sesji z każdej z 8 kategorii fabrycznych.", partial: "Partial Training", partialLead: "Wybierz kategorie i liczbę celów.", rounds: "Full Training", roundCount: "Liczba przebiegów", roundRange: "Zakres 1–10", dynamicMaximum: "Maksimum dla wybranego Profilu", roundLimit: "Wybrana liczba przebiegów przekracza pulę w kategorii", noRoundsAvailable: "Brak pełnego przebiegu bez powtórek. Kategoria ograniczająca:", noRoundsGuidance: "Dodaj nowe cele w tej kategorii, użyj Partial Training albo zmień ustawienie powtórek w Settings.", partialOnly: "tylko Partial Training", categories: "Kategorie", factory: "Fabryczne", user: "Moje cele", available: "dostępne", judgeCount: "Liczba AI Judge", none: "bez oceny", selectModel: "Wybierz model", execution: "Wykonanie i checkpointy", pauseRounds: "Pauza po każdym przebiegu", pauseRoundsLead: "Przy kilku przebiegach trening zatrzyma się po każdej pełnej grupie 8 sesji, ale nie po ostatniej sesji całego runu.", sessions: "Sesje", viewerCalls: "Wywołania Viewera (bazowe)", viewerCallNote: "Bazowy pipeline na sesję: 4 wywołania RV Lite + Post-Reveal Review + Field Guide Update + Viewer Notes Reflection, gdy Viewer Notes są włączone. Recovery/repair może dodać wywołanie tylko wtedy, gdy wymaga tego istniejący kontrakt domenowy.", judgeCalls: "Wywołania Judge", curriculum: "Curriculum", repeatPolicy: "Polityka powtórek", avoidProfile: "Unikaj celów użytych przez ten Profil", allowRepeat: "Zezwalaj na ponowne użycie", costCeiling: "Limit kosztu sesji RV", rvOnly: "· tylko część RV", notConfigured: "nie ustawiono", startFull: "Rozpocznij Full Training", startPartial: "Rozpocznij trening częściowy", pauseAfterSession: "Pauza po bieżącej sesji", session: "Sesja", step: "krok", pausedCheckpoint: "Trening zatrzymany na trwałym checkpoincie.", completed: "Trening zakończony.", sessionInterrupted: "Sesja treningowa została przerwana.", routeMissing: "Nie można odtworzyć trasy modelu Viewer dla tego treningu.", judgeMissing: "Nie można odtworzyć wybranej trasy Judge.", targetMissing: "Brak celu", exported: "Pakiet treningowy zapisano", history: "Ostatnie treningi", resume: "Wznów", export: "Zapisz cały trening", noRuns: "Nie wykonano jeszcze żadnego treningu.", chooseExportFolder: "Wybierz folder zapisu całego treningu", showSessions: "Pokaż sesje", saveTraining: "Zapisz trening", archive: "Archiwizuj", archiveTraining: "Archiwizować trening?", archiveTrainingLead: "Trening i należące do niego sesje znikną z aktywnych widoków, ale pozostaną bezpiecznie zapisane i będzie można je przywrócić w Archive and recovery.", workspaceRequired: "Wybrany Profil nie ma aktywnego RV Workspace ani legacy combined Workspace. Przywróć lub utwórz kompatybilny RV Workspace dla tego Profilu, aby rozpocząć Training.", targetsRequired: "Wybierz co najmniej jeden cel treningowy.",
  } : {
    training: "AI Training", lead: "Controlled RV Lite training series using factory and user-added training targets.", viewerModel: "Viewer model", useViewerNotes: "Use Viewer Notes", enabledByDefault: "Enabled by default", viewerNotesHelp: "Notes are used in the session and may be updated after Reveal and the Viewer's own review. Monitor and Judge are excluded.", packError: "The factory pack does not contain the complete 94-target set:", trainingRun: "Training", identity: "AI IS-BE", aiIsBe: "AI IS-BE", noModel: "No Viewer model", noProvider: "No profile connection", protocol: "RV Lite variant", coreLead: "The four core steps only.", extendedLead: "Four steps with deepening between Steps 3 and 4.", scope: "Training scope", full: "Full Training", fullLead: "1–10 rounds, one session from each of the 8 factory categories per round.", partial: "Partial Training", partialLead: "Choose categories and target counts.", rounds: "Full Training", roundCount: "Number of rounds", roundRange: "Range 1–10", dynamicMaximum: "Maximum for the selected Profile", roundLimit: "The selected round count exceeds the available pool in", noRoundsAvailable: "No complete round is available without target reuse. Limiting category:", noRoundsGuidance: "Add targets to that category, use Partial Training, or change the repeat setting in Settings.", partialOnly: "Partial Training only", categories: "Categories", factory: "Factory", user: "My Targets", available: "available", judgeCount: "AI Judge count", none: "no evaluation", selectModel: "Select model", execution: "Execution and checkpoints", pauseRounds: "Pause after each round", pauseRoundsLead: "With multiple rounds, Training pauses after each complete group of 8 sessions, but not after the final session of the whole run.", sessions: "Sessions", viewerCalls: "Viewer calls (baseline)", viewerCallNote: "Baseline per session: 4 RV Lite calls + Post-Reveal Review + Field Guide Update + Viewer Notes Reflection when Viewer Notes are enabled. Recovery/repair can add a call only when required by the existing domain contract.", judgeCalls: "Judge calls", curriculum: "Curriculum", repeatPolicy: "Repeat policy", avoidProfile: "Avoid targets used by this Profile", allowRepeat: "Allow target reuse", costCeiling: "RV session cost ceiling", rvOnly: "· RV portion only", notConfigured: "not configured", startFull: "Start Full Training", startPartial: "Start partial training", pauseAfterSession: "Pause after current session", session: "Session", step: "step", pausedCheckpoint: "Training paused at a durable checkpoint.", completed: "Training completed.", sessionInterrupted: "The training session was interrupted.", routeMissing: "The Viewer model route for this training run is unavailable.", judgeMissing: "A selected Judge route is unavailable.", targetMissing: "Missing target", exported: "Training package saved", history: "Recent training runs", resume: "Resume", export: "Save complete training", noRuns: "No training runs yet.", chooseExportFolder: "Choose where to save the complete training", showSessions: "Show sessions", saveTraining: "Save training", archive: "Archive", archiveTraining: "Archive training?", archiveTrainingLead: "The Training run and its sessions will leave active views but remain safely stored and can be restored from Archive and recovery.", workspaceRequired: "The selected Profile has no active RV Workspace or legacy combined Workspace. Restore or create a compatible RV Workspace for this Profile before starting Training.", targetsRequired: "Select at least one training target.",
  };
}
