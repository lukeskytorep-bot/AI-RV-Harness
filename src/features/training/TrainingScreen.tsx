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
import type { TargetRecord } from "../../targets/types";
import { localizedTargetTitle } from "../../targets/localization";
import { userTargetKind } from "../../targets/service";
import { buildFactoryCurriculum, FACTORY_CURRICULUM_ID, FACTORY_CURRICULUM_VERSION, selectPartialTrainingTargets } from "../../training/curriculum";
import { exportTrainingRun } from "../../training/export";
import type { TrainingRunRecord } from "../../training/types";
import type { AppSettings, Profile, Workspace } from "../../types";
import { SessionInspection } from "../../components/SessionInspection";
import { executeTrainingRun } from "./trainingExecution";

type Copy = ReturnType<typeof getCopy>;
type Mode = "full" | "partial";

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
  const [runs, setRuns] = useState<TrainingRunRecord[]>([]);
  const [mode, setMode] = useState<Mode>("full");
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
    const [nextProviders, nextModels, nextTargets, nextRuns] = await Promise.all([
      repository.listProviderConfigs(),
      repository.listProviderModels(),
      repository.listTargets(),
      repository.listTrainingRuns(),
    ]);
    setProviders(nextProviders);
    setModels(nextModels);
    setTargets(nextTargets);
    setRuns(nextRuns);
  };

  useEffect(() => { void refresh().catch((cause) => setError(errorText(cause))); }, [repository]);
  useEffect(() => () => executionAbort.current?.abort(), []);
  const provider = providers.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const viewerModels = models.filter((item) => item.providerConfigId === provider?.id);
  const viewerModelId = resolveViewerDefault(profile, provider, viewerModels);
  const viewerModel = viewerModels.find((item) => item.modelId === viewerModelId) ?? null;
  const pack = validateFactoryTrainingPack();
  const plannedTargets = useMemo(() => {
    try {
      if (mode === "full") {
        const byId = new Map(targets.map((target) => [target.id, target]));
        return buildFactoryCurriculum().map((item) => byId.get(item.targetId)).filter((target): target is TargetRecord => Boolean(target));
      }
      return selectPartialTrainingTargets(targets, counts, myTargetsCount);
    } catch {
      return [];
    }
  }, [counts, mode, myTargetsCount, targets]);
  const selectedJudges = judgeRoutes.slice(0, judgeCount).map((key) => findCredentialScopedModelByRouteKey(key, profile?.credentialId, providers, models));
  const ready = Boolean(repository && profile && workspaceId && provider?.lastStatus === "ok" && viewerModel && plannedTargets.length && selectedJudges.every(Boolean) && isTauriRuntime() && (mode !== "full" || (pack.valid && plannedTargets.length === 84)));

  const startNew = async () => {
    if (!repository || !profile || !viewerModel || !provider || !ready) return;
    if (mode === "full" && (!pack.valid || plannedTargets.length !== 84)) {
      setError(`${text.packError}${pack.errors.length ? ` ${pack.errors.join(", ")}` : ""}`);
      return;
    }
    const now = new Date();
    const run = await repository.createTrainingRun({
      name: `${text.trainingRun} ${runs.length + 1} · ${now.toLocaleDateString()}`,
      status: "Running",
      mode,
      profileId: profile.id,
      workspaceId,
      modelRoute: modelRouteKeyFor(viewerModel),
      protocolVariant: variant,
      ...(mode === "full" ? { curriculumId: FACTORY_CURRICULUM_ID, curriculumVersion: FACTORY_CURRICULUM_VERSION } : {}),
      targetIds: plannedTargets.map((target) => target.id),
      categories: [...new Set(plannedTargets.map((target) => target.sourceMetadata.category).filter((category): category is TrainingCategory => TRAINING_CATEGORIES.includes(category as TrainingCategory)))],
      judgeModelRoutes: judgeRoutes.slice(0, judgeCount),
      pauseAfterBlock,
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
    await execute(run);
  };

  const execute = async (initial: TrainingRunRecord) => {
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
    try {
      const outcome = await executeTrainingRun({
        repository,
        initial,
        profile: runProfile,
        providerConfig: runProvider,
        model: runModel,
        judges,
        targets,
        language,
        settings,
        signal: controller.signal,
        shouldPause: () => pauseRequested.current,
        onRunChange: setActiveRun,
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
        {mode === "partial" && <TrainingSection title={text.categories}><div className="training-category-grid">{TRAINING_CATEGORIES.map((category) => { const available = targets.filter((target) => target.collection === "training" && target.sourceMetadata.category === category).length; return <label key={category}><span>{TRAINING_CATEGORY_LABELS[category][settings.interfaceLanguage]}<small>{text.factory} · {text.available}: {available}</small></span><input type="number" min={0} max={available} value={counts[category] ?? 0} onChange={(event) => setCounts((current) => ({ ...current, [category]: Math.max(0, Number(event.target.value) || 0) }))} /></label>; })}<label className="training-my-targets"><span>{text.user}<small>{text.available}: {targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general").length}</small></span><input type="number" min={0} max={targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general").length} value={myTargetsCount} onChange={(event) => setMyTargetsCount(Math.max(0, Number(event.target.value) || 0))} /></label></div></TrainingSection>}
        <TrainingSection title="AI Judge"><div className="training-grid two"><label>{text.judgeCount}<select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))}><option value={0}>0 · {text.none}</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>{Array.from({ length: judgeCount }, (_, index) => <label key={index}>Judge {index + 1}<ModelRouteSelect role="judge" profile={profile} providers={providers} models={models} value={judgeRoutes[index]} onChange={(next) => setJudgeRoutes((current) => current.map((value, itemIndex) => itemIndex === index ? next : value))} emptyLabel={text.selectModel} /></label>)}</div></TrainingSection>
        <TrainingSection title={text.execution}><label className="training-check"><input type="checkbox" checked={pauseAfterBlock} onChange={(event) => setPauseAfterBlock(event.target.checked)} /><span><strong>{text.pauseBlocks}</strong><small>{text.pauseBlocksLead}</small></span></label><div className="training-preflight"><span><small>{text.sessions}</small><strong>{plannedTargets.length}</strong></span><span><small>{text.viewerCalls}</small><strong>{plannedTargets.length * 4}</strong></span><span><small>{text.judgeCalls}</small><strong>{plannedTargets.length * judgeCount}</strong></span><span><small>{text.curriculum}</small><strong>{mode === "full" ? `${FACTORY_CURRICULUM_ID}:${FACTORY_CURRICULUM_VERSION}` : text.partial}</strong></span><span><small>{text.costCeiling}</small><strong>{settings.maxSessionCostUsd > 0 ? `≤ $${(plannedTargets.length * settings.maxSessionCostUsd).toFixed(2)}` : text.notConfigured}</strong></span></div></TrainingSection>
        <div className="training-actions">{busy ? <><button className="secondary-button" onClick={() => { pauseRequested.current = true; }}><CircleStop size={15} />{text.pauseAfterSession}</button><span>{progressLine}</span></> : <span className="disabled-action-help" title={!workspaceId ? text.workspaceRequired : !plannedTargets.length ? text.targetsRequired : undefined}><button className="primary-button" disabled={!ready} onClick={() => void startNew()}><Play size={15} />{mode === "full" ? text.startFull : `${text.startPartial} · ${plannedTargets.length}`}</button></span>}</div>
        {!workspaceId && <div className="training-requirement-note"><ShieldCheck size={15} /><span>{text.workspaceRequired}</span></div>}
        {error && <div className="provider-error">{error}</div>}{exportMessage && <div className="storage-success"><Check size={14} />{exportMessage}</div>}
      </section>
      <aside className="training-runs panel"><div className="panel-header"><span><Database size={18} /></span><h2>{text.history}</h2></div>{activeRun && <div className="active-training-run"><strong>{activeRun.name}</strong><span>{activeRun.completedTargetIds.length}/{activeRun.targetIds.length}</span><progress max={activeRun.targetIds.length} value={activeRun.completedTargetIds.length} /><small>{progressLine || activeRun.status}</small></div>}<div className="training-run-list">{runs.map((run) => <article key={run.id} className={expandedRunId === run.id ? "expanded" : ""}><div className="training-run-meta"><strong>#{run.runNumber} · {run.name}</strong><small>{run.status} · {run.completedTargetIds.length}/{run.targetIds.length} · Lite {run.protocolVariant}</small></div>{(run.status === "Paused" || run.status === "Interrupted" || run.status === "Running") && !busy && run.currentIndex < run.targetIds.length && <button className="secondary-button training-resume-button" onClick={() => void execute(run)}><Play size={13} />{text.resume}</button>}<div className="training-run-actions">{Boolean(run.sessionIds?.length) && <button className="secondary-button" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)}>{text.showSessions}</button>}{Boolean(run.sessionIds?.length) && <button className="secondary-button" title={text.export} onClick={() => void exportExisting(run)}><Download size={14} />{text.saveTraining}</button>}<button className="secondary-button" disabled={busy && activeRun?.id === run.id} title={text.archiveTraining} onClick={() => void archiveExisting(run)}><Archive size={14} />{text.archive}</button></div>{expandedRunId === run.id && <div className="training-session-links">{run.sessionIds.map((sessionId, index) => <button key={sessionId} className={selectedSession?.sessionId === sessionId ? "active" : ""} onClick={() => setSelectedSession({ workspaceId: run.workspaceId, sessionId })}>{text.session} {index + 1} · {run.completedTargetIds[index] ?? sessionId}</button>)}</div>}</article>)}</div>{!runs.length && <p className="recent-session-empty">{text.noRuns}</p>}</aside>
    </div>
    {selectedSession && repository && <SessionInspection repository={repository} workspaceId={selectedSession.workspaceId} sessionId={selectedSession.sessionId} language={language} />}
  </div>;
}

function TrainingHelpPanel({ pl, packTotal, packValid }: { pl: boolean; packTotal: number; packValid: boolean }) {
  const help = currentTrainingHelp(pl);
  return <details className="training-help-panel">
    <summary>
      <span className="training-help-title"><GraduationCap size={20} /><strong>{help.title}</strong></span>
      <span className={packValid ? "status-chip ready" : "status-chip next"}>{packTotal}/94</span>
    </summary>
    <div className="training-help-content">
      <p>{help.intro}</p>
      <section><h3>{help.fullTitle}</h3><p>{help.fullBody}</p></section>
      <section><h3>{help.partialTitle}</h3><p>{help.partialBody}</p></section>
      <section><h3>{help.learningTitle}</h3><p>{help.learningBody}</p></section>
      <section><h3>{help.resumeTitle}</h3><p>{help.resumeBody}</p></section>
    </div>
  </details>;
}

function currentTrainingHelp(pl: boolean) {
  return pl ? {
    title: "Jak działa AI Training?",
    intro: "AI Training wykonuje kontrolowane sesje RV Lite. Cel pozostaje ślepy do zakończenia sesji, a po Revealu Viewer analizuje wynik, aktualizuje Field Guide i — gdy Viewer Notes są włączone — może zaktualizować również Viewer Notes.",
    fullTitle: "Full Training",
    fullBody: "W aktualnym curriculum v0.7.13 Full Training obejmuje dokładnie 84 cele fabryczne w 12 stałych blokach po 7 sesji: 5 celów kategorii i 2 cele mieszane. Cele dodane przez użytkownika nie są dołączane do Full Training.",
    partialTitle: "Partial Training",
    partialBody: "Partial Training pozwala wybrać liczbę celów z poszczególnych kategorii fabrycznych oraz z My Targets.",
    learningTitle: "Jak Viewer uczy się po sesji?",
    learningBody: "Po Revealu wykonywane są kolejno Post-Reveal Review, Field Guide Update, Viewer Notes Reflection oraz opcjonalny AI Judge. Field Guide i Viewer Notes pozostają oddzielnymi pakietami wiedzy; Monitor i Judge ich nie aktualizują.",
    resumeTitle: "Pauza i Resume",
    resumeBody: "Trening można zatrzymać po bieżącej sesji, a Full Training także na istniejących granicach bloków. Trwałe checkpointy pozwalają wznowić zapisany run bez ponownego wykonywania ukończonych etapów.",
  } : {
    title: "How does AI Training work?",
    intro: "AI Training runs controlled RV Lite sessions. The target remains blind until the session ends, and after Reveal the Viewer reviews the result, updates the Field Guide, and can also update Viewer Notes when they are enabled.",
    fullTitle: "Full Training",
    fullBody: "In the current v0.7.13 curriculum, Full Training contains exactly 84 factory targets in 12 fixed blocks of 7 sessions: 5 category targets and 2 mixed targets. User-added targets are not included in Full Training.",
    partialTitle: "Partial Training",
    partialBody: "Partial Training lets you choose target counts from individual factory categories and from My Targets.",
    learningTitle: "How does the Viewer learn after a session?",
    learningBody: "After Reveal, the pipeline runs Post-Reveal Review, Field Guide Update, Viewer Notes Reflection, and the optional AI Judge. The Field Guide and Viewer Notes remain separate knowledge packages; Monitor and Judge do not update them.",
    resumeTitle: "Pause and Resume",
    resumeBody: "Training can be paused after the current session, and Full Training can also pause at the existing block boundaries. Durable checkpoints allow a saved run to resume without repeating completed stages.",
  };
}

function TrainingSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="training-section"><h3>{title}</h3>{children}</section>;
}

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

function labels(pl: boolean) {
  return pl ? {
    training: "Trening AI", lead: "Kontrolowane serie treningowe RV Lite na fabrycznych i własnych celach treningowych.", viewerModel: "Model Viewera", useViewerNotes: "Użyj Viewer Notes", enabledByDefault: "Domyślnie włączone", viewerNotesHelp: "Notatki są używane w sesji i mogą zostać zaktualizowane po Revealu i własnej ocenie Viewera. Monitor i Judge są wykluczeni.", packError: "Pakiet fabryczny nie zawiera kompletnego zestawu 94 celów:", trainingRun: "Trening", identity: "AI IS-BE", aiIsBe: "AI IS-BE", noModel: "Brak modelu Viewer", noProvider: "Brak połączenia profilu", protocol: "Wariant protokołu Lite", coreLead: "Cztery podstawowe kroki.", extendedLead: "Cztery kroki z pogłębianiem pomiędzy krokiem 3 i 4.", scope: "Zakres treningu", full: "Pełny — stałe 84", fullLead: "Niezmienny fabryczny przebieg wszystkich 84 celów.", partial: "Częściowy", partialLead: "Wybierz kategorie i liczbę celów.", categories: "Kategorie", factory: "Fabryczne", user: "Moje cele", available: "dostępne", judgeCount: "Liczba AI Judge", none: "bez oceny", selectModel: "Wybierz model", execution: "Wykonanie i checkpointy", pauseBlocks: "Pauza po każdym bloku", pauseBlocksLead: "Pełny trening zatrzymuje się po każdej grupie 5+2; można go bezpiecznie wznowić.", sessions: "Sesje", viewerCalls: "Wywołania Viewera", judgeCalls: "Wywołania Judge", curriculum: "Curriculum", costCeiling: "Limit kosztu Viewera (bez Judge)", notConfigured: "nie ustawiono", startFull: "Rozpocznij trening 84 sesji", startPartial: "Rozpocznij trening częściowy", pauseAfterSession: "Wstrzymaj po bieżącej sesji", session: "Sesja", step: "krok", pausedCheckpoint: "Trening zatrzymany na trwałym checkpoincie.", completed: "Trening zakończony.", sessionInterrupted: "Sesja treningowa została przerwana.", routeMissing: "Nie można odtworzyć trasy modelu Viewer dla tego treningu.", judgeMissing: "Nie można odtworzyć wybranej trasy Judge.", targetMissing: "Brak celu", exported: "Pakiet treningowy zapisano", history: "Ostatnie treningi", resume: "Wznów", export: "Zapisz cały trening", noRuns: "Nie wykonano jeszcze żadnego treningu.", chooseExportFolder: "Wybierz folder zapisu całego treningu", showSessions: "Pokaż sesje", saveTraining: "Zapisz trening", archive: "Archiwizuj", archiveTraining: "Archiwizować trening?", archiveTrainingLead: "Trening i należące do niego sesje znikną z aktywnych widoków, ale pozostaną bezpiecznie zapisane i będzie można je przywrócić w Archive and recovery.", workspaceRequired: "Wybrany Profil nie ma aktywnego Workspace. Przywróć lub utwórz Workspace dla tego Profilu, aby rozpocząć Training.", targetsRequired: "Wybierz co najmniej jeden cel treningowy.",
  } : {
    training: "AI Training", lead: "Controlled RV Lite training series using factory and user-added training targets.", viewerModel: "Viewer model", useViewerNotes: "Use Viewer Notes", enabledByDefault: "Enabled by default", viewerNotesHelp: "Notes are used in the session and may be updated after Reveal and the Viewer's own review. Monitor and Judge are excluded.", packError: "The factory pack does not contain the complete 94-target set:", trainingRun: "Training", identity: "AI IS-BE", aiIsBe: "AI IS-BE", noModel: "No Viewer model", noProvider: "No profile connection", protocol: "RV Lite variant", coreLead: "The four core steps only.", extendedLead: "Four steps with deepening between Steps 3 and 4.", scope: "Training scope", full: "Full — fixed 84", fullLead: "Immutable factory curriculum covering all 84 targets.", partial: "Partial", partialLead: "Choose categories and target counts.", categories: "Categories", factory: "Factory", user: "My Targets", available: "available", judgeCount: "AI Judge count", none: "no evaluation", selectModel: "Select model", execution: "Execution and checkpoints", pauseBlocks: "Pause after every block", pauseBlocksLead: "A full run stops after each 5+2 group and can be safely resumed.", sessions: "Sessions", viewerCalls: "Viewer calls", judgeCalls: "Judge calls", curriculum: "Curriculum", costCeiling: "Viewer cost ceiling (Judges excluded)", notConfigured: "not configured", startFull: "Start 84-session training", startPartial: "Start partial training", pauseAfterSession: "Pause after current session", session: "Session", step: "step", pausedCheckpoint: "Training paused at a durable checkpoint.", completed: "Training completed.", sessionInterrupted: "The training session was interrupted.", routeMissing: "The Viewer model route for this training run is unavailable.", judgeMissing: "A selected Judge route is unavailable.", targetMissing: "Missing target", exported: "Training package saved", history: "Recent training runs", resume: "Resume", export: "Save complete training", noRuns: "No training runs yet.", chooseExportFolder: "Choose where to save the complete training", showSessions: "Show sessions", saveTraining: "Save training", archive: "Archive", archiveTraining: "Archive training?", archiveTrainingLead: "The Training run and its sessions will leave active views but remain safely stored and can be restored from Archive and recovery.", workspaceRequired: "The selected Profile has no active Workspace. Restore or create a Workspace for this Profile before starting Training.", targetsRequired: "Select at least one training target.",
  };
}
