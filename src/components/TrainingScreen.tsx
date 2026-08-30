import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CircleStop, Database, Download, FileCheck2, GraduationCap, Play, ShieldCheck } from "lucide-react";
import type { getCopy } from "../i18n";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../domain/isBeIdentity";
import { resolveSessionLanguage } from "../domain/localization";
import { runBlindJudging } from "../judge/engine";
import { resolveViewerDefault } from "../profileModelDefaults";
import { profileGenerationDefaults, profileSystemPromptSnapshot } from "../profileViewerDefaults";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import { getRvLite } from "../resources/protocolRegistry";
import { runAutomaticRvLiteSession } from "../sessions/rvLiteController";
import { runAutomaticPostRevealReview } from "../sessions/postReveal";
import type { AppRepository } from "../storage/repository";
import { isTauriRuntime } from "../storage";
import { chooseDirectory } from "../storage/native";
import {
  TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
  validateFactoryTrainingPack,
  type TrainingCategory,
} from "../targets/bundled";
import type { TargetRecord } from "../targets/types";
import { localizedTargetTitle } from "../targets/localization";
import { userTargetKind } from "../targets/service";
import { buildFactoryCurriculum, FACTORY_CURRICULUM_ID, FACTORY_CURRICULUM_VERSION, selectPartialTrainingTargets } from "../training/curriculum";
import { exportTrainingRun } from "../training/export";
import type { TrainingRunRecord } from "../training/types";
import type { AppSettings, Profile, Workspace } from "../types";
import { SessionInspection } from "./SessionInspection";
import { prepareViewerNotesForSession, runViewerNoteReflection } from "../aiCenter/viewerNotes";

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
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const text = labels(pl);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const ownedWorkspaces = workspaces.filter((item) => item.profileId === profileId);
  const [workspaceId, setWorkspaceId] = useState(ownedWorkspaces[0]?.id ?? "");
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
  useEffect(() => {
    const first = workspaces.find((item) => item.profileId === profileId);
    if (!ownedWorkspaces.some((item) => item.id === workspaceId)) setWorkspaceId(first?.id ?? "");
  }, [profileId, workspaceId, workspaces]);

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
  const selectedJudges = judgeRoutes.slice(0, judgeCount).map((key) => models.find((model) => routeKey(model) === key) ?? null);
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
      modelRoute: routeKey(viewerModel),
      protocolVariant: variant,
      ...(mode === "full" ? { curriculumId: FACTORY_CURRICULUM_ID, curriculumVersion: FACTORY_CURRICULUM_VERSION } : {}),
      targetIds: plannedTargets.map((target) => target.id),
      categories: [...new Set(plannedTargets.map((target) => target.sourceMetadata.category).filter((category): category is TrainingCategory => TRAINING_CATEGORIES.includes(category as TrainingCategory)))],
      judgeModelRoutes: judgeRoutes.slice(0, judgeCount),
      pauseAfterBlock,
      viewerNotesEnabled,
    });
    setActiveRun(run);
    setRuns((current) => [run, ...current]);
    await execute(run);
  };

  const execute = async (initial: TrainingRunRecord) => {
    if (!repository) return;
    const runProfile = profiles.find((item) => item.id === initial.profileId);
    const runProvider = providers.find((item) => item.credentialId === runProfile?.credentialId);
    const runModel = models.find((item) => routeKey(item) === initial.modelRoute);
    const targetById = new Map(targets.map((target) => [target.id, target]));
    if (!runProfile || !runProvider || !runModel) { setError(text.routeMissing); return; }
    const judges = initial.judgeModelRoutes.map((key) => {
      const model = models.find((item) => routeKey(item) === key);
      const providerConfig = providers.find((item) => item.id === model?.providerConfigId);
      if (!model || !providerConfig) throw new Error(text.judgeMissing);
      return { model, providerConfig };
    });
    const rvSystemPrompt = await profileSystemPromptSnapshot(runProfile, language);
    let working: TrainingRunRecord = { ...initial, sessionIds: initial.sessionIds ?? [], status: "Running" };
    pauseRequested.current = false;
    setBusy(true); setError(null); setExportMessage(null); setActiveRun(working);
    await repository.updateTrainingRun(working.id, { status: "Running" });
    try {
      for (let index = working.currentIndex; index < working.targetIds.length; index += 1) {
        const target = targetById.get(working.targetIds[index]);
        if (!target) throw new Error(`${text.targetMissing}: ${working.targetIds[index]}`);
        setProgressLine(`${text.session} ${index + 1}/${working.targetIds.length} · ${localizedTargetTitle(target, language)}`);
        const viewerNotes = await prepareViewerNotesForSession({ repository, profileId: runProfile.id, providerConfig: runProvider, model: runModel, enabled: working.viewerNotesEnabled ?? false });
        const result = await runAutomaticRvLiteSession({
          repository,
          workspaceId: working.workspaceId,
          profileId: runProfile.id,
          profileName: aiIsBeDisplayName(runProfile),
          humanIsBeDisplayName: humanIsBeDisplayName(runProfile),
          providerConfig: runProvider,
          model: runModel,
          protocol: getRvLite(language, working.protocolVariant),
          sessionLanguage: language,
          requestedSettings: profileGenerationDefaults(runProfile, runModel),
          viewerNotes,
          ...(rvSystemPrompt ? { rvSystemPrompt } : {}),
          automaticTarget: target,
          maxRetries: settings.maxRetries,
          requestTimeoutMs: settings.requestTimeoutMs,
          sessionCodePrefix: settings.sessionCodePrefix,
          ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}),
          onProgress: (item) => setProgressLine(`${text.session} ${index + 1}/${working.targetIds.length} · ${localizedTargetTitle(target, language)} · ${item.state}${item.phase ? ` · ${text.step} ${item.phase}/4` : ""}`),
        });
        if (result.state !== "Revealed") throw new Error(result.stopReason ?? text.sessionInterrupted);
        await runAutomaticPostRevealReview({
          repository,
          sessionId: result.sessionId,
          viewer: { providerConfig: runProvider, model: runModel },
          timeoutMs: settings.requestTimeoutMs,
          afterViewerReview: async ({ content }) => {
            await runViewerNoteReflection({ repository, sessionId: result.sessionId, viewerReview: content, providerConfig: runProvider, model: runModel, timeoutMs: settings.requestTimeoutMs });
          },
        });
        if (judges.length) await runBlindJudging({ repository, sessionId: result.sessionId, language, judges });
        await repository.updateRvSessionState(result.sessionId, "Completed");
        working = {
          ...working,
          completedTargetIds: [...working.completedTargetIds, target.id],
          sessionIds: [...working.sessionIds, result.sessionId],
          currentIndex: index + 1,
          updatedAt: new Date().toISOString(),
        };
        await repository.updateTrainingRun(working.id, { completedTargetIds: working.completedTargetIds, sessionIds: working.sessionIds, currentIndex: working.currentIndex });
        setActiveRun(working);
        const atBlockBoundary = isBlockBoundary(working, index);
        if (pauseRequested.current || (working.pauseAfterBlock && atBlockBoundary && index + 1 < working.targetIds.length)) {
          working = { ...working, status: "Paused" };
          await repository.updateTrainingRun(working.id, { status: "Paused" });
          setProgressLine(text.pausedCheckpoint);
          await refresh();
          return;
        }
      }
      working = { ...working, status: "Completed", completedAt: new Date().toISOString() };
      await repository.updateTrainingRun(working.id, { status: "Completed", completedAt: working.completedAt });
      setActiveRun(working);
      setProgressLine(text.completed);
      await refresh();
    } catch (cause) {
      const message = errorText(cause);
      await repository.updateTrainingRun(working.id, { status: "Interrupted", error: message });
      working = { ...working, status: "Interrupted", errors: [...working.errors, message] };
      setActiveRun(working);
      setError(message);
      await refresh();
    } finally {
      setBusy(false);
    }
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
    <header className="page-header"><div><h1>{text.training}</h1><p>{text.lead}</p></div></header>
    <div className="training-pack-banner"><GraduationCap size={23} /><div><strong>{text.fixed84}</strong><p>{text.fixed84Lead}</p></div><span className={pack.valid ? "status-chip ready" : "status-chip next"}>{pack.total}/84</span></div>
    <div className="training-layout">
      <section className="panel training-config">
        <TrainingSection title={text.identity}><div className="training-grid two"><label>{text.aiIsBe}<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{aiIsBeDisplayName(item)}</option>)}</select></label><label>{text.workspace}<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{ownedWorkspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><small>{provider ? `${provider.label} · ${viewerModel?.displayName ?? text.noModel}` : text.noProvider}</small></TrainingSection>
        <TrainingSection title={text.protocol}><div className="training-choice-row"><button className={variant === "core" ? "active" : ""} onClick={() => setVariant("core")}><FileCheck2 size={18} /><span><strong>RV Lite Core</strong><small>{text.coreLead}</small></span></button><button className={variant === "extended" ? "active" : ""} onClick={() => setVariant("extended")}><GraduationCap size={18} /><span><strong>RV Lite Extended</strong><small>{text.extendedLead}</small></span></button></div></TrainingSection>
        <TrainingSection title={text.scope}><div className="training-choice-row"><button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}><Database size={18} /><span><strong>{text.full}</strong><small>{text.fullLead}</small></span></button><button className={mode === "partial" ? "active" : ""} onClick={() => setMode("partial")}><ShieldCheck size={18} /><span><strong>{text.partial}</strong><small>{text.partialLead}</small></span></button></div></TrainingSection>
        <TrainingSection title="Viewer Notes"><label className="training-check" title={pl ? "Notatki są używane w sesji i mogą zostać zaktualizowane po Revealu i własnej ocenie Viewera. Monitor i Judge są wykluczeni." : "Notes are used in the session and may be updated after Reveal and the Viewer's own review. Monitor and Judge are excluded."}><input type="checkbox" checked={viewerNotesEnabled} onChange={(event) => setViewerNotesEnabled(event.target.checked)} /><span><strong>{pl ? "Użyj Viewer Notes" : "Use Viewer Notes"}</strong><small>{pl ? "Eksperymentalne · domyślnie włączone" : "Experimental · enabled by default"}</small></span></label></TrainingSection>
        {mode === "partial" && <TrainingSection title={text.categories}><div className="training-category-grid">{TRAINING_CATEGORIES.map((category) => { const available = targets.filter((target) => target.collection === "training" && target.sourceMetadata.category === category).length; return <label key={category}><span>{TRAINING_CATEGORY_LABELS[category][settings.interfaceLanguage]}<small>{text.factory} · {text.available}: {available}</small></span><input type="number" min={0} max={available} value={counts[category] ?? 0} onChange={(event) => setCounts((current) => ({ ...current, [category]: Math.max(0, Number(event.target.value) || 0) }))} /></label>; })}<label className="training-my-targets"><span>{text.user}<small>{text.available}: {targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general").length}</small></span><input type="number" min={0} max={targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general").length} value={myTargetsCount} onChange={(event) => setMyTargetsCount(Math.max(0, Number(event.target.value) || 0))} /></label></div></TrainingSection>}
        <TrainingSection title="AI Judge"><div className="training-grid two"><label>{text.judgeCount}<select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))}><option value={0}>0 · {text.none}</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>{Array.from({ length: judgeCount }, (_, index) => <label key={index}>Judge {index + 1}<select value={judgeRoutes[index]} onChange={(event) => setJudgeRoutes((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}><option value="">{text.selectModel}</option>{models.map((model) => <option key={routeKey(model)} value={routeKey(model)}>{providers.find((item) => item.id === model.providerConfigId)?.label ?? model.provider} · {model.displayName}</option>)}</select></label>)}</div></TrainingSection>
        <TrainingSection title={text.execution}><label className="training-check"><input type="checkbox" checked={pauseAfterBlock} onChange={(event) => setPauseAfterBlock(event.target.checked)} /><span><strong>{text.pauseBlocks}</strong><small>{text.pauseBlocksLead}</small></span></label><div className="training-preflight"><span><small>{text.sessions}</small><strong>{plannedTargets.length}</strong></span><span><small>{text.viewerCalls}</small><strong>{plannedTargets.length * 4}</strong></span><span><small>{text.judgeCalls}</small><strong>{plannedTargets.length * judgeCount}</strong></span><span><small>{text.curriculum}</small><strong>{mode === "full" ? `${FACTORY_CURRICULUM_ID}:${FACTORY_CURRICULUM_VERSION}` : text.partial}</strong></span><span><small>{text.costCeiling}</small><strong>{settings.maxSessionCostUsd > 0 ? `≤ $${(plannedTargets.length * settings.maxSessionCostUsd).toFixed(2)}` : text.notConfigured}</strong></span></div></TrainingSection>
        <div className="training-actions">{busy ? <><button className="secondary-button" onClick={() => { pauseRequested.current = true; }}><CircleStop size={15} />{text.pauseAfterSession}</button><span>{progressLine}</span></> : <span className="disabled-action-help" title={!workspaceId ? text.workspaceRequired : !plannedTargets.length ? text.targetsRequired : undefined}><button className="primary-button" disabled={!ready} onClick={() => void startNew()}><Play size={15} />{mode === "full" ? text.startFull : `${text.startPartial} · ${plannedTargets.length}`}</button></span>}</div>
        {!workspaceId && <div className="training-requirement-note"><ShieldCheck size={15} /><span>{text.workspaceRequired}</span></div>}
        {error && <div className="provider-error">{error}</div>}{exportMessage && <div className="storage-success"><Check size={14} />{exportMessage}</div>}
      </section>
      <aside className="training-runs panel"><div className="panel-header"><span><Database size={18} /></span><h2>{text.history}</h2></div>{activeRun && <div className="active-training-run"><strong>{activeRun.name}</strong><span>{activeRun.completedTargetIds.length}/{activeRun.targetIds.length}</span><progress max={activeRun.targetIds.length} value={activeRun.completedTargetIds.length} /><small>{progressLine || activeRun.status}</small></div>}<div className="training-run-list">{runs.map((run) => <article key={run.id} className={expandedRunId === run.id ? "expanded" : ""}><div className="training-run-meta"><strong>#{run.runNumber} · {run.name}</strong><small>{run.status} · {run.completedTargetIds.length}/{run.targetIds.length} · Lite {run.protocolVariant}</small></div><div className="training-run-actions">{(run.status === "Paused" || run.status === "Interrupted" || run.status === "Running") && !busy && run.currentIndex < run.targetIds.length && <button className="secondary-button training-resume-button" onClick={() => void execute(run)}><Play size={13} />{text.resume}</button>}{Boolean(run.sessionIds?.length) && <button className="secondary-button" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)}>{text.showSessions}</button>}{Boolean(run.sessionIds?.length) && <button className="secondary-button" title={text.export} onClick={() => void exportExisting(run)}><Download size={14} />{text.saveTraining}</button>}</div>{expandedRunId === run.id && <div className="training-session-links">{run.sessionIds.map((sessionId, index) => <button key={sessionId} className={selectedSession?.sessionId === sessionId ? "active" : ""} onClick={() => setSelectedSession({ workspaceId: run.workspaceId, sessionId })}>{text.session} {index + 1} · {run.completedTargetIds[index] ?? sessionId}</button>)}</div>}</article>)}</div>{!runs.length && <p className="recent-session-empty">{text.noRuns}</p>}</aside>
    </div>
    {selectedSession && repository && <SessionInspection repository={repository} workspaceId={selectedSession.workspaceId} sessionId={selectedSession.sessionId} language={language} />}
  </div>;
}

function TrainingSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="training-section"><h3>{title}</h3>{children}</section>;
}

function routeKey(model: ProviderModel): string { return `${model.providerConfigId}::${model.modelId}`; }
function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

function isBlockBoundary(run: TrainingRunRecord, zeroBasedIndex: number): boolean {
  if (run.mode === "full") return (zeroBasedIndex + 1) % 7 === 0;
  const current = run.targetIds[zeroBasedIndex];
  const next = run.targetIds[zeroBasedIndex + 1];
  return !next || current.split("_").slice(0, 3).join("_") !== next.split("_").slice(0, 3).join("_");
}

function labels(pl: boolean) {
  return pl ? {
    training: "Trening AI", lead: "Kontrolowane serie treningowe RV Lite na fabrycznych i własnych celach treningowych.", fixed84: "Pełny trening zawsze obejmuje dokładnie 84 cele fabryczne.", fixed84Lead: "12 bloków po 7 sesji: 5 celów kategorii + 2 cele mieszane. To oznacza 336 wywołań Viewera, a przy Judge dodatkowo 84–252 wywołania. Cele użytkownika nie są dołączane — użyj treningu częściowego, aby je trenować.", packError: "Pakiet fabryczny nie zawiera kompletnego programu 84 celów:", trainingRun: "Trening", identity: "AI IS-BE i workspace", aiIsBe: "AI IS-BE", workspace: "Workspace", noModel: "Brak modelu Viewer", noProvider: "Brak połączenia profilu", protocol: "Wariant protokołu Lite", coreLead: "Cztery podstawowe kroki.", extendedLead: "Cztery kroki z pogłębianiem pomiędzy krokiem 3 i 4.", scope: "Zakres treningu", full: "Pełny — stałe 84", fullLead: "Niezmienny fabryczny przebieg wszystkich 84 celów.", partial: "Częściowy", partialLead: "Wybierz kategorie i liczbę celów.", categories: "Kategorie", factory: "Fabryczne", user: "Moje cele", available: "dostępne", judgeCount: "Liczba AI Judge", none: "bez oceny", selectModel: "Wybierz model", execution: "Wykonanie i checkpointy", pauseBlocks: "Pauza po każdym bloku", pauseBlocksLead: "Pełny trening zatrzymuje się po każdej grupie 5+2; można go bezpiecznie wznowić.", sessions: "Sesje", viewerCalls: "Wywołania Viewera", judgeCalls: "Wywołania Judge", curriculum: "Curriculum", costCeiling: "Limit kosztu Viewera (bez Judge)", notConfigured: "nie ustawiono", startFull: "Rozpocznij trening 84 sesji", startPartial: "Rozpocznij trening częściowy", pauseAfterSession: "Wstrzymaj po bieżącej sesji", session: "Sesja", step: "krok", pausedCheckpoint: "Trening zatrzymany na trwałym checkpoincie.", completed: "Trening zakończony.", sessionInterrupted: "Sesja treningowa została przerwana.", routeMissing: "Nie można odtworzyć trasy modelu Viewer dla tego treningu.", judgeMissing: "Nie można odtworzyć wybranej trasy Judge.", targetMissing: "Brak celu", exported: "Pakiet treningowy zapisano", history: "Ostatnie treningi", resume: "Wznów", export: "Zapisz cały trening", noRuns: "Nie wykonano jeszcze żadnego treningu.", chooseExportFolder: "Wybierz folder zapisu całego treningu", showSessions: "Pokaż sesje", saveTraining: "Zapisz trening", workspaceRequired: "Nie możesz rozpocząć treningu, dopóki nie utworzysz i nie wybierzesz Workspace.", targetsRequired: "Wybierz co najmniej jeden cel treningowy.",
  } : {
    training: "AI Training", lead: "Controlled RV Lite training series using factory and user-added training targets.", fixed84: "A full training run always contains exactly 84 factory targets.", fixed84Lead: "12 blocks of 7 sessions: 5 category targets + 2 mixed targets. This means 336 Viewer calls and, when enabled, another 84–252 Judge calls. User-added targets are excluded — use Partial Training to train with them.", packError: "The factory pack does not contain the complete 84-target curriculum:", trainingRun: "Training", identity: "AI IS-BE and workspace", aiIsBe: "AI IS-BE", workspace: "Workspace", noModel: "No Viewer model", noProvider: "No profile connection", protocol: "RV Lite variant", coreLead: "The four core steps only.", extendedLead: "Four steps with deepening between Steps 3 and 4.", scope: "Training scope", full: "Full — fixed 84", fullLead: "Immutable factory curriculum covering all 84 targets.", partial: "Partial", partialLead: "Choose categories and target counts.", categories: "Categories", factory: "Factory", user: "My Targets", available: "available", judgeCount: "AI Judge count", none: "no evaluation", selectModel: "Select model", execution: "Execution and checkpoints", pauseBlocks: "Pause after every block", pauseBlocksLead: "A full run stops after each 5+2 group and can be safely resumed.", sessions: "Sessions", viewerCalls: "Viewer calls", judgeCalls: "Judge calls", curriculum: "Curriculum", costCeiling: "Viewer cost ceiling (Judges excluded)", notConfigured: "not configured", startFull: "Start 84-session training", startPartial: "Start partial training", pauseAfterSession: "Pause after current session", session: "Session", step: "step", pausedCheckpoint: "Training paused at a durable checkpoint.", completed: "Training completed.", sessionInterrupted: "The training session was interrupted.", routeMissing: "The Viewer model route for this training run is unavailable.", judgeMissing: "A selected Judge route is unavailable.", targetMissing: "Missing target", exported: "Training package saved", history: "Recent training runs", resume: "Resume", export: "Save complete training", noRuns: "No training runs yet.", chooseExportFolder: "Choose where to save the complete training", showSessions: "Show sessions", saveTraining: "Save training", workspaceRequired: "You cannot start training until you create and select a Workspace.", targetsRequired: "Select at least one training target.",
  };
}
