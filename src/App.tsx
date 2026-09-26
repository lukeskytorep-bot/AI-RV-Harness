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
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
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
import {
  closeApplication,
  createRepository,
  DatabaseCompatibilityError,
  isTauriRuntime,
  openDataFolder,
  startFreshDatabase,
  type DatabaseCompatibilityStatus,
} from "./storage";
import type { AppRepository } from "./storage/repository";
import type {
  AppSettings,
  InterfaceLanguage,
  Profile,
  ProfileAiConfigurationInput,
  Theme,
  Workspace,
} from "./types";
import type { ProviderKind } from "./providers/types";
import { TrainingScreen } from "./features/training";
import type { AiCenterView } from "./features/aiCenter";
import type { RvSession } from "./sessions/types";
import { APP_VERSION } from "./version";
import { HomeScreen } from "./features/home";
import { CreateProfileDialog, NEW_PROFILE_PROVIDER_CHOICE, ProfilesScreen, ProfileViewerControls, useProfileSetupController } from "./features/profiles";
import { TargetsScreen } from "./features/targets";
import { ConversationsScreen } from "./features/conversations";
import { RvSessionsScreen, type RvSessionsView } from "./features/rvSessions";
import { FormDialog } from "./components/FormDialog";
import { ensureBundledTrainingTargets } from "./targets/bundled";
import { createDefaultSettings } from "./startupDefaults";
import { SettingsSaveQueue } from "./storage/settingsSaveQueue";
import { profileNeedingInitialSetup } from "./profileModelDefaults";
import { ModelRouteSelect } from "./components/ModelRouteSelect";
import { aiIsBeDisplayName } from "./domain/isBeIdentity";
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

export type Page = "home" | "profiles" | "conversations" | "rv-sessions" | "training" | "research" | "ai-center" | "targets" | "settings";
export type LegacyPage = Page | "workspace" | "workspaces";

export function normalizePage(page: LegacyPage): Page {
  if (page === "workspaces") return "profiles";
  if (page === "workspace") return "conversations";
  return page;
}

export default function App() {
  const [repository, setRepository] = useState<AppRepository | null>(null);
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [rvSessionsView, setRvSessionsView] = useState<RvSessionsView>("automatic");
  const [aiCenterView, setAiCenterView] = useState<AiCenterView>("overview");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [profileDialog, setProfileDialog] = useState(false);
  const [workspaceDialogFor, setWorkspaceDialogFor] = useState<string | null>(null);
  const [workspaceCreatedNotice, setWorkspaceCreatedNotice] = useState<{ workspaceId: string; workspaceName: string; profileName: string } | null>(null);
  const [recentSessions, setRecentSessions] = useState<RvSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [databaseCompatibility, setDatabaseCompatibility] = useState<DatabaseCompatibilityStatus | null>(null);
  const [databaseCompatibilityBusy, setDatabaseCompatibilityBusy] = useState(false);
  const [databaseCompatibilityActionError, setDatabaseCompatibilityActionError] = useState<string | null>(null);
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
    setDatabaseCompatibility(null);
    setDatabaseCompatibilityActionError(null);
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
        setRepository(null);
        if (error instanceof DatabaseCompatibilityError) {
          setDatabaseCompatibility(error.status);
          setInitializationError(null);
          setLoading(false);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`AI RV Harness initialization failed at ${stage}`, error);
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

  const navigate = (destination: LegacyPage) => {
    const normalized = normalizePage(destination);
    if (normalized === "ai-center") setAiCenterView("overview");
    setPage(normalized);
  };

  const openWorkspace = async (
    workspace: Workspace,
    destination: "conversations" | "rv-sessions" = "conversations",
    rvView: RvSessionsView = "automatic",
  ) => {
    setActiveWorkspaceId(workspace.id);
    setActiveProfileId(workspace.profileId);
    if (destination === "rv-sessions") setRvSessionsView(rvView);
    setPage(destination);
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

  const compatibilityLanguage: InterfaceLanguage = databaseCompatibility?.interfaceLanguage
    ?? (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("pl") ? "pl" : "en");

  const startFreshFromBlockedDatabase = async () => {
    if (!databaseCompatibility || databaseCompatibilityBusy) return;
    if (databaseCompatibility.kind !== "legacy" && databaseCompatibility.kind !== "incomplete_current_initialization") return;
    setDatabaseCompatibilityBusy(true);
    setDatabaseCompatibilityActionError(null);
    try {
      await startFreshDatabase(compatibilityLanguage);
      setDatabaseCompatibility(null);
      setInitializationAttempt((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("cancelled by the user")) setDatabaseCompatibilityActionError(message);
    } finally {
      setDatabaseCompatibilityBusy(false);
    }
  };

  if (!loading && databaseCompatibility) {
    return <DatabaseCompatibilityScreen
      status={databaseCompatibility}
      language={compatibilityLanguage}
      busy={databaseCompatibilityBusy}
      actionError={databaseCompatibilityActionError}
      onClose={() => void closeApplication()}
      onOpenFolder={() => void openDataFolder()}
      onStartFresh={() => void startFreshFromBlockedDatabase()}
    />;
  }

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
              onOpenWorkspace={(workspace) => void openWorkspace(workspace, "conversations")}
              onOpenSession={(session) => { const owner = workspaces.find((item) => item.id === session.workspaceId); if (owner) void openWorkspace(owner, "rv-sessions", "automatic"); }}
            />
          ) : page === "profiles" ? (
            <ProfilesScreen
              copy={copy}
              profiles={profiles}
              workspaces={workspaces}
              onCreateProfile={() => setProfileDialog(true)}
              onCreateWorkspace={(profileId) => setWorkspaceDialogFor(profileId)}
              onOpenWorkspace={(workspace) => void openWorkspace(workspace, "conversations")}
              activeWorkspaceId={activeWorkspaceId}
              onActiveWorkspaceArchived={setActiveWorkspaceId}
              repository={repository!}
              onProfilesChanged={refreshProfiles}
            />
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
          ) : page === "conversations" ? (
            activeWorkspace ? (
              <ConversationsScreen
                copy={copy}
                settings={settings}
                profile={profiles.find((item) => item.id === activeWorkspace.profileId) ?? null}
                workspace={activeWorkspace}
                repository={repository}
                profiles={profiles}
                workspaces={workspaces}
                onOpenWorkspace={(workspace) => void openWorkspace(workspace, "conversations")}
                createdNotice={workspaceCreatedNotice?.workspaceId === activeWorkspace.id ? workspaceCreatedNotice : null}
                onDismissCreatedNotice={() => setWorkspaceCreatedNotice(null)}
              />
            ) : <EmptyCard>{copy.noWorkspace}</EmptyCard>
          ) : page === "rv-sessions" ? (
            activeWorkspace ? (
              <RvSessionsScreen
                copy={copy}
                settings={settings}
                profile={profiles.find((item) => item.id === activeWorkspace.profileId) ?? null}
                workspace={activeWorkspace}
                repository={repository}
                profiles={profiles}
                workspaces={workspaces}
                view={rvSessionsView}
                onViewChange={setRvSessionsView}
                onOpenWorkspace={(workspace) => void openWorkspace(workspace, "rv-sessions", rvSessionsView)}
                createdNotice={workspaceCreatedNotice?.workspaceId === activeWorkspace.id ? workspaceCreatedNotice : null}
                onDismissCreatedNotice={() => setWorkspaceCreatedNotice(null)}
              />
            ) : <EmptyCard>{copy.noWorkspace}</EmptyCard>
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
  const [profileName, setProfileName] = useState(existingProfile?.name ?? "");
  const [humanName, setHumanName] = useState(existingProfile?.humanName ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const setup = useProfileSetupController({ copy, repository, existingProfile });
  const busy = setup.busy || saving;

  const finish = async (skipOptional = false) => {
    if (!setup.selectedProvider || !setup.viewerModel || busy) return;
    setSaving(true);
    setSaveError(null);
    try {
      const aiConfiguration = setup.buildAiConfiguration(skipOptional);
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
      setSaveError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
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
          {!setup.desktop && <div className="runtime-warning"><ShieldCheck size={16} />{copy.setupNeedsDesktop}</div>}
          {setup.providers.length > 0 && <label>{copy.providerConnection}
            <select value={setup.connectionChoice} onChange={(event) => setup.changeConnection(event.target.value)} disabled={busy}>
              {setup.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} · {provider.credentialHint ?? "••••••••"}</option>)}
              <option value={NEW_PROFILE_PROVIDER_CHOICE}>＋ {copy.newProviderConnection}</option>
            </select>
          </label>}
          {(!setup.providers.length || setup.connectionChoice === NEW_PROFILE_PROVIDER_CHOICE) && <div className="setup-provider-grid">
            <label>{copy.provider}<select value={setup.providerKind} onChange={(event) => setup.changeProviderKind(event.target.value as ProviderKind)} disabled={busy}>{setup.providerKinds.map((kind) => <option key={kind} value={kind}>{PROVIDER_LABELS[kind]}</option>)}</select></label>
            <label>{copy.providerLabel}<input value={setup.providerLabel} onChange={(event) => setup.setProviderLabel(event.target.value)} disabled={busy} /></label>
            {setup.providerKind === "custom_openai" && <label className="wide">{copy.baseUrl}<input type="url" value={setup.baseUrl} onChange={(event) => setup.setBaseUrl(event.target.value)} disabled={busy} placeholder="https://example.com/v1" /></label>}
            <label className="wide">{copy.apiKey}<input type="password" autoComplete="off" value={setup.apiKey} onChange={(event) => setup.setApiKey(event.target.value)} disabled={busy} /></label>
          </div>}
          <small className="setup-security-note"><LockKeyhole size={13} />{copy.providersReady}</small>
          <div className="first-run-actions"><span>{setup.selectedProvider && setup.cachedModelCount > 0 && <button className="secondary-button" disabled={busy} onClick={() => { setup.prepareCachedModels(); setStep(2); }}>{copy.useCachedModels} ({setup.cachedModelCount})</button>}</span><button className="primary-button" disabled={!setup.desktop || busy || (!setup.selectedProvider && (!setup.providerLabel.trim() || !setup.apiKey.trim() || (setup.providerKind === "custom_openai" && !setup.baseUrl.trim())))} onClick={() => void setup.connectProvider().then((provider) => { if (provider) setStep(2); })}>{busy ? copy.refreshing : copy.connectLoadModels}<ArrowRight size={15} /></button></div>
        </div>}

        {step === 2 && <div className="first-run-body">
          <div className="setup-section-heading"><Sparkles size={20} /><div><h2>{copy.setupViewer}</h2><p>{copy.setupViewerLead}</p></div></div>
          <div className="selected-provider-summary"><ServerIcon /><span><strong>{setup.selectedProvider?.label}</strong><small>{setup.selectedProvider?.credentialHint}</small></span><Check size={16} /></div>
          <label>{copy.modelSearch}<input value={setup.modelSearch} onChange={(event) => setup.setModelSearch(event.target.value)} placeholder={copy.modelSearchPlaceholder} /></label>
          <label>{copy.defaultViewerModel}<select size={Math.min(8, Math.max(3, setup.visibleViewerModels.length))} value={setup.viewerModelId} onChange={(event) => setup.selectViewerModel(event.target.value)}>{setup.visibleViewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label>
          {!setup.visibleViewerModels.length && <p className="provider-empty">{copy.noMatchingModels}</p>}
          <ProfileViewerControls copy={copy} model={setup.viewerModel} reasoning={setup.viewerReasoning} temperature={setup.viewerTemperature} systemPrompt={setup.viewerSystemPrompt} onReasoning={setup.setViewerReasoning} onTemperature={setup.setViewerTemperature} />
          <div className="identity-name-grid"><label>{copy.aiIsBeName}<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div>
          <small className="setup-security-note"><Users size={13} />{copy.identityNamesLead}</small>
          <div className="first-run-actions"><button className="secondary-button" onClick={() => setStep(1)} disabled={busy}>{copy.back}</button><button className="primary-button" disabled={!setup.viewerModelId || busy} onClick={() => setStep(3)}>{copy.continue}<ArrowRight size={15} /></button></div>
        </div>}

        {step === 3 && <div className="first-run-body">
          <div className="setup-section-heading"><BrainCircuit size={20} /><div><h2>{copy.setupRoles}</h2><p>{copy.setupRolesLead}</p></div></div>
          <div className="optional-role-grid">
            <label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><ModelRouteSelect role="judge" credentialId={setup.selectedProvider?.credentialId} providers={setup.providers} models={setup.models} value={setup.judgeModelKey} onChange={setup.setJudgeModelKey} emptyLabel={copy.skipForNow} /><small>{copy.judgeLead}</small></label>
            <label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><ModelRouteSelect role="monitor" credentialId={setup.selectedProvider?.credentialId} providers={setup.providers} models={setup.models} value={setup.monitorModelKey} onChange={setup.setMonitorModelKey} emptyLabel={copy.skipForNow} /><small>{copy.monitorGuard}</small></label>
          </div>
          <small className="setup-security-note"><Settings2 size={13} />{copy.changeDefaultsLater}</small>
          <div className="first-run-actions"><button className="secondary-button" onClick={() => setStep(2)} disabled={busy}>{copy.back}</button><span><button className="secondary-button" disabled={busy} onClick={() => void finish(true)}>{copy.skipOptionalAndFinish}</button><button className="primary-button" disabled={busy} onClick={() => void finish()}>{busy ? copy.saving : copy.finishSetup}<Check size={15} /></button></span></div>
        </div>}
        {(setup.error || saveError) && <div className="provider-error first-run-error" role="alert">{saveError ?? setup.error}</div>}
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
    { id: "conversations", icon: MessageCircle, label: copy.conversationsNav },
    { id: "rv-sessions", icon: Crosshair, label: copy.rvSessionsNav },
    { id: "training", icon: GraduationCap, label: copy.training },
    { id: "research", icon: FlaskConical, label: copy.research },
    { id: "ai-center", icon: BrainCircuit, label: "AI Center" },
    { id: "targets", icon: Crosshair, label: copy.targets },
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
          const active = page === item.id;
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

function DatabaseCompatibilityScreen({
  status,
  language,
  busy,
  actionError,
  onClose,
  onOpenFolder,
  onStartFresh,
}: {
  status: DatabaseCompatibilityStatus;
  language: InterfaceLanguage;
  busy: boolean;
  actionError: string | null;
  onClose: () => void;
  onOpenFolder: () => void;
  onStartFresh: () => void;
}) {
  const legacy = status.kind === "legacy";
  const incomplete = status.kind === "incomplete_current_initialization";
  const canStartFresh = legacy || incomplete;
  const copy = language === "pl"
    ? legacy
      ? {
          title: "Wykryto dane z wcześniejszej wersji",
          paragraphs: [
            "AI RV Harness v0.7.13 korzysta z nowego modelu danych. Automatyczna migracja danych z v0.7.12 i wcześniejszych wersji nie jest obsługiwana, ponieważ mogłaby doprowadzić do częściowej lub błędnej konwersji.",
            "Aby nadal korzystać z dotychczasowych danych, uruchom AI RV Harness v0.7.12.",
            "Aby rozpocząć pracę w v0.7.13, możesz utworzyć nową bazę danych. Dotychczasowa baza zostanie zachowana jako kopia i nie zostanie usunięta.",
          ],
          close: "Zamknij aplikację",
          open: "Otwórz folder starej bazy",
          fresh: "Rozpocznij od nowa w v0.7.13",
          busy: "Zabezpieczanie starej bazy…",
        }
      : incomplete
        ? {
            title: "Wykryto niedokończone tworzenie bazy v0.7.13",
            paragraphs: [
              "Poprzednie tworzenie świeżej bazy AI RV Harness v0.7.13 zostało przerwane przed zakończeniem schematu. Ta częściowa baza nie będzie automatycznie migrowana ani kontynuowana.",
              "Możesz zachować ją jako kopię diagnostyczną i bezpiecznie utworzyć nową bazę v0.7.13. Częściowy plik nie zostanie usunięty.",
            ],
            close: "Zamknij aplikację",
            open: "Otwórz folder bazy",
            fresh: "Zachowaj kopię i rozpocznij od nowa",
            busy: "Zabezpieczanie częściowej bazy…",
          }
        : {
            title: "Nie można bezpiecznie otworzyć bazy danych",
            paragraphs: [
              "Baza danych jest uszkodzona albo ma nierozpoznany schemat. AI RV Harness nie uruchomi migracji i nie nadpisze tego pliku.",
              "Otwórz folder bazy, aby zachować lub ręcznie skopiować dane, a następnie zamknij aplikację.",
            ],
            close: "Zamknij aplikację",
            open: "Otwórz folder bazy",
            fresh: "",
            busy: "",
          }
    : legacy
      ? {
          title: "Data from an earlier version was detected",
          paragraphs: [
            "AI RV Harness v0.7.13 uses a new data model. Automatic migration from v0.7.12 and earlier versions is not supported because it could result in partial or incorrect conversion.",
            "To continue using your existing data, run AI RV Harness v0.7.12.",
            "To start using v0.7.13, you may create a new database. Your existing database will be preserved as a backup and will not be deleted.",
          ],
          close: "Close application",
          open: "Open legacy database folder",
          fresh: "Start fresh in v0.7.13",
          busy: "Preserving legacy database…",
        }
      : incomplete
        ? {
            title: "An incomplete v0.7.13 database initialization was detected",
            paragraphs: [
              "A previous attempt to create a fresh AI RV Harness v0.7.13 database was interrupted before the schema was complete. This partial database will not be migrated or resumed automatically.",
              "You may preserve it as a diagnostic backup and safely create a new v0.7.13 database. The partial file will not be deleted.",
            ],
            close: "Close application",
            open: "Open database folder",
            fresh: "Preserve backup and start fresh",
            busy: "Preserving incomplete database…",
          }
        : {
            title: "The database cannot be opened safely",
            paragraphs: [
              "The database is corrupted or uses an unrecognized schema. AI RV Harness will not run migrations or overwrite this file.",
              "Open the database folder to preserve or manually copy the data, then close the application.",
            ],
            close: "Close application",
            open: "Open database folder",
            fresh: "",
            busy: "",
          };

  return (
    <main className="first-run-shell">
      <section className="first-run-card">
        <header className="first-run-header">
          <span className="first-run-logo"><Database size={28} /></span>
          <div><small>AI RV Harness v0.7.13</small><h1>{copy.title}</h1></div>
        </header>
        <div className="first-run-body">
          {copy.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {status.migrationVersion != null && <small>SQLite schema: {status.migrationVersion} · dataEpoch: {status.dataEpoch ?? "unknown"}</small>}
          {actionError && <div className="provider-error" role="alert">{actionError}</div>}
          {!legacy && status.detail && <details><summary>{language === "pl" ? "Szczegóły techniczne" : "Technical details"}</summary><code>{status.detail}</code></details>}
          <div className="first-run-actions">
            <span><button className="secondary-button" disabled={busy} onClick={onClose}>{copy.close}</button><button className="secondary-button" disabled={busy} onClick={onOpenFolder}>{copy.open}</button></span>
            {canStartFresh && <button className="primary-button" disabled={busy} onClick={onStartFresh}>{busy ? copy.busy : copy.fresh}</button>}
          </div>
        </div>
      </section>
    </main>
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
