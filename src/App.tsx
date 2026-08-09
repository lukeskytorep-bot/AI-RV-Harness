import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Crosshair,
  Database,
  FileCheck2,
  FlaskConical,
  Home,
  KeyRound,
  Languages,
  LockKeyhole,
  MessageCircle,
  MonitorCog,
  Moon,
  Archive,
  Pencil,
  Plus,
  RadioTower,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Users,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getCopy } from "./i18n";
import { PROVIDER_LABELS, ProviderSettings } from "./components/ProviderSettings";
import { resolveSessionLanguage } from "./domain/localization";
import { getFullRcp, getRvLite, type ProtocolResource, type RvLiteProtocolResource } from "./resources/protocolRegistry";
import { createRepository, isTauriRuntime } from "./storage";
import { createId, type AppRepository } from "./storage/repository";
import type {
  AppSettings,
  InterfaceLanguage,
  Profile,
  ProfileAiConfigurationInput,
  SessionLanguageSetting,
  Theme,
  Workspace,
} from "./types";
import { PROVIDER_KINDS, type ProviderConfig } from "./providers/types";
import type { ProviderImageInput, ProviderKind, ProviderModel, ReasoningEffort } from "./providers/types";
import { runAutomaticRcpSession, submitExternalReveal, type SessionProgress } from "./sessions/controller";
import { sendChatTurn } from "./chat/engine";
import type { ChatMessage, ChatMode, ChatThread } from "./types";
import { runBlindJudging } from "./judge/engine";
import type { JudgingResult } from "./judge/types";
import { chooseRandomTarget, createUserTarget, targetHasSupportedReveal, updateUserTarget } from "./targets/service";
import type { TargetRecord, TargetUsageRecord } from "./targets/types";
import { dryRunCustomProtocol, saveCustomProtocol } from "./protocols/custom";
import type { CustomProtocolVersion } from "./protocols/types";
import { runAutomaticCustomSession } from "./sessions/customController";
import { runAutomaticRvLiteSession } from "./sessions/rvLiteController";
import { runOrdinaryBatch, selectBatchTargets, type OrdinaryBatchProgress, type OrdinaryBatchSessionResult } from "./sessions/batch";
import { ResearchBuilder } from "./components/ResearchBuilder";
import { buildCalibrationHistory, type CalibrationHistoryItem } from "./research/calibration";
import { imageFileToProviderInput, storeRevealArtifact, storeTargetArtifact } from "./artifacts/native";
import type { RevealArtifactRecord, RvSession, TargetClarificationRecord } from "./sessions/types";
import { aggregateJudgeScores } from "./domain/scoring";
import type { MonitorInterventionRecord, MonitorRunRecord } from "./monitor/types";
import { createTextWorkspaceSource, estimateTextTokens } from "./sources/service";
import type { WorkspaceSource } from "./sources/types";
import { createStorageBackup, createStorageExport, restoreStorageBackup } from "./storage/maintenance";
import { getStoragePaths, listStorageBackups, openDataFolder, type StorageBackupRecord, type StoragePaths } from "./storage/native";
import { APP_VERSION } from "./version";
import { clearProviderDebug, listProviderDebug } from "./providers/debug";
import { addProvider, PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER, refreshProviderModels } from "./providers/service";
import { sendPostRevealTurn } from "./sessions/postReveal";
import { parsePostRevealTranscript } from "./sessions/postRevealTranscript";
import { exportMonitorRun } from "./exports/monitor";
import { ensureBundledTrainingTargets } from "./targets/bundled";
import { createDefaultSettings } from "./startupDefaults";
import { SettingsSaveQueue } from "./storage/settingsSaveQueue";
import { AsyncRunGuard } from "./sessions/runGuard";
import { modelRouteKey, preferredModelOrder, profileNeedingInitialSetup, resolveRoleDefault, resolveViewerDefault, splitModelRouteKey } from "./profileModelDefaults";
import { defaultTemperatureForModel, profileGenerationDefaults, profileSystemPromptSnapshot, reasoningEffortForModel } from "./profileViewerDefaults";

type Page = "home" | "profiles" | "research" | "targets" | "settings" | "workspace";
type WorkspaceTab = "chat" | "rv" | "monitor";

export default function App() {
  const [repository, setRepository] = useState<AppRepository | null>(null);
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("chat");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [profileDialog, setProfileDialog] = useState(false);
  const [workspaceDialogFor, setWorkspaceDialogFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const settingsSaveQueueRef = useRef<{ repository: AppRepository; queue: SettingsSaveQueue } | null>(null);

  const copy = getCopy(settings.interfaceLanguage);
  const activeWorkspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? null;
  const lastWorkspace = workspaces[0] ?? null;
  const lastProfile =
    profiles.find((item) => item.id === (activeProfileId ?? lastWorkspace?.profileId)) ?? profiles[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    let stage = "repository.connect";
    setLoading(true);
    setInitializationError(null);
    void (async () => {
      try {
        const repo = await createRepository();
        stage = "starter-targets.seed";
        await ensureBundledTrainingTargets(repo);
        stage = "workspace-data.read";
        const [storedSettings, storedProfiles, storedWorkspaces] = await Promise.all([
          repo.loadSettings(),
          repo.listProfiles(),
          repo.listWorkspaces(),
        ]);
        if (cancelled) return;
        const nextSettings = { ...createDefaultSettings(), ...storedSettings };
        setRepository(repo);
        setSettings(nextSettings);
        setProfiles(storedProfiles);
        setWorkspaces(storedWorkspaces);
        setActiveProfileId(storedWorkspaces[0]?.profileId ?? storedProfiles[0]?.id ?? null);
        setActiveWorkspaceId(storedWorkspaces[0]?.id ?? null);
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`AI RV Harness initialization failed at ${stage}`, error);
        setRepository(null);
        setInitializationError(`${stage}: ${message}`);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initializationAttempt]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.interfaceLanguage;
    document.documentElement.dataset.textScale = settings.textScale;
    document.documentElement.dataset.animations = settings.animations ? "on" : "off";
    try {
      localStorage.setItem("rvh.ui.theme", settings.theme);
    } catch {
      // The SQLite setting remains canonical if WebView storage is unavailable.
    }
  }, [settings.animations, settings.interfaceLanguage, settings.textScale, settings.theme]);

  useEffect(() => {
    if (!repository || loading) return;
    if (settingsSaveQueueRef.current?.repository !== repository) {
      settingsSaveQueueRef.current = {
        repository,
        queue: new SettingsSaveQueue(
          (next) => repository.saveSettings(next),
          (error) => console.error("AI RV Harness settings save failed", error),
        ),
      };
    }
    settingsSaveQueueRef.current.queue.enqueue(settings);
  }, [repository, loading, settings]);

  const navigate = (destination: Page) => setPage(destination);

  const openWorkspace = async (workspace: Workspace) => {
    setActiveWorkspaceId(workspace.id);
    setActiveProfileId(workspace.profileId);
    setWorkspaceTab("chat");
    setPage("workspace");
    if (repository) {
      await repository.touchWorkspace(workspace.id);
      setWorkspaces(await repository.listWorkspaces());
    }
  };

  const createProfile = async (name: string, note: string | undefined, aiConfiguration: ProfileAiConfigurationInput) => {
    if (!repository) return;
    const profile = await repository.createProfile({ name, note, aiConfiguration });
    setProfiles(await repository.listProfiles());
    setActiveProfileId(profile.id);
    setProfileDialog(false);
  };

  const createWorkspace = async (profileId: string, name: string, description?: string) => {
    if (!repository) return;
    const workspace = await repository.createWorkspace({ profileId, name, description });
    setWorkspaces(await repository.listWorkspaces());
    setWorkspaceDialogFor(null);
    await openWorkspace(workspace);
  };

  const refreshProfiles = async () => {
    if (!repository) return;
    const [nextProfiles, nextWorkspaces] = await Promise.all([repository.listProfiles(), repository.listWorkspaces()]);
    setProfiles(nextProfiles);
    setWorkspaces(nextWorkspaces);
  };

  const updateSettings = (patch: Partial<AppSettings>) => setSettings((current) => ({ ...current, ...patch }));

  const finishFirstRun = async (profile: Profile) => {
    if (!repository) return;
    setProfiles(await repository.listProfiles());
    setActiveProfileId(profile.id);
    setPage("home");
  };

  const initialSetupProfile = profileNeedingInitialSetup(profiles);
  if (!loading && !initializationError && repository && (profiles.length === 0 || initialSetupProfile)) {
    return <FirstRunSetup copy={copy} repository={repository} existingProfile={initialSetupProfile} onComplete={finishFirstRun} />;
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} copy={copy} onNavigate={navigate} />
      <main className="main-pane">
        <TopBar
          copy={copy}
          profile={lastProfile}
          workspace={activeWorkspace}
          theme={settings.theme}
          onThemeChange={(theme) => updateSettings({ theme })}
        />
        <div className="content-scroll">
          {loading ? (
            <LoadingState />
          ) : initializationError ? (
            <InitializationErrorState
              copy={copy}
              error={initializationError}
              onRetry={() => setInitializationAttempt((current) => current + 1)}
            />
          ) : page === "home" ? (
            <HomeScreen
              copy={copy}
              profile={lastProfile}
              workspace={lastWorkspace}
              recent={workspaces.slice(0, 5)}
              profiles={profiles}
              onCreateProfile={() => setProfileDialog(true)}
              onOpenProfiles={() => navigate("profiles")}
              onOpenWorkspace={openWorkspace}
              onResearch={() => navigate("research")}
              onSettings={() => navigate("settings")}
            />
          ) : page === "profiles" ? (
            <ProfilesScreen
              copy={copy}
              profiles={profiles}
              workspaces={workspaces}
              onCreateProfile={() => setProfileDialog(true)}
              onCreateWorkspace={(profileId) => setWorkspaceDialogFor(profileId)}
              onOpenWorkspace={openWorkspace}
              repository={repository}
              onProfilesChanged={refreshProfiles}
            />
          ) : page === "research" ? (
            <ResearchScreen copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} />
          ) : page === "targets" ? (
            <TargetsScreen copy={copy} repository={repository} />
          ) : page === "settings" ? (
            <SettingsScreen copy={copy} settings={settings} repository={repository} onChange={updateSettings} />
          ) : activeWorkspace ? (
            <WorkspaceScreen
              copy={copy}
              settings={settings}
              profile={profiles.find((item) => item.id === activeWorkspace.profileId) ?? null}
              workspace={activeWorkspace}
              tab={workspaceTab}
              onTab={setWorkspaceTab}
              repository={repository}
            />
          ) : (
            <EmptyCard>{copy.noWorkspace}</EmptyCard>
          )}
        </div>
      </main>

      {profileDialog && repository && (
        <CreateProfileDialog copy={copy} repository={repository} onCancel={() => setProfileDialog(false)} onCreate={createProfile} />
      )}
      {workspaceDialogFor && (
        <CreateWorkspaceDialog
          copy={copy}
          profile={profiles.find((item) => item.id === workspaceDialogFor) ?? null}
          onCancel={() => setWorkspaceDialogFor(null)}
          onCreate={(name, description) => createWorkspace(workspaceDialogFor, name, description)}
        />
      )}
    </div>
  );
}

function FirstRunSetup({
  copy,
  repository,
  existingProfile,
  onComplete,
}: {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository;
  existingProfile: Profile | null;
  onComplete: (profile: Profile) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [connectionChoice, setConnectionChoice] = useState("__new__");
  const [providerKind, setProviderKind] = useState<ProviderKind>("openrouter");
  const [providerLabel, setProviderLabel] = useState(PROVIDER_LABELS.openrouter);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [viewerModelId, setViewerModelId] = useState("");
  const [viewerReasoning, setViewerReasoning] = useState<"" | ReasoningEffort>("");
  const [viewerTemperature, setViewerTemperature] = useState("");
  const [viewerSystemPrompt, setViewerSystemPrompt] = useState(existingProfile?.defaultViewerSystemPrompt ?? "");
  const [modelSearch, setModelSearch] = useState("");
  const [profileName, setProfileName] = useState(existingProfile?.name ?? "");
  const [judgeModelKey, setJudgeModelKey] = useState("");
  const [monitorModelKey, setMonitorModelKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = isTauriRuntime();
  const selectedProvider = providers.find((provider) => provider.id === connectionChoice) ?? null;
  const providerModels = useMemo(
    () => preferredModelOrder(models.filter((model) => model.providerConfigId === selectedProvider?.id)),
    [models, selectedProvider?.id],
  );
  const visibleViewerModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const matching = query
      ? providerModels.filter((model) => `${model.displayName} ${model.modelId}`.toLowerCase().includes(query))
      : providerModels;
    return matching.slice(0, 250);
  }, [modelSearch, providerModels]);
  const roleModels = useMemo(() => preferredModelOrder(models), [models]);
  const viewerModel = providerModels.find((model) => model.modelId === viewerModelId) ?? null;
  const cachedModelCount = models.filter((model) => model.providerConfigId === selectedProvider?.id).length;

  const reloadInventory = async (preferredProviderId?: string) => {
    const [nextProviders, nextModels] = await Promise.all([
      repository.listProviderConfigs(),
      repository.listProviderModels(),
    ]);
    setProviders(nextProviders);
    setModels(nextModels);
    setConnectionChoice((current) => {
      if (preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)) return preferredProviderId;
      if (nextProviders.some((provider) => provider.id === current)) return current;
      const bound = nextProviders.find((provider) => provider.credentialId === existingProfile?.credentialId);
      return bound?.id ?? nextProviders[0]?.id ?? "__new__";
    });
  };

  useEffect(() => {
    void reloadInventory().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [repository]);

  const changeProviderKind = (kind: ProviderKind) => {
    setProviderKind(kind);
    setProviderLabel(PROVIDER_LABELS[kind]);
  };

  const connectProvider = async () => {
    if (busy || !desktop) return;
    setBusy(true);
    setError(null);
    let provider = selectedProvider;
    try {
      if (!provider) {
        provider = await addProvider(repository, {
          provider: providerKind,
          label: providerLabel,
          apiKey,
          ...(providerKind === "custom_openai" ? { baseUrl } : {}),
        });
        setApiKey("");
      }
      await refreshProviderModels(repository, provider);
      await reloadInventory(provider.id);
      setViewerModelId("");
      setViewerReasoning("");
      setViewerTemperature("");
      setModelSearch("");
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await reloadInventory(provider?.id).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const selectViewerModel = (modelId: string) => {
    const model = providerModels.find((item) => item.modelId === modelId) ?? null;
    const sameStoredPair = existingProfile?.credentialId === selectedProvider?.credentialId && existingProfile?.defaultViewerModelId === modelId;
    setViewerModelId(modelId);
    setViewerReasoning(sameStoredPair ? reasoningEffortForModel(model, existingProfile?.defaultViewerReasoningEffort) ?? "" : "");
    const temperature = sameStoredPair && existingProfile?.defaultViewerTemperature !== undefined
      ? existingProfile.defaultViewerTemperature
      : defaultTemperatureForModel(model);
    setViewerTemperature(temperature === undefined ? "" : String(temperature));
  };

  const finish = async (skipOptional = false) => {
    const provider = providers.find((item) => item.id === connectionChoice);
    if (!provider || !viewerModel || busy) return;
    const temperature = viewerModel.capabilities.temperature.supported
      ? viewerTemperature.trim() ? Number(viewerTemperature) : defaultTemperatureForModel(viewerModel)
      : undefined;
    if (viewerReasoning && !reasoningEffortForModel(viewerModel, viewerReasoning)) { setError(copy.reasoningNotSupported); return; }
    if (viewerModel.capabilities.temperature.supported && (!Number.isFinite(temperature) || (viewerModel.capabilities.temperature.min !== undefined && temperature! < viewerModel.capabilities.temperature.min) || (viewerModel.capabilities.temperature.max !== undefined && temperature! > viewerModel.capabilities.temperature.max))) { setError(copy.temperatureOutOfRange); return; }
    const judge = skipOptional ? null : splitModelRouteKey(judgeModelKey);
    const monitor = skipOptional ? null : splitModelRouteKey(monitorModelKey);
    setBusy(true);
    setError(null);
    try {
      const aiConfiguration: ProfileAiConfigurationInput = {
          credentialId: provider.credentialId,
          credentialProvider: provider.provider,
          defaultViewerModelId: viewerModel.modelId,
          ...(viewerReasoning ? { defaultViewerReasoningEffort: viewerReasoning } : {}),
          ...(temperature !== undefined ? { defaultViewerTemperature: temperature } : {}),
          ...(viewerSystemPrompt.trim() ? { defaultViewerSystemPrompt: viewerSystemPrompt.trim() } : {}),
          ...(judge ? { defaultJudgeProviderConfigId: judge.providerConfigId, defaultJudgeModelId: judge.modelId } : {}),
          ...(monitor ? { defaultMonitorProviderConfigId: monitor.providerConfigId, defaultMonitorModelId: monitor.modelId } : {}),
      };
      const profile = existingProfile
        ? { ...existingProfile, name: profileName.trim(), ...aiConfiguration, updatedAt: new Date().toISOString() }
        : await repository.createProfile({ name: profileName, aiConfiguration });
      if (existingProfile) {
        await repository.updateProfile(existingProfile.id, { name: profileName, note: existingProfile.note });
        await repository.setProfileAiConfiguration(existingProfile.id, aiConfiguration);
      }
      await onComplete(profile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <main className="first-run-shell">
      <section className="first-run-card">
        <header className="first-run-header">
          <span className="first-run-logo"><Waves size={28} /></span>
          <div><small>AI RV Harness</small><h1>{copy.firstRunTitle}</h1><p>{copy.firstRunLead}</p></div>
        </header>
        <div className="first-run-progress" aria-label={`${copy.step} ${step}/3`}>
          <span className={step >= 1 ? "active" : ""}><b>1</b>{copy.setupProvider}</span>
          <span className={step >= 2 ? "active" : ""}><b>2</b>{copy.setupViewer}</span>
          <span className={step >= 3 ? "active" : ""}><b>3</b>{copy.setupRoles}</span>
        </div>

        {step === 1 && <div className="first-run-body">
          <div className="setup-section-heading"><KeyRound size={20} /><div><h2>{copy.setupProvider}</h2><p>{copy.setupProviderLead}</p></div></div>
          {!desktop && <div className="runtime-warning"><ShieldCheck size={16} />{copy.setupNeedsDesktop}</div>}
          {providers.length > 0 && <label>{copy.providerConnection}
            <select value={connectionChoice} onChange={(event) => setConnectionChoice(event.target.value)} disabled={busy}>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} · {provider.credentialHint ?? "••••••••"}</option>)}
              <option value="__new__">＋ {copy.newProviderConnection}</option>
            </select>
          </label>}
          {(!providers.length || connectionChoice === "__new__") && <div className="setup-provider-grid">
            <label>{copy.provider}<select value={providerKind} onChange={(event) => changeProviderKind(event.target.value as ProviderKind)} disabled={busy}>{PROVIDER_KINDS.map((kind) => <option key={kind} value={kind}>{PROVIDER_LABELS[kind]}</option>)}</select></label>
            <label>{copy.providerLabel}<input value={providerLabel} onChange={(event) => setProviderLabel(event.target.value)} disabled={busy} /></label>
            {providerKind === "custom_openai" && <label className="wide">{copy.baseUrl}<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={busy} placeholder="https://example.com/v1" /></label>}
            <label className="wide">{copy.apiKey}<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={busy} /></label>
          </div>}
          <small className="setup-security-note"><LockKeyhole size={13} />{copy.providersReady}</small>
          <div className="first-run-actions"><span>{selectedProvider && cachedModelCount > 0 && <button className="secondary-button" disabled={busy} onClick={() => { setViewerModelId(""); setModelSearch(""); setStep(2); }}>{copy.useCachedModels} ({cachedModelCount})</button>}</span><button className="primary-button" disabled={!desktop || busy || (!selectedProvider && (!providerLabel.trim() || !apiKey.trim() || (providerKind === "custom_openai" && !baseUrl.trim())))} onClick={() => void connectProvider()}>{busy ? copy.refreshing : copy.connectLoadModels}<ArrowRight size={15} /></button></div>
        </div>}

        {step === 2 && <div className="first-run-body">
          <div className="setup-section-heading"><Sparkles size={20} /><div><h2>{copy.setupViewer}</h2><p>{copy.setupViewerLead}</p></div></div>
          <div className="selected-provider-summary"><ServerIcon /><span><strong>{selectedProvider?.label}</strong><small>{selectedProvider?.credentialHint}</small></span><Check size={16} /></div>
          <label>{copy.modelSearch}<input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder={copy.modelSearchPlaceholder} /></label>
          <label>{copy.defaultViewerModel}<select size={Math.min(8, Math.max(3, visibleViewerModels.length))} value={viewerModelId} onChange={(event) => selectViewerModel(event.target.value)}>{visibleViewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label>
          {!visibleViewerModels.length && <p className="provider-empty">{copy.noMatchingModels}</p>}
          <ViewerProfileControls copy={copy} model={viewerModel} reasoning={viewerReasoning} temperature={viewerTemperature} systemPrompt={viewerSystemPrompt} onReasoning={setViewerReasoning} onTemperature={setViewerTemperature} onSystemPrompt={setViewerSystemPrompt} />
          <label>{copy.profileName}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={copy.profileNamePlaceholder} /></label>
          <small className="setup-security-note"><Users size={13} />{copy.profileMeaning}</small>
          <div className="first-run-actions"><button className="secondary-button" onClick={() => setStep(1)} disabled={busy}>{copy.back}</button><button className="primary-button" disabled={!viewerModelId || busy} onClick={() => setStep(3)}>{copy.continue}<ArrowRight size={15} /></button></div>
        </div>}

        {step === 3 && <div className="first-run-body">
          <div className="setup-section-heading"><BrainCircuit size={20} /><div><h2>{copy.setupRoles}</h2><p>{copy.setupRolesLead}</p></div></div>
          <div className="optional-role-grid">
            <label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><select value={judgeModelKey} onChange={(event) => setJudgeModelKey(event.target.value)}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const provider = providers.find((item) => item.id === model.providerConfigId); return <option key={`judge-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{provider?.label ?? model.provider} · {model.displayName}</option>; })}</select><small>{copy.judgeLead}</small></label>
            <label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><select value={monitorModelKey} onChange={(event) => setMonitorModelKey(event.target.value)}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const provider = providers.find((item) => item.id === model.providerConfigId); return <option key={`monitor-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{provider?.label ?? model.provider} · {model.displayName}</option>; })}</select><small>{copy.monitorGuard}</small></label>
          </div>
          <small className="setup-security-note"><Settings2 size={13} />{copy.changeDefaultsLater}</small>
          <div className="first-run-actions"><button className="secondary-button" onClick={() => setStep(2)} disabled={busy}>{copy.back}</button><span><button className="secondary-button" disabled={busy} onClick={() => void finish(true)}>{copy.skipOptionalAndFinish}</button><button className="primary-button" disabled={busy} onClick={() => void finish()}>{busy ? copy.saving : copy.finishSetup}<Check size={15} /></button></span></div>
        </div>}
        {error && <div className="provider-error first-run-error" role="alert">{error}</div>}
      </section>
    </main>
  );
}

function ServerIcon() {
  return <Database size={17} />;
}

function ViewerProfileControls({ copy, model, reasoning, temperature, systemPrompt, onReasoning, onTemperature, onSystemPrompt }: { copy: ReturnType<typeof getCopy>; model: ProviderModel | null; reasoning: "" | ReasoningEffort; temperature: string; systemPrompt: string; onReasoning: (value: "" | ReasoningEffort) => void; onTemperature: (value: string) => void; onSystemPrompt: (value: string) => void }) {
  const reasoningChoices = model?.capabilities.reasoning.efforts ?? [];
  const temperatureCapability = model?.capabilities.temperature;
  return <div className="profile-viewer-controls">
    <label><span>{copy.viewerReasoningLevel}</span><select value={reasoning} onChange={(event) => onReasoning(event.target.value as "" | ReasoningEffort)} disabled={!model || !reasoningChoices.length}><option value="">{copy.autoProviderDefault}</option>{reasoningChoices.map((effort) => <option key={effort} value={effort}>{effort.toUpperCase()}</option>)}</select><small>{!model ? copy.selectModelFirst : !model.capabilities.reasoning.supported ? copy.reasoningUnavailable : !reasoningChoices.length ? copy.reasoningLevelsUnknown : copy.autoReasoningLead}</small></label>
    <label><span>{copy.viewerTemperature}</span><input type="number" step="0.1" value={temperature} onChange={(event) => onTemperature(event.target.value)} disabled={!temperatureCapability?.supported} min={temperatureCapability?.min} max={temperatureCapability?.max} placeholder={temperatureCapability?.supported ? "0.9" : copy.notSupported} /><small>{temperatureCapability?.supported ? `${copy.temperatureDefaultLead}${temperatureCapability.min !== undefined || temperatureCapability.max !== undefined ? ` (${temperatureCapability.min ?? "−∞"}–${temperatureCapability.max ?? "+∞"})` : ""}` : copy.temperatureUnavailable}</small></label>
    <label className="profile-system-prompt-field"><span>{copy.viewerSystemPrompt}<small>{copy.optional}</small></span><textarea className="system-prompt-editor" rows={12} maxLength={100000} value={systemPrompt} onChange={(event) => onSystemPrompt(event.target.value)} placeholder={copy.viewerSystemPromptPlaceholder} /><small>{copy.viewerSystemPromptLead}</small></label>
  </div>;
}

function Sidebar({ page, copy, onNavigate }: { page: Page; copy: ReturnType<typeof getCopy>; onNavigate: (page: Page) => void }) {
  const items: Array<{ id: Page; icon: typeof Home; label: string }> = [
    { id: "home", icon: Home, label: copy.home },
    { id: "profiles", icon: Users, label: copy.profiles },
    { id: "research", icon: FlaskConical, label: copy.research },
    { id: "targets", icon: Crosshair, label: copy.targets },
    { id: "settings", icon: Settings2, label: copy.settings },
  ];
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("home")}>
        <span className="brand-mark"><Waves size={22} /></span>
        <span><strong>{copy.appName}</strong><small>{copy.tagline}</small></span>
      </button>
      <nav className="side-nav">
        {items.map((item) => {
          const Icon = item.icon;
          const active = page === item.id || (page === "workspace" && item.id === "profiles");
          return (
            <button key={item.id} className={active ? "nav-item active" : "nav-item"} onClick={() => onNavigate(item.id)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="privacy-badge"><ShieldCheck size={15} /><span>{copy.secureLocal}</span></div>
        <small>v{APP_VERSION} · MIT</small>
      </div>
    </aside>
  );
}

function TopBar({
  copy,
  profile,
  workspace,
  theme,
  onThemeChange,
}: {
  copy: ReturnType<typeof getCopy>;
  profile: Profile | null;
  workspace: Workspace | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const nextTheme: Theme = theme === "aurora" ? "light" : theme === "light" ? "dark" : "aurora";
  return (
    <header className="topbar">
      <div className="crumbs">
        {profile ? <><span className="avatar tiny">{initials(profile.name || copy.unnamedProfile)}</span><span>{profile.name || copy.unnamedProfile}</span></> : <span>{copy.noProfile}</span>}
        {workspace && <><ChevronRight size={15} /><strong>{workspace.name}</strong></>}
      </div>
      <div className="top-actions">
        <span className="runtime-pill"><Database size={14} />{isTauriRuntime() ? "SQLite" : "Preview"}</span>
        <button className="icon-button" title={copy.theme} onClick={() => onThemeChange(nextTheme)}>
          {theme === "light" ? <Sun size={18} /> : theme === "dark" ? <Moon size={18} /> : <Sparkles size={18} />}
        </button>
      </div>
    </header>
  );
}

function HomeScreen({
  copy,
  profile,
  workspace,
  recent,
  profiles,
  onCreateProfile,
  onOpenProfiles,
  onOpenWorkspace,
  onResearch,
  onSettings,
}: {
  copy: ReturnType<typeof getCopy>;
  profile: Profile | null;
  workspace: Workspace | null;
  recent: Workspace[];
  profiles: Profile[];
  onCreateProfile: () => void;
  onOpenProfiles: () => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onResearch: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="page home-page">
      <section className="hero-panel">
        <div className="eyebrow"><Sparkles size={14} /> {copy.foundation}</div>
        <h1>{copy.welcomeBack}</h1>
        <p>{copy.welcomeLead}</p>
        <div className="resume-grid">
          <ResumeCard
            label={copy.lastProfile}
            title={profile ? profile.name || copy.unnamedProfile : copy.noProfile}
            icon={profile ? <span className="avatar">{initials(profile.name || copy.unnamedProfile)}</span> : <Users size={22} />}
            action={profile ? copy.openProfile : copy.createProfile}
            onClick={profile ? onOpenProfiles : onCreateProfile}
          />
          <ResumeCard
            label={copy.lastWorkspace}
            title={workspace?.name ?? copy.noWorkspace}
            icon={<RadioTower size={22} />}
            action={workspace ? copy.openWorkspace : copy.profiles}
            onClick={workspace ? () => onOpenWorkspace(workspace) : onOpenProfiles}
          />
        </div>
      </section>

      <section className="feature-strip">
        <MiniStat icon={<LockKeyhole size={17} />} title={copy.blindIntegrity} value="Viewer ≠ Reveal" />
        <MiniStat icon={<Languages size={17} />} title={copy.versionedResources} value="RCP 1.5a · PL / EN" />
        <MiniStat icon={<ShieldCheck size={17} />} title={copy.secureLocal} value="SQLite · local artifacts" />
      </section>

      <div className="home-columns">
        <section className="panel">
          <PanelHeader title={copy.recentWorkspaces} icon={<Clock3 size={18} />} />
          {recent.length === 0 ? <p className="muted empty-copy">{copy.noRecent}</p> : (
            <div className="list-stack">
              {recent.map((item) => {
                const owner = profiles.find((profileItem) => profileItem.id === item.profileId);
                return (
                  <button className="recent-row" key={item.id} onClick={() => onOpenWorkspace(item)}>
                    <span className="recent-icon"><RadioTower size={18} /></span>
                    <span className="recent-copy"><strong>{item.name}</strong><small>{owner?.name ?? "—"}</small></span>
                    <ArrowRight size={16} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel quick-panel">
          <PanelHeader title={copy.home} icon={<Sparkles size={18} />} />
          <button className="quick-action" onClick={onResearch}><FlaskConical size={19} /><span>{copy.research}<small>Blind · locked · reproducible</small></span><ChevronRight size={16} /></button>
          <button className="quick-action" onClick={onOpenProfiles}><Users size={19} /><span>{copy.profiles}<small>Profile → Workspaces</small></span><ChevronRight size={16} /></button>
          <button className="quick-action" onClick={onSettings}><Settings2 size={19} /><span>{copy.settings}<small>PL / EN · Aurora · API</small></span><ChevronRight size={16} /></button>
        </section>
      </div>
    </div>
  );
}

function ResumeCard({ label, title, icon, action, onClick }: { label: string; title: string; icon: ReactNode; action: string; onClick: () => void }) {
  return (
    <button className="resume-card" onClick={onClick}>
      <span className="resume-icon">{icon}</span>
      <span className="resume-main"><small>{label}</small><strong>{title}</strong><span>{action} <ArrowRight size={14} /></span></span>
    </button>
  );
}

function MiniStat({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="mini-stat"><span>{icon}</span><div><small>{title}</small><strong>{value}</strong></div></div>;
}

function ProfilesScreen({
  copy,
  profiles,
  workspaces,
  onCreateProfile,
  onCreateWorkspace,
  onOpenWorkspace,
  repository,
  onProfilesChanged,
}: {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  onCreateProfile: () => void;
  onCreateWorkspace: (profileId: string) => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  repository: AppRepository | null;
  onProfilesChanged: () => Promise<void>;
}) {
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [calibrationHistory, setCalibrationHistory] = useState<CalibrationHistoryItem[]>([]);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!repository) return;
    void (async () => {
      const [configs, cachedModels, projects] = await Promise.all([repository.listProviderConfigs(), repository.listProviderModels(), repository.listResearchProjects()]);
      const reasoning = projects.filter((project) => project.state === "Complete" && project.templateType === "reasoning");
      const resultPairs = await Promise.all(reasoning.map(async (project) => [project.id, await repository.getResearchResults(project.id)] as const));
      const resultMap = new Map(resultPairs.filter((pair): pair is readonly [string, NonNullable<typeof pair[1]>] => Boolean(pair[1])));
      if (cancelled) return;
      setProviderConfigs(configs);
      setModels(cachedModels);
      setCalibrationHistory(profiles.flatMap((profile) => buildCalibrationHistory(projects, resultMap, profile, configs)));
    })();
    return () => { cancelled = true; };
  }, [repository, profiles]);
  const archiveProfile = async (profile: Profile) => {
    if (!repository || !window.confirm(`${copy.archiveProfileConfirm}\n\n${profile.name || copy.unnamedProfile}`)) return;
    await repository.archiveProfile(profile.id);
    await onProfilesChanged();
  };
  const saveProfile = async (name: string, note?: string, aiConfiguration?: ProfileAiConfigurationInput) => {
    if (!repository || !editingProfile) return;
    if (aiConfiguration && editingProfile.credentialId && editingProfile.credentialId !== aiConfiguration.credentialId && !window.confirm(copy.calibrationBindingWarning)) return;
    await repository.updateProfile(editingProfile.id, { name, note });
    if (aiConfiguration) await repository.setProfileAiConfiguration(editingProfile.id, aiConfiguration);
    setEditingProfile(null);
    await onProfilesChanged();
  };
  return (
    <div className="page">
      <PageHeader title={copy.profiles} subtitle={copy.profileMeaning} action={<button className="primary-button" onClick={onCreateProfile}><Plus size={16} />{copy.createProfile}</button>} />
      {profiles.length === 0 ? (
        <EmptyState icon={<Users size={28} />} title={copy.noProfile} body={copy.profileMeaning} action={<button className="primary-button" onClick={onCreateProfile}><Plus size={16} />{copy.createProfile}</button>} />
      ) : (
        <div className="profile-grid">
          {profiles.map((profile) => {
            const owned = workspaces.filter((workspace) => workspace.profileId === profile.id);
            const boundProvider = providerConfigs.find((provider) => provider.credentialId === profile.credentialId) ?? null;
            const viewerReady = Boolean(resolveViewerDefault(profile, boundProvider, models));
            return (
              <section className="profile-card" key={profile.id}>
                <div className="profile-heading">
                  <span className="avatar large">{initials(profile.name || copy.unnamedProfile)}</span>
                  <div><h3>{profile.name || copy.unnamedProfile}</h3><p>{profile.note || copy.credentialPending}</p></div>
                  <span className={`status-chip ${viewerReady ? "ready" : "next"}`}><KeyRound size={13} />{viewerReady ? copy.aiDefaultsReady : copy.aiDefaultsIncomplete}</span>
                </div>
                <div className="workspace-list">
                  {owned.length === 0 ? <p className="muted">{copy.noWorkspace}</p> : owned.map((workspace) => (
                    <button key={workspace.id} className="workspace-row" onClick={() => onOpenWorkspace(workspace)}>
                      <span><RadioTower size={17} /><strong>{workspace.name}</strong></span><ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                <CalibrationHistory copy={copy} items={calibrationHistory.filter((item) => item.profileId === profile.id)} />
                <div className="profile-actions"><button className="secondary-button" onClick={() => setEditingProfile(profile)}><Pencil size={14} />{copy.editProfile}</button><button className="secondary-button danger-action" onClick={() => void archiveProfile(profile)}><Archive size={14} />{copy.archiveProfile}</button></div>
                <button className="secondary-button full" onClick={() => onCreateWorkspace(profile.id)}><Plus size={16} />{copy.createWorkspace}</button>
              </section>
            );
          })}
        </div>
      )}
      {editingProfile && <EditProfileDialog copy={copy} profile={editingProfile} providers={providerConfigs} models={models} onCancel={() => setEditingProfile(null)} onSave={saveProfile} />}
    </div>
  );
}

function CalibrationHistory({ copy, items }: { copy: ReturnType<typeof getCopy>; items: CalibrationHistoryItem[] }) {
  return <section className="calibration-history"><div className="calibration-history-head"><strong>{copy.calibrationHistory}</strong><small>{items.length}</small></div>{items.length ? <div className="calibration-list">{items.slice(0, 5).map((item) => <article key={item.projectId}><div><strong>{item.modelId}</strong><span className={`status-chip ${item.historical ? "next" : "ready"}`}>{item.historical ? copy.historicalCalibration : copy.currentPairing}</span></div><small>{item.providerLabel}{item.credentialHint ? ` · ${item.credentialHint}` : ""}</small><dl><div><dt>{copy.lastCalibration}</dt><dd>{new Date(item.completedAt).toLocaleDateString()}</dd></div><div><dt>{copy.tested}</dt><dd>{item.tested.join(" / ")}</dd></div><div><dt>{copy.bestObserved}</dt><dd>{item.bestObserved.join(" / ") || "—"}</dd></div><div><dt>n</dt><dd>{item.n}</dd></div></dl></article>)}</div> : <p>{copy.noCalibrationHistory}</p>}</section>;
}

function WorkspaceScreen({ copy, settings, profile, workspace, tab, onTab, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; tab: WorkspaceTab; onTab: (tab: WorkspaceTab) => void; repository: AppRepository | null }) {
  return (
    <div className="page workspace-page">
      <PageHeader title={workspace.name} subtitle={workspace.description || `${profile ? profile.name || copy.unnamedProfile : "—"} · ${copy.workspace}`} />
      <div className="module-tabs">
        <button className={tab === "chat" ? "module-tab active" : "module-tab"} onClick={() => onTab("chat")}><MessageCircle size={17} />{copy.chat}</button>
        <button className={tab === "rv" ? "module-tab active" : "module-tab"} onClick={() => onTab("rv")}><Crosshair size={17} />{copy.rvSession}</button>
        <button className={tab === "monitor" ? "module-tab active" : "module-tab"} onClick={() => onTab("monitor")}><BrainCircuit size={17} />{copy.aiMonitor}</button>
      </div>
      {tab === "chat" ? <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} /> : tab === "rv" ? <RvSessionPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} /> : <MonitorPanel copy={copy} workspace={workspace} repository={repository} />}
    </div>
  );
}

function ChatPanel({ copy, settings, profile, workspace, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; repository: AppRepository | null }) {
  const [mode, setMode] = useState<ChatMode>("conversation");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [savedThreadTitle, setSavedThreadTitle] = useState("");
  const [formalRvState, setFormalRvState] = useState<ChatThread["formalRvState"]>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const [chatImages, setChatImages] = useState<ProviderImageInput[]>([]);
  const [chatImageNames, setChatImageNames] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [input, setInput] = useState("");
  const [attachRcp, setAttachRcp] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const activeProvider = providerConfigs.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const selectedModel = models.find((item) => item.modelId === modelId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const [configs, thread] = await Promise.all([
        repository.listProviderConfigs(),
        repository.getOrCreateChatThread(workspace.id, mode),
      ]);
      if (cancelled) return;
      setProviderConfigs(configs);
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setFormalRvState(thread.formalRvState);
      const bound = configs.find((item) => item.credentialId === profile?.credentialId);
      const [nextModels, nextMessages, nextSources, nextActiveSources] = await Promise.all([
        bound ? repository.listProviderModels(bound.id) : Promise.resolve([]),
        repository.listChatMessages(thread.id),
        repository.listWorkspaceSources(workspace.id),
        repository.listActiveChatSourceIds(thread.id),
      ]);
      if (cancelled) return;
      setModels(nextModels);
      setMessages(nextMessages);
      setSources(nextSources);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
      setModelId(resolveViewerDefault(profile, bound ?? null, nextModels));
      setError(null);
    })();
    return () => { cancelled = true; };
  }, [repository, workspace.id, profile?.credentialId, profile?.defaultViewerModelId, mode]);

  useEffect(() => {
    if (selectedModel && (!selectedModel.capabilities.supportsVision || !selectedModel.capabilities.inputModalities.includes("image"))) {
      setChatImages([]);
      setChatImageNames([]);
    }
  }, [selectedModel?.modelId]);

  const selectedSources = sources.filter((source) => activeSourceIds.includes(source.id));
  const estimatedContext = estimateTextTokens(messages.map((message) => message.content).join("\n\n") + "\n" + input) + selectedSources.reduce((sum, source) => sum + estimateTextTokens(source.content), 0);
  const reservedOutput = selectedModel ? Math.min(selectedModel.capabilities.maxOutputTokens ?? 4096, 4096) : 0;
  const contextExceeded = Boolean(selectedModel?.capabilities.contextTokens && estimatedContext + reservedOutput > selectedModel.capabilities.contextTokens);

  const toggleSource = async (sourceId: string) => {
    if (!repository || !threadId) return;
    const active = !activeSourceIds.includes(sourceId);
    await repository.setChatSourceActive(threadId, sourceId, active);
    setActiveSourceIds((current) => active ? [...new Set([...current, sourceId])] : current.filter((id) => id !== sourceId));
  };

  const importSources = async (files: FileList | null) => {
    if (!repository || !threadId || !files?.length) return;
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().match(/\.(txt|md)$/)) throw new Error("Workspace Source must be a .txt or .md file.");
        const source = await createTextWorkspaceSource(repository, workspace.id, file.name, await file.text());
        await repository.setChatSourceActive(threadId, source.id, true);
        setSources((current) => [source, ...current]);
        setActiveSourceIds((current) => [...new Set([...current, source.id])]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const removeSource = async (source: WorkspaceSource) => {
    if (!repository || !window.confirm(`${copy.removeSource}: ${source.displayName}?`)) return;
    await repository.deleteWorkspaceSource(source.id);
    setSources((current) => current.filter((item) => item.id !== source.id));
    setActiveSourceIds((current) => current.filter((id) => id !== source.id));
  };

  const attachChatImages = async (files: FileList | null) => {
    if (!files?.length || !selectedModel) return;
    if (!selectedModel.capabilities.supportsVision || !selectedModel.capabilities.inputModalities.includes("image")) { setError(copy.modelNoVision); return; }
    try {
      const fileArray = Array.from(files).slice(0, 8);
      setChatImages(await Promise.all(fileArray.map(imageFileToProviderInput)));
      setChatImageNames(fileArray.map((file) => file.name));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const send = async () => {
    const content = input.trim();
    if (!repository || !threadId || !activeProvider || !selectedModel || !content || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    setMessages((current) => [...current, { id: "pending-user", threadId, role: "user", content, createdAt: new Date().toISOString() }]);
    try {
      await sendChatTurn({
        repository,
        threadId,
        mode,
        language,
        providerConfig: activeProvider,
        model: selectedModel,
        content,
        requestedSettings: profileGenerationDefaults(profile, selectedModel),
        ...(mode === "manual_rv" && profile?.defaultViewerSystemPrompt ? { rvSystemPrompt: profile.defaultViewerSystemPrompt } : {}),
        sources: selectedSources,
        images: chatImages,
        ...(mode === "manual_rv" && attachRcp ? { attachedProtocol: getFullRcp(language).content } : {}),
      });
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMessages(await repository.listChatMessages(threadId));
      setSending(false);
    }
  };

  const renameThread = async () => {
    if (!repository || !threadId || !threadTitle.trim() || threadTitle.trim() === savedThreadTitle) return;
    try {
      await repository.renameChatThread(threadId, threadTitle);
      setThreadTitle(threadTitle.trim());
      setSavedThreadTitle(threadTitle.trim());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const advanceFormalRvState = async () => {
    if (!repository || !threadId || mode !== "manual_rv") return;
    const next: ChatThread["formalRvState"] = !formalRvState ? "BLIND" : formalRvState === "BLIND" ? "REVEALED" : undefined;
    try {
      await repository.setChatThreadFormalRvState(threadId, next);
      setFormalRvState(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return (
    <section className="chat-surface">
      <div className="chat-toolbar">
        <div className="segmented large-segmented">
          <button className={mode === "conversation" ? "active" : ""} onClick={() => setMode("conversation")}><MessageCircle size={16} />{copy.conversation}</button>
          <button className={mode === "manual_rv" ? "active" : ""} onClick={() => setMode("manual_rv")}><Crosshair size={16} />{copy.manualRv}</button>
        </div>
        <span className={mode === "conversation" ? "context-badge conversation" : "context-badge blind"}>
          {mode === "conversation" ? <Sparkles size={14} /> : <LockKeyhole size={14} />}
          {mode === "conversation" ? copy.systemActive : profile?.defaultViewerSystemPrompt ? copy.viewerSystemActive : copy.systemEmpty}
        </span>
      </div>
      <div className="chat-thread-bar">
        <label><span>{copy.threadTitle}</span><input value={threadTitle} maxLength={160} onChange={(event) => setThreadTitle(event.target.value)} /></label>
        <button className="secondary-button" disabled={!threadTitle.trim() || threadTitle.trim() === savedThreadTitle} onClick={() => void renameThread()}><Pencil size={13} />{copy.renameThread}</button>
        {mode === "manual_rv" && <div className="formal-rv-control"><span className={`formal-rv-state ${formalRvState?.toLowerCase() ?? "idle"}`}><LockKeyhole size={13} />{copy.formalManualState}: {formalRvState ?? "—"}</span><button className="secondary-button" onClick={() => void advanceFormalRvState()}>{!formalRvState ? copy.startFormalRv : formalRvState === "BLIND" ? copy.markRevealed : copy.endFormalRv}</button></div>}
      </div>
      <div className="chat-model-bar">
        <span><KeyRound size={14} />{activeProvider?.label ?? copy.credentialPending}</span>
        <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!activeProvider || !models.length || sending}>
          <option value="">{models.length ? copy.selectModel : copy.noCachedModels}</option>
          {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.recommended ? "★ " : ""}{model.displayName}</option>)}
        </select>
        {mode === "manual_rv" && <label className="protocol-toggle"><input type="checkbox" checked={attachRcp} onChange={(event) => setAttachRcp(event.target.checked)} disabled={sending} /><span>{copy.attachRcp}</span></label>}
      </div>
      <div className="context-banner">
        <span className={mode === "conversation" ? "banner-icon violet" : "banner-icon cyan"}>{mode === "conversation" ? <MessageCircle size={22} /> : <ShieldCheck size={22} />}</span>
        <div><strong>{mode === "conversation" ? copy.conversationTitle : copy.manualTitle}</strong><p>{mode === "conversation" ? copy.conversationDesc : copy.manualDesc}</p></div>
      </div>
      <details className="chat-sources"><summary><span><FileCheck2 size={14} />{copy.workspaceSources}</span><small>{copy.activeSources}: {activeSourceIds.length} · {copy.estimatedContext}: ~{estimatedContext.toLocaleString()} tokens</small></summary><div className="chat-source-body"><div className="chat-source-actions"><label className="secondary-button">{copy.addSource}<input type="file" multiple accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void importSources(event.target.files)} /></label></div>{sources.length ? <div className="chat-source-list">{sources.map((source) => <label key={source.id}><input type="checkbox" checked={activeSourceIds.includes(source.id)} onChange={() => void toggleSource(source.id)} /><span><strong>{source.displayName}</strong><small>~{estimateTextTokens(source.content).toLocaleString()} tokens</small></span><button type="button" className="icon-button danger" title={copy.removeSource} onClick={(event) => { event.preventDefault(); void removeSource(source); }}><X size={13} /></button></label>)}</div> : <p>{copy.noSources}</p>}{contextExceeded && <div className="source-context-error">{copy.contextExceeded}</div>}</div></details>
      {messages.length === 0 ? <div className="chat-empty"><div className="empty-orbit"><Waves size={32} /></div><h3>{copy.cleanBoundary}</h3><p>{activeProvider ? copy.noChatMessages : copy.providerNeeded}</p></div> : <div className="message-list">{messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}><span>{message.role === "user" ? initials(profile?.name || copy.unnamedProfile) : "AI"}</span><div><small>{message.role === "user" ? profile?.name || copy.unnamedProfile : selectedModel?.displayName ?? "AI"}</small><p>{message.content}</p></div></article>)}{sending && <div className="typing-row"><span className="loader-orb" />{copy.sending}</div>}</div>}
      {error && <div className="provider-error chat-error">{error}</div>}
      <div className="composer">
        <textarea rows={2} placeholder={copy.messagePlaceholder} value={input} onChange={(event) => setInput(event.target.value)} disabled={!selectedModel || sending} />
        <div className="composer-actions"><label className={`composer-image-button ${selectedModel?.capabilities.supportsVision ? "" : "disabled"}`} title={selectedModel?.capabilities.supportsVision ? copy.addImage : copy.modelNoVision}>▣<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={!selectedModel?.capabilities.supportsVision || sending} onChange={(event) => void attachChatImages(event.target.files)} /></label><button disabled={!selectedModel || !input.trim() || sending || contextExceeded} onClick={() => void send()}>{sending ? copy.sending : copy.send}<ArrowRight size={15} /></button></div>
      </div>
      {chatImageNames.length > 0 && <div className="chat-image-chips"><small>{copy.attachedImages}</small>{chatImageNames.map((name) => <span key={name}>{name}</span>)}</div>}
    </section>
  );
}

function RvSessionPanel({ copy, settings, profile, workspace, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; repository: AppRepository | null }) {
  const [executionScope, setExecutionScope] = useState<"single" | "batch">("single");
  const [runType, setRunType] = useState<"automatic" | "monitor">("automatic");
  const [protocol, setProtocol] = useState<"rcp" | "lite" | "custom">("rcp");
  const [revealSource, setRevealSource] = useState<"automatic" | "external">(settings.defaultRevealSource);
  const [sessionLanguage, setSessionLanguage] = useState<SessionLanguageSetting>(settings.sessionLanguage);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [allModels, setAllModels] = useState<ProviderModel[]>([]);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [targetUsage, setTargetUsage] = useState<TargetUsageRecord[]>([]);
  const [customProtocols, setCustomProtocols] = useState<CustomProtocolVersion[]>([]);
  const [customProtocolVersionId, setCustomProtocolVersionId] = useState("");
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);
  const [customBuilderNew, setCustomBuilderNew] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState("__random__");
  const [modelId, setModelId] = useState("");
  const [monitorModelKey, setMonitorModelKey] = useState("");
  const [reasoning, setReasoning] = useState<"" | ReasoningEffort>("");
  const [temperature, setTemperature] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(settings.defaultMaxOutputTokens));
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [revealText, setRevealText] = useState("");
  const [revealArtifacts, setRevealArtifacts] = useState<RevealArtifactRecord[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [acceptedRevealText, setAcceptedRevealText] = useState("");
  const [acceptedRevealArtifacts, setAcceptedRevealArtifacts] = useState<RevealArtifactRecord[]>([]);
  const [saveTargetTitle, setSaveTargetTitle] = useState("");
  const [targetSaved, setTargetSaved] = useState(false);
  const [recentSessions, setRecentSessions] = useState<RvSession[]>([]);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<TargetClarificationRecord[]>([]);
  const [clarificationOpen, setClarificationOpen] = useState(false);
  const [clarificationText, setClarificationText] = useState("");
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [postRevealTranscript, setPostRevealTranscript] = useState("");
  const [postRevealText, setPostRevealText] = useState("");
  const [postRevealBusy, setPostRevealBusy] = useState(false);
  const [batchCollection, setBatchCollection] = useState<"all" | "training" | "user">("all");
  const [batchCount, setBatchCount] = useState(3);
  const [batchProgress, setBatchProgress] = useState<OrdinaryBatchProgress | null>(null);
  const [batchResults, setBatchResults] = useState<OrdinaryBatchSessionResult[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [sessionRunning, setSessionRunning] = useState(false);
  const [batchPreflightSignature, setBatchPreflightSignature] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runGuardRef = useRef(new AsyncRunGuard());
  const resolvedLanguage = resolveSessionLanguage(settings.interfaceLanguage, sessionLanguage);
  const rcp = getFullRcp(resolvedLanguage);
  const rvLite = getRvLite(resolvedLanguage);
  const activeProvider = providerConfigs.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const selectedModel = models.find((item) => item.modelId === modelId) ?? null;
  const monitorModel = allModels.find((item) => `${item.providerConfigId}::${item.modelId}` === monitorModelKey) ?? null;
  const monitorProvider = monitorModel ? providerConfigs.find((item) => item.id === monitorModel.providerConfigId) ?? null : null;
  const usedByProfile = new Set(targetUsage.filter((usage) => usage.profileId === profile?.id).map((usage) => usage.targetId));
  const eligibleTargets = targets.filter((target) => targetHasSupportedReveal(target) && (settings.targetRepeatPolicy === "allow" || target.collection !== "training" || !usedByProfile.has(target.id)));
  const batchPool = eligibleTargets.filter((target) => batchCollection === "all" || target.collection === batchCollection);
  const batchConfigSignature = JSON.stringify({ providerConfigId: activeProvider?.id ?? null, providerStatus: activeProvider?.lastStatus ?? null, providerTestedAt: activeProvider?.lastTestedAt ?? null, modelId, protocol, customProtocolVersionId, runType, monitorModelKey, sessionLanguage: resolvedLanguage, reasoning, temperature, profileSystemPrompt: profile?.defaultViewerSystemPrompt ?? null, maxOutputTokens, requestTimeoutMs: settings.requestTimeoutMs, maxRetries: settings.maxRetries, maxSessionCostUsd: settings.maxSessionCostUsd, sessionCodePrefix: settings.sessionCodePrefix, targetRepeatPolicy: settings.targetRepeatPolicy, batchCollection, batchCount, targetIds: batchPool.map((target) => target.id).sort() });
  const selectedCustomProtocol = customProtocols.find((item) => item.versionId === customProtocolVersionId) ?? null;
  const activeStepCount = protocol === "custom" ? selectedCustomProtocol?.steps.length ?? 0 : protocol === "lite" ? 4 : 6;
  const running = sessionRunning || batchRunning || progress?.state === "BlindRunning" || progress?.state === "Preflight";
  const activeTarget = activeTargetId ? targets.find((target) => target.id === activeTargetId) ?? null : null;
  const clarificationEligible = Boolean(progress && (progress.state === "Revealed" || progress.state === "Completed") && (!activeTargetId || activeTarget?.collection === "user"));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const configs = await repository.listProviderConfigs();
      if (cancelled) return;
      setProviderConfigs(configs);
      const bound = configs.find((item) => item.credentialId === profile?.credentialId);
      const [nextModels, everyModel, targetCatalog, usageHistory, sessionHistory] = await Promise.all([
        bound ? repository.listProviderModels(bound.id) : Promise.resolve([]),
        repository.listProviderModels(),
        repository.listTargets(),
        repository.listTargetUsage(),
        repository.listRvSessions(workspace.id),
      ]);
      if (cancelled) return;
      setModels(nextModels);
      setAllModels(everyModel);
      setTargets(targetCatalog);
      setTargetUsage(usageHistory);
      setRecentSessions(sessionHistory.filter((session) => !session.researchProjectId));
      setModelId(resolveViewerDefault(profile, bound ?? null, nextModels));
      setMonitorModelKey(resolveRoleDefault(profile, "monitor", everyModel));
    })();
    return () => { cancelled = true; };
  }, [repository, profile?.credentialId, profile?.defaultViewerModelId, profile?.defaultViewerReasoningEffort, profile?.defaultViewerTemperature, profile?.defaultMonitorProviderConfigId, profile?.defaultMonitorModelId, workspace.id]);

  useEffect(() => {
    let cancelled = false;
    if (!repository) return;
    void repository.listCustomProtocols(resolvedLanguage).then((items) => {
      if (cancelled) return;
      setCustomProtocols(items);
      setCustomProtocolVersionId((current) => items.some((item) => item.versionId === current) ? current : items[0]?.versionId ?? "");
    });
    return () => { cancelled = true; };
  }, [repository, resolvedLanguage]);

  useEffect(() => {
    if (!selectedModel) return;
    const limit = selectedModel.capabilities.maxOutputTokens;
    const profileDefaults = profileGenerationDefaults(profile, selectedModel);
    setMaxOutputTokens(String(limit ? Math.min(limit, settings.defaultMaxOutputTokens) : settings.defaultMaxOutputTokens));
    setReasoning(profileDefaults.reasoningEffort ?? "");
    setTemperature(profileDefaults.temperature === undefined ? "" : String(profileDefaults.temperature));
  }, [selectedModel?.modelId, profile?.defaultViewerModelId, profile?.defaultViewerReasoningEffort, profile?.defaultViewerTemperature, settings.defaultMaxOutputTokens]);

  const preflightBatch = () => {
    const failures: string[] = [];
    if (!activeProvider || activeProvider.lastStatus !== "ok") failures.push(copy.batchProviderPreflight);
    if (!selectedModel) failures.push(copy.selectModel);
    if (protocol === "custom" && !selectedCustomProtocol) failures.push(copy.noCustomProtocols);
    if (runType === "monitor" && protocol !== "rcp") failures.push(copy.customMonitorNote);
    if (runType === "monitor" && (!monitorModel || !monitorProvider)) failures.push(copy.monitorModel);
    if (!Number.isFinite(Number(maxOutputTokens)) || Number(maxOutputTokens) <= 0) failures.push(copy.maxOutputTokens);
    if (batchCount < 1 || batchCount > batchPool.length) failures.push(copy.batchTargetPreflight);
    if (failures.length) {
      setBatchPreflightSignature(null);
      setRunError(`${copy.preflightFailed}: ${failures.join(" · ")}`);
      return;
    }
    setBatchPreflightSignature(batchConfigSignature);
    setRunError(null);
  };

  const start = async () => {
    if (!repository || !profile || !activeProvider || !selectedModel) return;
    if (protocol === "custom" && !selectedCustomProtocol) return;
    if (protocol !== "rcp" && runType === "monitor") return;
    if (runType === "monitor" && (!monitorModel || !monitorProvider)) return;
    const automaticTarget = executionScope === "single" && revealSource === "automatic"
      ? selectedTargetId === "__random__" ? chooseRandomTarget(eligibleTargets) : eligibleTargets.find((target) => target.id === selectedTargetId) ?? null
      : null;
    if (executionScope === "single" && revealSource === "automatic" && !automaticTarget) return;
    if (executionScope === "batch" && (batchCount < 1 || batchCount > batchPool.length || batchPreflightSignature !== batchConfigSignature)) return;
    const batchTargets = executionScope === "batch" ? selectBatchTargets(batchPool, batchCount) : [];
    let rvSystemPrompt: Awaited<ReturnType<typeof profileSystemPromptSnapshot>>;
    try { rvSystemPrompt = await profileSystemPromptSnapshot(profile); }
    catch (cause) { setRunError(cause instanceof Error ? cause.message : String(cause)); return; }
    if (!runGuardRef.current.tryAcquire()) return;
    setSessionRunning(true);
    setActiveTargetId(executionScope === "single" ? automaticTarget?.id ?? null : null);
    setRunError(null);
    setRevealText("");
    setRevealArtifacts([]);
    setAcceptedRevealText("");
    setAcceptedRevealArtifacts([]);
    setSaveTargetTitle("");
    setTargetSaved(false);
    setClarifications([]);
    setClarificationOpen(false);
    setClarificationText("");
    setPostRevealTranscript("");
    setPostRevealText("");
    setBatchResults([]);
    setBatchProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const requestedSettings = {
      ...(reasoning ? { reasoningEffort: reasoning } : {}),
      ...(temperature.trim() ? { temperature: Number(temperature) } : {}),
      ...(maxOutputTokens.trim() ? { maxOutputTokens: Number(maxOutputTokens) } : {}),
    };
    const runOne = async (target: TargetRecord | null) => {
      if (protocol === "lite") {
        return runAutomaticRvLiteSession({ repository, workspaceId: workspace.id, profileId: profile.id, profileName: profile.name, providerConfig: activeProvider, model: selectedModel, protocol: rvLite, sessionLanguage: resolvedLanguage, requestedSettings, ...(rvSystemPrompt ? { rvSystemPrompt } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, sessionCodePrefix: settings.sessionCodePrefix, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), onProgress: setProgress, ...(target ? { automaticTarget: target } : {}) });
      }
      if (protocol === "custom" && selectedCustomProtocol) {
        return runAutomaticCustomSession({ repository, workspaceId: workspace.id, profileId: profile.id, providerConfig: activeProvider, model: selectedModel, protocol: selectedCustomProtocol, sessionLanguage: resolvedLanguage, requestedSettings, ...(rvSystemPrompt ? { rvSystemPrompt } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, sessionCodePrefix: settings.sessionCodePrefix, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), onProgress: setProgress, ...(target ? { automaticTarget: target } : {}) });
      }
      return runAutomaticRcpSession({
        repository,
        workspaceId: workspace.id,
        profileId: profile.id,
        providerConfig: activeProvider,
        model: selectedModel,
        protocol: rcp,
        sessionLanguage: resolvedLanguage,
        requestedSettings,
        ...(rvSystemPrompt ? { rvSystemPrompt } : {}),
        signal: controller.signal,
        maxRetries: settings.maxRetries,
        requestTimeoutMs: settings.requestTimeoutMs,
        sessionCodePrefix: settings.sessionCodePrefix,
        ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}),
        onProgress: setProgress,
        ...(target ? { automaticTarget: target } : {}),
        ...(runType === "monitor" && monitorModel && monitorProvider ? { monitor: { providerConfig: monitorProvider, model: monitorModel } } : {}),
      });
    };
    try {
      if (executionScope === "batch") {
        setBatchRunning(true);
        await runOrdinaryBatch({
          targets: batchTargets,
          signal: controller.signal,
          onProgress: setBatchProgress,
          onSessionComplete: (result) => setBatchResults((current) => [...current, result]),
          runSession: async (target) => {
            setActiveTargetId(target.id);
            return runOne(target);
          },
        });
      } else {
        await runOne(automaticTarget);
      }
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      runGuardRef.current.release();
      setSessionRunning(false);
      setBatchRunning(false);
      abortRef.current = null;
      try {
        const [sessions, usage] = await Promise.all([repository.listRvSessions(workspace.id), repository.listTargetUsage()]);
        setRecentSessions(sessions.filter((session) => !session.researchProjectId));
        setTargetUsage(usage);
      } catch (cause) {
        setRunError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  };

  const submitReveal = async () => {
    if (!repository || !progress?.sessionId) return;
    setRunError(null);
    try {
      const submittedText = revealText.trim();
      await submitExternalReveal(repository, progress.sessionId, submittedText, revealArtifacts);
      setProgress((current) => current ? { ...current, state: "Revealed" } : current);
      setAcceptedRevealText(submittedText);
      setAcceptedRevealArtifacts([...revealArtifacts]);
      setRevealText("");
      setRevealArtifacts([]);
      setRecentSessions((await repository.listRvSessions(workspace.id)).filter((session) => !session.researchProjectId));
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const attachRevealFiles = async (files: FileList | null) => {
    if (!files?.length || !progress?.sessionId) return;
    setArtifactBusy(true);
    setRunError(null);
    try {
      const stored: RevealArtifactRecord[] = [];
      const textParts: string[] = [];
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".txt") || lower.endsWith(".md") || file.type === "text/plain" || file.type === "text/markdown") textParts.push((await file.text()).trim());
        stored.push(await storeRevealArtifact(progress.sessionId, file));
      }
      setRevealArtifacts((current) => [...current, ...stored]);
      if (textParts.filter(Boolean).length) setRevealText((current) => [current.trim(), ...textParts.filter(Boolean)].filter(Boolean).join("\n\n---\n\n"));
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setArtifactBusy(false);
    }
  };

  const saveExternalRevealTarget = async () => {
    if (!repository || (!acceptedRevealText && !acceptedRevealArtifacts.length) || !saveTargetTitle.trim()) return;
    try {
      const target = await createUserTarget(repository, { title: saveTargetTitle, ...(acceptedRevealText ? { revealText: acceptedRevealText } : {}), ...(acceptedRevealArtifacts.length ? { revealArtifacts: acceptedRevealArtifacts } : {}), source: "external_blind_session" });
      setTargets((current) => [target, ...current]);
      setTargetSaved(true);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const customProtocolSaved = (saved: CustomProtocolVersion) => {
    setCustomProtocols((current) => [saved, ...current.filter((item) => item.versionId !== saved.versionId)]);
    setCustomProtocolVersionId(saved.versionId);
    setCustomBuilderOpen(false);
  };

  const loadStoredSession = async (session: RvSession) => {
    setExecutionScope("single");
    setProgress({ sessionId: session.id, sessionCode: session.sessionCode, state: session.state, transcript: session.preRevealTranscript });
    setActiveTargetId(session.targetId ?? null);
    setRunError(null); setRevealText(""); setRevealArtifacts([]); setAcceptedRevealText(""); setAcceptedRevealArtifacts([]); setTargetSaved(false); setClarificationOpen(false); setClarificationText(""); setPostRevealTranscript(session.postRevealTranscript); setPostRevealText("");
    if (!repository) {
      setClarifications([]);
      return;
    }
    const [storedClarifications, storedReveal] = await Promise.all([
      repository.listTargetClarifications(session.id),
      repository.getReveal(session.id),
    ]);
    setClarifications(storedClarifications);
    setAcceptedRevealText(storedReveal?.text ?? "");
    setAcceptedRevealArtifacts(storedReveal?.artifactManifest ?? []);
  };

  const preserveInterrupted = async (session: RvSession) => {
    if (!repository) return;
    await repository.updateRvSessionState(session.id, "Interrupted", "RECOVERY: incomplete blind run preserved after restart");
    setRecentSessions((await repository.listRvSessions(workspace.id)).filter((item) => !item.researchProjectId));
  };

  const completeWithoutEvaluation = async () => {
    if (!repository || !progress?.sessionId) return;
    await repository.updateRvSessionState(progress.sessionId, "Completed");
    setProgress((current) => current ? { ...current, state: "Completed" } : current);
    setRecentSessions((await repository.listRvSessions(workspace.id)).filter((session) => !session.researchProjectId));
  };

  const discussPostReveal = async () => {
    if (!repository || !progress?.sessionId || !postRevealText.trim() || postRevealBusy) return;
    setPostRevealBusy(true);
    setRunError(null);
    try {
      const snapshot = await repository.getSessionSnapshot(progress.sessionId);
      if (!snapshot) throw new Error(copy.postRevealRouteUnavailable);
      const providerConfig = providerConfigs.find((item) => item.id === snapshot.providerConfigId);
      if (!providerConfig) throw new Error(copy.postRevealRouteUnavailable);
      const cached = allModels.find((item) => item.providerConfigId === snapshot.providerConfigId && item.modelId === snapshot.modelId);
      const viewerModel: ProviderModel = cached ?? {
        providerConfigId: snapshot.providerConfigId,
        provider: snapshot.provider,
        modelId: snapshot.modelId,
        displayName: snapshot.modelId,
        route: snapshot.modelRoute,
        capabilities: snapshot.capabilitySnapshot as unknown as ProviderModel["capabilities"],
        pricing: {},
        recommended: false,
        rawMetadata: {},
        refreshedAt: snapshot.capabilityCapturedAt,
      };
      const result = await sendPostRevealTurn({ repository, sessionId: progress.sessionId, existingTranscript: postRevealTranscript, providerConfig, model: viewerModel, content: postRevealText, timeoutMs: settings.requestTimeoutMs });
      setPostRevealTranscript(result.transcript);
      setPostRevealText("");
      setRecentSessions((await repository.listRvSessions(workspace.id)).filter((session) => !session.researchProjectId));
    } catch (cause) {
      const sessions = await repository.listRvSessions(workspace.id).catch(() => []);
      const stored = sessions.find((session) => session.id === progress.sessionId);
      if (stored) setPostRevealTranscript(stored.postRevealTranscript);
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPostRevealBusy(false);
    }
  };

  const addClarification = async () => {
    if (!repository || !progress?.sessionId || !clarificationText.trim() || clarificationBusy) return;
    setClarificationBusy(true);
    setRunError(null);
    try {
      const session = recentSessions.find((item) => item.id === progress.sessionId);
      if (session?.researchProjectId) {
        const project = await repository.getResearchProject(session.researchProjectId);
        if (!project?.scoresFrozenAt) throw new Error(copy.clarificationResearchGuard);
      }
      const record = await repository.addTargetClarification(progress.sessionId, clarificationText);
      setClarifications((current) => [...current, record]);
      setClarificationText("");
      setClarificationOpen(false);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClarificationBusy(false);
    }
  };

  return (
    <section className="session-layout">
      <div className="session-main panel">
        <PanelHeader title={copy.newAutomaticSession} icon={<Crosshair size={18} />} />
        {progress ? (
          <div className="live-session">
            <div className="live-session-head">
              <div><span className={`session-state ${progress.state.toLowerCase()}`}>{progress.state === "AwaitingReveal" ? "🔒" : progress.state === "Revealed" || progress.state === "Completed" ? "🔓" : "●"} {progress.state}</span><strong>{progress.sessionCode}</strong>{progress.phase && progress.state === "BlindRunning" && <small>{copy.runningPhase} {progress.phase}/{activeStepCount}</small>}</div>
              {running && <button className="stop-button" onClick={() => abortRef.current?.abort()}><CircleStop size={17} />{copy.stopSession}</button>}
            </div>
            {executionScope === "batch" && batchProgress && <div className="batch-progress-strip"><strong>{copy.batchProgress}</strong><span>{batchProgress.current} / {batchProgress.total}</span><small>{copy.completedSessions}: {batchProgress.completed}</small></div>}
            {progress.metrics && <div className="session-run-metrics"><span><small>{copy.apiCalls}</small><strong>{progress.metrics.requestCount}</strong></span>{progress.metrics.totalTokens !== undefined && <span><small>{copy.tokens}</small><strong>{Math.round(progress.metrics.totalTokens).toLocaleString()}</strong></span>}{progress.metrics.costUsd !== undefined && <span><small>{copy.cost}</small><strong>${progress.metrics.costUsd.toFixed(4)}</strong></span>}<span><small>{copy.elapsed}</small><strong>{formatDuration(progress.metrics.sessionDurationMs)}</strong></span></div>}
            {progress.transcript ? <pre className="live-transcript">{progress.transcript}</pre> : <div className="session-wait"><span className="loader-orb" /><p>{progress.state === "Preflight" ? "Preflight" : `${copy.runningPhase} ${progress.phase ?? 1}`}</p></div>}
            {progress.state === "AwaitingReveal" && <div className="reveal-box"><div><LockKeyhole size={18} /><span><strong>{copy.awaitingReveal}</strong><small>{copy.blindRunComplete}</small></span></div><textarea rows={5} value={revealText} onChange={(event) => setRevealText(event.target.value)} placeholder={copy.revealPlaceholder} /><div className="reveal-artifact-row"><label className="secondary-button reveal-file-button">{copy.revealFiles}<input type="file" multiple accept=".txt,.md,image/png,image/jpeg,image/webp,image/gif" disabled={artifactBusy} onChange={(event) => void attachRevealFiles(event.target.files)} /></label>{artifactBusy && <small>{copy.storingFile}</small>}{revealArtifacts.map((artifact) => <span className="reveal-artifact-chip" key={`${artifact.artifactId}-${artifact.originalFileName}`}>{artifact.mimeType.startsWith("image/") ? "▣" : "≡"} {artifact.originalFileName}</span>)}</div>{revealArtifacts.some((artifact) => artifact.mimeType.startsWith("image/")) && <small className="vision-guard-note">{copy.imageJudgeGuard}</small>}<button className="primary-button" disabled={artifactBusy || (!revealText.trim() && !revealArtifacts.length)} onClick={() => void submitReveal()}>{copy.submitReveal}</button></div>}
            {(progress.state === "Revealed" || progress.state === "Completed") && <>
              <div className="reveal-success"><Check size={18} /><div><strong>🔓 {copy.revealAccepted}</strong><p>{copy.blindRunComplete}</p></div></div>
              {(acceptedRevealText || acceptedRevealArtifacts.length > 0) && <div className="save-reveal-target"><input value={saveTargetTitle} onChange={(event) => setSaveTargetTitle(event.target.value)} placeholder={copy.targetName} disabled={targetSaved} /><button className="secondary-button" disabled={!saveTargetTitle.trim() || targetSaved} onClick={() => void saveExternalRevealTarget()}>{targetSaved ? copy.savedToTargets : copy.saveRevealTarget}</button></div>}
              {executionScope === "single" && <section className="post-reveal-discussion"><div className="post-reveal-head"><div><strong>{copy.postRevealDiscussion}</strong><p>{copy.postRevealEvidenceGuard}</p></div><span>POST-REVEAL</span></div>{postRevealTranscript && <div className="post-reveal-turns">{parsePostRevealTranscript(postRevealTranscript).map((turn, index) => <article className={turn.role} key={`${turn.role}-${index}`}><small>{turn.role === "user" ? copy.you : copy.viewerModel}</small><p>{turn.content}</p></article>)}</div>}<div className="post-reveal-compose"><textarea rows={3} value={postRevealText} onChange={(event) => setPostRevealText(event.target.value)} placeholder={copy.postRevealPlaceholder} disabled={postRevealBusy} /><button className="secondary-button" disabled={!postRevealText.trim() || postRevealBusy} onClick={() => void discussPostReveal()}>{postRevealBusy ? copy.sending : copy.sendPostReveal}</button></div></section>}
              {executionScope === "single" && <JudgeEvaluation copy={copy} repository={repository} sessionId={progress.sessionId} language={resolvedLanguage} models={allModels} providerConfigs={providerConfigs} defaultModelKey={resolveRoleDefault(profile, "judge", allModels)} onCompleted={() => { setProgress((current) => current ? { ...current, state: "Completed" } : current); void repository?.listRvSessions(workspace.id).then((sessions) => setRecentSessions(sessions.filter((session) => !session.researchProjectId))); }} />}
              {executionScope === "single" && progress.state === "Revealed" && <button className="secondary-button save-only-button" onClick={() => void completeWithoutEvaluation()}>{copy.saveOnly}</button>}
              {executionScope === "single" && clarificationEligible && <section className="target-clarification"><div className="target-clarification-head"><div><strong>{copy.askTargetClarification}</strong><p>{copy.clarificationLead}</p></div><button className="secondary-button" onClick={() => setClarificationOpen((value) => !value)}>{copy.askTargetClarification}</button></div>{clarificationOpen && <div className="clarification-form"><textarea rows={4} value={clarificationText} onChange={(event) => setClarificationText(event.target.value)} placeholder={copy.clarificationPlaceholder} /><button className="primary-button" disabled={!clarificationText.trim() || clarificationBusy} onClick={() => void addClarification()}>{copy.saveClarification}</button></div>}{clarifications.length > 0 && <div className="clarification-list">{clarifications.map((item) => <article key={item.id}><small>{copy.supplementaryClarification} · {new Date(item.createdAt).toLocaleString()}</small><p>{item.content}</p></article>)}</div>}</section>}
            </>}
            {progress.state === "Interrupted" && <div className="provider-error"><CircleStop size={16} /><span><strong>{copy.interrupted}</strong>{progress.stopReason ? ` · ${progress.stopReason}` : ""}</span></div>}
            {executionScope === "batch" && batchResults.length > 0 && !batchRunning && <BatchEvaluation copy={copy} repository={repository} sessions={batchResults} language={resolvedLanguage} models={allModels} providerConfigs={providerConfigs} defaultModelKey={resolveRoleDefault(profile, "judge", allModels)} onCompleted={() => void repository?.listRvSessions(workspace.id).then((sessions) => setRecentSessions(sessions.filter((session) => !session.researchProjectId)))} />}
            {!running && <button className="secondary-button new-session-button" onClick={() => { setProgress(null); setRunError(null); setActiveTargetId(null); setAcceptedRevealText(""); setAcceptedRevealArtifacts([]); setClarifications([]); setClarificationOpen(false); setClarificationText(""); setPostRevealTranscript(""); setPostRevealText(""); setBatchResults([]); setBatchProgress(null); }}>{copy.newAutomaticSession}</button>}
          </div>
        ) : <>
        <ConfigBlock label={copy.sessionScope}>
          <div className="choice-grid two">
            <Choice active={executionScope === "single"} onClick={() => setExecutionScope("single")} icon={<Crosshair size={18} />} title={copy.singleSession} />
            <Choice active={executionScope === "batch"} onClick={() => { setExecutionScope("batch"); setRevealSource("automatic"); }} icon={<Database size={18} />} title={copy.ordinaryBatch} />
          </div>
        </ConfigBlock>
        <ConfigBlock label={copy.runType}>
          <div className="choice-grid two">
            <Choice active={runType === "automatic"} onClick={() => setRunType("automatic")} icon={<Waves size={18} />} title={copy.automatic} />
            <Choice disabled={protocol !== "rcp"} active={runType === "monitor"} onClick={() => setRunType("monitor")} icon={<BrainCircuit size={18} />} title={copy.automaticMonitor} />
          </div>
        </ConfigBlock>
        {runType === "monitor" && <ConfigBlock label={copy.monitorModel}>
          <div className="monitor-model-config">
            <select value={monitorModelKey} onChange={(event) => setMonitorModelKey(event.target.value)}>
              <option value="">{copy.selectModel}</option>
              {allModels.map((model) => { const connection = providerConfigs.find((item) => item.id === model.providerConfigId); return <option key={`${model.providerConfigId}:${model.modelId}`} value={`${model.providerConfigId}::${model.modelId}`}>{connection?.label ?? model.provider} · {model.displayName}</option>; })}
            </select>
            <small>{copy.monitorGuard}</small>
          </div>
        </ConfigBlock>}
        <ConfigBlock label={copy.protocol}>
          <div className="choice-grid three">
            <Choice active={protocol === "rcp"} onClick={() => setProtocol("rcp")} icon={<FileCheck2 size={18} />} title={copy.fullRcp} meta="v1.5a" />
            <Choice active={protocol === "lite"} onClick={() => { setProtocol("lite"); setRunType("automatic"); }} icon={<Sparkles size={18} />} title={copy.rvLite} meta="v1.0.0" />
            <Choice active={protocol === "custom"} onClick={() => { setProtocol("custom"); setRunType("automatic"); }} icon={<Settings2 size={18} />} title={copy.customProtocol} meta={customProtocols.length ? `${customProtocols.length}` : undefined} />
          </div>
        </ConfigBlock>
        {protocol === "custom" && <ConfigBlock label={copy.customProtocolSelect}>
          <div className="custom-protocol-select"><select value={customProtocolVersionId} onChange={(event) => setCustomProtocolVersionId(event.target.value)}><option value="">{copy.noCustomProtocols}</option>{customProtocols.map((item) => <option key={item.versionId} value={item.versionId}>{item.displayName} · {item.version}</option>)}</select><div className="custom-protocol-buttons"><button className="secondary-button" onClick={() => { setCustomBuilderNew(true); setCustomBuilderOpen(true); }}><Plus size={15} />{copy.newCustomProtocol}</button>{selectedCustomProtocol && <button className="secondary-button" onClick={() => { setCustomBuilderNew(false); setCustomBuilderOpen(true); }}>{copy.editCustomProtocol}</button>}</div><small>{copy.customMonitorNote}</small></div>
        </ConfigBlock>}
        <ConfigBlock label={copy.providerConnection}>
          <div className="route-summary">{activeProvider ? <><KeyRound size={16} /><span><strong>{activeProvider.label}</strong><small>{activeProvider.credentialHint ?? "••••••••"}</small></span></> : <><KeyRound size={16} /><span><strong>{copy.credentialPending}</strong><small>{copy.configureProviderFirst}</small></span></>}</div>
        </ConfigBlock>
        <ConfigBlock label={copy.viewerModel}>
          <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!activeProvider || models.length === 0}>
            <option value="">{models.length ? copy.selectModel : copy.noCachedModels}</option>
            {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.recommended ? "★ " : ""}{model.displayName}</option>)}
          </select>
        </ConfigBlock>
        {selectedModel && <ConfigBlock label="Generation">
          <div className="generation-grid">
            <label><span>{copy.reasoning}</span><select value={reasoning} onChange={(event) => setReasoning(event.target.value as "" | ReasoningEffort)} disabled={!selectedModel.capabilities.reasoning.efforts.length}><option value="">{copy.providerDefault}</option>{selectedModel.capabilities.reasoning.efforts.map((effort) => <option key={effort} value={effort}>{effort.toUpperCase()}</option>)}</select></label>
            <label><span>{copy.temperature}</span><input type="number" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder={copy.providerDefault} disabled={!selectedModel.capabilities.temperature.supported} min={selectedModel.capabilities.temperature.min} max={selectedModel.capabilities.temperature.max} /></label>
            <label><span>{copy.maxOutputTokens}</span><input type="number" min={1} max={selectedModel.capabilities.maxOutputTokens} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} /></label>
          </div>
        </ConfigBlock>}
        <ConfigBlock label={copy.sessionLanguage}>
          <select className="session-language-select" value={sessionLanguage} onChange={(event) => setSessionLanguage(event.target.value as SessionLanguageSetting)}>
            <option value="same">{copy.sameAsInterface}</option>
            <option value="pl">Polski</option>
            <option value="en">English</option>
          </select>
        </ConfigBlock>
        {executionScope === "single" ? <><ConfigBlock label={copy.targetSource}>
          <div className="choice-grid two">
            <Choice active={revealSource === "automatic"} onClick={() => setRevealSource("automatic")} icon={<Crosshair size={18} />} title={copy.automaticTarget} meta={eligibleTargets.length ? `${eligibleTargets.length}` : undefined} />
            <Choice active={revealSource === "external"} onClick={() => setRevealSource("external")} icon={<LockKeyhole size={18} />} title={copy.externalBlind} />
          </div>
        </ConfigBlock>
        {revealSource === "automatic" && <ConfigBlock label={copy.selectTarget}>
          {eligibleTargets.length ? <select className="session-language-select" value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)}><option value="__random__">🎲 {copy.randomTarget}</option>{eligibleTargets.map((target) => <option key={target.id} value={target.id}>{target.collection === "training" ? "Training" : "My Targets"} · {target.title}</option>)}</select> : <div className="route-summary"><Crosshair size={16} /><span><strong>{copy.noEligibleTargets}</strong><small>{copy.textRevealOnly}</small></span></div>}
        </ConfigBlock>}</> : <ConfigBlock label={copy.targetPool}><div className="batch-config"><label><span>{copy.targetPool}</span><select value={batchCollection} onChange={(event) => setBatchCollection(event.target.value as "all" | "training" | "user")}><option value="all">{copy.allTargets}</option><option value="training">{copy.trainingTarget}</option><option value="user">{copy.myTargets}</option></select></label><label><span>{copy.batchCount}</span><input type="number" min={1} max={Math.max(1, batchPool.length)} value={batchCount} onChange={(event) => setBatchCount(Math.max(1, Number(event.target.value) || 1))} /></label><small>{copy.eligibleTargets}: {batchPool.length}</small><div className="batch-preflight-actions"><button className="secondary-button" onClick={preflightBatch}>{copy.runPreflight}</button>{batchPreflightSignature === batchConfigSignature && <span className="status-chip ready"><Check size={12} />{copy.preflightPassed}</span>}</div></div></ConfigBlock>}
        <div className="start-block">
          <button className="primary-button start-button" disabled={!isTauriRuntime() || !activeProvider || !selectedModel || !maxOutputTokens || Number(maxOutputTokens) <= 0 || (runType === "monitor" && (protocol !== "rcp" || !monitorModel || !monitorProvider)) || (protocol === "custom" && !selectedCustomProtocol) || (executionScope === "single" && revealSource === "automatic" && eligibleTargets.length === 0) || (executionScope === "batch" && (batchCount < 1 || batchCount > batchPool.length || batchPreflightSignature !== batchConfigSignature))} onClick={() => void start()}><Waves size={18} />{executionScope === "batch" ? copy.startBatch : copy.startSession}</button>
          <p>{activeProvider ? copy.controllerReady : copy.configureProviderFirst}</p>
        </div>
        </>}
        {runError && <div className="provider-error session-error">{runError}</div>}
      </div>
      <aside className="session-side">
        <section className="panel protocol-card">
          <span className="resource-orb"><FileCheck2 size={22} /></span>
          <span className="status-chip ready"><Check size={13} />{copy.statusReady}</span>
          <h3>{protocol === "custom" ? selectedCustomProtocol?.displayName ?? copy.customProtocol : protocol === "lite" ? `${copy.rvLite} v1.0.0` : copy.rcpReady}</h3>
          <p>{protocol === "custom" ? selectedCustomProtocol?.description ?? copy.dryRunLead : copy.rcpReadyDesc}</p>
          <dl>
            <div><dt>{copy.sessionLanguage}</dt><dd>{resolvedLanguage.toUpperCase()}</dd></div>
            <div><dt>{protocol === "custom" ? copy.blindSteps : copy.wordCount}</dt><dd>{protocol === "custom" ? selectedCustomProtocol?.steps.length ?? 0 : wordCount(protocol === "lite" ? rvLite.content : rcp.content).toLocaleString()}</dd></div>
            <div><dt>Version</dt><dd>{protocol === "custom" ? selectedCustomProtocol?.version ?? "—" : protocol === "lite" ? rvLite.version : rcp.version}</dd></div>
          </dl>
          {protocol === "custom" ? <button className="secondary-button full" disabled={!selectedCustomProtocol} onClick={() => { setCustomBuilderNew(false); setCustomBuilderOpen(true); }}>{copy.previewDryRun}</button> : <button className="secondary-button full" onClick={() => setResourceOpen(true)}>{copy.inspectProtocol}</button>}
        </section>
        <section className="integrity-card"><LockKeyhole size={18} /><div><strong>🔒 BLIND</strong><p>Reveal boundary is a separate state transition.</p></div></section>
        <section className="integrity-card"><ShieldCheck size={18} /><div><strong>External Blind</strong><p>{copy.externalReady}</p></div></section>
        <section className="panel recent-sessions-card"><PanelHeader title={copy.recentSessions} icon={<Clock3 size={17} />} />{recentSessions.length ? <div className="recent-session-list">{recentSessions.slice(0, 7).map((session) => <div key={session.id}><button className="recent-session-open" disabled={session.state === "BlindRunning" || session.state === "Preflight"} onClick={() => void loadStoredSession(session)}><span><strong>{session.sessionCode}</strong><small>{session.state}</small></span><ChevronRight size={13} /></button>{(session.state === "BlindRunning" || session.state === "Preflight") && <div className="session-recovery"><small>{copy.recoveryRequired}</small><button onClick={() => void preserveInterrupted(session)}>{copy.markInterrupted}</button></div>}</div>)}</div> : <p className="recent-session-empty">{copy.noSessions}</p>}</section>
      </aside>
      {resourceOpen && <ProtocolDialog copy={copy} resource={protocol === "lite" ? rvLite : rcp} onClose={() => setResourceOpen(false)} />}
      {customBuilderOpen && repository && <CustomProtocolDialog copy={copy} repository={repository} language={resolvedLanguage} base={customBuilderNew ? null : selectedCustomProtocol} onCancel={() => setCustomBuilderOpen(false)} onSaved={customProtocolSaved} />}
    </section>
  );
}

function JudgeEvaluation({
  copy,
  repository,
  sessionId,
  language,
  models,
  providerConfigs,
  defaultModelKey,
  onCompleted,
}: {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository | null;
  sessionId: string;
  language: InterfaceLanguage;
  models: ProviderModel[];
  providerConfigs: ProviderConfig[];
  defaultModelKey?: string;
  onCompleted?: () => void;
}) {
  const [judgeCount, setJudgeCount] = useState(1);
  const [selections, setSelections] = useState([defaultModelKey ?? "", "", ""]);
  const [result, setResult] = useState<JudgingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const keyFor = (model: ProviderModel) => `${model.providerConfigId}::${model.modelId}`;
  const activeSelections = selections.slice(0, judgeCount).map((key) => models.find((model) => keyFor(model) === key) ?? null);
  const ready = activeSelections.every(Boolean) && activeSelections.length === judgeCount;

  useEffect(() => {
    setJudgeCount(1);
    setSelections([defaultModelKey ?? "", "", ""]);
  }, [defaultModelKey, sessionId]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    if (!repository) return () => { cancelled = true; };
    void repository.listJudgeScores(sessionId).then((scores) => {
      if (cancelled || !scores.length) return;
      setResult({
        anonymousSessionId: "stored",
        scores,
        aggregate: aggregateJudgeScores(scores),
      });
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
      const next = await runBlindJudging({ repository, sessionId, language, judges, onProgress: (done) => setCompleted(done) });
      await repository.updateRvSessionState(sessionId, "Completed");
      setResult(next);
      onCompleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="judge-evaluation">
      <div className="judge-heading">
        <span><ShieldCheck size={18} /></span>
        <div><strong>{copy.judgeEvaluation}</strong><p>{copy.judgeLead}</p></div>
      </div>
      {!result ? <>
        <div className="judge-config">
          <label><span>{copy.judgeCount}</span><select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))} disabled={busy}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          {Array.from({ length: judgeCount }, (_, index) => <label key={index}><span>{copy.judgeModel} {index + 1}</span><select value={selections[index]} onChange={(event) => setSelections((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} disabled={busy}><option value="">{copy.selectModel}</option>{models.map((model) => { const provider = providerConfigs.find((item) => item.id === model.providerConfigId); return <option key={keyFor(model)} value={keyFor(model)}>{provider?.label ?? model.provider} · {model.displayName}</option>; })}</select></label>)}
        </div>
        <div className="judge-actions"><small>{busy ? `${copy.judging} ${completed}/${judgeCount}` : copy.judgeRequiresModels}</small><button className="primary-button" disabled={!isTauriRuntime() || !ready || busy} onClick={() => void evaluate()}>{busy ? copy.judging : copy.runJudges}</button></div>
      </> : <div className="judge-results">
        <div className="judge-aggregate">
          <span><small>{copy.meanScore}</small><strong>{result.aggregate.mean.total.toFixed(2)} / 10</strong></span>
          <span><small>{copy.medianScore}</small><strong>{result.aggregate.medianTotal.toFixed(2)}</strong></span>
          <span><small>{copy.scoreSpread}</small><strong>{result.aggregate.totalRange.toFixed(2)} · σ {result.aggregate.totalStdDev.toFixed(2)}</strong></span>
        </div>
        <strong className="judge-frozen-label"><LockKeyhole size={14} />{copy.frozenScores}</strong>
        <div className="judge-score-list">{result.scores.map((score) => <article key={score.id} className="judge-score-card">
          <div className="judge-score-head"><span>Judge {score.judgeIndex}<small>{score.modelRoute}</small></span><strong>{score.total.toFixed(1)} / 10</strong></div>
          <div className="judge-components"><span>{copy.scoreGestalt}<b>{score.gestalt.toFixed(1)}/3</b></span><span>{copy.scoreFeatures}<b>{score.verifiableFeatures.toFixed(1)}/3</b></span><span>{copy.scoreActivity}<b>{score.activityFunctionEvent.toFixed(1)}/2</b></span><span>{copy.scoreConfab}<b>{score.confabulationControl.toFixed(1)}/2</b></span></div>
          <JudgeNarrativeRow label={copy.strongestMatches} values={score.narrative.strongestMatches} />
          <JudgeNarrativeRow label={copy.majorMisses} values={score.narrative.majorMissesContradictions} />
          <JudgeNarrativeRow label={copy.confabNotes} values={score.narrative.confabulationObservations} />
          <div className="judge-rationale"><small>{copy.rationale}</small><p>{score.narrative.conciseRationale}</p></div>
        </article>)}</div>
      </div>}
      {error && <div className="provider-error">{error}</div>}
    </section>
  );
}

function BatchEvaluation({
  copy,
  repository,
  sessions,
  language,
  models,
  providerConfigs,
  defaultModelKey,
  onCompleted,
}: {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository | null;
  sessions: OrdinaryBatchSessionResult[];
  language: InterfaceLanguage;
  models: ProviderModel[];
  providerConfigs: ProviderConfig[];
  defaultModelKey?: string;
  onCompleted?: () => void;
}) {
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
        const result = existing.length
          ? { anonymousSessionId: "stored", scores: existing, aggregate: aggregateJudgeScores(existing) }
          : await runBlindJudging({ repository, sessionId: session.sessionId, language, judges });
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

function JudgeNarrativeRow({ label, values }: { label: string; values: string[] }) {
  return <div className="judge-narrative"><small>{label}</small>{values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul> : <p>—</p>}</div>;
}

function MonitorPanel({ copy, workspace, repository }: { copy: ReturnType<typeof getCopy>; workspace: Workspace; repository: AppRepository | null }) {
  const [runs, setRuns] = useState<MonitorRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<MonitorInterventionRecord[]>([]);
  const [exportingRun, setExportingRun] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    if (!repository) return;
    void Promise.all([repository.listMonitorRuns(workspace.id), repository.listRvSessions(workspace.id), repository.listResearchProjects(workspace.id)]).then(([items, sessions, projects]) => {
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const researchById = new Map(projects.map((project) => [project.id, project]));
      const visible = items.filter((run) => {
        const researchId = sessionById.get(run.sessionId)?.researchProjectId;
        return !researchId || researchById.get(researchId)?.state === "Complete";
      });
      setRuns(visible);
      setSelectedRunId((current) => current && visible.some((item) => item.id === current) ? current : visible[0]?.id ?? null);
    });
  }, [repository, workspace.id]);
  useEffect(() => {
    if (!repository || !selectedRunId) { setInterventions([]); return; }
    void repository.listMonitorInterventions(selectedRunId).then(setInterventions);
  }, [repository, selectedRunId]);
  const selected = runs.find((run) => run.id === selectedRunId) ?? null;
  const exportSelected = async () => {
    if (!repository || !selected || exportingRun || !isTauriRuntime()) return;
    setExportingRun(true); setExportError(null); setExportPath(null);
    try { setExportPath(await exportMonitorRun(repository, workspace.id, selected, interventions)); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExportingRun(false); }
  };
  return (
    <section className="panel monitor-panel">
      <PanelHeader title={copy.monitorHistory} icon={<BrainCircuit size={18} />} />
      <div className="role-guard"><ShieldCheck size={22} /><div><strong>{copy.blindRoleBoundary}</strong><p>{copy.monitorLead}</p></div></div>
      {!runs.length ? <EmptyState icon={<MonitorCog size={28} />} title={copy.noMonitorRuns} body={copy.monitorLead} /> : <div className="monitor-history-layout"><div className="monitor-run-list">{runs.map((run) => <button className={run.id === selectedRunId ? "active" : ""} key={run.id} onClick={() => { setSelectedRunId(run.id); setExportPath(null); setExportError(null); }}><span><strong>{run.sessionCode}</strong><small>{run.modelRoute}</small></span><span>{run.interventionCount}</span></button>)}</div><div className="monitor-run-detail">{selected && <><div className="monitor-run-meta"><span><small>{copy.promptVersion}</small><strong>{selected.promptVersionId ?? "—"}</strong></span><span><small>{copy.libraryVersion}</small><strong>{selected.libraryVersion}</strong></span><span><small>{copy.interventions}</small><strong>{selected.interventionCount} / {selected.maxInterventions}</strong></span></div><div className="monitor-export-row"><button className="secondary-button" disabled={!isTauriRuntime() || exportingRun} onClick={() => void exportSelected()}>{exportingRun ? copy.exporting : copy.exportMonitorRun}</button><small>{copy.monitorExportSafe}</small></div></>}{interventions.length ? <div className="monitor-timeline">{interventions.map((item) => <article key={item.id} className={item.decision === "INTERVENE" ? "intervene" : "continue"}><div><span>{item.sequenceNumber}</span><strong>{item.decision === "INTERVENE" ? item.commandId ?? "INTERVENE" : copy.continueProtocol}</strong></div>{item.viewerEvidence && <p><b>{copy.viewerEvidence}</b>{item.viewerEvidence}</p>}{item.commandText && <p><b>{copy.monitorCommand}</b>{item.commandText}</p>}</article>)}</div> : <p className="monitor-no-decisions">{copy.noMonitorRuns}</p>}{exportPath && <div className="storage-success"><Check size={14} />{copy.exportComplete} · {exportPath}</div>}{exportError && <div className="provider-error">{exportError}</div>}</div></div>}
    </section>
  );
}

function ResearchScreen({ copy, settings, profiles, workspaces, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profiles: Profile[]; workspaces: Workspace[]; repository: AppRepository | null }) {
  return (
    <div className="page">
      <PageHeader title={copy.research} subtitle={copy.researchLead} />
      <div className="research-guardrails">
        <MiniStat icon={<LockKeyhole size={17} />} title={copy.blinded} value="Allowlist packets" />
        <MiniStat icon={<ShieldCheck size={17} />} title={copy.locked} value="Config → immutable" />
        <MiniStat icon={<FileCheck2 size={17} />} title="Scores" value="Freeze → unblind" />
      </div>
      <ResearchBuilder copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} />
    </div>
  );
}

function TargetsScreen({ copy, repository }: { copy: ReturnType<typeof getCopy>; repository: AppRepository | null }) {
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [usage, setUsage] = useState<TargetUsageRecord[]>([]);
  const [researchLockedTargetIds, setResearchLockedTargetIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<TargetRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    if (!repository) return;
    const [nextTargets, nextUsage, projects] = await Promise.all([repository.listTargets(), repository.listTargetUsage(), repository.listResearchProjects()]);
    const assignments = (await Promise.all(projects.map((project) => repository.listResearchAssignments(project.id)))).flat();
    setTargets(nextTargets);
    setUsage(nextUsage);
    setResearchLockedTargetIds([...new Set(assignments.map((assignment) => assignment.targetId))]);
  };
  useEffect(() => {
    void reload().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [repository]);
  const training = targets.filter((target) => target.collection === "training");
  const mine = targets.filter((target) => target.collection === "user");
  const usedTargetIds = new Set([...usage.map((item) => item.targetId), ...researchLockedTargetIds]);
  const createTarget = async (title: string, revealText: string, tags: string[], images: File[]) => {
    if (!repository) return;
    const targetId = createId("target");
    const revealArtifacts = images.length ? await Promise.all(images.map((file) => storeTargetArtifact(targetId, file))) : [];
    const target = await createUserTarget(repository, { id: targetId, title, ...(revealText.trim() ? { revealText } : {}), ...(revealArtifacts.length ? { revealArtifacts } : {}), tags });
    setTargets((current) => [target, ...current]);
    setDialogOpen(false);
  };
  const editTarget = async (target: TargetRecord, title: string, revealText: string, tags: string[]) => {
    if (!repository) return;
    setError(null);
    await updateUserTarget(repository, target, { title, revealText, tags });
    setEditingTarget(null);
    await reload();
  };
  const deleteTarget = async (target: TargetRecord) => {
    if (!repository || !window.confirm(`${copy.deleteTargetConfirm}\n\n${target.title}`)) return;
    setError(null);
    try {
      await repository.deleteTarget(target.id);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <div className="page">
      <PageHeader title={copy.targets} subtitle={copy.targetsLead} action={<button className="primary-button" onClick={() => setDialogOpen(true)}><Plus size={16} />{copy.addTarget}</button>} />
      <div className="target-columns">
        <section className="panel target-panel"><PanelHeader title={`${copy.trainingTargets} · ${training.length}`} icon={<Crosshair size={18} />} />{training.length ? <TargetList copy={copy} targets={training} usedTargetIds={usedTargetIds} /> : <EmptyState icon={<FileCheck2 size={28} />} title={copy.statusNext} body={copy.targetPackPending} />}</section>
        <section className="panel target-panel"><PanelHeader title={`${copy.myTargets} · ${mine.length}`} icon={<LockKeyhole size={18} />} />{mine.length ? <TargetList copy={copy} targets={mine} usedTargetIds={usedTargetIds} onEdit={setEditingTarget} onDelete={(target) => void deleteTarget(target)} /> : <EmptyState icon={<Plus size={28} />} title={copy.noPrivateTargets} body={copy.secureLocal} action={<button className="secondary-button" onClick={() => setDialogOpen(true)}><Plus size={15} />{copy.addTarget}</button>} />}</section>
      </div>
      <p className="target-support-note">{copy.textRevealOnly}</p>
      {error && <div className="provider-error">{error}</div>}
      {dialogOpen && <CreateTargetDialog copy={copy} onCancel={() => setDialogOpen(false)} onCreate={createTarget} />}
      {editingTarget && <EditTargetDialog copy={copy} target={editingTarget} onCancel={() => setEditingTarget(null)} onSave={(title, revealText, tags) => editTarget(editingTarget, title, revealText, tags)} />}
    </div>
  );
}

function TargetList({ copy, targets, usedTargetIds, onEdit, onDelete }: { copy: ReturnType<typeof getCopy>; targets: TargetRecord[]; usedTargetIds: Set<string>; onEdit?: (target: TargetRecord) => void; onDelete?: (target: TargetRecord) => void }) {
  return <div className="target-list">{targets.map((target) => {
    const locked = usedTargetIds.has(target.id);
    return <article className="target-card" key={target.id}><div className="target-card-head"><div><strong>{target.title}</strong><small>{target.tags.length ? target.tags.join(" · ") : target.collection}</small></div>{target.collection === "user" && <div className="target-card-actions"><button className="icon-button" disabled={locked} title={locked ? copy.usedTargetLocked : copy.editTarget} onClick={() => onEdit?.(target)}><Pencil size={14} /></button><button className="icon-button danger" disabled={locked} title={locked ? copy.usedTargetLocked : copy.deleteTarget} onClick={() => onDelete?.(target)}><Trash2 size={14} /></button></div>}</div>{target.revealText && <p>{target.revealText}</p>}{Boolean(target.revealArtifacts?.length) && <div className="target-image-list">{target.revealArtifacts!.map((artifact) => <span key={`${artifact.artifactId}-${artifact.sha256}`}>▣ {artifact.originalFileName}</span>)}</div>}{locked && <small className="target-locked-note"><LockKeyhole size={11} />{copy.usedTargetLocked}</small>}{target.contentHash && <code>sha256 {target.contentHash.slice(0, 16)}…</code>}</article>;
  })}</div>;
}

function CreateTargetDialog({ copy, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; onCancel: () => void; onCreate: (title: string, revealText: string, tags: string[], images: File[]) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [revealText, setRevealText] = useState("");
  const [tags, setTags] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (!revealText.trim() && !images.length) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(title, revealText, tags.split(","), images);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  return <FormDialog title={copy.addTarget} onCancel={onCancel}><form onSubmit={(event) => void submit(event)}><label>{copy.targetName}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{copy.targetReveal}<textarea rows={7} value={revealText} onChange={(event) => setRevealText(event.target.value)} /></label><label>{copy.targetImages}<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isTauriRuntime() || saving} onChange={(event) => setImages(Array.from(event.target.files ?? []).slice(0, 8))} /></label>{images.length > 0 && <div className="form-image-list">{images.map((file) => <span key={`${file.name}-${file.size}`}>▣ {file.name}</span>)}</div>}<label>{copy.targetTags}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label><small className="form-hint">{copy.textRevealOnly}</small>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!title.trim() || (!revealText.trim() && !images.length) || saving}>{copy.saveTarget}</button></div></form></FormDialog>;
}

function EditTargetDialog({ copy, target, onCancel, onSave }: { copy: ReturnType<typeof getCopy>; target: TargetRecord; onCancel: () => void; onSave: (title: string, revealText: string, tags: string[]) => Promise<void> }) {
  const [title, setTitle] = useState(target.title);
  const [revealText, setRevealText] = useState(target.revealText ?? "");
  const [tags, setTags] = useState(target.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (!revealText.trim() && !target.revealArtifacts?.length) || saving) return;
    setSaving(true); setError(null);
    try { await onSave(title, revealText, tags.split(",")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <FormDialog title={copy.editTarget} onCancel={onCancel}><form onSubmit={(event) => void submit(event)}><label>{copy.targetName}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{copy.targetReveal}<textarea rows={7} value={revealText} onChange={(event) => setRevealText(event.target.value)} /></label>{Boolean(target.revealArtifacts?.length) && <div><small className="form-hint">{copy.existingTargetImages}</small><div className="form-image-list">{target.revealArtifacts!.map((artifact) => <span key={`${artifact.artifactId}-${artifact.sha256}`}>▣ {artifact.originalFileName}</span>)}</div></div>}<label>{copy.targetTags}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!title.trim() || (!revealText.trim() && !target.revealArtifacts?.length) || saving}>{saving ? copy.saving : copy.saveChanges}</button></div></form></FormDialog>;
}

function SettingsScreen({ copy, settings, repository, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; repository: AppRepository | null; onChange: (settings: Partial<AppSettings>) => void }) {
  const [tab, setTab] = useState<"providers" | "models" | "storage" | "targets" | "sessions" | "appearance" | "advanced" | "about">("providers");
  const [protocolResource, setProtocolResource] = useState<ProtocolResource | RvLiteProtocolResource | null>(null);
  const tabs = [
    ["providers", copy.providersApi], ["models", copy.models], ["storage", copy.storage], ["targets", copy.targets], ["sessions", copy.sessions], ["appearance", copy.appearance], ["advanced", copy.advanced], ["about", copy.aboutProtocols],
  ] as const;
  return (
    <div className="page">
      <PageHeader title={copy.settings} subtitle={copy.languageResearchNote} />
      <nav className="settings-tabs" aria-label={copy.settings}>{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="settings-tab-content">
        {tab === "providers" && <ProviderSettings copy={copy} repository={repository} section="providers" />}
        {tab === "models" && <ProviderSettings copy={copy} repository={repository} section="models" />}
        {tab === "storage" && <StorageSettingsCard copy={copy} repository={repository} />}
        {tab === "targets" && <TargetSettingsCard copy={copy} settings={settings} repository={repository} onChange={onChange} />}
        {tab === "sessions" && <SessionSettingsCard copy={copy} settings={settings} onChange={onChange} />}
        {tab === "appearance" && <section className="panel settings-card wide">
          <PanelHeader title={copy.appearance} icon={<Sparkles size={18} />} />
          <SettingRow label={copy.interfaceLanguage} icon={<Languages size={18} />}>
            <select value={settings.interfaceLanguage} onChange={(event) => onChange({ interfaceLanguage: event.target.value as InterfaceLanguage })}><option value="pl">Polski</option><option value="en">English</option></select>
          </SettingRow>
          <SettingRow label={copy.theme} icon={<Sparkles size={18} />}>
            <div className="theme-picker">
              {(["aurora", "light", "dark"] as Theme[]).map((theme) => <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => onChange({ theme })}>{theme === "aurora" ? <Sparkles size={15} /> : theme === "light" ? <Sun size={15} /> : <Moon size={15} />}{copy[theme]}</button>)}
            </div>
          </SettingRow>
          <SettingRow label={copy.textSize} icon={<MessageCircle size={18} />}><select value={settings.textScale} onChange={(event) => onChange({ textScale: event.target.value as AppSettings["textScale"] })}><option value="small">{copy.small}</option><option value="normal">{copy.normal}</option><option value="large">{copy.large}</option></select></SettingRow>
          <SettingRow label={copy.animations} icon={<Sparkles size={18} />}><select value={settings.animations ? "on" : "off"} onChange={(event) => onChange({ animations: event.target.value === "on" })}><option value="on">{copy.enabled}</option><option value="off">{copy.disabled}</option></select></SettingRow>
        </section>}
        {tab === "advanced" && <AdvancedSettingsCard copy={copy} repository={repository} />}
        {tab === "about" && <AboutProtocolsCard copy={copy} onOpen={setProtocolResource} />}
      </div>
      {protocolResource && <ProtocolDialog copy={copy} resource={protocolResource} onClose={() => setProtocolResource(null)} />}
    </div>
  );
}

function AboutProtocolsCard({ copy, onOpen }: { copy: ReturnType<typeof getCopy>; onOpen: (resource: ProtocolResource | RvLiteProtocolResource) => void }) {
  const protocolCards = [
    { id: "rcp", name: copy.fullRcp, version: "1.5a", pl: getFullRcp("pl"), en: getFullRcp("en") },
    { id: "lite", name: copy.rvLite, version: "1.0.0", pl: getRvLite("pl"), en: getRvLite("en") },
  ] as const;
  return <div className="about-settings-grid">
    <section className="panel about-protocol-card"><PanelHeader title={copy.protocolLibrary} icon={<FileCheck2 size={18} />} /><div className="about-card-body"><p>{copy.protocolLibraryLead}</p><div className="about-protocol-list">{protocolCards.map((protocol) => <article key={protocol.id}><span className="resource-orb"><FileCheck2 size={18} /></span><div><small>{copy.readOnly}</small><strong>{protocol.name}</strong><code>v{protocol.version}</code></div><div className="about-protocol-actions"><button className="secondary-button" onClick={() => onOpen(protocol.pl)}>{copy.readPolish}</button><button className="secondary-button" onClick={() => onOpen(protocol.en)}>{copy.readEnglish}</button></div></article>)}</div></div></section>
    <section className="panel about-credits-card"><PanelHeader title={copy.credits} icon={<Users size={18} />} /><div className="about-card-body"><p>{copy.creditsLead}</p><div className="credit-group"><small>{copy.projectLead}</small><article><strong>Edward <code>lukeskytorep-bot</code></strong><p>{copy.projectLeadCredit}</p></article></div><div className="credit-group"><small>{copy.aiCollaborators}</small><article><strong>Orion via Active Model — Codex / ChatGPT</strong><p>{copy.orionCredit}</p></article><article><strong>Aion via Active Model — ChatGPT 4.0</strong><p>{copy.aionCredit}</p></article><article><strong>Aura via Active Model — Gemini 3.1 Pro</strong><p>{copy.auraCredit}</p></article></div><p className="human-directed-credit">{copy.humanDirectedCredit}</p><div className="about-license"><span><small>{copy.appVersion}</small><strong>v{APP_VERSION}</strong></span><span><small>{copy.projectLicense}</small><strong>MIT</strong></span></div></div></section>
  </div>;
}

function TargetSettingsCard({ copy, settings, repository, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; repository: AppRepository | null; onChange: (settings: Partial<AppSettings>) => void }) {
  const [trainingCount, setTrainingCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [usageCount, setUsageCount] = useState(0);
  useEffect(() => {
    if (!repository) return;
    void Promise.all([repository.listTargets(), repository.listTargetUsage()]).then(([targets, usage]) => {
      setTrainingCount(targets.filter((target) => target.collection === "training").length);
      setUserCount(targets.filter((target) => target.collection === "user").length);
      setUsageCount(usage.length);
    });
  }, [repository]);
  const updatePrefix = (value: string) => onChange({ sessionCodePrefix: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "RVH" });
  return <section className="panel target-settings-card"><PanelHeader title={copy.targets} icon={<Crosshair size={18} />} /><div className="target-settings-summary"><span><small>{copy.trainingTargets}</small><strong>{trainingCount}</strong></span><span><small>{copy.myTargets}</small><strong>{userCount}</strong></span><span><small>{copy.trackedTargetUses}</small><strong>{usageCount}</strong></span></div><div className="target-settings-body"><label><span>{copy.repeatBehavior}</span><select value={settings.targetRepeatPolicy} onChange={(event) => onChange({ targetRepeatPolicy: event.target.value as AppSettings["targetRepeatPolicy"] })}><option value="allow">{copy.allowRepeatedTraining}</option><option value="avoid_profile">{copy.avoidPreviouslyUsedTraining}</option></select></label><label><span>{copy.sessionCodePrefix}</span><input value={settings.sessionCodePrefix} maxLength={12} onChange={(event) => updatePrefix(event.target.value)} /></label><div className="training-pack-status"><div><strong>{copy.trainingTargets}</strong><p>{copy.targetPackPending}</p></div><button className="secondary-button" disabled>{copy.downloadMore}</button></div></div></section>;
}

function AdvancedSettingsCard({ copy, repository }: { copy: ReturnType<typeof getCopy>; repository: AppRepository | null }) {
  const [modelCount, setModelCount] = useState(0);
  const [capabilitySummary, setCapabilitySummary] = useState({ vision: 0, reasoning: 0, compatibility: 0 });
  const [debugEntries, setDebugEntries] = useState(() => listProviderDebug());
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => { if (repository) void repository.listProviderModels().then((models) => { setModelCount(models.length); setCapabilitySummary({ vision: models.filter((model) => model.capabilities.supportsVision).length, reasoning: models.filter((model) => model.capabilities.reasoning.supported).length, compatibility: models.filter((model) => model.capabilities.source === "compatibility").length }); }); };
  useEffect(refresh, [repository]);
  const reset = async () => {
    if (!repository || !window.confirm(copy.resetCapabilityCacheConfirm)) return;
    await repository.clearProviderModelCache();
    setModelCount(0); setCapabilitySummary({ vision: 0, reasoning: 0, compatibility: 0 }); setMessage(copy.resetCapabilityCache);
  };
  const clearDebug = () => { clearProviderDebug(); setDebugEntries([]); };
  return <section className="panel advanced-settings-card"><PanelHeader title={copy.advanced} icon={<Settings2 size={18} />} /><div className="advanced-settings-body"><div className="advanced-version"><span><small>{copy.appVersion}</small><strong>v{APP_VERSION}</strong></span><span><small>{copy.cachedModelCount}</small><strong>{modelCount}</strong></span><span><small>{copy.visionRoutes}</small><strong>{capabilitySummary.vision}</strong></span><span><small>{copy.reasoningRoutes}</small><strong>{capabilitySummary.reasoning}</strong></span><span><small>{copy.compatibilityRoutes}</small><strong>{capabilitySummary.compatibility}</strong></span></div><p>{copy.debugSecurity}</p><button className="secondary-button" disabled={!repository || !modelCount} onClick={() => void reset()}>{copy.resetCapabilityCache}</button>{message && <div className="storage-success"><Check size={14} />{message}</div>}<div className="debug-log-heading"><div><strong>{copy.apiDebugLog}</strong><small>{copy.debugVolatile}</small></div><span><button className="secondary-button" type="button" onClick={() => setDebugEntries(listProviderDebug())}>{copy.refreshDebugLog}</button><button className="secondary-button" type="button" disabled={!debugEntries.length} onClick={clearDebug}>{copy.clearDebugLog}</button></span></div><div className="debug-log-list">{debugEntries.length === 0 ? <p>{copy.noDebugCalls}</p> : debugEntries.map((entry) => <details key={entry.id}><summary><span className={`debug-status ${entry.status}`}>{entry.status.toUpperCase()}</span><strong>{entry.provider} · {entry.modelId}</strong><small>{new Date(entry.capturedAt).toLocaleString()}</small></summary><div className="debug-payload">{entry.endpoint && <code>{entry.endpoint}</code>}{entry.error && <pre>{entry.error}</pre>}{entry.request !== undefined && <><h4>{copy.rawRequest}</h4><pre>{JSON.stringify(entry.request, null, 2)}</pre></>}{entry.response !== undefined && <><h4>{copy.rawResponse}</h4><pre>{JSON.stringify(entry.response, null, 2)}</pre></>}</div></details>)}</div></div></section>;
}

function StorageSettingsCard({ copy, repository }: { copy: ReturnType<typeof getCopy>; repository: AppRepository | null }) {
  const [paths, setPaths] = useState<StoragePaths | null>(null);
  const [backups, setBackups] = useState<StorageBackupRecord[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState("");
  const [busy, setBusy] = useState<"backup" | "export" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState({ routes: 0, approxBytes: 0 });
  const refresh = async () => {
    if (!isTauriRuntime() || !repository) return;
    const [nextPaths, nextBackups, cachedModels] = await Promise.all([getStoragePaths(), listStorageBackups(), repository.listProviderModels()]);
    setPaths(nextPaths); setBackups(nextBackups);
    setCacheInfo({ routes: cachedModels.length, approxBytes: new TextEncoder().encode(JSON.stringify(cachedModels)).byteLength });
    setSelectedBackupId((current) => nextBackups.some((item) => item.backupId === current) ? current : nextBackups[0]?.backupId ?? "");
  };
  useEffect(() => { if (repository) void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [repository]);
  const backup = async () => {
    if (!repository || busy || !isTauriRuntime()) return;
    setBusy("backup"); setError(null); setMessage(null);
    try {
      const created = await createStorageBackup(repository);
      setMessage(`${copy.backupComplete} · ${new Date(created.createdAtUnixMs).toLocaleString()}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const restore = async () => {
    if (!repository || !selectedBackupId || busy || !isTauriRuntime()) return;
    const selected = backups.find((item) => item.backupId === selectedBackupId);
    if (!window.confirm(`${copy.restoreConfirm}\n\n${selected ? new Date(selected.createdAtUnixMs).toLocaleString() : selectedBackupId}`)) return;
    setBusy("restore"); setError(null); setMessage(null);
    try {
      await restoreStorageBackup(repository, selectedBackupId);
      window.location.reload();
    } catch (cause) {
      window.alert(`${copy.restoreFailed}\n\n${cause instanceof Error ? cause.message : String(cause)}`);
      window.location.reload();
    }
  };
  const exportData = async () => {
    if (!repository || busy || !isTauriRuntime()) return;
    setBusy("export"); setError(null); setMessage(null);
    try {
      const exported = await createStorageExport(repository);
      setMessage(`${copy.exportComplete} · ${exported.directory}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  return <section className="panel storage-settings-card"><PanelHeader title={copy.storage} icon={<Database size={18} />} />{isTauriRuntime() ? <div className="storage-settings-body"><p>{copy.backupSecurity}</p>{paths && <div className="storage-paths"><span><small>{copy.dataLocation}</small><code>{paths.databasePath}</code></span><span><small>{copy.artifacts}</small><code>{paths.artifactsPath}</code></span></div>}<div className="storage-cache-info"><span><small>{copy.capabilityCacheStorage}</small><strong>{formatBytes(cacheInfo.approxBytes)} · {cacheInfo.routes} {copy.cachedModelCount.toLowerCase()}</strong></span><span><small>{copy.cacheRouteLimit}</small><strong>{PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER.toLocaleString()} / provider</strong></span></div><div className="storage-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void openDataFolder().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>{copy.openDataFolder}</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void backup()}>{busy === "backup" ? copy.backingUp : copy.createBackup}</button><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void exportData()}>{busy === "export" ? copy.exporting : copy.exportData}</button></div><div className="restore-row"><label><span>{copy.backups}</span><select value={selectedBackupId} onChange={(event) => setSelectedBackupId(event.target.value)} disabled={Boolean(busy) || !backups.length}><option value="">{copy.noBackups}</option>{backups.map((item) => <option value={item.backupId} key={item.backupId}>{new Date(item.createdAtUnixMs).toLocaleString()} · {formatBytes(item.sizeBytes)}</option>)}</select></label><button className="secondary-button restore-button" disabled={Boolean(busy) || !selectedBackupId} onClick={() => void restore()}>{busy === "restore" ? copy.restoring : copy.restoreBackup}</button></div>{backups[0] && <small className="backup-hash">SHA-256 {backups[0].databaseSha256.slice(0, 20)}… · {formatBytes(backups[0].sizeBytes)}</small>}{message && <div className="storage-success"><Check size={14} />{message}</div>}{error && <div className="provider-error">{error}</div>}</div> : <div className="settings-info storage-runtime-info"><p>{copy.storageDesktop}</p></div>}</section>;
}

function SessionSettingsCard({ copy, settings, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; onChange: (settings: Partial<AppSettings>) => void }) {
  return <section className="panel session-settings-card"><PanelHeader title={copy.sessions} icon={<CircleStop size={18} />} /><div className="session-settings-body"><label><span>{copy.sessionLanguage}</span><select value={settings.sessionLanguage} onChange={(event) => onChange({ sessionLanguage: event.target.value as SessionLanguageSetting })}><option value="same">{copy.sameAsInterface}</option><option value="pl">Polski</option><option value="en">English</option></select></label><label><span>{copy.requestTimeout}</span><div><input type="number" min={1} max={600} value={Math.round(settings.requestTimeoutMs / 1000)} onChange={(event) => onChange({ requestTimeoutMs: Math.max(1, Math.min(600, Number(event.target.value) || 120)) * 1000 })} /><small>s</small></div></label><label><span>{copy.retryPolicy}</span><select value={settings.maxRetries} onChange={(event) => onChange({ maxRetries: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>{copy.defaultMaxOutput}</span><input type="number" min={1} max={262144} value={settings.defaultMaxOutputTokens} onChange={(event) => onChange({ defaultMaxOutputTokens: Math.max(1, Number(event.target.value) || 8192) })} /></label><label><span>{copy.hardSessionCostLimit}</span><div><input type="number" min={0} step="0.01" value={settings.maxSessionCostUsd} onChange={(event) => onChange({ maxSessionCostUsd: Math.max(0, Number(event.target.value) || 0) })} /><small>USD · {settings.maxSessionCostUsd > 0 ? copy.enabled : copy.disabled}</small></div></label><label><span>{copy.defaultReveal}</span><select value={settings.defaultRevealSource} onChange={(event) => onChange({ defaultRevealSource: event.target.value as AppSettings["defaultRevealSource"] })}><option value="external">{copy.externalBlind}</option><option value="automatic">{copy.automaticTarget}</option></select></label><div className="mandatory-autosave"><ShieldCheck size={16} /><div><strong>{copy.mandatoryAutosave}</strong><p>{copy.sessionRules}</p></div></div></div></section>;
}

function ProtocolDialog({ copy, resource, onClose }: { copy: ReturnType<typeof getCopy>; resource: ProtocolResource | RvLiteProtocolResource; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>{copy.protocolResource}</small><h2>{resource.displayName}</h2><p>v{resource.version} · {resource.language.toUpperCase()} · {wordCount(resource.content).toLocaleString()} {copy.wordCount.toLowerCase()}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <div className="hash-grid"><code>{"sourceDocxSha256" in resource ? <>{copy.sourceHash}<br />{resource.sourceDocxSha256}</> : <>Source<br />{resource.sourceFormat}</>}</code><code>{copy.contentHash}<br />{resource.contentSha256}</code></div>
        <pre className="protocol-text">{resource.content}</pre>
        <div className="modal-actions"><button className="primary-button" onClick={onClose}>{copy.close}</button></div>
      </section>
    </div>
  );
}

function CustomProtocolDialog({ copy, repository, language, base, onCancel, onSaved }: { copy: ReturnType<typeof getCopy>; repository: AppRepository; language: InterfaceLanguage; base: CustomProtocolVersion | null; onCancel: () => void; onSaved: (protocol: CustomProtocolVersion) => void }) {
  const [name, setName] = useState(base?.displayName ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(base?.systemPrompt ?? "");
  const [steps, setSteps] = useState<string[]>(base?.steps.length ? [...base.steps] : [""]);
  const [preview, setPreview] = useState(Boolean(base));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanSteps = steps.map((step) => step.trim()).filter(Boolean);
  const draft = { name, description, language, systemPrompt, steps };
  const dryRun = dryRunCustomProtocol({
    protocolId: base?.protocolId ?? "preview",
    versionId: base?.versionId ?? "preview",
    displayName: name || copy.customProtocol,
    description,
    version: base?.version ?? "preview",
    language,
    systemPrompt: systemPrompt || undefined,
    steps: cleanSteps,
    contentHash: base?.contentHash ?? "preview",
    createdAt: base?.createdAt ?? "preview",
  });

  const persist = async (asDuplicate: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveCustomProtocol(repository, draft, asDuplicate ? undefined : base?.protocolId);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><section className="modal custom-protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><small>{base ? `${base.displayName} · ${base.version}` : copy.newCustomProtocol}</small><h2>{copy.customProtocol}</h2><p>{language.toUpperCase()} · {copy.sessionCodePlaceholder}</p></div><button className="icon-button" onClick={onCancel}><X size={19} /></button></div><div className="custom-protocol-body"><div className="custom-builder-fields"><label>{copy.protocolName}<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.protocolDescription}<input value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>{copy.systemPromptOptional}<textarea className="custom-system-prompt-editor" rows={10} maxLength={100000} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /></label><div className="custom-steps-head"><strong>{copy.blindSteps} · {steps.length}/20</strong><button className="secondary-button" type="button" disabled={steps.length >= 20} onClick={() => setSteps((current) => [...current, ""])}><Plus size={14} />{copy.addStep}</button></div><div className="custom-steps">{steps.map((step, index) => <div className="custom-step" key={index}><span>{index + 1}</span><textarea rows={3} value={step} onChange={(event) => setSteps((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder={`${copy.step} ${index + 1}`} /><div><button type="button" className="icon-button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="icon-button" disabled={index === steps.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="icon-button danger" disabled={steps.length === 1} title={copy.removeStep} onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></div></div>)}</div></div>{preview && <aside className="custom-dry-run"><div><strong>{copy.dryRun}</strong><p>{copy.dryRunLead}</p></div>{systemPrompt.trim() && <article><span>SYSTEM</span><p>{systemPrompt.trim()}</p></article>}{dryRun.map((item) => <article key={item.sequence} className={item.boundary === "REVEAL" ? "reveal-step" : ""}><span>{item.boundary} · {item.role === "Viewer" ? copy.viewerCall : copy.revealCall}</span><strong>{item.role === "Viewer" ? `${copy.step} ${item.sequence}` : copy.revealSeparate}</strong>{item.prompt && <p>{item.prompt}</p>}</article>)}</aside>}</div>{error && <div className="provider-error">{error}</div>}<div className="custom-protocol-actions"><button className="secondary-button" type="button" onClick={() => setPreview((current) => !current)}>{copy.previewDryRun}</button><div>{base && <button className="secondary-button" type="button" disabled={saving || !name.trim() || !cleanSteps.length} onClick={() => void persist(true)}>{copy.duplicateProtocol}</button>}<button className="primary-button" type="button" disabled={saving || !name.trim() || !cleanSteps.length || cleanSteps.length > 20} onClick={() => void persist(false)}>{copy.saveNewVersion}</button></div></div></section></div>;
}

function buildProfileAiConfiguration(copy: ReturnType<typeof getCopy>, provider: ProviderConfig | null, viewerModel: ProviderModel | null, reasoning: "" | ReasoningEffort, temperatureInput: string, systemPrompt: string, monitorModelKey: string, judgeModelKey: string): ProfileAiConfigurationInput {
  if (!provider || !viewerModel || viewerModel.providerConfigId !== provider.id) throw new Error(copy.selectViewerBeforeSaving);
  const normalizedReasoning = reasoning ? reasoningEffortForModel(viewerModel, reasoning) : undefined;
  if (reasoning && !normalizedReasoning) throw new Error(copy.reasoningNotSupported);
  let temperature: number | undefined;
  if (viewerModel.capabilities.temperature.supported) {
    temperature = temperatureInput.trim() ? Number(temperatureInput) : defaultTemperatureForModel(viewerModel);
    const capability = viewerModel.capabilities.temperature;
    if (!Number.isFinite(temperature) || (capability.min !== undefined && temperature! < capability.min) || (capability.max !== undefined && temperature! > capability.max)) throw new Error(copy.temperatureOutOfRange);
  }
  const monitor = splitModelRouteKey(monitorModelKey);
  const judge = splitModelRouteKey(judgeModelKey);
  return {
    credentialId: provider.credentialId,
    credentialProvider: provider.provider,
    defaultViewerModelId: viewerModel.modelId,
    ...(normalizedReasoning ? { defaultViewerReasoningEffort: normalizedReasoning } : {}),
    ...(temperature !== undefined ? { defaultViewerTemperature: temperature } : {}),
    ...(systemPrompt.trim() ? { defaultViewerSystemPrompt: systemPrompt.trim() } : {}),
    ...(monitor ? { defaultMonitorProviderConfigId: monitor.providerConfigId, defaultMonitorModelId: monitor.modelId } : {}),
    ...(judge ? { defaultJudgeProviderConfigId: judge.providerConfigId, defaultJudgeModelId: judge.modelId } : {}),
  };
}

function CreateProfileDialog({ copy, repository, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; repository: AppRepository; onCancel: () => void; onCreate: (name: string, note: string | undefined, aiConfiguration: ProfileAiConfigurationInput) => Promise<void> }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [providerConfigId, setProviderConfigId] = useState("");
  const [viewerModelId, setViewerModelId] = useState("");
  const [reasoning, setReasoning] = useState<"" | ReasoningEffort>("");
  const [temperature, setTemperature] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [monitorModelKey, setMonitorModelKey] = useState("");
  const [judgeModelKey, setJudgeModelKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([repository.listProviderConfigs(), repository.listProviderModels()]).then(([nextProviders, nextModels]) => {
      if (cancelled) return;
      setProviders(nextProviders);
      setModels(nextModels);
      setProviderConfigId(nextProviders[0]?.id ?? "");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { cancelled = true; };
  }, [repository]);
  const provider = providers.find((item) => item.id === providerConfigId) ?? null;
  const viewerModels = preferredModelOrder(models.filter((model) => model.providerConfigId === providerConfigId));
  const viewerModel = viewerModels.find((model) => model.modelId === viewerModelId) ?? null;
  const roleModels = preferredModelOrder(models);
  const selectViewer = (modelId: string) => {
    const model = viewerModels.find((item) => item.modelId === modelId) ?? null;
    setViewerModelId(modelId);
    setReasoning("");
    const nextTemperature = defaultTemperatureForModel(model);
    setTemperature(nextTemperature === undefined ? "" : String(nextTemperature));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const aiConfiguration = buildProfileAiConfiguration(copy, provider, viewerModel, reasoning, temperature, systemPrompt, monitorModelKey, judgeModelKey);
      await onCreate(name, note || undefined, aiConfiguration);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <FormDialog title={copy.createProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}><label>{copy.profileName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><p>{copy.aiDefaultsLead}</p>{providers.length ? <><label><span>{copy.profileCredential}</span><select value={providerConfigId} onChange={(event) => { setProviderConfigId(event.target.value); setViewerModelId(""); setReasoning(""); setTemperature(""); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label><span>{copy.defaultViewerModel}</span><select value={viewerModelId} onChange={(event) => selectViewer(event.target.value)} disabled={!provider}><option value="">{viewerModels.length ? copy.selectModel : copy.noCachedModels}</option>{viewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label><ViewerProfileControls copy={copy} model={viewerModel} reasoning={reasoning} temperature={temperature} systemPrompt={systemPrompt} onReasoning={setReasoning} onTemperature={setTemperature} onSystemPrompt={setSystemPrompt} /><label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><select value={judgeModelKey} onChange={(event) => setJudgeModelKey(event.target.value)}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`create-judge-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label><label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><select value={monitorModelKey} onChange={(event) => setMonitorModelKey(event.target.value)}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`create-monitor-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label></> : <small>{copy.configureProviderFirst}</small>}</fieldset>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving || !provider || !viewerModel}>{saving ? copy.saving : copy.create}</button></div></form></FormDialog>;
}

function EditProfileDialog({ copy, profile, providers, models, onCancel, onSave }: { copy: ReturnType<typeof getCopy>; profile: Profile; providers: ProviderConfig[]; models: ProviderModel[]; onCancel: () => void; onSave: (name: string, note?: string, aiConfiguration?: ProfileAiConfigurationInput) => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [note, setNote] = useState(profile.note ?? "");
  const currentProvider = providers.find((provider) => provider.credentialId === profile.credentialId) ?? null;
  const [providerConfigId, setProviderConfigId] = useState(currentProvider?.id ?? "");
  const [viewerModelId, setViewerModelId] = useState(profile.defaultViewerModelId ?? "");
  const [reasoning, setReasoning] = useState<"" | ReasoningEffort>(profile.defaultViewerReasoningEffort ?? "");
  const [temperature, setTemperature] = useState(profile.defaultViewerTemperature === undefined ? "" : String(profile.defaultViewerTemperature));
  const [systemPrompt, setSystemPrompt] = useState(profile.defaultViewerSystemPrompt ?? "");
  const [monitorModelKey, setMonitorModelKey] = useState(resolveRoleDefault(profile, "monitor", models));
  const [judgeModelKey, setJudgeModelKey] = useState(resolveRoleDefault(profile, "judge", models));
  const [aiTouched, setAiTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((item) => item.id === providerConfigId) ?? null;
  const viewerModels = preferredModelOrder(models.filter((model) => model.providerConfigId === providerConfigId));
  const roleModels = preferredModelOrder(models);
  const validViewerModelId = viewerModels.some((model) => model.modelId === viewerModelId) ? viewerModelId : "";
  const viewerModel = viewerModels.find((model) => model.modelId === validViewerModelId) ?? null;
  useEffect(() => {
    if (aiTouched) return;
    const nextProvider = providers.find((item) => item.credentialId === profile.credentialId) ?? null;
    const storedModel = models.find((model) => model.providerConfigId === nextProvider?.id && model.modelId === profile.defaultViewerModelId) ?? null;
    setProviderConfigId(nextProvider?.id ?? "");
    setViewerModelId(profile.defaultViewerModelId ?? "");
    setReasoning(reasoningEffortForModel(storedModel, profile.defaultViewerReasoningEffort) ?? "");
    const storedTemperature = storedModel?.capabilities.temperature.supported ? profile.defaultViewerTemperature ?? defaultTemperatureForModel(storedModel) : undefined;
    setTemperature(storedTemperature === undefined ? "" : String(storedTemperature));
    setSystemPrompt(profile.defaultViewerSystemPrompt ?? "");
    setMonitorModelKey(resolveRoleDefault(profile, "monitor", models));
    setJudgeModelKey(resolveRoleDefault(profile, "judge", models));
  }, [aiTouched, models, profile, providers]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (aiTouched && (!provider || !validViewerModelId)) { setError(copy.selectViewerBeforeSaving); return; }
    setSaving(true); setError(null);
    try {
      const aiConfiguration = aiTouched ? buildProfileAiConfiguration(copy, provider, viewerModel, reasoning, temperature, systemPrompt, monitorModelKey, judgeModelKey) : undefined;
      await onSave(name, note, aiConfiguration);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const selectViewer = (modelId: string) => {
    const model = viewerModels.find((item) => item.modelId === modelId) ?? null;
    setViewerModelId(modelId);
    const sameStoredPair = provider?.credentialId === profile.credentialId && profile.defaultViewerModelId === modelId;
    setReasoning(sameStoredPair ? reasoningEffortForModel(model, profile.defaultViewerReasoningEffort) ?? "" : "");
    const nextTemperature = sameStoredPair && profile.defaultViewerTemperature !== undefined ? profile.defaultViewerTemperature : defaultTemperatureForModel(model);
    setTemperature(nextTemperature === undefined ? "" : String(nextTemperature));
    setAiTouched(true);
  };
  return <FormDialog title={copy.editProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}><label>{copy.profileName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><p>{copy.aiDefaultsLead}</p>{providers.length ? <><label><span>{copy.profileCredential}</span><select value={providerConfigId} onChange={(event) => { setProviderConfigId(event.target.value); setViewerModelId(""); setReasoning(""); setTemperature(""); setAiTouched(true); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label><span>{copy.defaultViewerModel}</span><select value={validViewerModelId} onChange={(event) => selectViewer(event.target.value)} disabled={!provider}><option value="">{viewerModels.length ? copy.selectModel : copy.noCachedModels}</option>{viewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label><ViewerProfileControls copy={copy} model={viewerModel} reasoning={reasoning} temperature={temperature} systemPrompt={systemPrompt} onReasoning={(value) => { setReasoning(value); setAiTouched(true); }} onTemperature={(value) => { setTemperature(value); setAiTouched(true); }} onSystemPrompt={(value) => { setSystemPrompt(value); setAiTouched(true); }} /><label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><select value={judgeModelKey} onChange={(event) => { setJudgeModelKey(event.target.value); setAiTouched(true); }}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`edit-judge-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label><label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><select value={monitorModelKey} onChange={(event) => { setMonitorModelKey(event.target.value); setAiTouched(true); }}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`edit-monitor-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label></> : <small>{copy.configureProviderFirst}</small>}</fieldset>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving}>{saving ? copy.saving : copy.saveChanges}</button></div></form></FormDialog>;
}

function CreateWorkspaceDialog({ copy, profile, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; profile: Profile | null; onCancel: () => void; onCreate: (name: string, description?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) void onCreate(name, description); };
  return <FormDialog title={`${copy.createWorkspace}${profile ? ` · ${profile.name || copy.unnamedProfile}` : ""}`} onCancel={onCancel}><form onSubmit={submit}><label>{copy.workspaceName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.workspaceDescription}<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!name.trim()}>{copy.create}</button></div></form></FormDialog>;
}

function FormDialog({ title, onCancel, children, modalClassName = "" }: { title: string; onCancel: () => void; children: ReactNode; modalClassName?: string }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><section className={`modal form-modal ${modalClassName}`.trim()} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onCancel}><X size={19} /></button></div>{children}</section></div>;
}

function Choice({ active, onClick, icon, title, meta, disabled = false }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; meta?: string; disabled?: boolean }) {
  return <button disabled={disabled} className={active ? "choice active" : "choice"} onClick={onClick}><span className="choice-icon">{icon}</span><span><strong>{title}</strong>{meta && <small>{meta}</small>}</span>{active && <Check size={16} className="choice-check" />}</button>;
}

function ConfigBlock({ label, children }: { label: string; children: ReactNode }) {
  return <div className="config-block"><label>{label}</label>{children}</div>;
}

function SettingRow({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <div className="setting-row"><span className="setting-label">{icon}<strong>{label}</strong></span>{children}</div>;
}

function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

function PanelHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-header"><span>{icon}</span><h2>{title}</h2></div>;
}

function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><h3>{title}</h3>{body && <p>{body}</p>}{action}</div>;
}

function EmptyCard({ children }: { children: ReactNode }) {
  return <div className="page"><section className="panel"><div className="empty-state">{children}</div></section></div>;
}

function LoadingState() {
  return <div className="loading-state"><span className="loader-orb" /><p>AI RV Harness</p></div>;
}

function InitializationErrorState({ copy, error, onRetry }: { copy: ReturnType<typeof getCopy>; error: string; onRetry: () => void }) {
  return <div className="startup-error-state"><span><CircleStop size={25} /></span><h2>{copy.startupFailed}</h2><p>{copy.startupFailedLead}</p><button className="primary-button" onClick={onRetry}>{copy.retryStartup}</button><details><summary>{copy.technicalDetails}</summary><code>{error}</code></details></div>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AI";
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
