import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Crosshair,
  Database,
  Download,
  EllipsisVertical,
  FileCheck2,
  FlaskConical,
  GraduationCap,
  Home,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  MonitorCog,
  Moon,
  Archive,
  Pencil,
  Paperclip,
  Plus,
  RadioTower,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Waves,
  X,
} from "lucide-react";
import rosehipLogo from "./assets/rosehip-logo.png";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getCopy } from "./i18n";
import { PROVIDER_LABELS } from "./components/ProviderSettings";
import { resolveSessionLanguage } from "./domain/localization";
import { getFullRcp, getRvLite, getTelepathicProtocol, type ProtocolResource } from "./resources/protocolRegistry";
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
import type { ProviderKind, ProviderModel, ReasoningEffort } from "./providers/types";
import { runAutomaticRcpSession, submitExternalReveal, type SessionProgress } from "./sessions/controller";
import { chooseRandomTarget, createUserTarget, targetIsEligibleForProtocol } from "./targets/service";
import { localizedTargetTitle } from "./targets/localization";
import type { TargetRecord } from "./targets/types";
import { dryRunCustomProtocol, saveCustomProtocol } from "./protocols/custom";
import type { CustomProtocolVersion } from "./protocols/types";
import { runAutomaticCustomSession } from "./sessions/customController";
import { runAutomaticRvLiteSession } from "./sessions/rvLiteController";
import { createSessionReplay, isRecoverableProviderInterruption } from "./sessions/resumeReplay";
import { runOrdinaryBatch, selectBatchTargets, type OrdinaryBatchProgress, type OrdinaryBatchSessionResult } from "./sessions/batch";
import { TrainingScreen } from "./features/training";
import { AiCenterScreen, type AiCenterView } from "./features/aiCenter";
import { ResearchScreen } from "./features/research";
import { storeRevealArtifact } from "./artifacts/native";
import type { RevealArtifactRecord, RvSession } from "./sessions/types";
import type { MonitorInterventionRecord, MonitorRunRecord } from "./monitor/types";
import { chooseDirectory, saveTextFile } from "./storage/native";
import { APP_VERSION } from "./version";
import { addProvider, refreshProviderModels } from "./providers/service";
import { runAutomaticPostRevealReview, sendPostRevealTurn } from "./sessions/postReveal";
import { HomeScreen } from "./features/home";
import { CreateProfileDialog, ProfilesScreen, ProfileViewerControls } from "./features/profiles";
import { SettingsScreen } from "./features/settings";
import { TargetsScreen } from "./features/targets";
import { ChatPanel } from "./features/conversations";
import { WorkspacesScreen, WorkspaceSwitcherDialog } from "./features/workspaces";
import { BatchEvaluation, JudgeEvaluation } from "./features/judge";
import { EmptyState } from "./components/EmptyState";
import { FormDialog } from "./components/FormDialog";
import { PageHeader } from "./components/PageHeader";
import { ProtocolDialog } from "./components/ProtocolDialog";
import { parsePostRevealTranscript } from "./sessions/postRevealTranscript";
import { exportMonitorRun } from "./exports/monitor";
import { exportSessionRecord } from "./exports/session";
import { ensureBundledTrainingTargets } from "./targets/bundled";
import { createDefaultSettings } from "./startupDefaults";
import { SettingsSaveQueue } from "./storage/settingsSaveQueue";
import { AsyncRunGuard } from "./sessions/runGuard";
import { modelRouteKey, preferredModelOrder, profileNeedingInitialSetup, resolveRoleDefault, resolveViewerDefault, splitModelRouteKey } from "./profileModelDefaults";
import { defaultTemperatureForModel, profileGenerationDefaults, profileSystemPromptSnapshot, reasoningEffortForModel } from "./profileViewerDefaults";
import { canSelectMonitor, canSelectProtocol, isRunModeCompatible } from "./sessions/modeCompatibility";
import { SafeMarkdown } from "./components/SafeMarkdown";
import { reasoningOptions } from "./providers/modelReasoningRegistry";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "./domain/isBeIdentity";
import { buildEffectiveMonitorPrompt, buildEffectiveViewerPrompt, factoryMonitorEditablePrompt, localizedMonitorEditablePrompt, localizedViewerEditablePrompt, lockedActivityDefinition, lockedMonitorExecution } from "./resources/systemPrompts";
import { SPECIAL_TASK_OPTIONS, specialTaskUsesMappedLabels, type SpecialTaskInput, type SpecialTaskOption } from "./sessions/specialTask";
import { seedBundledTelepathicTargets, TELEPATHIC_STARTER_PACK_VERSION } from "./targets/telepathicBundled";
import {
  resumeTelepathicManualQuestionStage,
  runAutomaticTelepathicSession,
  telepathicManualRecoveryState,
  type TelepathicManualQuestionHandle,
  type TelepathicManualRecoveryState,
  type TelepathicQuestionMode,
} from "./sessions/telepathicController";
import { prepareViewerNotesForSession, viewerNotesSystemBlock } from "./aiCenter/viewerNotes";
import { reasoningCapabilityLead, reasoningOptionLabel } from "./providers/reasoningPresentation";

type Page = "home" | "profiles" | "workspaces" | "research" | "targets" | "training" | "ai-center" | "settings" | "workspace";
type WorkspaceTab = "chat" | "rv";

export default function App() {
  const [repository, setRepository] = useState<AppRepository | null>(null);
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("chat");
  const [aiCenterView, setAiCenterView] = useState<AiCenterView>("overview");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [profileDialog, setProfileDialog] = useState(false);
  const [workspaceDialogFor, setWorkspaceDialogFor] = useState<string | null>(null);
  const [workspaceCreatedNotice, setWorkspaceCreatedNotice] = useState<{ workspaceId: string; workspaceName: string; profileName: string } | null>(null);
  const [recentSessions, setRecentSessions] = useState<RvSession[]>([]);
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
        stage = "factory-training-targets.seed";
        await ensureBundledTrainingTargets(repo);
        stage = "workspace-data.read";
        const [storedSettings, storedProfiles, storedWorkspaces] = await Promise.all([
          repo.loadSettings(),
          repo.listProfiles(),
          repo.listWorkspaces(),
        ]);
        let nextSettings = { ...createDefaultSettings(), ...storedSettings };
        if (storedSettings.telepathicStarterPackVersion !== TELEPATHIC_STARTER_PACK_VERSION) {
          stage = "telepathic-user-targets.seed";
          await seedBundledTelepathicTargets(repo);
          nextSettings = { ...nextSettings, telepathicStarterPackVersion: TELEPATHIC_STARTER_PACK_VERSION };
          await repo.saveSettings(nextSettings);
        }
        if (cancelled) return;
        setRepository(repo);
        setSettings(nextSettings);
        setProfiles(storedProfiles);
        setWorkspaces(storedWorkspaces);
        const sessions = (await Promise.all(storedWorkspaces.map((workspace) => repo.listRvSessions(workspace.id)))).flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setRecentSessions(sessions.slice(0, 8));
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

  const navigate = (destination: Page) => {
    if (destination === "ai-center") setAiCenterView("overview");
    setPage(destination);
  };

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

  const createProfile = async (name: string, humanName: string | undefined, note: string | undefined, aiConfiguration: ProfileAiConfigurationInput) => {
    if (!repository) return;
    const profile = await repository.createProfile({ name, humanName, note, aiConfiguration });
    setProfiles(await repository.listProfiles());
    setActiveProfileId(profile.id);
    setProfileDialog(false);
  };

  const createWorkspace = async (profileId: string, name: string, description?: string) => {
    if (!repository) return;
    const workspace = await repository.createWorkspace({ profileId, name, description });
    const owner = profiles.find((profile) => profile.id === profileId);
    setWorkspaceCreatedNotice({ workspaceId: workspace.id, workspaceName: workspace.name, profileName: owner ? aiIsBeDisplayName(owner) : "AI IS-BE" });
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
    <div className={page === "home" ? "app-shell" : "app-shell compact-navigation"}>
      <Sidebar page={page} copy={copy} compact={page !== "home"} onNavigate={navigate} />
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
              recentSessions={recentSessions}
              profiles={profiles}
              onCreateProfile={() => setProfileDialog(true)}
              onOpenProfiles={() => navigate("profiles")}
              onOpenWorkspace={openWorkspace}
              onOpenSession={(session) => { const owner = workspaces.find((item) => item.id === session.workspaceId); if (owner) { void openWorkspace(owner).then(() => setWorkspaceTab("rv")); } }}
            />
          ) : page === "profiles" ? (
            <ProfilesScreen
              copy={copy}
              profiles={profiles}
              workspaces={workspaces}
              onCreateProfile={() => setProfileDialog(true)}
              onCreateWorkspace={(profileId) => setWorkspaceDialogFor(profileId)}
              onOpenWorkspace={openWorkspace}
              repository={repository!}
              onProfilesChanged={refreshProfiles}
            />
          ) : page === "workspaces" ? (
            <WorkspacesScreen copy={copy} profiles={profiles} workspaces={workspaces} repository={repository} onChanged={refreshProfiles} activeWorkspaceId={activeWorkspaceId} onActiveArchived={(nextId) => { setActiveWorkspaceId(nextId); navigate("workspaces"); }} onOpenWorkspace={openWorkspace} onCreateWorkspace={() => setWorkspaceDialogFor("__choose__")} onCreateProfile={() => setProfileDialog(true)} />
          ) : page === "research" ? (
            <ResearchScreen copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} />
          ) : page === "targets" ? (
            <TargetsScreen copy={copy} settings={settings} repository={repository} />
          ) : page === "training" ? (
            <TrainingScreen copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} />
          ) : page === "ai-center" ? (
            <AiCenterScreen
              settings={settings}
              profiles={profiles}
              workspaces={workspaces}
              activeProfileId={activeProfileId}
              workspaceFilterId={activeWorkspace?.profileId === activeProfileId ? activeWorkspace.id : null}
              repository={repository!}
              initialView={aiCenterView}
              onProfileChange={(profileId) => { setActiveProfileId(profileId); setActiveWorkspaceId(workspaces.find((item) => item.profileId === profileId)?.id ?? null); }}
              monitorPanel={activeWorkspace && activeWorkspace.profileId === activeProfileId
                ? <MonitorPanel copy={copy} settings={settings} profile={profiles.find((item) => item.id === activeProfileId) ?? null} workspace={activeWorkspace} repository={repository} />
                : <EmptyCard>{settings.interfaceLanguage === "pl" ? "Utwórz lub wybierz Workspace tego Profilu, aby otworzyć historię AI Monitora." : "Create or select a Workspace for this Profile to open AI Monitor history."}</EmptyCard>}
            />
          ) : page === "settings" ? (
            <SettingsScreen copy={copy} settings={settings} workspaces={workspaces} repository={repository} onDataChanged={refreshProfiles} onChange={updateSettings} />
          ) : activeWorkspace ? (
            <WorkspaceScreen
              copy={copy}
              settings={settings}
              profile={profiles.find((item) => item.id === activeWorkspace.profileId) ?? null}
              workspace={activeWorkspace}
              tab={workspaceTab}
              onTab={setWorkspaceTab}
              repository={repository}
              profiles={profiles}
              workspaces={workspaces}
              onOpenWorkspace={openWorkspace}
              createdNotice={workspaceCreatedNotice?.workspaceId === activeWorkspace.id ? workspaceCreatedNotice : null}
              onDismissCreatedNotice={() => setWorkspaceCreatedNotice(null)}
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
          profiles={profiles}
          onCancel={() => setWorkspaceDialogFor(null)}
          onCreate={(profileId, name, description) => createWorkspace(profileId, name, description)}
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
  const setupLanguage: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  const [viewerSystemPrompt, setViewerSystemPrompt] = useState(localizedViewerEditablePrompt(existingProfile?.defaultViewerSystemPrompt, setupLanguage));
  const [modelSearch, setModelSearch] = useState("");
  const [profileName, setProfileName] = useState(existingProfile?.name ?? "");
  const [humanName, setHumanName] = useState(existingProfile?.humanName ?? "");
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
          defaultMonitorSystemPrompt: localizedMonitorEditablePrompt(existingProfile?.defaultMonitorSystemPrompt, setupLanguage),
          ...(judge ? { defaultJudgeProviderConfigId: judge.providerConfigId, defaultJudgeModelId: judge.modelId } : {}),
          ...(monitor ? { defaultMonitorProviderConfigId: monitor.providerConfigId, defaultMonitorModelId: monitor.modelId } : {}),
      };
      const profile = existingProfile
        ? { ...existingProfile, name: profileName.trim(), humanName: humanName.trim() || undefined, ...aiConfiguration, updatedAt: new Date().toISOString() }
        : await repository.createProfile({ name: profileName, humanName, aiConfiguration });
      if (existingProfile) {
        await repository.updateProfile(existingProfile.id, { name: profileName, humanName, note: existingProfile.note });
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
          <span className="first-run-logo"><img src={rosehipLogo} alt="" /></span>
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
          <ProfileViewerControls copy={copy} model={viewerModel} reasoning={viewerReasoning} temperature={viewerTemperature} systemPrompt={viewerSystemPrompt} onReasoning={setViewerReasoning} onTemperature={setViewerTemperature} onSystemPrompt={setViewerSystemPrompt} />
          <div className="identity-name-grid"><label>{copy.aiIsBeName}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div>
          <small className="setup-security-note"><Users size={13} />{copy.identityNamesLead}</small>
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

function Sidebar({ page, copy, compact, onNavigate }: { page: Page; copy: ReturnType<typeof getCopy>; compact: boolean; onNavigate: (page: Page) => void }) {
  const items: Array<{ id: Page; icon: typeof Home; label: string }> = [
    { id: "home", icon: Home, label: copy.home },
    { id: "profiles", icon: Users, label: copy.profiles },
    { id: "workspaces", icon: RadioTower, label: copy.workspaces },
    { id: "research", icon: FlaskConical, label: copy.research },
    { id: "targets", icon: Crosshair, label: copy.targets },
    { id: "training", icon: GraduationCap, label: copy.training },
    { id: "ai-center", icon: BrainCircuit, label: "AI Center" },
    { id: "settings", icon: Settings2, label: copy.settings },
  ];
  return (
    <aside className={compact ? "sidebar compact" : "sidebar"}>
      <button className="brand" onClick={() => onNavigate("home")} title={copy.appName}>
        <span className="brand-mark"><img src={rosehipLogo} alt="" /></span>
        {!compact && <span><strong>{copy.appName}</strong><small>{copy.tagline}</small></span>}
      </button>
      <nav className="side-nav">
        {items.map((item) => {
          const Icon = item.icon;
          const active = page === item.id || (page === "workspace" && item.id === "workspaces");
          return (
            <button key={item.id} title={item.label} aria-label={item.label} className={active ? "nav-item active" : "nav-item"} onClick={() => onNavigate(item.id)}>
              <Icon size={18} />
              {!compact && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer" title={copy.secureLocal}>
        <div className="privacy-badge"><ShieldCheck size={15} /><span>{copy.secureLocal}</span></div>
        {!compact && <small>v{APP_VERSION} · Code MIT · Content CC BY 4.0</small>}
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
  const themes: Theme[] = ["blue", "aurora", "light", "dark", "green"];
  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length];
  return (
    <header className="topbar">
      <div className="crumbs">
        {profile ? <><span className="avatar tiny">{initials(aiIsBeDisplayName(profile))}</span><span>{aiIsBeDisplayName(profile)}</span></> : <span>AI IS-BE</span>}
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


function WorkspaceScreen({ copy, settings, profile, workspace, tab, onTab, repository, profiles, workspaces, onOpenWorkspace, createdNotice, onDismissCreatedNotice }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; tab: WorkspaceTab; onTab: (tab: WorkspaceTab) => void; repository: AppRepository | null; profiles: Profile[]; workspaces: Workspace[]; onOpenWorkspace: (workspace: Workspace) => void; createdNotice: { workspaceId: string; workspaceName: string; profileName: string } | null; onDismissCreatedNotice: () => void }) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  return (
    <><div className="page workspace-page">
      <PageHeader title={workspace.name} subtitle={workspace.description || `${profile ? aiIsBeDisplayName(profile) : "—"} · ${copy.workspace}`} action={<button className="secondary-button" onClick={() => setSwitcherOpen(true)}><RadioTower size={15} />{copy.switchWorkspace}</button>} />
      {createdNotice && <div className="workspace-created-notice"><Check size={16} /><span><strong>{copy.workspaceCreated}</strong><small>{createdNotice.profileName} → {createdNotice.workspaceName}</small></span><button className="icon-button" onClick={onDismissCreatedNotice}><X size={14} /></button></div>}
      <div className="module-tabs">
        <button className={tab === "chat" ? "module-tab active" : "module-tab"} onClick={() => onTab("chat")}><MessageCircle size={17} />{copy.chat}</button>
        <button className={tab === "rv" ? "module-tab active" : "module-tab"} onClick={() => onTab("rv")}><Crosshair size={17} />{copy.rvSession}</button>
      </div>
      {tab === "chat" ? <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} /> : <RvSessionPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} />}
    </div>{switcherOpen && <WorkspaceSwitcherDialog copy={copy} profiles={profiles} workspaces={workspaces} onOpenWorkspace={onOpenWorkspace} onClose={() => setSwitcherOpen(false)} />}</>
  );
}


function RvSessionPanel({ copy, settings, profile, workspace, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; repository: AppRepository | null }) {
  const [executionScope, setExecutionScope] = useState<"single" | "batch">("single");
  const [runType, setRunType] = useState<"automatic" | "monitor">("automatic");
  const [viewerNotesEnabled, setViewerNotesEnabled] = useState(true);
  const [protocol, setProtocol] = useState<"rcp" | "lite" | "custom" | "telepathic">("rcp");
  const [liteVariant, setLiteVariant] = useState<"core" | "extended">("extended");
  const [specialTaskOptions, setSpecialTaskOptions] = useState<SpecialTaskOption[]>([]);
  const [specialTaskText, setSpecialTaskText] = useState("");
  const [telepathicQuestionMode, setTelepathicQuestionMode] = useState<TelepathicQuestionMode>("manual");
  const [telepathicQuestionsText, setTelepathicQuestionsText] = useState("");
  const [manualQuestionHandle, setManualQuestionHandle] = useState<TelepathicManualQuestionHandle | null>(null);
  const [telepathicRecovery, setTelepathicRecovery] = useState<Record<string, TelepathicManualRecoveryState>>({});
  const [recoverableSessions, setRecoverableSessions] = useState<Record<string, true>>({});
  const [manualQuestionText, setManualQuestionText] = useState("");
  const [manualQuestionBusy, setManualQuestionBusy] = useState(false);
  const [revealSource, setRevealSource] = useState<"automatic" | "external">(settings.defaultRevealSource);
  const [sessionLanguage, setSessionLanguage] = useState<SessionLanguageSetting>(settings.sessionLanguage);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [allModels, setAllModels] = useState<ProviderModel[]>([]);
  const [targets, setTargets] = useState<TargetRecord[]>([]);
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
  const [postRevealTranscript, setPostRevealTranscript] = useState("");
  const [postRevealText, setPostRevealText] = useState("");
  const [postRevealBusy, setPostRevealBusy] = useState(false);
  const [sessionExportBusy, setSessionExportBusy] = useState(false);
  const [sessionExportPath, setSessionExportPath] = useState<string | null>(null);
  const [batchCount, setBatchCount] = useState(3);
  const [batchProgress, setBatchProgress] = useState<OrdinaryBatchProgress | null>(null);
  const [batchResults, setBatchResults] = useState<OrdinaryBatchSessionResult[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [sessionRunning, setSessionRunning] = useState(false);
  const [batchPreflightSignature, setBatchPreflightSignature] = useState<string | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runGuardRef = useRef(new AsyncRunGuard());
  const resolvedLanguage = resolveSessionLanguage(settings.interfaceLanguage, sessionLanguage);
  const rcp = getFullRcp(resolvedLanguage);
  const rvLite = getRvLite(resolvedLanguage, liteVariant);
  const telepathic = getTelepathicProtocol(resolvedLanguage);
  const telepathicQuestions = telepathicQuestionsText.split(/\r?\n/).map((question) => question.trim()).filter(Boolean);
  const specialTask: SpecialTaskInput | undefined = specialTaskOptions.length || specialTaskText.trim() ? { selectedOptions: specialTaskOptions, ...(specialTaskText.trim() ? { customText: specialTaskText.trim() } : {}) } : undefined;
  const activeProvider = providerConfigs.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const selectedModel = models.find((item) => item.modelId === modelId) ?? null;
  const monitorModel = allModels.find((item) => `${item.providerConfigId}::${item.modelId}` === monitorModelKey) ?? null;
  const monitorProvider = monitorModel ? providerConfigs.find((item) => item.id === monitorModel.providerConfigId) ?? null : null;
  const eligibleTargets = targets.filter((target) => targetIsEligibleForProtocol(target, protocol));
  const batchPool = eligibleTargets;
  const batchConfigSignature = JSON.stringify({ providerConfigId: activeProvider?.id ?? null, providerStatus: activeProvider?.lastStatus ?? null, providerTestedAt: activeProvider?.lastTestedAt ?? null, modelId, protocol, liteVariant, specialTaskOptions, specialTaskText, telepathicQuestionMode, telepathicQuestions, customProtocolVersionId, runType, viewerNotesEnabled, monitorModelKey, sessionLanguage: resolvedLanguage, reasoning, temperature, profileSystemPrompt: profile?.defaultViewerSystemPrompt ?? null, maxOutputTokens, requestTimeoutMs: settings.requestTimeoutMs, maxRetries: settings.maxRetries, maxSessionCostUsd: settings.maxSessionCostUsd, sessionCodePrefix: settings.sessionCodePrefix, batchCount, targetIds: batchPool.map((target) => target.id).sort() });
  const selectedCustomProtocol = customProtocols.find((item) => item.versionId === customProtocolVersionId) ?? null;
  const activeStepCount = protocol === "custom" ? selectedCustomProtocol?.steps.length ?? 0 : protocol === "lite" ? 4 : protocol === "telepathic" ? 9 : 6;
  const running = sessionRunning || batchRunning || progress?.state === "BlindRunning" || progress?.state === "Preflight";
  const recoveryInspectionKey = recentSessions.map((session) => `${session.id}:${session.state}:${session.updatedAt}`).join("|");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const configs = await repository.listProviderConfigs();
      if (cancelled) return;
      setProviderConfigs(configs);
      const bound = configs.find((item) => item.credentialId === profile?.credentialId);
      const [nextModels, everyModel, targetCatalog, sessionHistory] = await Promise.all([
        bound ? repository.listProviderModels(bound.id) : Promise.resolve([]),
        repository.listProviderModels(),
        repository.listTargets(),
        repository.listRvSessions(workspace.id),
      ]);
      if (cancelled) return;
      setModels(nextModels);
      setAllModels(everyModel);
      setTargets(targetCatalog);
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
    let cancelled = false;
    if (!repository) return;
    const incomplete = recentSessions.filter((session) => session.state === "BlindRunning" || session.state === "Preflight");
    void Promise.all(incomplete.map(async (session) => {
      const snapshot = await repository.getSessionSnapshot(session.id);
      if (!snapshot?.telepathic || snapshot.telepathic.step8QuestionMode !== "manual" || snapshot.monitor) return null;
      const state = telepathicManualRecoveryState(await repository.listSessionEvents(session.id));
      return state ? [session.id, state] as const : null;
    })).then((items) => {
      if (cancelled) return;
      setTelepathicRecovery(Object.fromEntries(items.filter((item): item is readonly [string, TelepathicManualRecoveryState] => Boolean(item))));
    }).catch(() => {
      if (!cancelled) setTelepathicRecovery({});
    });
    return () => { cancelled = true; };
  }, [repository, recoveryInspectionKey]);

  useEffect(() => {
    let cancelled = false;
    if (!repository) return;
    const interrupted = recentSessions.filter((session) => session.state === "Interrupted" && !session.preRevealSealedAt);
    void Promise.all(interrupted.map(async (session) => [session.id, isRecoverableProviderInterruption(session, await repository.listSessionEvents(session.id))] as const)).then((items) => {
      if (!cancelled) setRecoverableSessions(Object.fromEntries(items.filter((item) => item[1]).map(([id]) => [id, true])));
    }).catch(() => { if (!cancelled) setRecoverableSessions({}); });
    return () => { cancelled = true; };
  }, [repository, recoveryInspectionKey]);

  useEffect(() => {
    if (!selectedModel) return;
    const limit = selectedModel.capabilities.maxOutputTokens;
    const profileDefaults = profileGenerationDefaults(profile, selectedModel);
    setMaxOutputTokens(String(limit ? Math.min(limit, settings.defaultMaxOutputTokens) : settings.defaultMaxOutputTokens));
    setReasoning(profileDefaults.reasoningEffort ?? "");
    setTemperature(profileDefaults.temperature === undefined ? "" : String(profileDefaults.temperature));
  }, [selectedModel?.modelId, profile?.defaultViewerModelId, profile?.defaultViewerReasoningEffort, profile?.defaultViewerTemperature, settings.defaultMaxOutputTokens]);

  useEffect(() => {
    if (protocol !== "telepathic") return;
    setTelepathicQuestionMode((current) => {
      if (runType === "monitor") return current === "predefined" ? current : "monitor";
      if (executionScope === "batch") return "predefined";
      return current === "monitor" ? "manual" : current;
    });
  }, [executionScope, protocol, runType]);

  const preflightBatch = () => {
    const failures: string[] = [];
    if (!activeProvider || activeProvider.lastStatus !== "ok") failures.push(copy.batchProviderPreflight);
    if (!selectedModel) failures.push(copy.selectModel);
    if (protocol === "custom" && !selectedCustomProtocol) failures.push(copy.noCustomProtocols);
    if (!isRunModeCompatible(runType, protocol)) failures.push(copy.rvLiteUnavailable);
    if (runType === "monitor" && (!monitorModel || !monitorProvider)) failures.push(copy.monitorModel);
    if (!Number.isFinite(Number(maxOutputTokens)) || Number(maxOutputTokens) <= 0) failures.push(copy.maxOutputTokens);
    if (protocol === "telepathic" && telepathicQuestionMode === "predefined" && telepathicQuestions.length === 0) failures.push(settings.interfaceLanguage === "pl" ? "Wpisz pytania po Kroku 8" : "Enter Step 8 questions");
    if (protocol === "telepathic" && runType === "monitor" && telepathicQuestions.length > 5) failures.push(settings.interfaceLanguage === "pl" ? "AI Monitor może zadać najwyżej 5 pytań" : "AI Monitor may ask at most 5 questions");
    if (protocol === "telepathic" && executionScope === "batch" && telepathicQuestionMode === "manual") failures.push(settings.interfaceLanguage === "pl" ? "Tryb ręcznych pytań nie jest dostępny w batchu" : "Manual questions are unavailable in batch mode");
    if (batchCount < 1 || batchCount > batchPool.length) failures.push(copy.batchTargetPreflight);
    if (failures.length) {
      setBatchPreflightSignature(null);
      setRunError(`${copy.preflightFailed}: ${failures.join(" · ")}`);
      return;
    }
    setBatchPreflightSignature(batchConfigSignature);
    setRunError(null);
  };

  const automaticReview = async (sessionId: string, updateVisibleTranscript: boolean): Promise<string> => {
    if (!repository) return "";
    if (updateVisibleTranscript) setPostRevealBusy(true);
    try {
      const snapshot = await repository.getSessionSnapshot(sessionId);
      if (!snapshot) throw new Error(copy.postRevealRouteUnavailable);
      const viewerProvider = providerConfigs.find((item) => item.id === snapshot.providerConfigId);
      if (!viewerProvider) throw new Error(copy.postRevealRouteUnavailable);
      const viewerModel: ProviderModel = allModels.find((item) => item.providerConfigId === snapshot.providerConfigId && item.modelId === snapshot.modelId) ?? {
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
      const capturedMonitorProvider = snapshot.monitor ? providerConfigs.find((item) => item.id === snapshot.monitor?.providerConfigId) : undefined;
      const capturedMonitorModel = snapshot.monitor ? allModels.find((item) => item.providerConfigId === snapshot.monitor?.providerConfigId && item.modelId === snapshot.monitor?.modelId) : undefined;
      const transcript = await runAutomaticPostRevealReview({
        repository,
        sessionId,
        viewer: { providerConfig: viewerProvider, model: viewerModel },
        ...(capturedMonitorProvider && capturedMonitorModel ? { monitor: { providerConfig: capturedMonitorProvider, model: capturedMonitorModel } } : {}),
        timeoutMs: settings.requestTimeoutMs,
        maxRetries: settings.maxRetries,
      });
      if (updateVisibleTranscript) setPostRevealTranscript(transcript);
      if (snapshot.monitor && (!capturedMonitorProvider || !capturedMonitorModel)) throw new Error(copy.postRevealRouteUnavailable);
      return transcript;
    } catch (cause) {
      if (updateVisibleTranscript) {
        const saved = (await repository.listRvSessions(workspace.id)).find((session) => session.id === sessionId);
        if (saved?.postRevealTranscript) setPostRevealTranscript(saved.postRevealTranscript);
      }
      throw cause;
    } finally {
      if (updateVisibleTranscript) setPostRevealBusy(false);
    }
  };

  const finishRevealedSession = async (result: { sessionId: string; state: string }) => {
    if (result.state !== "Revealed") return;
    if (executionScope === "single" && repository) {
      const storedReveal = await repository.getReveal(result.sessionId);
      setAcceptedRevealText(storedReveal?.text ?? "");
      setAcceptedRevealArtifacts(storedReveal?.artifactManifest ?? []);
    }
    await automaticReview(result.sessionId, executionScope === "single");
  };

  const start = async () => {
    if (!repository || !profile || !activeProvider || !selectedModel) return;
    if (protocol === "custom" && !selectedCustomProtocol) return;
    if (!isRunModeCompatible(runType, protocol)) return;
    if (runType === "monitor" && (!monitorModel || !monitorProvider)) return;
    if (protocol === "telepathic" && telepathicQuestionMode === "predefined" && telepathicQuestions.length === 0) return;
    if (protocol === "telepathic" && runType === "monitor" && telepathicQuestions.length > 5) return;
    if (protocol === "telepathic" && executionScope === "batch" && telepathicQuestionMode === "manual") return;
    const automaticTarget = executionScope === "single" && revealSource === "automatic"
      ? selectedTargetId === "__random__" ? chooseRandomTarget(eligibleTargets) : eligibleTargets.find((target) => target.id === selectedTargetId) ?? null
      : null;
    if (executionScope === "single" && revealSource === "automatic" && !automaticTarget) return;
    if (executionScope === "batch" && (batchCount < 1 || batchCount > batchPool.length || batchPreflightSignature !== batchConfigSignature)) return;
    const batchTargets = executionScope === "batch" ? selectBatchTargets(batchPool, batchCount) : [];
    let rvSystemPrompt: Awaited<ReturnType<typeof profileSystemPromptSnapshot>>;
    try { rvSystemPrompt = await profileSystemPromptSnapshot(profile, resolvedLanguage); }
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
    setPostRevealTranscript("");
    setPostRevealText("");
    setBatchResults([]);
    setBatchProgress(null);
    setManualQuestionHandle(null);
    setManualQuestionText("");
    const controller = new AbortController();
    abortRef.current = controller;
    const requestedSettings = {
      ...(reasoning ? { reasoningEffort: reasoning } : {}),
      ...(temperature.trim() ? { temperature: Number(temperature) } : {}),
      ...(maxOutputTokens.trim() ? { maxOutputTokens: Number(maxOutputTokens) } : {}),
    };
    const runOne = async (target: TargetRecord | null) => {
      const viewerNotes = await prepareViewerNotesForSession({ repository, profileId: profile.id, providerConfig: activeProvider, model: selectedModel, enabled: viewerNotesEnabled });
      if (protocol === "lite") {
        const result = await runAutomaticRvLiteSession({ repository, workspaceId: workspace.id, profileId: profile.id, profileName: aiIsBeDisplayName(profile), humanIsBeDisplayName: humanIsBeDisplayName(profile), providerConfig: activeProvider, model: selectedModel, protocol: rvLite, sessionLanguage: resolvedLanguage, requestedSettings, viewerNotes, ...(rvSystemPrompt ? { rvSystemPrompt } : {}), ...(specialTask ? { specialTask } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, sessionCodePrefix: settings.sessionCodePrefix, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), onProgress: setProgress, ...(target ? { automaticTarget: target } : {}) });
        await finishRevealedSession(result);
        return result;
      }
      if (protocol === "custom" && selectedCustomProtocol) {
        const result = await runAutomaticCustomSession({ repository, workspaceId: workspace.id, profileId: profile.id, aiIsBeDisplayName: aiIsBeDisplayName(profile), humanIsBeDisplayName: humanIsBeDisplayName(profile), providerConfig: activeProvider, model: selectedModel, protocol: selectedCustomProtocol, sessionLanguage: resolvedLanguage, requestedSettings, viewerNotes, ...(rvSystemPrompt ? { rvSystemPrompt } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, sessionCodePrefix: settings.sessionCodePrefix, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), onProgress: setProgress, ...(target ? { automaticTarget: target } : {}) });
        await finishRevealedSession(result);
        return result;
      }
      if (protocol === "telepathic") {
        const result = await runAutomaticTelepathicSession({
          repository,
          workspaceId: workspace.id,
          profileId: profile.id,
          aiIsBeDisplayName: aiIsBeDisplayName(profile),
          humanIsBeDisplayName: humanIsBeDisplayName(profile),
          providerConfig: activeProvider,
          model: selectedModel,
          protocol: telepathic,
          sessionLanguage: resolvedLanguage,
          requestedSettings,
          viewerNotes,
          step8Questions: { mode: telepathicQuestionMode, ...(telepathicQuestions.length ? { questions: telepathicQuestions } : {}) },
          ...(rvSystemPrompt ? { rvSystemPrompt } : {}),
          signal: controller.signal,
          maxRetries: settings.maxRetries,
          requestTimeoutMs: settings.requestTimeoutMs,
          sessionCodePrefix: settings.sessionCodePrefix,
          ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}),
          onProgress: setProgress,
          ...(executionScope === "single" && runType === "automatic" && telepathicQuestionMode === "manual" ? { onManualQuestionStage: setManualQuestionHandle } : {}),
          ...(target ? { automaticTarget: target } : {}),
          ...(runType === "monitor" && monitorModel && monitorProvider ? { monitor: { providerConfig: monitorProvider, model: monitorModel, editablePrompt: localizedMonitorEditablePrompt(profile.defaultMonitorSystemPrompt, resolvedLanguage) } } : {}),
        });
        await finishRevealedSession(result);
        return result;
      }
      const result = await runAutomaticRcpSession({
        repository,
        workspaceId: workspace.id,
        profileId: profile.id,
        providerConfig: activeProvider,
        model: selectedModel,
        protocol: rcp,
        sessionLanguage: resolvedLanguage,
        requestedSettings,
        viewerNotes,
        aiIsBeDisplayName: aiIsBeDisplayName(profile),
        humanIsBeDisplayName: humanIsBeDisplayName(profile),
        ...(specialTask ? { specialTask } : {}),
        ...(rvSystemPrompt ? { rvSystemPrompt } : {}),
        signal: controller.signal,
        maxRetries: settings.maxRetries,
        requestTimeoutMs: settings.requestTimeoutMs,
        sessionCodePrefix: settings.sessionCodePrefix,
        ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}),
        onProgress: setProgress,
        ...(target ? { automaticTarget: target } : {}),
        ...(runType === "monitor" && monitorModel && monitorProvider ? { monitor: { providerConfig: monitorProvider, model: monitorModel, editablePrompt: localizedMonitorEditablePrompt(profile.defaultMonitorSystemPrompt, resolvedLanguage) } } : {}),
      });
      await finishRevealedSession(result);
      return result;
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
      setManualQuestionHandle(null);
      abortRef.current = null;
      try {
        const sessions = await repository.listRvSessions(workspace.id);
        setRecentSessions(sessions.filter((session) => !session.researchProjectId));
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
      await submitExternalReveal(repository, progress.sessionId, submittedText, revealArtifacts, resolvedLanguage);
      setProgress((current) => current ? { ...current, state: "Revealed" } : current);
      setAcceptedRevealText(submittedText);
      setAcceptedRevealArtifacts([...revealArtifacts]);
      setRevealText("");
      setRevealArtifacts([]);
      await automaticReview(progress.sessionId, true);
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
      const target = await createUserTarget(repository, { title: saveTargetTitle, ...(acceptedRevealText ? { revealText: acceptedRevealText } : {}), ...(acceptedRevealArtifacts.length ? { revealArtifacts: acceptedRevealArtifacts } : {}), source: "external_blind_session", targetKind: protocol === "telepathic" ? "telepathic" : "general" });
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
    setRunError(null); setRevealText(""); setRevealArtifacts([]); setAcceptedRevealText(""); setAcceptedRevealArtifacts([]); setTargetSaved(false); setPostRevealTranscript(session.postRevealTranscript); setPostRevealText(""); setSessionExportPath(null);
    if (!repository) return;
    const storedReveal = await repository.getReveal(session.id);
    setAcceptedRevealText(storedReveal?.text ?? "");
    setAcceptedRevealArtifacts(storedReveal?.artifactManifest ?? []);
  };

  const resumeTelepathicSession = async (session: RvSession) => {
    if (!repository || !runGuardRef.current.tryAcquire()) return;
    setRunError(null);
    setProtocol("telepathic");
    setRunType("automatic");
    setExecutionScope("single");
    setSessionRunning(true);
    setManualQuestionHandle(null);
    setManualQuestionText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const snapshot = await repository.getSessionSnapshot(session.id);
      if (!snapshot?.telepathic) throw new Error(settings.interfaceLanguage === "pl" ? "Brak snapshota sesji telepatycznej." : "The telepathic session snapshot is unavailable.");
      const providerConfig = providerConfigs.find((item) => item.id === snapshot.providerConfigId);
      const viewerModel = allModels.find((item) => item.providerConfigId === snapshot.providerConfigId && item.modelId === snapshot.modelId && item.route === snapshot.modelRoute);
      if (!providerConfig || !viewerModel) throw new Error(copy.postRevealRouteUnavailable);
      const automaticTarget = snapshot.revealSource === "automatic" ? targets.find((target) => target.id === snapshot.targetId) : undefined;
      if (snapshot.revealSource === "automatic" && !automaticTarget) throw new Error(settings.interfaceLanguage === "pl" ? "Zapisany cel telepatyczny jest niedostępny." : "The captured telepathic target is unavailable.");
      setSessionLanguage(snapshot.sessionLanguage);
      setActiveTargetId(snapshot.targetId ?? null);
      setProgress({
        sessionId: session.id,
        sessionCode: session.sessionCode,
        state: "BlindRunning",
        transcript: session.preRevealTranscript,
        phase: telepathicRecovery[session.id] === "seal" ? 9 : 8,
        ...(telepathicRecovery[session.id] === "questions" ? { awaitingStep8Questions: true } : {}),
      });
      const result = await resumeTelepathicManualQuestionStage({
        repository,
        session,
        providerConfig,
        model: viewerModel,
        ...(automaticTarget ? { automaticTarget } : {}),
        signal: controller.signal,
        maxRetries: settings.maxRetries,
        requestTimeoutMs: settings.requestTimeoutMs,
        ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}),
        onManualQuestionStage: setManualQuestionHandle,
        onProgress: setProgress,
      });
      await finishRevealedSession(result);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      runGuardRef.current.release();
      setSessionRunning(false);
      setManualQuestionHandle(null);
      abortRef.current = null;
      try {
        setRecentSessions((await repository.listRvSessions(workspace.id)).filter((item) => !item.researchProjectId));
      } catch (cause) {
        setRunError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  };

  const runCapturedSession = async (session: RvSession, resume: boolean) => {
    if (!repository || !profile || !runGuardRef.current.tryAcquire()) return;
    setRunError(null);
    setExecutionScope("single");
    setSessionRunning(true);
    setManualQuestionHandle(null);
    setManualQuestionText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const snapshot = await repository.getSessionSnapshot(session.id);
      if (!snapshot) throw new Error(settings.interfaceLanguage === "pl" ? "Brak zapisanego snapshota tej sesji." : "The saved session snapshot is unavailable.");
      const providerConfig = providerConfigs.find((item) => item.id === snapshot.providerConfigId);
      const viewerModel = allModels.find((item) => item.providerConfigId === snapshot.providerConfigId && item.modelId === snapshot.modelId && item.route === snapshot.modelRoute);
      if (!providerConfig || !viewerModel) throw new Error(copy.postRevealRouteUnavailable);
      const capturedTarget = snapshot.revealSource === "automatic" ? targets.find((target) => target.id === snapshot.targetId) : undefined;
      if (snapshot.revealSource === "automatic" && !capturedTarget) throw new Error(settings.interfaceLanguage === "pl" ? "Zapisany cel tej sesji jest niedostępny." : "The saved target for this session is unavailable.");
      const capturedMonitorProvider = snapshot.monitor ? providerConfigs.find((item) => item.id === snapshot.monitor?.providerConfigId) : undefined;
      const capturedMonitorModel = snapshot.monitor ? allModels.find((item) => item.providerConfigId === snapshot.monitor?.providerConfigId && item.modelId === snapshot.monitor?.modelId && item.route === snapshot.monitor?.modelRoute) : undefined;
      if (snapshot.monitor && (!capturedMonitorProvider || !capturedMonitorModel)) throw new Error(copy.postRevealRouteUnavailable);
      const events = resume ? await repository.listSessionEvents(session.id) : [];
      if (resume && !isRecoverableProviderInterruption(session, events)) throw new Error(settings.interfaceLanguage === "pl" ? "Ta sesja nie została przerwana przez odzyskiwalny błąd providera." : "This session was not interrupted by a recoverable provider error.");
      const monitorRuns = snapshot.monitor ? await repository.listMonitorRuns(workspace.id) : [];
      const monitorRun = monitorRuns.find((item) => item.sessionId === session.id);
      const replay = resume ? createSessionReplay({ repository, session, events, ...(monitorRun ? { monitorRun } : {}) }) : null;
      const runRepository = replay?.repository ?? repository;
      const runChat = replay?.chat;
      const viewerPrompt = snapshot.rvSystemPrompt ? { id: snapshot.rvSystemPrompt.id, version: snapshot.rvSystemPrompt.version, content: snapshot.rvSystemPrompt.fullContent, contentSha256: snapshot.rvSystemPrompt.contentSha256 } : undefined;
      const capturedSpecialTask: SpecialTaskInput | undefined = snapshot.specialTask ? { selectedOptions: snapshot.specialTask.selectedOptions as SpecialTaskOption[], ...(snapshot.specialTask.customText ? { customText: snapshot.specialTask.customText } : {}) } : undefined;
      const monitor = snapshot.monitor && capturedMonitorProvider && capturedMonitorModel ? { providerConfig: capturedMonitorProvider, model: capturedMonitorModel, effectivePrompt: snapshot.monitor.effectivePrompt } : undefined;
      setSessionLanguage(snapshot.sessionLanguage);
      setRunType(snapshot.monitor ? "monitor" : "automatic");
      setActiveTargetId(snapshot.targetId ?? null);
      setProgress({ sessionId: session.id, sessionCode: session.sessionCode, state: "BlindRunning", transcript: session.preRevealTranscript });

      let result;
      if (snapshot.protocol.id === "rv-lite") {
        setProtocol("lite");
        const variant = snapshot.protocol.variant ?? "extended";
        setLiteVariant(variant);
        const resource = getRvLite(snapshot.sessionLanguage, variant);
        if (resource.contentSha256 !== snapshot.protocol.contentSha256) throw new Error("The captured RV Lite protocol version is unavailable.");
        result = await runAutomaticRvLiteSession({ repository: runRepository, workspaceId: workspace.id, profileId: profile.id, profileName: snapshot.identities?.aiIsBeDisplayName, humanIsBeDisplayName: snapshot.identities?.humanIsBeDisplayName, providerConfig, model: viewerModel, protocol: resource, sessionLanguage: snapshot.sessionLanguage, requestedSettings: snapshot.generationSettings.requested, ...(snapshot.viewerNotes ? { viewerNotes: snapshot.viewerNotes } : {}), ...(viewerPrompt ? { rvSystemPrompt: viewerPrompt } : {}), ...(capturedSpecialTask ? { specialTask: capturedSpecialTask } : {}), ...(capturedTarget ? { automaticTarget: capturedTarget } : {}), ...(resume ? { resumeSession: session } : {}), ...(runChat ? { chat: runChat } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), sessionCodePrefix: settings.sessionCodePrefix, onProgress: setProgress });
      } else if (snapshot.protocol.id === "telepathic-protocol") {
        setProtocol("telepathic");
        const resource = getTelepathicProtocol(snapshot.sessionLanguage);
        if (resource.contentSha256 !== snapshot.protocol.contentSha256) throw new Error("The captured Telepathic Protocol version is unavailable.");
        const questionMode = snapshot.telepathic?.step8QuestionMode ?? "predefined";
        setTelepathicQuestionMode(questionMode);
        result = await runAutomaticTelepathicSession({ repository: runRepository, workspaceId: workspace.id, profileId: profile.id, aiIsBeDisplayName: snapshot.identities?.aiIsBeDisplayName, humanIsBeDisplayName: snapshot.identities?.humanIsBeDisplayName, providerConfig, model: viewerModel, protocol: resource, sessionLanguage: snapshot.sessionLanguage, requestedSettings: snapshot.generationSettings.requested, viewerNotes: snapshot.viewerNotes, step8Questions: { mode: questionMode, questions: snapshot.telepathic?.predefinedQuestions ?? [] }, ...(viewerPrompt ? { rvSystemPrompt: viewerPrompt } : {}), ...(capturedTarget ? { automaticTarget: capturedTarget } : {}), ...(monitor ? { monitor } : {}), ...(resume ? { resumeSession: session } : {}), ...(runChat ? { chat: runChat } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), sessionCodePrefix: settings.sessionCodePrefix, onProgress: setProgress, ...(questionMode === "manual" && !snapshot.monitor ? { onManualQuestionStage: setManualQuestionHandle } : {}) });
      } else if (snapshot.protocol.id === "full-rcp") {
        setProtocol("rcp");
        const current = getFullRcp(snapshot.sessionLanguage);
        const resource: ProtocolResource = { ...current, content: snapshot.protocol.fullContent, contentSha256: snapshot.protocol.contentSha256 };
        result = await runAutomaticRcpSession({ repository: runRepository, workspaceId: workspace.id, profileId: profile.id, providerConfig, model: viewerModel, protocol: resource, sessionLanguage: snapshot.sessionLanguage, requestedSettings: snapshot.generationSettings.requested, viewerNotes: snapshot.viewerNotes, aiIsBeDisplayName: snapshot.identities?.aiIsBeDisplayName, humanIsBeDisplayName: snapshot.identities?.humanIsBeDisplayName, ...(viewerPrompt ? { rvSystemPrompt: viewerPrompt } : {}), ...(capturedSpecialTask ? { specialTask: capturedSpecialTask } : {}), ...(capturedTarget ? { automaticTarget: capturedTarget } : {}), ...(monitor ? { monitor } : {}), ...(resume ? { resumeSession: session } : {}), ...(runChat ? { chat: runChat } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), sessionCodePrefix: settings.sessionCodePrefix, onProgress: setProgress });
      } else {
        setProtocol("custom");
        const saved = JSON.parse(snapshot.protocol.fullContent) as { systemPrompt?: string; steps: string[] };
        const resource: CustomProtocolVersion = { protocolId: snapshot.protocol.id, versionId: `captured:${snapshot.protocol.id}:${snapshot.protocol.version}`, displayName: snapshot.protocol.id, version: snapshot.protocol.version, language: snapshot.sessionLanguage, ...(saved.systemPrompt ? { systemPrompt: saved.systemPrompt } : {}), steps: saved.steps, contentHash: snapshot.protocol.contentSha256, createdAt: snapshot.createdAt };
        result = await runAutomaticCustomSession({ repository: runRepository, workspaceId: workspace.id, profileId: profile.id, aiIsBeDisplayName: snapshot.identities?.aiIsBeDisplayName, humanIsBeDisplayName: snapshot.identities?.humanIsBeDisplayName, providerConfig, model: viewerModel, protocol: resource, sessionLanguage: snapshot.sessionLanguage, requestedSettings: snapshot.generationSettings.requested, viewerNotes: snapshot.viewerNotes, ...(viewerPrompt ? { rvSystemPrompt: viewerPrompt } : {}), ...(capturedTarget ? { automaticTarget: capturedTarget } : {}), ...(resume ? { resumeSession: session } : {}), ...(runChat ? { chat: runChat } : {}), signal: controller.signal, maxRetries: settings.maxRetries, requestTimeoutMs: settings.requestTimeoutMs, ...(settings.maxSessionCostUsd > 0 ? { maxSessionCostUsd: settings.maxSessionCostUsd } : {}), sessionCodePrefix: settings.sessionCodePrefix, onProgress: setProgress });
      }
      await finishRevealedSession(result);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      runGuardRef.current.release();
      setSessionRunning(false);
      setManualQuestionHandle(null);
      abortRef.current = null;
      try { setRecentSessions((await repository.listRvSessions(workspace.id)).filter((item) => !item.researchProjectId)); }
      catch (cause) { setRunError(cause instanceof Error ? cause.message : String(cause)); }
    }
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

  const saveCurrentSession = async () => {
    if (!repository || !progress?.sessionId || sessionExportBusy) return;
    const destination = await chooseDirectory(copy.chooseSessionExportFolder);
    if (!destination) return;
    setSessionExportBusy(true);
    setRunError(null);
    setSessionExportPath(null);
    try {
      setSessionExportPath(await exportSessionRecord(repository, workspace.id, progress.sessionId, resolvedLanguage, destination));
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSessionExportBusy(false);
    }
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
      const result = await sendPostRevealTurn({ repository, sessionId: progress.sessionId, existingTranscript: postRevealTranscript, providerConfig, model: viewerModel, content: postRevealText, timeoutMs: settings.requestTimeoutMs, maxRetries: settings.maxRetries });
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

  const askManualTelepathicQuestion = async () => {
    if (!manualQuestionHandle || !manualQuestionText.trim() || manualQuestionBusy) return;
    setManualQuestionBusy(true);
    setRunError(null);
    try {
      await manualQuestionHandle.ask(manualQuestionText.trim());
      setManualQuestionText("");
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setManualQuestionBusy(false);
    }
  };

  const finishManualTelepathicQuestions = () => {
    if (!manualQuestionHandle || manualQuestionBusy) return;
    manualQuestionHandle.finish();
    setManualQuestionHandle(null);
  };

  return (
    <section className={metadataOpen ? "session-layout metadata-open" : "session-layout metadata-closed"}>
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
            {progress.transcript ? <SafeMarkdown className="live-transcript" content={progress.transcript} /> : <div className="session-wait"><span className="loader-orb" /><p>{progress.state === "Preflight" ? "Preflight" : `${copy.runningPhase} ${progress.phase ?? 1}`}</p></div>}
            {progress.awaitingStep8Questions && manualQuestionHandle && <section className="telepathic-question-stage"><div><BrainCircuit size={18} /><span><strong>{settings.interfaceLanguage === "pl" ? "Krok 8 zakończony — pytania T9" : "Step 8 complete — T9 questions"}</strong><small>{settings.interfaceLanguage === "pl" ? `Zadane pytania: ${progress.telepathicQuestionCount ?? 0}. Możesz zadawać kolejne pojedynczo.` : `Questions asked: ${progress.telepathicQuestionCount ?? 0}. You may ask more, one at a time.`}</small></span></div><textarea rows={3} value={manualQuestionText} onChange={(event) => setManualQuestionText(event.target.value)} disabled={manualQuestionBusy} placeholder={settings.interfaceLanguage === "pl" ? "Wpisz pytanie do AI Viewera…" : "Enter a question for the AI Viewer…"} /><div className="telepathic-question-actions"><button className="secondary-button" disabled={!manualQuestionText.trim() || manualQuestionBusy} onClick={() => void askManualTelepathicQuestion()}>{manualQuestionBusy ? copy.sending : (settings.interfaceLanguage === "pl" ? "Zadaj pytanie" : "Ask question")}</button><button className="primary-button" disabled={manualQuestionBusy} onClick={finishManualTelepathicQuestions}>{settings.interfaceLanguage === "pl" ? "Zakończ Krok 8 i przejdź do Kroku 9" : "Finish Step 8 and continue to Step 9"}</button></div></section>}
            {progress.state === "AwaitingReveal" && <div className="reveal-box"><div><LockKeyhole size={18} /><span><strong>{copy.awaitingReveal}</strong><small>{copy.blindRunComplete}</small></span></div><textarea rows={5} value={revealText} onChange={(event) => setRevealText(event.target.value)} placeholder={copy.revealPlaceholder} /><div className="reveal-artifact-row"><label className="secondary-button reveal-file-button">{copy.revealFiles}<input type="file" multiple accept=".txt,.md,image/png,image/jpeg,image/webp,image/gif" disabled={artifactBusy} onChange={(event) => void attachRevealFiles(event.target.files)} /></label>{artifactBusy && <small>{copy.storingFile}</small>}{revealArtifacts.map((artifact) => <span className="reveal-artifact-chip" key={`${artifact.artifactId}-${artifact.originalFileName}`}>{artifact.mimeType.startsWith("image/") ? "▣" : "≡"} {artifact.originalFileName}</span>)}</div>{revealArtifacts.some((artifact) => artifact.mimeType.startsWith("image/")) && <small className="vision-guard-note">{copy.imageJudgeGuard}</small>}<button className="primary-button" disabled={artifactBusy || (!revealText.trim() && !revealArtifacts.length)} onClick={() => void submitReveal()}>{copy.submitReveal}</button></div>}
            {(progress.state === "Revealed" || progress.state === "Completed") && <>
              <div className="reveal-success"><Check size={18} /><div><strong>🔓 {copy.revealAccepted}</strong><p>{copy.blindRunComplete}</p></div></div>
              {(acceptedRevealText || acceptedRevealArtifacts.length > 0) && <section className="accepted-reveal-panel"><small>{copy.targetReveal}</small>{acceptedRevealText && <SafeMarkdown content={acceptedRevealText} />}{acceptedRevealArtifacts.length > 0 && <div className="reveal-artifact-row">{acceptedRevealArtifacts.map((artifact) => <span className="reveal-artifact-chip" key={`${artifact.artifactId}-${artifact.sha256}`}>{artifact.mimeType.startsWith("image/") ? "▣" : "≡"} {artifact.originalFileName}</span>)}</div>}</section>}
              {(acceptedRevealText || acceptedRevealArtifacts.length > 0) && <div className="save-reveal-target"><input value={saveTargetTitle} onChange={(event) => setSaveTargetTitle(event.target.value)} placeholder={copy.targetName} disabled={targetSaved} /><button className="secondary-button" disabled={!saveTargetTitle.trim() || targetSaved} onClick={() => void saveExternalRevealTarget()}>{targetSaved ? copy.savedToTargets : copy.saveRevealTarget}</button></div>}
              {executionScope === "single" && <section className="post-reveal-discussion"><div className="post-reveal-head"><div><strong>{copy.postRevealDiscussion}</strong><p>{copy.postRevealEvidenceGuard}</p></div><span>POST-REVEAL</span></div><div className="post-reveal-review-action"><div><strong>{settings.interfaceLanguage === "pl" ? "Automatyczna opinia po Revealu" : "Automatic post-Reveal review"}</strong><small>{postRevealBusy ? (settings.interfaceLanguage === "pl" ? "Viewer analizuje sesję…" : "The Viewer is reviewing the session…") : (settings.interfaceLanguage === "pl" ? "Viewer, a przy sesji monitorowanej także Monitor, otrzymuje Reveal automatycznie." : "The Viewer, and the Monitor for a monitored run, receives the Reveal automatically.")}</small></div><span className={`status-chip ${postRevealBusy ? "next" : "ready"}`}>{postRevealBusy ? copy.sending : (settings.interfaceLanguage === "pl" ? "AUTOMATYCZNIE" : "AUTOMATIC")}</span></div>{postRevealTranscript && <div className="post-reveal-turns">{parsePostRevealTranscript(postRevealTranscript).map((turn, index) => <article className={turn.role} key={`${turn.role}-${index}`}><small>{turn.role === "user" ? (settings.interfaceLanguage === "pl" ? "Polecenie po Revealu" : "Post-Reveal instruction") : turn.role === "monitor" ? copy.aiMonitorReview : aiIsBeDisplayName(profile)}</small><SafeMarkdown content={turn.content} /></article>)}</div>}<details className="post-reveal-conversation"><summary>{settings.interfaceLanguage === "pl" ? "Porozmawiaj z Viewerem o celu" : "Discuss the target with the Viewer"}</summary><p>{settings.interfaceLanguage === "pl" ? "Opcjonalna, dwustronna rozmowa po zakończonej sesji. Viewer może również zadawać pytania o Reveal." : "An optional two-way discussion after the completed session. The Viewer may also ask questions about the Reveal."}</p><div className="post-reveal-compose"><textarea rows={3} value={postRevealText} onChange={(event) => setPostRevealText(event.target.value)} placeholder={copy.postRevealPlaceholder} disabled={postRevealBusy} /><button className="secondary-button" disabled={!postRevealText.trim() || postRevealBusy} onClick={() => void discussPostReveal()}>{postRevealBusy ? copy.sending : copy.sendPostReveal}</button></div></details></section>}
              {executionScope === "single" && <JudgeEvaluation copy={copy} repository={repository} sessionId={progress.sessionId} language={resolvedLanguage} models={allModels} providerConfigs={providerConfigs} defaultModelKey={resolveRoleDefault(profile, "judge", allModels)} maxRetries={settings.maxRetries} timeoutMs={settings.requestTimeoutMs} onCompleted={() => { setProgress((current) => current ? { ...current, state: "Completed" } : current); void repository?.listRvSessions(workspace.id).then((sessions) => setRecentSessions(sessions.filter((session) => !session.researchProjectId))); }} />}
              {executionScope === "single" && progress.state === "Revealed" && <button className="secondary-button save-only-button" onClick={() => void completeWithoutEvaluation()}>{copy.saveOnly}</button>}
              {executionScope === "single" && <div className="session-export-action"><button className="secondary-button" disabled={!isTauriRuntime() || sessionExportBusy} onClick={() => void saveCurrentSession()}><Download size={15} />{sessionExportBusy ? copy.savingSession : copy.saveSession}</button>{sessionExportPath && <div className="storage-success">{copy.sessionExported}: {sessionExportPath}</div>}</div>}
            </>}
            {progress.state === "Interrupted" && <><div className="provider-error"><CircleStop size={16} /><span><strong>{copy.interrupted}</strong>{recoverableSessions[progress.sessionId] ? <><small>{settings.interfaceLanguage === "pl" ? "Provider modelu nie zwrócił kompletnej odpowiedzi. Dotychczasowy przebieg został zapisany i można go kontynuować." : "The model provider did not return a complete response. The completed portion was saved and can be continued."}</small>{progress.stopReason && <details><summary>{settings.interfaceLanguage === "pl" ? "Szczegół techniczny" : "Technical detail"}</summary>{progress.stopReason}</details>}</> : progress.stopReason ? ` · ${progress.stopReason}` : ""}</span></div>{recoverableSessions[progress.sessionId] && (() => { const interruptedSession = recentSessions.find((item) => item.id === progress.sessionId); return interruptedSession ? <div className="session-resume-actions"><button className="primary-button" disabled={sessionRunning || batchRunning} onClick={() => void runCapturedSession(interruptedSession, true)}>{settings.interfaceLanguage === "pl" ? "Kontynuuj sesję" : "Continue session"}</button><button className="secondary-button" disabled={sessionRunning || batchRunning} onClick={() => void runCapturedSession(interruptedSession, false)}>{settings.interfaceLanguage === "pl" ? "Rozpocznij ponownie" : "Start again"}</button></div> : null; })()}</>}
            {executionScope === "batch" && batchResults.length > 0 && !batchRunning && <BatchEvaluation copy={copy} repository={repository} sessions={batchResults} language={resolvedLanguage} models={allModels} providerConfigs={providerConfigs} defaultModelKey={resolveRoleDefault(profile, "judge", allModels)} maxRetries={settings.maxRetries} timeoutMs={settings.requestTimeoutMs} onCompleted={() => void repository?.listRvSessions(workspace.id).then((sessions) => setRecentSessions(sessions.filter((session) => !session.researchProjectId)))} />}
            {!running && <button className="secondary-button new-session-button" onClick={() => { setProgress(null); setRunError(null); setActiveTargetId(null); setAcceptedRevealText(""); setAcceptedRevealArtifacts([]); setPostRevealTranscript(""); setPostRevealText(""); setSessionExportPath(null); setBatchResults([]); setBatchProgress(null); }}>{copy.newAutomaticSession}</button>}
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
            <Choice disabled={!canSelectMonitor(protocol)} active={runType === "monitor"} onClick={() => setRunType("monitor")} icon={<BrainCircuit size={18} />} title={copy.automaticMonitor} />
          </div>
          {!canSelectMonitor(protocol) && <small className="mode-compatibility-note">{copy.rvLiteUnavailable}</small>}
        </ConfigBlock>
        <ConfigBlock label="Viewer Notes">
          <label className="viewer-notes-toggle" title={settings.interfaceLanguage === "pl" ? "Dołącz aktywne Viewer Notes tej tożsamości jako pomocniczą pamięć proceduralną. Zwykłe RV Sessions nigdy ich nie aktualizują; nowe wersje powstają wyłącznie podczas Training." : "Attach this identity's active Viewer Notes as auxiliary procedural memory. Ordinary RV Sessions never update them; new versions are created only during Training."}>
            <span><strong>{settings.interfaceLanguage === "pl" ? "Użyj Viewer Notes" : "Use Viewer Notes"}</strong><small>{settings.interfaceLanguage === "pl" ? "Eksperymentalne · domyślnie włączone" : "Experimental · enabled by default"}</small></span>
            <input type="checkbox" checked={viewerNotesEnabled} onChange={(event) => setViewerNotesEnabled(event.target.checked)} />
          </label>
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
            <Choice disabled={!canSelectProtocol(runType, "lite")} active={protocol === "lite"} onClick={() => setProtocol("lite")} icon={<Sparkles size={18} />} title={copy.rvLite} meta="v1.1.0" />
            <Choice disabled={!canSelectProtocol(runType, "telepathic")} active={protocol === "telepathic"} onClick={() => setProtocol("telepathic")} icon={<BrainCircuit size={18} />} title={settings.interfaceLanguage === "pl" ? "Protokół Telepatyczny" : "Telepathic Protocol"} meta="v1.1" />
            <Choice disabled={!canSelectProtocol(runType, "custom")} active={protocol === "custom"} onClick={() => setProtocol("custom")} icon={<Settings2 size={18} />} title={copy.customProtocol} meta={customProtocols.length ? `${customProtocols.length}` : undefined} />
          </div>
          {runType === "monitor" && protocol !== "telepathic" && protocol !== "rcp" && <small className="mode-compatibility-note">{copy.rvLiteUnavailable}</small>}
        </ConfigBlock>
        {protocol === "lite" && <ConfigBlock label={settings.interfaceLanguage === "pl" ? "Wariant RV Lite" : "RV Lite variant"}><div className="choice-grid two"><Choice active={liteVariant === "core"} onClick={() => setLiteVariant("core")} icon={<FileCheck2 size={18} />} title="Core" meta={settings.interfaceLanguage === "pl" ? "4 podstawowe kroki" : "4 core steps"} /><Choice active={liteVariant === "extended"} onClick={() => setLiteVariant("extended")} icon={<Sparkles size={18} />} title="Extended" meta={settings.interfaceLanguage === "pl" ? "4 kroki + pogłębianie po kroku 3" : "4 steps + deepening after Step 3"} /></div></ConfigBlock>}
        {protocol === "telepathic" && <ConfigBlock label={settings.interfaceLanguage === "pl" ? "Pytania po Kroku 8 (T9)" : "Questions after Step 8 (T9)"}><div className="choice-grid two">{runType === "automatic" && executionScope === "single" && <Choice active={telepathicQuestionMode === "manual"} onClick={() => setTelepathicQuestionMode("manual")} icon={<MessageCircle size={18} />} title={settings.interfaceLanguage === "pl" ? "Zatrzymaj i pytaj ręcznie" : "Pause for manual questions"} />}{runType === "monitor" && <Choice active={telepathicQuestionMode === "monitor"} onClick={() => setTelepathicQuestionMode("monitor")} icon={<BrainCircuit size={18} />} title={settings.interfaceLanguage === "pl" ? "AI Monitor wybiera pytania" : "AI Monitor chooses questions"} />}<Choice active={telepathicQuestionMode === "predefined"} onClick={() => setTelepathicQuestionMode("predefined")} icon={<FileCheck2 size={18} />} title={settings.interfaceLanguage === "pl" ? "Pytania wpisane przed sesją" : "Pre-entered questions"} /></div>{telepathicQuestionMode === "predefined" && <label className="telepathic-predefined-questions"><span>{settings.interfaceLanguage === "pl" ? "Jedno pytanie w każdym wierszu" : "One question per line"}</span><textarea rows={5} value={telepathicQuestionsText} onChange={(event) => setTelepathicQuestionsText(event.target.value)} placeholder={settings.interfaceLanguage === "pl" ? "Co jest najważniejszą intencją podmiotu?\nJak podmiot postrzega najbliższe otoczenie?" : "What is the subject's most important intention?\nHow does the subject perceive the immediate surroundings?"} /><small>{runType === "monitor" ? (settings.interfaceLanguage === "pl" ? `${Math.min(telepathicQuestions.length, 5)}/5 pytań Monitora` : `${Math.min(telepathicQuestions.length, 5)}/5 Monitor questions`) : (settings.interfaceLanguage === "pl" ? `${telepathicQuestions.length} pytań` : `${telepathicQuestions.length} questions`)}</small></label>}<small>{settings.interfaceLanguage === "pl" ? "Zadania specjalne są wyłączone dla Protokołu Telepatycznego. Po Krokach 3, 4 i 5 kontroler wykona dodatkowe obowiązkowe pogłębienie." : "Special Tasks are disabled for the Telepathic Protocol. The controller performs an additional mandatory deepening after Steps 3, 4, and 5."}</small></ConfigBlock>}
        {(protocol === "rcp" || protocol === "lite") && <details className="special-task-disclosure"><summary><span><strong>{settings.interfaceLanguage === "pl" ? "Zadanie specjalne — opcjonalne" : "Special task — optional"}</strong><small>{specialTaskOptions.length || specialTaskText.trim() ? (settings.interfaceLanguage === "pl" ? "Skonfigurowano" : "Configured") : (settings.interfaceLanguage === "pl" ? "Rozwiń, aby ustawić" : "Expand to configure")}</small></span><ChevronRight size={15} /></summary><div className="special-task-builder"><p>{protocol === "rcp" ? (settings.interfaceLanguage === "pl" ? "Zadanie zostanie przekazane bezpośrednio po Fazie 4." : "The task is supplied immediately after Phase 4.") : (settings.interfaceLanguage === "pl" ? "Zadanie zostanie przekazane bezpośrednio po kroku 3." : "The task is supplied immediately after Step 3.")}</p><p>{settings.interfaceLanguage === "pl" ? "Służy do neutralnego skierowania Viewera lub Monitora ku konkretnej osobie, istocie, strukturze, obiektowi, aktywności albo zdarzeniu będącemu częścią celu. Po sesji Target Reveal musi jasno wyjaśnić, co oznaczało każde użyte oznaczenie, np. Subject A lub Object A, aby Viewer mógł porównać dane z celem." : "It neutrally directs the Viewer or Monitor toward a specific subject, structure, object, activity, or event that is part of the target. After the session, the Target Reveal must clearly explain every label used, such as Subject A or Object A, so the Viewer can compare the data with the target."}</p><div>{SPECIAL_TASK_OPTIONS.map((option) => <label key={option}><input type="checkbox" checked={specialTaskOptions.includes(option)} onChange={(event) => setSpecialTaskOptions((current) => event.target.checked ? [...current, option] : current.filter((item) => item !== option))} /><span>{specialTaskOptionLabel(option, settings.interfaceLanguage)}</span></label>)}</div><textarea rows={3} value={specialTaskText} onChange={(event) => setSpecialTaskText(event.target.value)} placeholder={settings.interfaceLanguage === "pl" ? "Lub wpisz własne neutralne zadanie…" : "Or enter a custom neutral task…"} />{specialTaskUsesMappedLabels(specialTask) && <small className="special-task-warning"><ShieldCheck size={13} />{settings.interfaceLanguage === "pl" ? "W Target Reveal opisz jednoznacznie, czym są użyte oznaczenia Subject/Structure/Object A–C." : "The Target Reveal must clearly define every Subject/Structure/Object A–C label used here."}</small>}</div></details>}
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
            <label><span>{copy.reasoning}</span><select value={reasoning} onChange={(event) => setReasoning(event.target.value as "" | ReasoningEffort)}><option value="">{copy.providerDefault}</option>{reasoningOptions(selectedModel.capabilities.reasoning).map((option) => <option key={option.value} value={option.value}>{reasoningOptionLabel(copy, option)}</option>)}</select><small>{reasoningCapabilityLead(copy, selectedModel)}</small></label>
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
          <small className="target-source-explanation">{revealSource === "automatic" ? copy.automaticTargetLead : copy.externalBlindLead}</small>
        </ConfigBlock>
        {revealSource === "automatic" && <ConfigBlock label={copy.selectTarget}>
          {eligibleTargets.length ? <select className="session-language-select" value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)}><option value="__random__">🎲 {copy.randomTarget}</option>{eligibleTargets.map((target) => <option key={target.id} value={target.id}>{copy.myTargets} · {localizedTargetTitle(target, resolvedLanguage)}</option>)}</select> : <div className="route-summary target-empty-warning"><Crosshair size={16} /><span><strong>{copy.noEligibleTargets}</strong><small>{copy.noEligibleTargetsLead}</small></span></div>}
        </ConfigBlock>}</> : <ConfigBlock label={copy.targetPool}><div className="batch-config"><label><span>{copy.targetPool}</span><strong>{copy.myTargets}</strong></label><label><span>{copy.batchCount}</span><input type="number" min={1} max={Math.max(1, batchPool.length)} value={batchCount} onChange={(event) => setBatchCount(Math.max(1, Number(event.target.value) || 1))} /></label><small>{copy.eligibleTargets}: {batchPool.length}</small>{batchPool.length === 0 && <small className="target-source-error">{copy.noEligibleTargetsLead}</small>}<div className="batch-preflight-actions"><button className="secondary-button" onClick={preflightBatch}>{copy.runPreflight}</button>{batchPreflightSignature === batchConfigSignature && <span className="status-chip ready"><Check size={12} />{copy.preflightPassed}</span>}</div></div></ConfigBlock>}
        <div className="start-block">
          <button className="primary-button start-button" disabled={!isTauriRuntime() || !activeProvider || !selectedModel || !maxOutputTokens || Number(maxOutputTokens) <= 0 || (runType === "monitor" && (!canSelectMonitor(protocol) || !monitorModel || !monitorProvider)) || (protocol === "custom" && !selectedCustomProtocol) || (protocol === "telepathic" && telepathicQuestionMode === "predefined" && (!telepathicQuestions.length || (runType === "monitor" && telepathicQuestions.length > 5))) || (protocol === "telepathic" && executionScope === "batch" && telepathicQuestionMode === "manual") || (executionScope === "single" && revealSource === "automatic" && eligibleTargets.length === 0) || (executionScope === "batch" && (batchCount < 1 || batchCount > batchPool.length || batchPreflightSignature !== batchConfigSignature))} onClick={() => void start()}><Waves size={18} />{executionScope === "batch" ? copy.startBatch : copy.startSession}</button>
          <p>{activeProvider ? copy.controllerReady : copy.configureProviderFirst}</p>
        </div>
        </>}
        {runError && <div className="provider-error session-error">{runError}</div>}
      </div>
      <button className="session-metadata-toggle" title={metadataOpen ? (settings.interfaceLanguage === "pl" ? "Ukryj informacje o protokole" : "Hide protocol information") : (settings.interfaceLanguage === "pl" ? "Pokaż informacje o protokole" : "Show protocol information")} onClick={() => setMetadataOpen((current) => !current)}>{metadataOpen ? "›" : "‹"}</button>
      {metadataOpen && <aside className="session-side">
        <details className="panel recent-sessions-side" open>
          <summary><Clock3 size={15} /><strong>{copy.recentSessions}</strong><span>{recentSessions.length}</span></summary>
          {recentSessions.length ? <div className="recent-session-list">{recentSessions.map((session) => {
            const recovery = telepathicRecovery[session.id];
            const incomplete = session.state === "BlindRunning" || session.state === "Preflight";
            const providerRecovery = Boolean(recoverableSessions[session.id]);
            const recoveryLabel = recovery === "questions"
              ? (settings.interfaceLanguage === "pl" ? "Wznów pytania Kroku 8" : "Resume Step 8 questions")
              : recovery === "step9"
                ? (settings.interfaceLanguage === "pl" ? "Kontynuuj do Kroku 9" : "Continue to Step 9")
                : (settings.interfaceLanguage === "pl" ? "Dokończ zapis i Reveal" : "Finish sealing and Reveal");
            return <div key={session.id}>
              <button className="recent-session-open" disabled={incomplete} onClick={() => void loadStoredSession(session)}><span><strong>{session.sessionCode}</strong><small>{session.state}</small></span><ChevronRight size={13} /></button>
              {incomplete && <div className="session-recovery"><small>{recovery ? (settings.interfaceLanguage === "pl" ? "Znaleziono bezpieczny checkpoint Protokołu Telepatycznego." : "A safe Telepathic Protocol checkpoint was found.") : copy.recoveryRequired}</small>{recovery && <button disabled={sessionRunning || batchRunning} onClick={() => void resumeTelepathicSession(session)}>{recoveryLabel}</button>}<button disabled={sessionRunning || batchRunning} onClick={() => void preserveInterrupted(session)}>{copy.markInterrupted}</button></div>}
              {providerRecovery && <div className="session-recovery"><small>{settings.interfaceLanguage === "pl" ? "Sesja może zostać bezpiecznie wznowiona od nieudanego wywołania." : "The session can safely resume from the failed call."}</small><button disabled={sessionRunning || batchRunning} onClick={() => void runCapturedSession(session, true)}>{settings.interfaceLanguage === "pl" ? "Kontynuuj" : "Continue"}</button><button disabled={sessionRunning || batchRunning} onClick={() => void runCapturedSession(session, false)}>{settings.interfaceLanguage === "pl" ? "Od początku" : "Start again"}</button></div>}
            </div>;
          })}</div> : <p className="recent-session-empty">{copy.noSessions}</p>}
        </details>
        <section className="panel protocol-card">
          <span className="resource-orb"><FileCheck2 size={22} /></span>
          <span className="status-chip ready"><Check size={13} />{copy.statusReady}</span>
          <h3>{protocol === "custom" ? selectedCustomProtocol?.displayName ?? copy.customProtocol : protocol === "lite" ? `${copy.rvLite} v1.1.0` : protocol === "telepathic" ? (settings.interfaceLanguage === "pl" ? "Protokół Telepatyczny v1.1" : "Telepathic Protocol v1.1") : copy.rcpReady}</h3>
          <p>{protocol === "custom" ? selectedCustomProtocol?.description ?? copy.dryRunLead : copy.rcpReadyDesc}</p>
          <dl>
            <div><dt>{copy.sessionLanguage}</dt><dd>{resolvedLanguage.toUpperCase()}</dd></div>
            <div><dt>{protocol === "custom" ? copy.blindSteps : copy.wordCount}</dt><dd>{protocol === "custom" ? selectedCustomProtocol?.steps.length ?? 0 : wordCount(protocol === "lite" ? rvLite.content : protocol === "telepathic" ? telepathic.content : rcp.content).toLocaleString()}</dd></div>
            <div><dt>Version</dt><dd>{protocol === "custom" ? selectedCustomProtocol?.version ?? "—" : protocol === "lite" ? rvLite.version : protocol === "telepathic" ? telepathic.version : rcp.version}</dd></div>
          </dl>
          {protocol === "custom" ? <button className="secondary-button full" disabled={!selectedCustomProtocol} onClick={() => { setCustomBuilderNew(false); setCustomBuilderOpen(true); }}>{copy.previewDryRun}</button> : <button className="secondary-button full" onClick={() => setResourceOpen(true)}>{copy.inspectProtocol}</button>}
        </section>
        <section className="integrity-card"><LockKeyhole size={18} /><div><strong>🔒 BLIND</strong><p>Reveal boundary is a separate state transition.</p></div></section>
        <section className="integrity-card"><ShieldCheck size={18} /><div><strong>External Blind</strong><p>{copy.externalReady}</p></div></section>
      </aside>}
      {resourceOpen && <ProtocolDialog copy={copy} resource={protocol === "lite" ? rvLite : protocol === "telepathic" ? telepathic : rcp} onClose={() => setResourceOpen(false)} />}
      {customBuilderOpen && repository && <CustomProtocolDialog copy={copy} repository={repository} language={resolvedLanguage} base={customBuilderNew ? null : selectedCustomProtocol} onCancel={() => setCustomBuilderOpen(false)} onSaved={customProtocolSaved} />}
    </section>
  );
}

function MonitorPanel({ copy, settings, profile, workspace, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; repository: AppRepository | null }) {
  const [runs, setRuns] = useState<MonitorRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<MonitorInterventionRecord[]>([]);
  const [exportingRun, setExportingRun] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const [editablePrompt, setEditablePrompt] = useState(localizedMonitorEditablePrompt(profile?.defaultMonitorSystemPrompt, language));
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  useEffect(() => {
    setEditablePrompt(localizedMonitorEditablePrompt(profile?.defaultMonitorSystemPrompt, language));
    setPromptSaved(false);
    setPromptError(null);
  }, [language, profile?.defaultMonitorSystemPrompt, profile?.id]);
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
  const savePrompt = async () => {
    if (!repository || !profile) return;
    setPromptError(null);
    try {
      await repository.setProfileAiConfiguration(profile.id, {
        credentialId: profile.credentialId,
        credentialProvider: profile.credentialProvider,
        defaultViewerModelId: profile.defaultViewerModelId,
        defaultViewerReasoningEffort: profile.defaultViewerReasoningEffort,
        defaultViewerTemperature: profile.defaultViewerTemperature,
        defaultViewerSystemPrompt: profile.defaultViewerSystemPrompt,
        defaultMonitorSystemPrompt: editablePrompt.trim() || factoryMonitorEditablePrompt(language),
        defaultMonitorProviderConfigId: profile.defaultMonitorProviderConfigId,
        defaultMonitorModelId: profile.defaultMonitorModelId,
        defaultJudgeProviderConfigId: profile.defaultJudgeProviderConfigId,
        defaultJudgeModelId: profile.defaultJudgeModelId,
      });
      setPromptSaved(true);
    } catch (cause) { setPromptError(cause instanceof Error ? cause.message : String(cause)); }
  };
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
      <details className="monitor-prompt-editor" open>
        <summary><BrainCircuit size={15} /><span><strong>{settings.interfaceLanguage === "pl" ? "System prompt AI Monitora" : "AI Monitor system prompt"}</strong><small>{settings.interfaceLanguage === "pl" ? "Cały skuteczny prompt jest widoczny; część użytkownika można zmieniać." : "The complete effective prompt is visible; the user section is editable."}</small></span></summary>
        <div className="monitor-prompt-body">
          <label><span>{settings.interfaceLanguage === "pl" ? "Część edytowalna" : "Editable section"}</span><textarea rows={18} maxLength={100000} value={editablePrompt} onChange={(event) => { setEditablePrompt(event.target.value); setPromptSaved(false); }} /></label>
          <div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{settings.interfaceLanguage === "pl" ? "Definicja aktywności — zablokowana" : "Activity definition — locked"}</strong><p>{lockedActivityDefinition(language)}</p></div></div>
          <div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{settings.interfaceLanguage === "pl" ? "Reguła wykonania — zablokowana" : "Execution rule — locked"}</strong><pre>{lockedMonitorExecution(language)}</pre></div></div>
          <details className="effective-prompt-preview"><summary>{settings.interfaceLanguage === "pl" ? "Pokaż cały skuteczny prompt" : "Show the complete effective prompt"}</summary><pre>{buildEffectiveMonitorPrompt(language, editablePrompt)}</pre></details>
          <div className="monitor-prompt-actions"><button className="secondary-button" type="button" onClick={() => { setEditablePrompt(factoryMonitorEditablePrompt(language)); setPromptSaved(false); }}>{settings.interfaceLanguage === "pl" ? "Przywróć treść fabryczną" : "Restore factory text"}</button><button className="primary-button" type="button" disabled={!profile} onClick={() => void savePrompt()}>{settings.interfaceLanguage === "pl" ? "Zapisz prompt" : "Save prompt"}</button>{promptSaved && <span><Check size={13} />{settings.interfaceLanguage === "pl" ? "Zapisano" : "Saved"}</span>}</div>
          {promptError && <div className="provider-error">{promptError}</div>}
        </div>
      </details>
      {!runs.length ? <EmptyState icon={<MonitorCog size={28} />} title={copy.noMonitorRuns} body={copy.monitorLead} /> : <div className="monitor-history-layout"><div className="monitor-run-list">{runs.map((run) => <button className={run.id === selectedRunId ? "active" : ""} key={run.id} onClick={() => { setSelectedRunId(run.id); setExportPath(null); setExportError(null); }}><span><strong>{run.sessionCode}</strong><small>{run.modelRoute}</small></span><span>{run.interventionCount}</span></button>)}</div><div className="monitor-run-detail">{selected && <><div className="monitor-run-meta"><span><small>{copy.promptVersion}</small><strong>{selected.promptVersionId ?? "—"}</strong></span><span><small>{copy.libraryVersion}</small><strong>{selected.libraryVersion}</strong></span><span><small>{copy.interventions}</small><strong>{selected.interventionCount} / {selected.maxInterventions}</strong></span></div><div className="monitor-export-row"><button className="secondary-button" disabled={!isTauriRuntime() || exportingRun} onClick={() => void exportSelected()}>{exportingRun ? copy.exporting : copy.exportMonitorRun}</button><small>{copy.monitorExportSafe}</small></div></>}{interventions.length ? <div className="monitor-timeline">{interventions.map((item) => <article key={item.id} className={item.decision === "INTERVENE" ? "intervene" : "continue"}><div><span>{item.sequenceNumber}</span><strong>{item.decision === "INTERVENE" ? item.commandId ?? "INTERVENE" : copy.continueProtocol}</strong></div>{item.viewerEvidence && <div className="monitor-markdown-row"><b>{copy.viewerEvidence}</b><SafeMarkdown content={item.viewerEvidence} /></div>}{item.commandText && <div className="monitor-markdown-row"><b>{copy.monitorCommand}</b><SafeMarkdown content={item.commandText} /></div>}{item.rationale && <details className="monitor-rationale"><summary>{copy.rationale}</summary><SafeMarkdown content={formatMonitorRationale(item.rationale)} /></details>}</article>)}</div> : <p className="monitor-no-decisions">{copy.noMonitorRuns}</p>}{exportPath && <div className="storage-success"><Check size={14} />{copy.exportComplete} · {exportPath}</div>}{exportError && <div className="provider-error">{exportError}</div>}</div></div>}
    </section>
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

function CreateWorkspaceDialog({ copy, profile, profiles, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; profile: Profile | null; profiles: Profile[]; onCancel: () => void; onCreate: (profileId: string, name: string, description?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState(profile?.id ?? profiles[0]?.id ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); if (profileId && name.trim()) void onCreate(profileId, name, description); };
  return <FormDialog title={`${copy.createWorkspace}${profile ? ` · ${aiIsBeDisplayName(profile)}` : ""}`} onCancel={onCancel}><form onSubmit={submit}>{!profile && profiles.length > 1 && <label>{copy.home === "Home" ? "Profile" : "Profil"}<select autoFocus value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{aiIsBeDisplayName(item)}</option>)}</select></label>}<label>{copy.workspaceName}<input autoFocus={Boolean(profile) || profiles.length <= 1} value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.workspaceDescription}<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!profileId || !name.trim()}>{copy.create}</button></div></form></FormDialog>;
}

function Choice({ active, onClick, icon, title, meta, disabled = false }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; meta?: string; disabled?: boolean }) {
  return <button disabled={disabled} className={active ? "choice active" : "choice"} onClick={onClick}><span className="choice-icon">{icon}</span><span><strong>{title}</strong>{meta && <small>{meta}</small>}</span>{active && <Check size={16} className="choice-check" />}</button>;
}

function ConfigBlock({ label, children }: { label: string; children: ReactNode }) {
  return <div className="config-block"><label>{label}</label>{children}</div>;
}

function specialTaskOptionLabel(option: SpecialTaskOption, language: InterfaceLanguage): string {
  const labels: Record<SpecialTaskOption, Record<InterfaceLanguage, string>> = {
    main_subject: { pl: "Główna osoba lub istota", en: "Primary subject" },
    subject_a: { pl: "Subject A", en: "Subject A" },
    subject_b: { pl: "Subject B", en: "Subject B" },
    subject_c: { pl: "Subject C", en: "Subject C" },
    main_activity: { pl: "Główna aktywność dowolnego rodzaju", en: "Primary activity of any kind" },
    main_event: { pl: "Główne zdarzenie", en: "Primary event" },
    structure_a: { pl: "Structure A", en: "Structure A" },
    object_a: { pl: "Object A", en: "Object A" },
    object_b: { pl: "Object B", en: "Object B" },
  };
  return labels[option][language];
}

function PanelHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-header"><span>{icon}</span><h2>{title}</h2></div>;
}

function MiniStat({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="mini-stat"><span>{icon}</span><div><small>{title}</small><strong>{value}</strong></div></div>;
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

function formatMonitorRationale(value: string): string {
  try {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(value), null, 2)}\n\`\`\``;
  } catch {
    return value;
  }
}
