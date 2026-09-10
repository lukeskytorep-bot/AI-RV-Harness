import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Crosshair,
  Database,
  FlaskConical,
  GraduationCap,
  Home,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Moon,
  RadioTower,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
} from "lucide-react";
import rosehipLogo from "./assets/rosehip-logo.png";
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
} from "react";
import { getCopy } from "./i18n";
import { PROVIDER_LABELS } from "./components/ProviderSettings";
import { createRepository, isTauriRuntime } from "./storage";
import type { AppRepository } from "./storage/repository";
import type {
  AppSettings,
  InterfaceLanguage,
  Profile,
  ProfileAiConfigurationInput,
  Theme,
  Workspace,
} from "./types";
import { PROVIDER_KINDS, type ProviderConfig } from "./providers/types";
import type { ProviderKind, ProviderModel, ReasoningEffort } from "./providers/types";
import { TrainingScreen } from "./features/training";
import type { AiCenterView } from "./features/aiCenter";
import type { RvSession } from "./sessions/types";
import { APP_VERSION } from "./version";
import { addProvider, refreshProviderModels } from "./providers/service";
import { HomeScreen } from "./features/home";
import { CreateProfileDialog, ProfilesScreen, ProfileViewerControls } from "./features/profiles";
import { TargetsScreen } from "./features/targets";
import { ChatPanel } from "./features/conversations";
import { WorkspacesScreen, WorkspaceSwitcherDialog } from "./features/workspaces";
import { RvSessionPanel } from "./features/rvSessions";
import { FormDialog } from "./components/FormDialog";
import { PageHeader } from "./components/PageHeader";
import { ensureBundledTrainingTargets } from "./targets/bundled";
import { createDefaultSettings } from "./startupDefaults";
import { SettingsSaveQueue } from "./storage/settingsSaveQueue";
import { isRouteAllowedForCredential, preferredModelOrder, profileNeedingInitialSetup, splitModelRouteKey } from "./profileModelDefaults";
import { ModelRouteSelect } from "./components/ModelRouteSelect";
import { defaultTemperatureForModel, reasoningEffortForModel } from "./profileViewerDefaults";
import { aiIsBeDisplayName } from "./domain/isBeIdentity";
import { localizedMonitorEditablePrompt, localizedViewerEditablePrompt } from "./resources/systemPrompts";
import { seedBundledTelepathicTargets, TELEPATHIC_STARTER_PACK_VERSION } from "./targets/telepathicBundled";
import { createProfileWithInitialWorkspace } from "./application/profileWorkspace";

const LazyResearchScreen = lazy(() =>
  import("./features/research").then(({ ResearchScreen }) => ({ default: ResearchScreen })),
);
const LazySettingsScreen = lazy(() =>
  import("./features/settings").then(({ SettingsScreen }) => ({ default: SettingsScreen })),
);
const LazyAiCenterRoute = lazy(() =>
  import("./features/aiCenter").then(({ AiCenterRoute }) => ({ default: AiCenterRoute })),
);

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
        const sessions = await repo.listRecentRvSessions(8);
        setRecentSessions(sessions);
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
    const { profile, workspace } = await createProfileWithInitialWorkspace(repository, { name, humanName, note, aiConfiguration });
    const [nextProfiles, nextWorkspaces] = await Promise.all([repository.listProfiles(), repository.listWorkspaces()]);
    setProfiles(nextProfiles);
    setWorkspaces(nextWorkspaces);
    setActiveProfileId(profile.id);
    setActiveWorkspaceId(workspace.id);
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

  const finishFirstRun = async (profile: Profile, initialWorkspace?: Workspace) => {
    if (!repository) return;
    const [nextProfiles, nextWorkspaces] = await Promise.all([repository.listProfiles(), repository.listWorkspaces()]);
    setProfiles(nextProfiles);
    setWorkspaces(nextWorkspaces);
    setActiveProfileId(profile.id);
    if (initialWorkspace) setActiveWorkspaceId(initialWorkspace.id);
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
          ) : (
            <LazyRouteErrorBoundary key={page} language={settings.interfaceLanguage}>
              <Suspense fallback={<LazyRouteLoadingState language={settings.interfaceLanguage} />}>
                {page === "home" ? (
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
            <LazyResearchScreen copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} />
          ) : page === "targets" ? (
            <TargetsScreen copy={copy} settings={settings} repository={repository} />
          ) : page === "training" ? (
            <TrainingScreen copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} />
          ) : page === "ai-center" ? (
            <LazyAiCenterRoute
              copy={copy}
              settings={settings}
              profiles={profiles}
              workspaces={workspaces}
              activeProfileId={activeProfileId}
              activeWorkspace={activeWorkspace}
              repository={repository!}
              initialView={aiCenterView}
              onProfileChange={(profileId) => { setActiveProfileId(profileId); setActiveWorkspaceId(workspaces.find((item) => item.profileId === profileId)?.id ?? null); }}
              onProfileChanged={refreshProfiles}
            />
          ) : page === "settings" ? (
            <LazySettingsScreen copy={copy} settings={settings} workspaces={workspaces} repository={repository} onDataChanged={refreshProfiles} onChange={updateSettings} />
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
              </Suspense>
            </LazyRouteErrorBoundary>
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
  onComplete: (profile: Profile, initialWorkspace?: Workspace) => Promise<void>;
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
      setJudgeModelKey("");
      setMonitorModelKey("");
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
    const judge = skipOptional || !isRouteAllowedForCredential(judgeModelKey, provider.credentialId, providers, models) ? null : splitModelRouteKey(judgeModelKey);
    const monitor = skipOptional || !isRouteAllowedForCredential(monitorModelKey, provider.credentialId, providers, models) ? null : splitModelRouteKey(monitorModelKey);
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
      let profile: Profile;
      let initialWorkspace: Workspace | undefined;
      if (existingProfile) {
        profile = { ...existingProfile, name: profileName.trim(), humanName: humanName.trim() || undefined, ...aiConfiguration, updatedAt: new Date().toISOString() };
        await repository.updateProfile(existingProfile.id, { name: profileName, humanName, note: existingProfile.note });
        await repository.setProfileAiConfiguration(existingProfile.id, aiConfiguration);
      } else {
        const created = await createProfileWithInitialWorkspace(repository, { name: profileName, humanName, aiConfiguration });
        profile = created.profile;
        initialWorkspace = created.workspace;
      }
      await onComplete(profile, initialWorkspace);
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
            <label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><ModelRouteSelect role="judge" credentialId={selectedProvider?.credentialId} providers={providers} models={models} value={judgeModelKey} onChange={setJudgeModelKey} emptyLabel={copy.skipForNow} /><small>{copy.judgeLead}</small></label>
            <label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><ModelRouteSelect role="monitor" credentialId={selectedProvider?.credentialId} providers={providers} models={models} value={monitorModelKey} onChange={setMonitorModelKey} emptyLabel={copy.skipForNow} /><small>{copy.monitorGuard}</small></label>
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



function CreateWorkspaceDialog({ copy, profile, profiles, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; profile: Profile | null; profiles: Profile[]; onCancel: () => void; onCreate: (profileId: string, name: string, description?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState(profile?.id ?? profiles[0]?.id ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); if (profileId && name.trim()) void onCreate(profileId, name, description); };
  return <FormDialog title={`${copy.createWorkspace}${profile ? ` · ${aiIsBeDisplayName(profile)}` : ""}`} onCancel={onCancel}><form onSubmit={submit}>{!profile && profiles.length > 1 && <label>{copy.home === "Home" ? "Profile" : "Profil"}<select autoFocus value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{aiIsBeDisplayName(item)}</option>)}</select></label>}<label>{copy.workspaceName}<input autoFocus={Boolean(profile) || profiles.length <= 1} value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.workspaceDescription}<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!profileId || !name.trim()}>{copy.create}</button></div></form></FormDialog>;
}

function EmptyCard({ children }: { children: ReactNode }) {
  return <div className="page"><section className="panel"><div className="empty-state">{children}</div></section></div>;
}

class LazyRouteErrorBoundary extends Component<{ language: InterfaceLanguage; children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("AI RV Harness lazy route failed to load", error, info);
  }

  render() {
    if (!this.state.message) return this.props.children;
    const pl = this.props.language === "pl";
    return (
      <div className="route-load-error" role="alert">
        <span><CircleStop size={24} /></span>
        <h2>{pl ? "Nie udało się załadować ekranu" : "This screen could not be loaded"}</h2>
        <p>{pl ? "Nawigacja aplikacji nadal działa. Spróbuj ponownie uruchomić interfejs, aby pobrać moduł jeszcze raz." : "Application navigation is still available. Reload the interface to fetch the module again."}</p>
        <button className="primary-button" onClick={() => window.location.reload()}>{pl ? "Uruchom ponownie interfejs" : "Reload interface"}</button>
        <details><summary>{pl ? "Szczegóły techniczne" : "Technical details"}</summary><code>{this.state.message}</code></details>
      </div>
    );
  }
}

function LazyRouteLoadingState({ language }: { language: InterfaceLanguage }) {
  return (
    <div className="route-loading-state" role="status" aria-live="polite">
      <span className="loader-orb" />
      <p>{language === "pl" ? "Ładowanie modułu…" : "Loading module…"}</p>
    </div>
  );
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
