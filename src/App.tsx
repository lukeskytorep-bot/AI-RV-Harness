import {
  ArrowRight,
  BrainCircuit,
  BookOpen,
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
  Languages,
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
  Trash2,
  Users,
  Waves,
  X,
} from "lucide-react";
import rosehipLogo from "./assets/rosehip-logo.png";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getCopy } from "./i18n";
import { PROVIDER_LABELS, ProviderSettings } from "./components/ProviderSettings";
import { resolveSessionLanguage } from "./domain/localization";
import { getFullRcp, getRvLite, getTelepathicProtocol, type ProtocolResource, type RvLiteProtocolResource, type TelepathicProtocolResource } from "./resources/protocolRegistry";
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
import { buildChatProviderMessages, retryChatTurn, sendChatTurn } from "./chat/engine";
import { clearPendingChatTurn, loadPendingChatTurn, savePendingChatTurn, type PendingChatTurn } from "./chat/pendingTurn";
import { estimateContextBudget } from "./chat/contextBudget";
import { clampChatOutputTokens, defaultChatOutputTokens, loadChatOutputTokens, saveChatOutputTokens } from "./chat/outputPreference";
import type { ChatMessage, ChatMode, ChatThread, ChatThreadGroup } from "./types";
import { runBlindJudging, selectMissingJudgeSelections } from "./judge/engine";
import type { JudgingResult } from "./judge/types";
import { chooseRandomTarget, createUserTarget, targetIsEligibleForProtocol, updateUserTarget, userTargetKind } from "./targets/service";
import { localizedTargetReveal, localizedTargetTitle } from "./targets/localization";
import type { TargetRecord, TargetUsageRecord } from "./targets/types";
import { dryRunCustomProtocol, saveCustomProtocol } from "./protocols/custom";
import type { CustomProtocolVersion } from "./protocols/types";
import { runAutomaticCustomSession } from "./sessions/customController";
import { runAutomaticRvLiteSession } from "./sessions/rvLiteController";
import { createSessionReplay, isRecoverableProviderInterruption } from "./sessions/resumeReplay";
import { runOrdinaryBatch, selectBatchTargets, type OrdinaryBatchProgress, type OrdinaryBatchSessionResult } from "./sessions/batch";
import { ResearchBuilder } from "./components/ResearchBuilder";
import { TrainingScreen } from "./components/TrainingScreen";
import { AiCenterScreen, type AiCenterView } from "./components/AiCenterScreen";
import { buildCalibrationHistory, type CalibrationHistoryItem } from "./research/calibration";
import { storeRevealArtifact, storeTargetArtifact } from "./artifacts/native";
import type { RevealArtifactRecord, RvSession } from "./sessions/types";
import { aggregateJudgeScores } from "./domain/scoring";
import type { MonitorInterventionRecord, MonitorRunRecord } from "./monitor/types";
import { createImportedWorkspaceSource, estimateTextTokens } from "./sources/service";
import type { WorkspaceSource } from "./sources/types";
import { chooseAndImportAttachments, listBuiltinDocuments, readBuiltinDocument, saveBuiltinDocument, type BuiltinDocumentManifest } from "./attachments/native";
import { createPortableStorageBackup, restorePortableStorageBackup } from "./storage/maintenance";
import { chooseDirectory, openDataFolder, openProjectUrl, saveTextFile } from "./storage/native";
import { buildChatMarkdownExport } from "./chat/export";
import { APP_VERSION } from "./version";
import { clearProviderDebug, detailedProviderDiagnosticsEnabled, listProviderDebug, setDetailedProviderDiagnostics } from "./providers/debug";
import { addProvider, PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER, refreshProviderModels } from "./providers/service";
import { runAutomaticPostRevealReview, sendPostRevealTurn } from "./sessions/postReveal";
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
import { filterWorkspaceDirectory } from "./domain/workspaceDirectory";
import { reasoningOptions } from "./providers/modelReasoningRegistry";
import type { ReasoningOption } from "./providers/types";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "./domain/isBeIdentity";
import { TRAINING_CATEGORIES, TRAINING_CATEGORY_LABELS, isFactoryTrainingTargetId } from "./targets/bundled";
import { buildEffectiveMonitorPrompt, buildEffectiveViewerPrompt, factoryMonitorEditablePrompt, factoryViewerEditablePrompt, getFactoryPromptResources, localizedMonitorEditablePrompt, localizedViewerEditablePrompt, lockedActivityDefinition, lockedMonitorExecution, lockedViewerIdentity, type FactoryPromptResource } from "./resources/systemPrompts";
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
            <SettingsScreen copy={copy} settings={settings} profiles={profiles} workspaces={workspaces} repository={repository} onDataChanged={refreshProfiles} onChange={updateSettings} />
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
          <ViewerProfileControls copy={copy} model={viewerModel} reasoning={viewerReasoning} temperature={viewerTemperature} systemPrompt={viewerSystemPrompt} onReasoning={setViewerReasoning} onTemperature={setViewerTemperature} onSystemPrompt={setViewerSystemPrompt} />
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

function ViewerProfileControls({ copy, model, reasoning, temperature, systemPrompt, onReasoning, onTemperature, onSystemPrompt }: { copy: ReturnType<typeof getCopy>; model: ProviderModel | null; reasoning: "" | ReasoningEffort; temperature: string; systemPrompt: string; onReasoning: (value: "" | ReasoningEffort) => void; onTemperature: (value: string) => void; onSystemPrompt: (value: string) => void }) {
  const reasoningChoices = model ? reasoningOptions(model.capabilities.reasoning) : [];
  const temperatureCapability = model?.capabilities.temperature;
  const language: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  return <div className="profile-viewer-controls">
    <label><span>{copy.viewerReasoningLevel}</span><select value={reasoning} onChange={(event) => onReasoning(event.target.value as "" | ReasoningEffort)} disabled={!model}><option value="">{copy.autoProviderDefault}</option>{reasoningChoices.map((option) => <option key={option.value} value={option.value}>{reasoningOptionLabel(copy, option)}</option>)}</select><small>{!model ? copy.selectModelFirst : reasoningCapabilityLead(copy, model)}</small></label>
    <label><span>{copy.viewerTemperature}</span><input type="number" step="0.1" value={temperature} onChange={(event) => onTemperature(event.target.value)} disabled={!temperatureCapability?.supported} min={temperatureCapability?.min} max={temperatureCapability?.max} placeholder={temperatureCapability?.supported ? "0.9" : copy.notSupported} /><small>{temperatureCapability?.supported ? `${copy.temperatureDefaultLead}${temperatureCapability.min !== undefined || temperatureCapability.max !== undefined ? ` (${temperatureCapability.min ?? "−∞"}–${temperatureCapability.max ?? "+∞"})` : ""}` : copy.temperatureUnavailable}</small></label>
    <label className="profile-system-prompt-field"><span>{copy.viewerSystemPrompt}<small>{language === "pl" ? "część edytowalna" : "editable section"}</small></span><textarea className="system-prompt-editor" rows={12} maxLength={100000} value={systemPrompt} onChange={(event) => onSystemPrompt(event.target.value)} placeholder={copy.viewerSystemPromptPlaceholder} /><small>{copy.viewerSystemPromptLead}</small></label>
    <div className="monitor-prompt-actions"><button className="secondary-button" type="button" onClick={() => onSystemPrompt(factoryViewerEditablePrompt(language))}>{language === "pl" ? "Przywróć treść fabryczną Viewera" : "Restore factory Viewer text"}</button></div>
    <div className="viewer-locked-prompts"><div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{language === "pl" ? "Tożsamość AI IS-BE i Shadow Zone — zablokowane" : "AI IS-BE identity and Shadow Zone — locked"}</strong><pre>{lockedViewerIdentity(language)}</pre></div></div><div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{language === "pl" ? "Definicja aktywności — zablokowana" : "Activity definition — locked"}</strong><p>{lockedActivityDefinition(language)}</p></div></div><details className="effective-prompt-preview"><summary>{language === "pl" ? "Pokaż cały skuteczny prompt Viewera" : "Show the complete effective Viewer prompt"}</summary><pre>{buildEffectiveViewerPrompt(language, systemPrompt)}</pre></details></div>
  </div>;
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

function HomeScreen({
  copy,
  profile,
  workspace,
  recent,
  recentSessions,
  profiles,
  onCreateProfile,
  onOpenProfiles,
  onOpenWorkspace,
  onOpenSession,
}: {
  copy: ReturnType<typeof getCopy>;
  profile: Profile | null;
  workspace: Workspace | null;
  recent: Workspace[];
  recentSessions: RvSession[];
  profiles: Profile[];
  onCreateProfile: () => void;
  onOpenProfiles: () => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onOpenSession: (session: RvSession) => void;
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
            title={profile ? aiIsBeDisplayName(profile) : "AI IS-BE"}
            icon={profile ? <span className="avatar">{initials(aiIsBeDisplayName(profile))}</span> : <Users size={22} />}
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
                    <span className="recent-copy"><strong>{item.name}</strong><small>{owner ? aiIsBeDisplayName(owner) : "—"}</small></span>
                    <ArrowRight size={16} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel quick-panel">
          <PanelHeader title={copy.recentSessions} icon={<Clock3 size={18} />} />
          {recentSessions.length ? <div className="list-stack">{recentSessions.slice(0, 5).map((session) => <button className="recent-row" key={session.id} onClick={() => onOpenSession(session)}><span className="recent-icon"><Crosshair size={17} /></span><span className="recent-copy"><strong>{session.sessionCode}</strong><small>{session.state} · {new Date(session.updatedAt).toLocaleString()}</small></span><ArrowRight size={16} /></button>)}</div> : <p className="muted empty-copy">{copy.noRecent}</p>}
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

function WorkspacesScreen({ copy, profiles, workspaces, repository, activeWorkspaceId, onChanged, onActiveArchived, onOpenWorkspace, onCreateWorkspace, onCreateProfile }: { copy: ReturnType<typeof getCopy>; profiles: Profile[]; workspaces: Workspace[]; repository: AppRepository | null; activeWorkspaceId: string | null; onChanged: () => Promise<void>; onActiveArchived: (nextId: string | null) => void; onOpenWorkspace: (workspace: Workspace) => void; onCreateWorkspace: () => void; onCreateProfile: () => void }) {
  const createAction = profiles.length ? <button className="primary-button" onClick={onCreateWorkspace}><Plus size={16} />{copy.createWorkspace}</button> : <button className="primary-button" onClick={onCreateProfile}><Plus size={16} />{copy.createProfile}</button>;
  const rename = async (workspace: Workspace) => {
    if (!repository) return;
    const name = window.prompt(copy.home === "Home" ? "New Workspace name" : "Nowa nazwa Workspace", workspace.name)?.trim();
    if (!name || name === workspace.name) return;
    try { await repository.renameWorkspace(workspace.id, name); await onChanged(); }
    catch (cause) { window.alert(cause instanceof Error ? cause.message : String(cause)); }
  };
  const archive = async (workspace: Workspace) => {
    if (!repository || !window.confirm(copy.home === "Home" ? `Archive “${workspace.name}”? Its data will be preserved and can be restored in Settings > Data storage.` : `Zarchiwizować „${workspace.name}”? Dane zostaną zachowane i będzie można je przywrócić w Ustawienia > Pamięć danych.`)) return;
    try {
      await repository.archiveWorkspace(workspace.id);
      if (workspace.id === activeWorkspaceId) onActiveArchived(workspaces.find((item) => item.id !== workspace.id && item.profileId === workspace.profileId)?.id ?? null);
      await onChanged();
    } catch (cause) { window.alert(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="page"><PageHeader title={copy.allWorkspaces} subtitle={copy.allWorkspacesLead} action={createAction} /><section className="panel workspace-directory-panel"><WorkspaceDirectoryList copy={copy} profiles={profiles} workspaces={workspaces} onOpenWorkspace={onOpenWorkspace} onRename={rename} onArchive={archive} emptyAction={createAction} /></section></div>;
}

function WorkspaceDirectoryList({ copy, profiles, workspaces, onOpenWorkspace, onRename, onArchive, emptyAction }: { copy: ReturnType<typeof getCopy>; profiles: Profile[]; workspaces: Workspace[]; onOpenWorkspace: (workspace: Workspace) => void; onRename?: (workspace: Workspace) => void; onArchive?: (workspace: Workspace) => void; emptyAction?: ReactNode }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => filterWorkspaceDirectory(workspaces, profiles, query), [workspaces, profiles, query]);
  return <div className="workspace-directory"><label className="workspace-search"><RadioTower size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchWorkspaces} /></label>{groups.length ? <div className="workspace-directory-groups">{groups.map((group) => <section key={group.profile.id}><header><span className="avatar tiny">{initials(aiIsBeDisplayName(group.profile))}</span><div><strong>{aiIsBeDisplayName(group.profile)}</strong><small>{group.workspaces.length} {copy.workspacesCount}</small></div></header><div>{group.workspaces.map((workspace) => <div className="workspace-directory-row" key={workspace.id}><button className="workspace-open-button" onClick={() => onOpenWorkspace(workspace)}><span><RadioTower size={16} /><span><strong>{workspace.name}</strong><small>{workspace.description || new Date(workspace.lastOpenedAt).toLocaleString()}</small></span></span><ArrowRight size={15} /></button>{onRename && onArchive && <details className="workspace-actions"><summary aria-label={copy.home === "Home" ? "Workspace actions" : "Akcje Workspace"}><EllipsisVertical size={18} /></summary><div><button onClick={() => onRename(workspace)}><Pencil size={14} />{copy.home === "Home" ? "Rename" : "Zmień nazwę"}</button><button onClick={() => onArchive(workspace)}><Archive size={14} />{copy.home === "Home" ? "Archive" : "Archiwizuj"}</button></div></details>}</div>)}</div></section>)}</div> : <EmptyState icon={<RadioTower size={26} />} title={copy.noMatchingWorkspaces} body={copy.allWorkspacesLead} action={emptyAction} />}</div>;
}

function WorkspaceSwitcherDialog({ copy, profiles, workspaces, onOpenWorkspace, onClose }: { copy: ReturnType<typeof getCopy>; profiles: Profile[]; workspaces: Workspace[]; onOpenWorkspace: (workspace: Workspace) => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal workspace-switcher-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><small>{copy.workspaces}</small><h2>{copy.switchWorkspace}</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><WorkspaceDirectoryList copy={copy} profiles={profiles} workspaces={workspaces} onOpenWorkspace={(workspace) => { onClose(); onOpenWorkspace(workspace); }} /></section></div>;
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
    if (!repository || !window.confirm(`${copy.archiveProfileConfirm}\n\n${aiIsBeDisplayName(profile)}`)) return;
    await repository.archiveProfile(profile.id);
    await onProfilesChanged();
  };
  const saveProfile = async (name: string, humanName: string | undefined, note?: string, aiConfiguration?: ProfileAiConfigurationInput) => {
    if (!repository || !editingProfile) return;
    if (aiConfiguration && editingProfile.credentialId && editingProfile.credentialId !== aiConfiguration.credentialId && !window.confirm(copy.calibrationBindingWarning)) return;
    await repository.updateProfile(editingProfile.id, { name, humanName, note });
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
                  <span className="avatar large">{initials(aiIsBeDisplayName(profile))}</span>
                  <div><h3>{aiIsBeDisplayName(profile)}</h3><p>{humanIsBeDisplayName(profile)} · {profile.note || copy.credentialPending}</p></div>
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

function ChatPanel({ copy, settings, profile, workspace, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profile: Profile | null; workspace: Workspace; repository: AppRepository | null }) {
  const [mode, setMode] = useState<ChatMode>("conversation");
  const [threadGroups, setThreadGroups] = useState<ChatThreadGroup[]>([]);
  const [threadGroupId, setThreadGroupId] = useState<string | null>(null);
  const [threadGroupTitle, setThreadGroupTitle] = useState("");
  const [savedThreadGroupTitle, setSavedThreadGroupTitle] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [savedThreadTitle, setSavedThreadTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const [chatImages, setChatImages] = useState<ProviderImageInput[]>([]);
  const [chatImageNames, setChatImageNames] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [input, setInput] = useState("");
  const [manualProtocol, setManualProtocol] = useState<"none" | "rcp" | "lite-core" | "lite-extended" | "telepathic">("none");
  const [manualViewerNotesEnabled, setManualViewerNotesEnabled] = useState(true);
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(settings.defaultMaxOutputTokens));
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<PendingChatTurn | null>(null);
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const activeProvider = providerConfigs.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const selectedModel = models.find((item) => item.modelId === modelId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const [configs, nextSources] = await Promise.all([
        repository.listProviderConfigs(),
        repository.listWorkspaceSources(workspace.id),
      ]);
      if (cancelled) return;
      setProviderConfigs(configs);
      const bound = configs.find((item) => item.credentialId === profile?.credentialId);
      const nextModels = bound ? await repository.listProviderModels(bound.id) : [];
      if (cancelled) return;
      setModels(nextModels);
      setSources(nextSources);
      setChatImages([]);
      setChatImageNames([]);
      setModelId(resolveViewerDefault(profile, bound ?? null, nextModels));
      setError(null);
    })();
    return () => { cancelled = true; };
  }, [repository, workspace.id, profile?.credentialId, profile?.defaultViewerModelId]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setActiveSourceIds([]);
    setThreadGroups([]);
    setThreadGroupId(null);
    setThreadId(null);
    void (async () => {
      if (!repository) return;
      let groups = await repository.listChatThreadGroups(workspace.id, mode);
      const group = groups[0] ?? await repository.createChatThreadGroup(workspace.id, mode, "Thread 1");
      if (!groups.length) groups = [group];
      const allThreads = await repository.listChatThreads(workspace.id, mode);
      let available = allThreads.filter((item) => item.threadGroupId === group.id);
      const thread = available[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, group.id);
      if (!available.length) available = [thread];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(thread.id),
        repository.listActiveChatSourceIds(thread.id),
        repository.touchChatThread(thread.id),
      ]);
      if (cancelled) return;
      setThreadGroups(groups);
      setThreadGroupId(group.id);
      setThreadGroupTitle(group.title);
      setSavedThreadGroupTitle(group.title);
      setThreads(available);
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
      setError(null);
    })().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [repository, workspace.id, mode, copy.conversation, copy.manualRv]);

  useEffect(() => {
    if (selectedModel && (!selectedModel.capabilities.supportsVision || !selectedModel.capabilities.inputModalities.includes("image"))) {
      setChatImages([]);
      setChatImageNames([]);
    }
  }, [selectedModel?.modelId]);

  useEffect(() => {
    if (!selectedModel) return;
    const fallback = defaultChatOutputTokens(settings.defaultMaxOutputTokens, selectedModel.capabilities.maxOutputTokens);
    const next = threadId ? loadChatOutputTokens(threadId, fallback, selectedModel.capabilities.maxOutputTokens) : fallback;
    setMaxOutputTokens(String(next));
  }, [threadId, selectedModel?.modelId, selectedModel?.capabilities.maxOutputTokens, settings.defaultMaxOutputTokens]);

  useEffect(() => {
    setPendingRetry(threadId ? loadPendingChatTurn(threadId, messages) : null);
  }, [threadId, messages]);

  const selectedSources = sources.filter((source) => activeSourceIds.includes(source.id));
  const effectiveMaxOutputTokens = (() => {
    const parsed = Number(maxOutputTokens);
    const fallback = defaultChatOutputTokens(settings.defaultMaxOutputTokens, selectedModel?.capabilities.maxOutputTokens);
    return Number.isInteger(parsed) && parsed > 0 ? clampChatOutputTokens(parsed, selectedModel?.capabilities.maxOutputTokens) : fallback;
  })();
  const attachedProtocol = mode === "manual_rv" && manualProtocol !== "none"
    ? manualProtocol === "rcp"
      ? getFullRcp(language).content
      : manualProtocol === "telepathic"
        ? getTelepathicProtocol(language).content
        : getRvLite(language, manualProtocol === "lite-core" ? "core" : "extended").content
    : undefined;
  const rvSystemPrompt = mode === "manual_rv" ? buildEffectiveViewerPrompt(language, localizedViewerEditablePrompt(profile?.defaultViewerSystemPrompt, language)) : undefined;
  const previewMessages = buildChatProviderMessages({ mode, language, history: messages, content: input.trim(), rvSystemPrompt, attachedProtocol, sources: selectedSources, images: chatImages });
  const contextBudget = estimateContextBudget(previewMessages, selectedModel?.capabilities.contextTokens, effectiveMaxOutputTokens);
  const contextExceeded = contextBudget.exceeded;

  const openThread = async (nextThreadId: string) => {
    if (!repository || sending || nextThreadId === threadId) return;
    const thread = threads.find((item) => item.id === nextThreadId);
    if (!thread) return;
    setError(null);
    try {
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(thread.id),
        repository.listActiveChatSourceIds(thread.id),
        repository.touchChatThread(thread.id),
      ]);
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const openThreadGroup = async (nextGroupId: string) => {
    if (!repository || sending || nextGroupId === threadGroupId) return;
    const group = threadGroups.find((item) => item.id === nextGroupId);
    if (!group) return;
    setError(null);
    try {
      let available = (await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === group.id);
      const next = available[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, group.id);
      if (!available.length) available = [next];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(next.id),
        repository.listActiveChatSourceIds(next.id),
        repository.touchChatThread(next.id),
      ]);
      setThreadGroupId(group.id);
      setThreadGroupTitle(group.title);
      setSavedThreadGroupTitle(group.title);
      setThreads(available);
      setThreadId(next.id);
      setThreadTitle(next.title);
      setSavedThreadTitle(next.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const createNewThreadGroup = async () => {
    if (!repository || sending) return;
    setError(null);
    try {
      const group = await repository.createChatThreadGroup(workspace.id, mode, `Thread ${threadGroups.length + 1}`);
      const conversation = await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, group.id);
      setThreadGroups(await repository.listChatThreadGroups(workspace.id, mode));
      setThreadGroupId(group.id);
      setThreadGroupTitle(group.title);
      setSavedThreadGroupTitle(group.title);
      setThreads([conversation]);
      setThreadId(conversation.id);
      setThreadTitle(conversation.title);
      setSavedThreadTitle(conversation.title);
      setMessages([]);
      setActiveSourceIds([]);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const createNewThread = async () => {
    if (!repository || sending) return;
    const baseTitle = mode === "conversation" ? copy.conversation : copy.manualRv;
    const suggestedTitle = `${baseTitle} ${threads.length + 1}`;
    const requestedTitle = window.prompt(settings.interfaceLanguage === "pl" ? "Podaj nazwę nowej konwersacji:" : "Enter a name for the new conversation:", suggestedTitle);
    if (requestedTitle === null || !requestedTitle.trim()) return;
    setError(null);
    try {
      if (!threadGroupId) return;
      const thread = await repository.createChatThread(workspace.id, mode, requestedTitle.trim(), threadGroupId);
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setMessages([]);
      setActiveSourceIds([]);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const archiveCurrentThread = async () => {
    if (!repository || !threadId || sending || !window.confirm(`${copy.archiveChatConfirm}\n\n${savedThreadTitle}`)) return;
    setError(null);
    try {
      await repository.archiveChatThread(threadId);
      let remaining = (await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId);
      const next = remaining[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, threadGroupId ?? undefined);
      if (!remaining.length) remaining = [next];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(next.id),
        repository.listActiveChatSourceIds(next.id),
        repository.touchChatThread(next.id),
      ]);
      setThreads(remaining);
      setThreadId(next.id);
      setThreadTitle(next.title);
      setSavedThreadTitle(next.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const toggleSource = async (sourceId: string) => {
    if (!repository || !threadId) return;
    const active = !activeSourceIds.includes(sourceId);
    await repository.setChatSourceActive(threadId, sourceId, active);
    setActiveSourceIds((current) => active ? [...new Set([...current, sourceId])] : current.filter((id) => id !== sourceId));
  };

  const attachFiles = async () => {
    if (!repository || !threadId || sending || attachmentBusy) return;
    setAttachmentBusy(true);
    setError(null);
    try {
      const attachments = await chooseAndImportAttachments(settings.interfaceLanguage === "pl" ? "Dołącz dokumenty lub obrazy" : "Attach documents or images");
      const createdSourceIds: string[] = [];
      const nextImages: ProviderImageInput[] = [];
      const nextImageNames: string[] = [];
      const rejectedImages: string[] = [];
      for (const attachment of attachments) {
        if (attachment.kind === "document") {
          const source = await createImportedWorkspaceSource(repository, workspace.id, attachment);
          createdSourceIds.push(source.id);
          continue;
        }
        if (!selectedModel?.capabilities.supportsVision || !selectedModel.capabilities.inputModalities.includes("image")) {
          rejectedImages.push(attachment.displayName);
          continue;
        }
        nextImages.push({ mimeType: attachment.mimeType, dataBase64: attachment.dataBase64 });
        nextImageNames.push(attachment.displayName);
      }
      for (const sourceId of createdSourceIds) {
        await repository.setChatSourceActive(threadId, sourceId, true);
      }
      if (createdSourceIds.length) {
        setSources(await repository.listWorkspaceSources(workspace.id));
        setActiveSourceIds((current) => [...new Set([...current, ...createdSourceIds])]);
      }
      setChatImages((current) => [...current, ...nextImages].slice(0, 8));
      setChatImageNames((current) => [...current, ...nextImageNames].slice(0, 8));
      if (rejectedImages.length) {
        setError(`${copy.modelNoVision}\n${settings.interfaceLanguage === "pl" ? "Nieprzesłane pliki" : "Files not sent"}: ${rejectedImages.join(", ")}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeSource = async (source: WorkspaceSource) => {
    if (!repository || !window.confirm(`${copy.removeSource}: ${source.displayName}?`)) return;
    await repository.deleteWorkspaceSource(source.id);
    setSources((current) => current.filter((item) => item.id !== source.id));
    setActiveSourceIds((current) => current.filter((id) => id !== source.id));
  };

  const removeChatImage = (index: number) => {
    setChatImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setChatImageNames((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const commitMaxOutputTokens = () => {
    const next = threadId
      ? saveChatOutputTokens(threadId, effectiveMaxOutputTokens, selectedModel?.capabilities.maxOutputTokens)
      : effectiveMaxOutputTokens;
    setMaxOutputTokens(String(next));
  };

  const send = async () => {
    const content = input.trim();
    if (!repository || !threadId || !activeProvider || !selectedModel || !content || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    let effectiveRvSystemPrompt = rvSystemPrompt;
    try {
      if (mode === "manual_rv" && manualViewerNotesEnabled && profile) {
        const snapshot = await prepareViewerNotesForSession({ repository, profileId: profile.id, providerConfig: activeProvider, model: selectedModel, enabled: true });
        const notesBlock = viewerNotesSystemBlock(snapshot, language);
        if (notesBlock) effectiveRvSystemPrompt = [rvSystemPrompt, notesBlock].filter(Boolean).join("\n\n");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInput(content);
      setSending(false);
      return;
    }
    const pending: PendingChatTurn = {
      threadId,
      mode,
      language,
      providerConfigId: activeProvider.id,
      modelId: selectedModel.modelId,
      content,
      requestedSettings: { ...profileGenerationDefaults(profile, selectedModel), maxOutputTokens: effectiveMaxOutputTokens },
      ...(effectiveRvSystemPrompt ? { rvSystemPrompt: effectiveRvSystemPrompt } : {}),
      ...(attachedProtocol ? { attachedProtocol } : {}),
      sourceIds: selectedSources.map((source) => source.id),
      images: chatImages,
      imageNames: chatImageNames,
      createdAt: new Date().toISOString(),
    };
    savePendingChatTurn(pending);
    setPendingRetry(pending);
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
        requestedSettings: { ...profileGenerationDefaults(profile, selectedModel), maxOutputTokens: effectiveMaxOutputTokens },
        ...(effectiveRvSystemPrompt ? { rvSystemPrompt: effectiveRvSystemPrompt } : {}),
        sources: selectedSources,
        images: chatImages,
        maxRetries: settings.maxRetries,
        timeoutMs: settings.requestTimeoutMs,
        ...(attachedProtocol ? { attachedProtocol } : {}),
      });
      clearPendingChatTurn(threadId);
      setPendingRetry(null);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      const storedMessages = await repository.listChatMessages(threadId);
      if (storedMessages.at(-1)?.role !== "user") {
        clearPendingChatTurn(threadId);
        setPendingRetry(null);
      }
      setMessages(storedMessages);
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
      setSending(false);
    }
  };

  const retryPendingResponse = async () => {
    if (!repository || !pendingRetry || sending) return;
    const providerConfig = providerConfigs.find((item) => item.id === pendingRetry.providerConfigId);
    const model = models.find((item) => item.providerConfigId === pendingRetry.providerConfigId && item.modelId === pendingRetry.modelId);
    if (!providerConfig || !model) {
      setError(settings.interfaceLanguage === "pl" ? "Zapisany model lub połączenie nie jest obecnie dostępne. Przywróć je, aby ponowić odpowiedź." : "The saved model or connection is currently unavailable. Restore it to retry the response.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await retryChatTurn({
        repository,
        threadId: pendingRetry.threadId,
        mode: pendingRetry.mode,
        language: pendingRetry.language,
        providerConfig,
        model,
        requestedSettings: pendingRetry.requestedSettings,
        ...(pendingRetry.rvSystemPrompt ? { rvSystemPrompt: pendingRetry.rvSystemPrompt } : {}),
        ...(pendingRetry.attachedProtocol ? { attachedProtocol: pendingRetry.attachedProtocol } : {}),
        sources: sources.filter((source) => pendingRetry.sourceIds.includes(source.id)),
        images: pendingRetry.images,
        maxRetries: settings.maxRetries,
        timeoutMs: settings.requestTimeoutMs,
      });
      clearPendingChatTurn(pendingRetry.threadId);
      setPendingRetry(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMessages(await repository.listChatMessages(pendingRetry.threadId));
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
      setSending(false);
    }
  };

  const renameThread = async () => {
    if (!repository || !threadId || !threadTitle.trim() || threadTitle.trim() === savedThreadTitle) return;
    try {
      await repository.renameChatThread(threadId, threadTitle);
      setThreadTitle(threadTitle.trim());
      setSavedThreadTitle(threadTitle.trim());
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const renameThreadGroup = async () => {
    if (!repository || !threadGroupId || !threadGroupTitle.trim() || threadGroupTitle.trim() === savedThreadGroupTitle) return;
    try {
      await repository.renameChatThreadGroup(threadGroupId, threadGroupTitle);
      setThreadGroupTitle(threadGroupTitle.trim());
      setSavedThreadGroupTitle(threadGroupTitle.trim());
      setThreadGroups(await repository.listChatThreadGroups(workspace.id, mode));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const archiveCurrentThreadGroup = async () => {
    if (!repository || !threadGroupId || sending || !window.confirm(`${copy.archiveThreadConfirm}\n\n${savedThreadGroupTitle}`)) return;
    setError(null);
    try {
      await repository.archiveChatThreadGroup(threadGroupId);
      let groups = await repository.listChatThreadGroups(workspace.id, mode);
      const nextGroup = groups[0] ?? await repository.createChatThreadGroup(workspace.id, mode, "Thread 1");
      if (!groups.length) groups = [nextGroup];
      let available = (await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === nextGroup.id);
      const next = available[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, nextGroup.id);
      if (!available.length) available = [next];
      const [nextMessages, nextActiveSources] = await Promise.all([repository.listChatMessages(next.id), repository.listActiveChatSourceIds(next.id)]);
      setThreadGroups(groups);
      setThreadGroupId(nextGroup.id);
      setThreadGroupTitle(nextGroup.title);
      setSavedThreadGroupTitle(nextGroup.title);
      setThreads(available);
      setThreadId(next.id);
      setThreadTitle(next.title);
      setSavedThreadTitle(next.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const exportCurrentThread = async () => {
    const thread = threads.find((item) => item.id === threadId);
    if (!thread || sending) return;
    setError(null);
    try {
      const exported = buildChatMarkdownExport({
        language: settings.interfaceLanguage,
        mode,
        thread,
        workspace,
        profile,
        messages,
        ...(selectedModel?.modelId ? { modelId: selectedModel.modelId } : {}),
      });
      await saveTextFile(settings.interfaceLanguage === "pl" ? "Zapisz rozmowę" : "Save conversation", exported.fileName, exported.content);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return (
    <section className="chat-surface">
      <div className="chat-hierarchy">
        <span className="hierarchy-workspace"><RadioTower size={15} /><span><small>{copy.workspace}</small><strong>{workspace.name}</strong></span></span>
        <ChevronRight size={15} />
        <label className="hierarchy-thread"><span>{copy.threadGroups}</span><select value={threadGroupId ?? ""} disabled={!threadGroupId || sending} onChange={(event) => void openThreadGroup(event.target.value)}>{threadGroups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
        <button className="icon-button hierarchy-add" type="button" title={copy.newThread} disabled={!repository || sending} onClick={() => void createNewThreadGroup()}><Plus size={15} /></button>
        <details className="hierarchy-menu">
          <summary aria-label={copy.renameThreadGroup} title={copy.renameThreadGroup}>•••</summary>
          <div className="hierarchy-menu-popover">
            <label><span>{copy.threadGroupTitle}</span><input value={threadGroupTitle} maxLength={160} onChange={(event) => setThreadGroupTitle(event.target.value)} /></label>
            <button className="secondary-button" disabled={!threadGroupTitle.trim() || threadGroupTitle.trim() === savedThreadGroupTitle} onClick={() => void renameThreadGroup()}><Pencil size={13} />{copy.renameThreadGroup}</button>
            <button className="secondary-button danger-action" disabled={!threadGroupId || sending} onClick={() => void archiveCurrentThreadGroup()}><Archive size={13} />{copy.archiveThreadGroup}</button>
          </div>
        </details>
      </div>
      <div className="chat-toolbar">
        <div className="segmented large-segmented">
          <button disabled={sending} className={mode === "conversation" ? "active" : ""} onClick={() => setMode("conversation")}><MessageCircle size={16} />{copy.conversation}</button>
          <button disabled={sending} className={mode === "manual_rv" ? "active" : ""} onClick={() => setMode("manual_rv")}><Crosshair size={16} />{copy.manualRv}</button>
        </div>
        <div className="conversation-switcher">
          <label><span>{copy.chatThreads}</span><select value={threadId ?? ""} disabled={!threadId || sending} onChange={(event) => void openThread(event.target.value)}>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></label>
          <button className="secondary-button" disabled={!repository || sending} onClick={() => void createNewThread()}><Plus size={13} />{copy.newChat}</button>
          <button className="secondary-button danger-action" disabled={!threadId || sending} title={copy.archiveChat} onClick={() => void archiveCurrentThread()}><Archive size={13} />{copy.archiveChat}</button>
          <details className="hierarchy-menu conversation-menu">
            <summary aria-label={copy.renameThread} title={copy.renameThread}>•••</summary>
            <div className="hierarchy-menu-popover">
              <label><span>{copy.threadTitle}</span><input value={threadTitle} maxLength={160} onChange={(event) => setThreadTitle(event.target.value)} /></label>
              <button className="secondary-button" disabled={!threadTitle.trim() || threadTitle.trim() === savedThreadTitle} onClick={() => void renameThread()}><Pencil size={13} />{copy.renameThread}</button>
              <button className="secondary-button" disabled={!threadId || sending} onClick={() => void exportCurrentThread()}><Download size={13} />{settings.interfaceLanguage === "pl" ? "Zapisz rozmowę (.md)" : "Save conversation (.md)"}</button>
            </div>
          </details>
        </div>
        <span className={mode === "conversation" ? "context-badge conversation" : "context-badge blind"}>
          {mode === "conversation" ? <Sparkles size={14} /> : <LockKeyhole size={14} />}
          {mode === "conversation" ? copy.systemActive : copy.viewerSystemActive}
        </span>
      </div>
      <div className="chat-model-bar">
        <span><KeyRound size={14} />{activeProvider?.label ?? copy.credentialPending}</span>
        <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!activeProvider || !models.length || sending}>
          <option value="">{models.length ? copy.selectModel : copy.noCachedModels}</option>
          {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.recommended ? "★ " : ""}{model.displayName}</option>)}
        </select>
        <label className="chat-output-limit"><span>{copy.maxOutputTokens}</span><input type="number" min={1} max={selectedModel?.capabilities.maxOutputTokens ?? 262144} value={maxOutputTokens} disabled={!selectedModel || sending} onChange={(event) => setMaxOutputTokens(event.target.value)} onBlur={commitMaxOutputTokens} /></label>
        <span className={`chat-context-meter ${contextBudget.level}`} title={contextBudget.contextLimit === undefined
          ? `${copy.estimatedContext}: ~${contextBudget.estimatedInputTokens.toLocaleString()} + ${contextBudget.reservedOutputTokens.toLocaleString()} output tokens`
          : `${copy.estimatedContext}: ~${contextBudget.estimatedInputTokens.toLocaleString()} + ${contextBudget.reservedOutputTokens.toLocaleString()} output; ${contextBudget.remainingTokens?.toLocaleString()} remaining of ${contextBudget.contextLimit.toLocaleString()}`}>
          {contextBudget.percent === undefined
            ? (settings.interfaceLanguage === "pl" ? "Limit kontekstu niedostępny" : "Context limit unavailable")
            : `${copy.estimatedContext}: ${contextBudget.percent}%`}
        </span>
        {mode === "manual_rv" && <><label className="manual-protocol-select"><span>{settings.interfaceLanguage === "pl" ? "Dołącz protokół" : "Attach protocol"}</span><select value={manualProtocol} onChange={(event) => setManualProtocol(event.target.value as typeof manualProtocol)} disabled={sending}><option value="none">{settings.interfaceLanguage === "pl" ? "Bez dodatkowego protokołu" : "No additional protocol"}</option><option value="rcp">Full RCP 1.5a</option><option value="lite-core">RV Lite Core 1.1.0</option><option value="lite-extended">RV Lite Extended 1.1.0</option><option value="telepathic">{settings.interfaceLanguage === "pl" ? "Protokół Telepatyczny 1.1" : "Telepathic Protocol 1.1"}</option></select></label><label className="manual-notes-toggle" title={settings.interfaceLanguage === "pl" ? "Dołącz aktualne Viewer Notes tej instancji AI do Manual RV." : "Attach this AI identity's current Viewer Notes to Manual RV."}><span>Viewer Notes</span><input type="checkbox" checked={manualViewerNotesEnabled} onChange={(event) => setManualViewerNotesEnabled(event.target.checked)} disabled={sending} /></label></>}
      </div>
      <div className="context-banner">
        <span className={mode === "conversation" ? "banner-icon violet" : "banner-icon cyan"}>{mode === "conversation" ? <MessageCircle size={22} /> : <ShieldCheck size={22} />}</span>
        <div><strong>{mode === "conversation" ? copy.conversationTitle : copy.manualTitle}</strong><p>{mode === "conversation" ? copy.conversationDesc : copy.manualDesc}</p></div>
      </div>
      <details className="chat-sources"><summary><span><FileCheck2 size={14} />{copy.workspaceSources}</span><small>{copy.activeSources}: {activeSourceIds.length} · {copy.estimatedContext}: ~{contextBudget.estimatedInputTokens.toLocaleString()} tokens</small></summary><div className="chat-source-body">{sources.length ? <div className="chat-source-list">{sources.map((source) => <label key={source.id}><input type="checkbox" checked={activeSourceIds.includes(source.id)} onChange={() => void toggleSource(source.id)} /><span><strong>{source.displayName}</strong><small>{source.sourceType.toUpperCase()} · ~{estimateTextTokens(source.content).toLocaleString()} tokens</small></span><button type="button" className="icon-button danger" title={copy.removeSource} onClick={(event) => { event.preventDefault(); void removeSource(source); }}><X size={13} /></button></label>)}</div> : <p>{copy.noSources}</p>}{contextExceeded && <div className="source-context-error">{copy.contextExceeded}</div>}</div></details>
      {messages.length === 0 ? <div className="chat-empty"><div className="empty-orbit"><Waves size={32} /></div><h3>{copy.cleanBoundary}</h3><p>{activeProvider ? copy.noChatMessages : copy.providerNeeded}</p></div> : <div className="message-list">{messages.map((message, index) => { const displayName = message.role === "user" ? humanIsBeDisplayName(profile) : aiIsBeDisplayName(profile); const date = new Date(message.createdAt); const previous = index > 0 ? new Date(messages[index - 1].createdAt) : null; const dayChanged = !previous || date.toDateString() !== previous.toDateString(); return <div className="chat-message-block" key={message.id}>{dayChanged && <div className="chat-date-separator"><span>{date.toLocaleDateString(settings.interfaceLanguage === "pl" ? "pl-PL" : "en-GB", { dateStyle: "full" })}</span></div>}<article className={`chat-message ${message.role}`}><span>{initials(displayName)}</span><div><small>{displayName} · {date.toLocaleTimeString(settings.interfaceLanguage === "pl" ? "pl-PL" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</small><SafeMarkdown content={message.content} /></div></article></div>; })}{sending && <div className="typing-row"><span className="loader-orb" />{copy.sending}</div>}</div>}
      {error && <div className="provider-error chat-error">{error}</div>}
      {pendingRetry && <div className="chat-retry-panel"><span>{settings.interfaceLanguage === "pl" ? "Ostatnia wiadomość nie otrzymała odpowiedzi AI." : "The last message did not receive an AI response."}</span><button className="secondary-button" disabled={sending} onClick={() => void retryPendingResponse()}>{settings.interfaceLanguage === "pl" ? "Ponów odpowiedź" : "Retry response"}</button></div>}
      {(selectedSources.length > 0 || chatImageNames.length > 0) && <div className="attachment-chips">{selectedSources.map((source) => <button type="button" key={source.id} title={copy.removeSource} onClick={() => void toggleSource(source.id)}><FileCheck2 size={12} /><span>{source.displayName} · {source.sourceType.toUpperCase()} · {settings.interfaceLanguage === "pl" ? "aktywne" : "active"} · ~{estimateTextTokens(source.content).toLocaleString()} tokens</span><X size={11} /></button>)}{chatImageNames.map((name, index) => <button type="button" key={`${name}-${index}`} onClick={() => removeChatImage(index)}><span>{name} · IMAGE · {settings.interfaceLanguage === "pl" ? "następna tura" : "next turn"} · ~2,048 tokens</span><X size={11} /></button>)}</div>}
      <div className="composer">
        <textarea rows={2} placeholder={copy.messagePlaceholder} value={input} onChange={(event) => setInput(event.target.value)} disabled={!selectedModel || sending || Boolean(pendingRetry)} />
        <div className="composer-actions"><button type="button" className="composer-attachment-button" title={settings.interfaceLanguage === "pl" ? "Dołącz dokumenty lub obrazy" : "Attach documents or images"} disabled={!repository || !threadId || sending || attachmentBusy || Boolean(pendingRetry)} onClick={() => void attachFiles()}><Paperclip size={17} /></button><button disabled={!selectedModel || !input.trim() || sending || contextExceeded || Boolean(pendingRetry)} onClick={() => void send()}>{sending ? copy.sending : copy.send}<ArrowRight size={15} /></button></div>
      </div>
    </section>
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

function JudgeEvaluation({
  copy,
  repository,
  sessionId,
  language,
  models,
  providerConfigs,
  defaultModelKey,
  maxRetries,
  timeoutMs,
  onCompleted,
}: {
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
}) {
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
      const existing = await repository.listJudgeScores(sessionId);
      const missingJudges = selectMissingJudgeSelections(existing, judges);
      const next = missingJudges.length
        ? await runBlindJudging({
          repository,
          sessionId,
          language,
          judges: missingJudges,
          maxRetries,
          timeoutMs,
          onProgress: (done) => setCompleted(existing.length + done),
        })
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

  return (
    <section className="judge-evaluation">
      <div className="judge-heading">
        <span><ShieldCheck size={18} /></span>
        <div><strong>{copy.judgeEvaluation}</strong><p>{copy.judgeLead}</p></div>
      </div>
      {(!result || addingJudges) && <>
        <div className="judge-config">
          <label><span>{copy.judgeCount}</span><select value={judgeCount} onChange={(event) => setJudgeCount(Number(event.target.value))} disabled={busy || Boolean(result)}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          {Array.from({ length: judgeCount }, (_, index) => <label key={index}><span>{copy.judgeModel} {index + 1}</span><select value={selections[index]} onChange={(event) => setSelections((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} disabled={busy || Boolean(result && index < result.scores.length)}><option value="">{copy.selectModel}</option>{models.map((model) => { const provider = providerConfigs.find((item) => item.id === model.providerConfigId); return <option key={keyFor(model)} value={keyFor(model)}>{provider?.label ?? model.provider} · {model.displayName}</option>; })}</select></label>)}
        </div>
        <div className="judge-actions"><small>{busy ? `${copy.judging} ${completed}/${judgeCount}` : copy.judgeRequiresModels}</small><button className="primary-button" disabled={!isTauriRuntime() || !ready || busy} onClick={() => void evaluate()}>{busy ? copy.judging : copy.runJudges}</button></div>
      </>}
      {result && <div className="judge-results">
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
          <div className="judge-rationale"><small>{copy.rationale}</small><SafeMarkdown content={score.narrative.conciseRationale} /></div>
        </article>)}</div>
        {!addingJudges && result.scores.length < 3 && <button className="secondary-button" disabled={busy} onClick={addAnotherJudge}>{language === "pl" ? "Dodaj kolejnego Judge’a" : "Add another Judge"}</button>}
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
  maxRetries,
  timeoutMs,
  onCompleted,
}: {
  copy: ReturnType<typeof getCopy>;
  repository: AppRepository | null;
  sessions: OrdinaryBatchSessionResult[];
  language: InterfaceLanguage;
  models: ProviderModel[];
  providerConfigs: ProviderConfig[];
  defaultModelKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
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

function JudgeNarrativeRow({ label, values }: { label: string; values: string[] }) {
  return <div className="judge-narrative"><small>{label}</small>{values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value}`}><SafeMarkdown content={value} /></li>)}</ul> : <p>—</p>}</div>;
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

function TargetsScreen({ copy, settings, repository }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; repository: AppRepository | null }) {
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
  const mine = targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general");
  const telepathicTargets = targets.filter((target) => target.collection === "user" && userTargetKind(target) === "telepathic");
  const usedTargetIds = new Set([...usage.map((item) => item.targetId), ...researchLockedTargetIds]);
  const createTarget = async (title: string, revealText: string, tags: string[], images: File[], targetKind: "general" | "telepathic") => {
    if (!repository) return;
    const targetId = createId("target");
    const revealArtifacts = images.length ? await Promise.all(images.map((file) => storeTargetArtifact(targetId, file))) : [];
    const target = await createUserTarget(repository, { id: targetId, title, ...(revealText.trim() ? { revealText } : {}), ...(revealArtifacts.length ? { revealArtifacts } : {}), tags, targetKind });
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
    if (!repository || !window.confirm(`${copy.deleteTargetConfirm}\n\n${localizedTargetTitle(target, settings.interfaceLanguage)}`)) return;
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
        <section className="panel target-panel"><PanelHeader title={`${copy.trainingTargets} · ${training.length}`} icon={<Crosshair size={18} />} />{training.length ? <div className="training-target-groups">{TRAINING_CATEGORIES.map((category) => { const items = training.filter((target) => target.sourceMetadata.category === category); return <details key={category}><summary><span>{TRAINING_CATEGORY_LABELS[category][settings.interfaceLanguage]}</span><b>{items.length}</b></summary><TargetList copy={copy} language={settings.interfaceLanguage} targets={items} usedTargetIds={usedTargetIds} /></details>; })}</div> : <EmptyState icon={<FileCheck2 size={28} />} title={copy.statusNext} body={copy.targetPackPending} />}</section>
        <section className="panel target-panel"><PanelHeader title={`${copy.myTargets} · ${mine.length}`} icon={<LockKeyhole size={18} />} />{mine.length ? <TargetList copy={copy} language={settings.interfaceLanguage} targets={mine} usedTargetIds={usedTargetIds} onEdit={setEditingTarget} onDelete={(target) => void deleteTarget(target)} /> : <EmptyState icon={<Plus size={28} />} title={copy.noPrivateTargets} body={copy.secureLocal} action={<button className="secondary-button" onClick={() => setDialogOpen(true)}><Plus size={15} />{copy.addTarget}</button>} />}</section>
        <section className="panel target-panel"><PanelHeader title={`${settings.interfaceLanguage === "pl" ? "Moje cele telepatyczne" : "My Telepathic Targets"} · ${telepathicTargets.length}`} icon={<BrainCircuit size={18} />} />{telepathicTargets.length ? <TargetList copy={copy} language={settings.interfaceLanguage} targets={telepathicTargets} usedTargetIds={usedTargetIds} onEdit={setEditingTarget} onDelete={(target) => void deleteTarget(target)} /> : <EmptyState icon={<BrainCircuit size={28} />} title={settings.interfaceLanguage === "pl" ? "Brak celów telepatycznych" : "No telepathic targets"} body={settings.interfaceLanguage === "pl" ? "Dodaj osobę, istotę lub grupę przeznaczoną dla Protokołu Telepatycznego." : "Add a person, being, or group intended for the Telepathic Protocol."} />}</section>
      </div>
      <section className="panel target-help-panel"><strong>{settings.interfaceLanguage === "pl" ? "Opis celu i obrazy" : "Target descriptions and images"}</strong>{settings.interfaceLanguage === "pl" ? <><p>Cel może zawierać opis tekstowy, jeden lub więcej obrazów PNG, JPG, WEBP lub GIF albo oba rodzaje danych. Zalecamy dodanie dokładnego opisu słownego, ponieważ nie każdy model potrafi odczytać obrazy. Opis możesz przygotować samodzielnie albo poprosić model obsługujący obrazy — na przykład z rodziny Google lub OpenAI — o opisanie zdjęcia.</p><p>Jeśli obraz ma być częścią Revealu lub materiału dla AI Judge, wybierz trasę Judge obsługującą obrazy; aplikacja sprawdzi tę zgodność przed oceną. Treść celu i obrazy pozostają ukryte podczas ślepej części sesji i są udostępniane dopiero po Reveal.</p></> : <><p>A target may contain a text description, one or more PNG, JPG, WEBP, or GIF images, or both. We recommend adding an accurate written description because not every model can read images. You can write it yourself or ask an image-capable model — for example from Google or OpenAI — to describe the image.</p><p>If an image is part of the Reveal or AI Judge evidence, select a Judge route that accepts images; the app checks this compatibility before evaluation. Target content and images remain hidden during the blind portion and are released only after Reveal.</p></>}</section>
      {error && <div className="provider-error">{error}</div>}
      {dialogOpen && <CreateTargetDialog copy={copy} onCancel={() => setDialogOpen(false)} onCreate={createTarget} />}
      {editingTarget && <EditTargetDialog copy={copy} target={editingTarget} onCancel={() => setEditingTarget(null)} onSave={(title, revealText, tags) => editTarget(editingTarget, title, revealText, tags)} />}
    </div>
  );
}

function TargetList({ copy, language, targets, usedTargetIds, onEdit, onDelete }: { copy: ReturnType<typeof getCopy>; language: InterfaceLanguage; targets: TargetRecord[]; usedTargetIds: Set<string>; onEdit?: (target: TargetRecord) => void; onDelete?: (target: TargetRecord) => void }) {
  return <div className="target-list">{targets.map((target) => {
    const locked = usedTargetIds.has(target.id);
    const revealText = localizedTargetReveal(target, language);
    return <article className="target-card" key={target.id}><div className="target-card-head"><div><strong>{localizedTargetTitle(target, language)}</strong><small>{target.tags.length ? target.tags.join(" · ") : target.collection}</small></div>{target.collection === "user" && <div className="target-card-actions"><button className="icon-button" disabled={locked} title={locked ? copy.usedTargetLocked : copy.editTarget} onClick={() => onEdit?.(target)}><Pencil size={14} /></button><button className="icon-button danger" disabled={locked} title={locked ? copy.usedTargetLocked : copy.deleteTarget} onClick={() => onDelete?.(target)}><Trash2 size={14} /></button></div>}</div>{revealText && <details className="target-reveal-preview"><summary>{copy.targetReveal}</summary><p>{revealText}</p></details>}{Boolean(target.revealArtifacts?.length) && <div className="target-image-list">{target.revealArtifacts!.map((artifact) => <span key={`${artifact.artifactId}-${artifact.sha256}`}>▣ {artifact.originalFileName}</span>)}</div>}{locked && <small className="target-locked-note"><LockKeyhole size={11} />{copy.usedTargetLocked}</small>}{target.contentHash && <code>sha256 {target.contentHash.slice(0, 16)}…</code>}</article>;
  })}</div>;
}

function CreateTargetDialog({ copy, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; onCancel: () => void; onCreate: (title: string, revealText: string, tags: string[], images: File[], targetKind: "general" | "telepathic") => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [revealText, setRevealText] = useState("");
  const [tags, setTags] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [targetKind, setTargetKind] = useState<"general" | "telepathic">("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (!revealText.trim() && !images.length) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(title, revealText, tags.split(","), images, targetKind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  return <FormDialog title={copy.addTarget} onCancel={onCancel}><form onSubmit={(event) => void submit(event)}><label>{copy.home === "Home" ? "Target category" : "Kategoria celu"}<select value={targetKind} onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}><option value="general">{copy.home === "Home" ? "General RV target" : "Ogólny cel RV"}</option><option value="telepathic">{copy.home === "Home" ? "Telepathic target (person / being / group)" : "Cel telepatyczny (osoba / istota / grupa)"}</option></select></label><label>{copy.targetName}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{copy.targetReveal}<textarea rows={7} value={revealText} onChange={(event) => setRevealText(event.target.value)} /></label><label>{copy.targetImages}<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isTauriRuntime() || saving} onChange={(event) => setImages(Array.from(event.target.files ?? []).slice(0, 8))} /></label>{images.length > 0 && <div className="form-image-list">{images.map((file) => <span key={`${file.name}-${file.size}`}>▣ {file.name}</span>)}</div>}<label>{copy.targetTags}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label><small className="form-hint">{targetKind === "telepathic" ? (copy.home === "Home" ? "This target appears only when the Telepathic Protocol is selected." : "Ten cel pojawi się wyłącznie po wybraniu Protokołu Telepatycznego.") : (copy.home === "Home" ? "This target is available to Full RCP, RV Lite, and custom protocols." : "Ten cel jest dostępny dla Full RCP, RV Lite i protokołów własnych.")}</small>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!title.trim() || (!revealText.trim() && !images.length) || saving}>{copy.saveTarget}</button></div></form></FormDialog>;
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

function SettingsScreen({ copy, settings, profiles, workspaces, repository, onDataChanged, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; profiles: Profile[]; workspaces: Workspace[]; repository: AppRepository | null; onDataChanged: () => Promise<void>; onChange: (settings: Partial<AppSettings>) => void }) {
  const [tab, setTab] = useState<"providers" | "models" | "storage" | "targets" | "sessions" | "appearance" | "advanced" | "about">("providers");
  const [protocolResource, setProtocolResource] = useState<ProtocolResource | RvLiteProtocolResource | TelepathicProtocolResource | null>(null);
  const [promptResource, setPromptResource] = useState<FactoryPromptResource | null>(null);
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
        {tab === "storage" && <StorageSettingsCard copy={copy} profiles={profiles} workspaces={workspaces} repository={repository} onDataChanged={onDataChanged} />}
        {tab === "targets" && <TargetSettingsCard copy={copy} settings={settings} repository={repository} onChange={onChange} />}
        {tab === "sessions" && <SessionSettingsCard copy={copy} settings={settings} onChange={onChange} />}
        {tab === "appearance" && <section className="panel settings-card wide">
          <PanelHeader title={copy.appearance} icon={<Sparkles size={18} />} />
          <SettingRow label={copy.interfaceLanguage} icon={<Languages size={18} />}>
            <select value={settings.interfaceLanguage} onChange={(event) => onChange({ interfaceLanguage: event.target.value as InterfaceLanguage })}><option value="pl">Polski</option><option value="en">English</option></select>
          </SettingRow>
          <SettingRow label={copy.theme} icon={<Sparkles size={18} />}>
            <div className="theme-picker">
              {(["blue", "aurora", "light", "dark", "green"] as Theme[]).map((theme) => <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => onChange({ theme })}>{theme === "dark" ? <Moon size={15} /> : theme === "light" ? <Sun size={15} /> : <Sparkles size={15} />}{copy[theme]}</button>)}
            </div>
          </SettingRow>
          <SettingRow label={copy.textSize} icon={<MessageCircle size={18} />}><select value={settings.textScale} onChange={(event) => onChange({ textScale: event.target.value as AppSettings["textScale"] })}><option value="small">{copy.small}</option><option value="normal">{copy.normal}</option><option value="large">{copy.large}</option></select></SettingRow>
          <SettingRow label={copy.animations} icon={<Sparkles size={18} />}><select value={settings.animations ? "on" : "off"} onChange={(event) => onChange({ animations: event.target.value === "on" })}><option value="on">{copy.enabled}</option><option value="off">{copy.disabled}</option></select></SettingRow>
        </section>}
        {tab === "advanced" && <AdvancedSettingsCard copy={copy} repository={repository} />}
        {tab === "about" && <AboutProtocolsCard copy={copy} onOpen={setProtocolResource} onOpenPrompt={setPromptResource} />}
      </div>
      {protocolResource && <ProtocolDialog copy={copy} resource={protocolResource} onClose={() => setProtocolResource(null)} />}
      {promptResource && <PromptResourceDialog copy={copy} resource={promptResource} onClose={() => setPromptResource(null)} />}
    </div>
  );
}

function AboutProtocolsCard({ copy, onOpen, onOpenPrompt }: { copy: ReturnType<typeof getCopy>; onOpen: (resource: ProtocolResource | RvLiteProtocolResource | TelepathicProtocolResource) => void; onOpenPrompt: (resource: FactoryPromptResource) => void }) {
  const [documents, setDocuments] = useState<BuiltinDocumentManifest[]>([]);
  const [openDocument, setOpenDocument] = useState<{ manifest: BuiltinDocumentManifest; content: string } | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentMessage, setDocumentMessage] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void listBuiltinDocuments().then(setDocuments).catch((cause) => setDocumentError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  const readDocument = async (manifest: BuiltinDocumentManifest) => {
    setDocumentBusy(true); setDocumentError(null); setDocumentMessage(null);
    try {
      const parsed = await readBuiltinDocument(manifest.id);
      setOpenDocument({ manifest, content: parsed.content });
    } catch (cause) { setDocumentError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDocumentBusy(false); }
  };
  const saveDocument = async (manifest: BuiltinDocumentManifest) => {
    setDocumentBusy(true); setDocumentError(null); setDocumentMessage(null);
    try {
      const path = await saveBuiltinDocument(manifest.id, copy.home === "Home" ? "Save the original DOCX" : "Zapisz oryginalny plik DOCX");
      if (path) setDocumentMessage(`${copy.home === "Home" ? "Saved" : "Zapisano"}: ${path}`);
    } catch (cause) { setDocumentError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDocumentBusy(false); }
  };
  const protocolCards = [
    { id: "rcp", name: copy.fullRcp, version: "1.5a", pl: getFullRcp("pl"), en: getFullRcp("en") },
    { id: "lite-core", name: `${copy.rvLite} Core`, version: "1.1.0", pl: getRvLite("pl", "core"), en: getRvLite("en", "core") },
    { id: "lite-extended", name: `${copy.rvLite} Extended`, version: "1.1.0", pl: getRvLite("pl", "extended"), en: getRvLite("en", "extended") },
    { id: "telepathic", name: copy.home === "Home" ? "Telepathic Protocol" : "Protokół Telepatyczny", version: "1.1", pl: getTelepathicProtocol("pl"), en: getTelepathicProtocol("en") },
  ] as const;
  const prompts = getFactoryPromptResources();
  const promptCards = (["ai-viewer-system-prompt", "ai-monitor-system-prompt"] as const).map((id) => ({ id, name: id === "ai-viewer-system-prompt" ? "AI Viewer System Prompt" : "AI Monitor System Prompt", pl: prompts.find((item) => item.id === id && item.language === "pl")!, en: prompts.find((item) => item.id === id && item.language === "en")! }));
  return <div className="about-settings-grid">
    <section className="panel about-protocol-card"><PanelHeader title={copy.protocolLibrary} icon={<FileCheck2 size={18} />} /><div className="about-card-body"><p>{copy.protocolLibraryLead}</p><div className="about-protocol-list">{protocolCards.map((protocol) => <article key={protocol.id}><span className="resource-orb"><FileCheck2 size={18} /></span><div><small>{copy.readOnly} · CC BY 4.0</small><strong>{protocol.name}</strong><code>v{protocol.version}</code></div><div className="about-protocol-actions"><button className="secondary-button" onClick={() => onOpen(protocol.pl)}>{copy.readPolish}</button><button className="secondary-button" onClick={() => onOpen(protocol.en)}>{copy.readEnglish}</button></div></article>)}{promptCards.map((prompt) => <article key={prompt.id}><span className="resource-orb"><BrainCircuit size={18} /></span><div><small>{copy.readOnly} · CC BY 4.0</small><strong>{prompt.name}</strong><code>v{prompt.pl.version}</code></div><div className="about-protocol-actions"><button className="secondary-button" onClick={() => onOpenPrompt(prompt.pl)}>{copy.readPolish}</button><button className="secondary-button" onClick={() => onOpenPrompt(prompt.en)}>{copy.readEnglish}</button></div></article>)}{documents.map((document) => <article key={document.id}><span className="resource-orb"><BookOpen size={18} /></span><div><small>DOCX · {document.language.toUpperCase()} · SHA-256</small><strong>{document.title}</strong><code>{document.sha256.slice(0, 16)}…</code></div><div className="about-protocol-actions"><button className="secondary-button" disabled={documentBusy} onClick={() => void readDocument(document)}>{copy.home === "Home" ? "Read" : "Czytaj"}</button><button className="secondary-button" disabled={documentBusy} onClick={() => void saveDocument(document)}><Download size={13} />{copy.home === "Home" ? "Save DOCX" : "Zapisz DOCX"}</button></div></article>)}</div>{documentMessage && <div className="storage-success"><Check size={14} />{documentMessage}</div>}{documentError && <div className="provider-error">{documentError}</div>}<div className="content-license-notice"><ShieldCheck size={16} /><div><strong>{copy.home === "Home" ? "Two-license model" : "Model dwóch licencji"}</strong><p>{copy.home === "Home" ? "Source code is licensed under the MIT License. Documentation, bundled prompts, training content, and other non-code visual assets are licensed under CC BY 4.0." : "Kod źródłowy jest objęty licencją MIT. Dokumentacja, dołączone prompty, materiały treningowe i inne niekodowe zasoby wizualne są objęte licencją CC BY 4.0."}</p></div></div></div></section>
    <section className="panel about-credits-card"><PanelHeader title={copy.credits} icon={<Users size={18} />} /><div className="about-card-body"><div className="credits-summary"><strong>{copy.home === "Home" ? "Thank you" : "Dziękujemy"}</strong><p>{copy.home === "Home" ? "Thank you to everyone who has tested, reviewed, discussed, and helped improve AI RV Harness. For the complete contribution history and acknowledgements, see CREDITS.md." : "Dziękujemy wszystkim, którzy testowali, recenzowali, omawiali i pomagali rozwijać AI RV Harness. Pełną historię wkładu i podziękowania znajdziesz w CREDITS.md."}</p><button className="secondary-button" onClick={() => void openProjectUrl("https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md")}><BookOpen size={14} />{copy.home === "Home" ? "View full credits and acknowledgements" : "Zobacz pełne Credits i podziękowania"}</button></div><div className="credit-group online-links"><small>{copy.home === "Home" ? "Find us online" : "Gdzie nas znaleźć"}</small><article><button className="external-project-link" onClick={() => void openProjectUrl("https://github.com/lukeskytorep-bot")}><strong>GitHub</strong></button><p>{copy.home === "Home" ? "Source repositories and current project releases." : "Repozytoria źródłowe i aktualne wydania projektu."}</p></article><article><button className="external-project-link" onClick={() => void openProjectUrl("https://presence-beyond-form.blogspot.com/")}><strong>Presence Beyond Form</strong></button><p>{copy.home === "Home" ? "Technical publications, protocols, lexicons, selected sessions, and research; includes a Polish section." : "Publikacje techniczne, protokoły, słowniki, wybrane sesje i badania; zawiera sekcję polską."}</p></article><article><button className="external-project-link" onClick={() => void openProjectUrl("https://echoofpresence.substack.com/")}><strong>Echo of Presence</strong></button><p>{copy.home === "Home" ? "Broader project notes, sessions, AI texts, and shorter updates." : "Szerszy dziennik projektu: sesje, teksty AI i krótsze aktualizacje."}</p></article><article><button className="external-project-link" onClick={() => void openProjectUrl("https://archive.org/details/resonant-contact-protocol-ai-is-be-v-1.5a")}><strong>Internet Archive · RCP 1.5a</strong></button><p>{copy.home === "Home" ? "Archived example of Resonant Contact Protocol AI IS-BE v1.5a." : "Archiwalna kopia Resonant Contact Protocol AI IS-BE v1.5a."}</p></article><article><button className="external-project-link" onClick={() => void openProjectUrl("https://web.archive.org/")}><strong>Wayback Machine</strong></button><p>{copy.home === "Home" ? "Older project pages may be located through Internet Archive snapshots." : "Starsze strony projektu można odnaleźć w migawkach Internet Archive."}</p></article></div><div className="about-license"><span><small>{copy.appVersion}</small><strong>v{APP_VERSION}</strong></span><span><small>{copy.projectLicense}</small><strong>Code: MIT</strong></span><span><small>Content</small><strong>CC BY 4.0</strong></span></div></div></section>
    <div className="credits-url-row"><span>{copy.home === "Home" ? "Full credits:" : "Pełne Credits:"}</span><code>https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md</code></div>
    {openDocument && <BuiltinDocumentDialog copy={copy} document={openDocument} busy={documentBusy} onSave={() => void saveDocument(openDocument.manifest)} onClose={() => setOpenDocument(null)} />}
  </div>;
}

function BuiltinDocumentDialog({ copy, document, busy, onSave, onClose }: { copy: ReturnType<typeof getCopy>; document: { manifest: BuiltinDocumentManifest; content: string }; busy: boolean; onSave: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><small>DOCX · {document.manifest.language.toUpperCase()}</small><h2>{document.manifest.title}</h2><p>{document.manifest.fileName} · {formatBytes(document.manifest.sizeBytes)}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="hash-grid"><code>SHA-256<br />{document.manifest.sha256}</code><code>{copy.wordCount}<br />{wordCount(document.content).toLocaleString()}</code></div><pre className="protocol-text">{document.content}</pre><div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onSave}><Download size={14} />{copy.home === "Home" ? "Save original DOCX" : "Zapisz oryginalny DOCX"}</button><button className="primary-button" onClick={onClose}>{copy.close}</button></div></section></div>;
}

function TargetSettingsCard({ copy, settings, repository, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; repository: AppRepository | null; onChange: (settings: Partial<AppSettings>) => void }) {
  const [trainingCount, setTrainingCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [telepathicCount, setTelepathicCount] = useState(0);
  const [usageCount, setUsageCount] = useState(0);
  useEffect(() => {
    if (!repository) return;
    void Promise.all([repository.listTargets(), repository.listTargetUsage()]).then(([targets, usage]) => {
      setTrainingCount(targets.filter((target) => target.collection === "training").length);
      setUserCount(targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general").length);
      setTelepathicCount(targets.filter((target) => target.collection === "user" && userTargetKind(target) === "telepathic").length);
      setUsageCount(usage.length);
    });
  }, [repository]);
  const updatePrefix = (value: string) => onChange({ sessionCodePrefix: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "RVH" });
  return <section className="panel target-settings-card"><PanelHeader title={copy.targets} icon={<Crosshair size={18} />} /><div className="target-settings-summary"><span><small>{copy.trainingTargets}</small><strong>{trainingCount}</strong></span><span><small>{copy.myTargets}</small><strong>{userCount}</strong></span><span><small>{settings.interfaceLanguage === "pl" ? "Telepatyczne" : "Telepathic"}</small><strong>{telepathicCount}</strong></span><span><small>{copy.trackedTargetUses}</small><strong>{usageCount}</strong></span></div><div className="target-settings-body"><label><span>{copy.repeatBehavior}</span><select value={settings.targetRepeatPolicy} onChange={(event) => onChange({ targetRepeatPolicy: event.target.value as AppSettings["targetRepeatPolicy"] })}><option value="allow">{copy.allowRepeatedTraining}</option><option value="avoid_profile">{copy.avoidPreviouslyUsedTraining}</option></select></label><label><span>{copy.sessionCodePrefix}</span><input value={settings.sessionCodePrefix} maxLength={12} onChange={(event) => updatePrefix(event.target.value)} /></label><div className="training-pack-status"><div><strong>{copy.trainingTargets}</strong><p>{copy.targetPackPending}</p></div></div></div></section>;
}

function AdvancedSettingsCard({ copy, repository }: { copy: ReturnType<typeof getCopy>; repository: AppRepository | null }) {
  const [modelCount, setModelCount] = useState(0);
  const [capabilitySummary, setCapabilitySummary] = useState({ vision: 0, reasoning: 0, compatibility: 0 });
  const [debugEntries, setDebugEntries] = useState(() => listProviderDebug());
  const [detailedDiagnostics, setDetailedDiagnostics] = useState(() => detailedProviderDiagnosticsEnabled());
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => { if (repository) void repository.listProviderModels().then((models) => { setModelCount(models.length); setCapabilitySummary({ vision: models.filter((model) => model.capabilities.supportsVision).length, reasoning: models.filter((model) => model.capabilities.reasoning.supported).length, compatibility: models.filter((model) => model.capabilities.source === "compatibility").length }); }); };
  useEffect(refresh, [repository]);
  const reset = async () => {
    if (!repository || !window.confirm(copy.resetCapabilityCacheConfirm)) return;
    await repository.clearProviderModelCache();
    setModelCount(0); setCapabilitySummary({ vision: 0, reasoning: 0, compatibility: 0 }); setMessage(copy.resetCapabilityCache);
  };
  const clearDebug = () => { clearProviderDebug(); setDebugEntries([]); };
  const toggleDetailedDiagnostics = () => {
    const next = !detailedDiagnostics;
    if (next && !window.confirm(copy.home === "Home" ? "Detailed diagnostics can temporarily keep redacted request and response bodies in memory. They may still contain sensitive conversation text. Enable only while troubleshooting?" : "Szczegółowa diagnostyka może tymczasowo przechowywać w pamięci zanonimizowane treści żądań i odpowiedzi. Nadal mogą one zawierać poufny tekst rozmowy. Włączyć tylko na czas diagnozy?")) return;
    setDetailedProviderDiagnostics(next);
    setDetailedDiagnostics(next);
  };
  return <section className="panel advanced-settings-card"><PanelHeader title={copy.advanced} icon={<Settings2 size={18} />} /><div className="advanced-settings-body"><div className="advanced-version"><span><small>{copy.appVersion}</small><strong>v{APP_VERSION}</strong></span><span><small>{copy.cachedModelCount}</small><strong>{modelCount}</strong></span><span><small>{copy.visionRoutes}</small><strong>{capabilitySummary.vision}</strong></span><span><small>{copy.reasoningRoutes}</small><strong>{capabilitySummary.reasoning}</strong></span><span><small>{copy.compatibilityRoutes}</small><strong>{capabilitySummary.compatibility}</strong></span></div><p>{copy.debugSecurity}</p><label className="detailed-diagnostics-toggle"><input type="checkbox" checked={detailedDiagnostics} onChange={toggleDetailedDiagnostics} /><span><strong>{copy.home === "Home" ? "Detailed request/response diagnostics" : "Szczegółowa diagnostyka żądań i odpowiedzi"}</strong><small>{copy.home === "Home" ? "Off by default and held only in volatile memory." : "Domyślnie wyłączona; dane są przechowywane wyłącznie w pamięci ulotnej."}</small></span></label><button className="secondary-button" disabled={!repository || !modelCount} onClick={() => void reset()}>{copy.resetCapabilityCache}</button>{message && <div className="storage-success"><Check size={14} />{message}</div>}<div className="debug-log-heading"><div><strong>{copy.apiDebugLog}</strong><small>{copy.debugVolatile}</small></div><span><button className="secondary-button" type="button" onClick={() => setDebugEntries(listProviderDebug())}>{copy.refreshDebugLog}</button><button className="secondary-button" type="button" disabled={!debugEntries.length} onClick={clearDebug}>{copy.clearDebugLog}</button></span></div><div className="debug-log-list">{debugEntries.length === 0 ? <p>{copy.noDebugCalls}</p> : debugEntries.map((entry) => <details key={entry.id}><summary><span className={`debug-status ${entry.status}`}>{entry.status.toUpperCase()}</span><strong>{entry.provider} · {entry.modelId}</strong><small>{new Date(entry.capturedAt).toLocaleString()}</small></summary><div className="debug-payload">{entry.endpoint && <code>{entry.endpoint}</code>}{entry.usage && <code>tokens: {entry.usage.inputTokens ?? "?"} + {entry.usage.outputTokens ?? "?"}</code>}{entry.error && <pre>{entry.error}</pre>}{entry.request !== undefined && <><h4>{copy.rawRequest}</h4><pre>{JSON.stringify(entry.request, null, 2)}</pre></>}{entry.response !== undefined && <><h4>{copy.rawResponse}</h4><pre>{JSON.stringify(entry.response, null, 2)}</pre></>}</div></details>)}</div></div></section>;
}

function StorageSettingsCard({ copy, profiles, workspaces, repository, onDataChanged }: { copy: ReturnType<typeof getCopy>; profiles: Profile[]; workspaces: Workspace[]; repository: AppRepository | null; onDataChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState({ routes: 0, approxBytes: 0 });
  const [archivedProfiles, setArchivedProfiles] = useState<Profile[]>([]);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<Workspace[]>([]);
  const [archivedGroups, setArchivedGroups] = useState<ChatThreadGroup[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<ChatThread[]>([]);
  const refresh = async () => {
    if (!repository) return;
    const [cachedModels, archivedProfileRows, archivedWorkspaceRows, groupRows, threadRows] = await Promise.all([repository.listProviderModels(), repository.listArchivedProfiles(), repository.listArchivedWorkspaces(), repository.listArchivedChatThreadGroups(), repository.listArchivedChatThreads()]);
    setCacheInfo({ routes: cachedModels.length, approxBytes: new TextEncoder().encode(JSON.stringify(cachedModels)).byteLength });
    setArchivedProfiles(archivedProfileRows); setArchivedWorkspaces(archivedWorkspaceRows); setArchivedGroups(groupRows); setArchivedThreads(threadRows);
  };
  useEffect(() => { if (repository) void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [repository]);
  const backup = async () => {
    if (!repository || busy || !isTauriRuntime()) return;
    const destination = await chooseDirectory(copy.backupChooseFolder);
    if (!destination) return;
    setBusy("backup"); setError(null); setMessage(null);
    try {
      const created = await createPortableStorageBackup(repository, destination);
      setMessage(`${copy.backupComplete} · ${created.directory}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const restore = async () => {
    if (!repository || busy || !isTauriRuntime()) return;
    const directory = await chooseDirectory(copy.restoreChooseFolder);
    if (!directory) return;
    if (!window.confirm(`${copy.restoreConfirm}\n\n${directory}`)) return;
    setBusy("restore"); setError(null); setMessage(null);
    try {
      await restorePortableStorageBackup(repository, directory);
      window.location.reload();
    } catch (cause) {
      window.alert(`${copy.restoreFailed}\n\n${cause instanceof Error ? cause.message : String(cause)}`);
      window.location.reload();
    }
  };
  const recover = async (action: () => Promise<void>) => { setError(null); try { await action(); await onDataChanged(); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const restoreWorkspace = async (workspace: Workspace) => {
    if (!repository) return;
    setError(null);
    try { await repository.restoreWorkspace(workspace.id); await onDataChanged(); await refresh(); }
    catch (cause) {
      const replacement = window.prompt(copy.home === "Home" ? `The original name may conflict with an active Workspace. Enter a new name for “${workspace.name}”.` : `Pierwotna nazwa może kolidować z aktywnym Workspace. Podaj nową nazwę dla „${workspace.name}”.`, `${workspace.name} (restored)`)?.trim();
      if (!replacement) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
      await recover(() => repository.restoreWorkspace(workspace.id, replacement));
    }
  };
  const allWorkspaceNames = new Map([...workspaces, ...archivedWorkspaces].map((item) => [item.id, item.name]));
  const visibleArchivedThreads = archivedThreads.filter((thread) => !archivedGroups.some((group) => group.id === thread.threadGroupId));
  const archiveCount = archivedProfiles.length + archivedWorkspaces.length + archivedGroups.length + visibleArchivedThreads.length;
  const archiveList = <div className="archive-recovery"><div className="storage-backup-explainer"><Archive size={18} /><div><strong>{copy.home === "Home" ? "Archive and recovery" : "Archiwum i odzyskiwanie"}</strong><p>{copy.home === "Home" ? "Archived data remains in local storage. Restore it here; permanent deletion is not part of this update." : "Zarchiwizowane dane pozostają w pamięci lokalnej. Tutaj można je przywrócić; trwałe usuwanie nie jest częścią tej aktualizacji."}</p></div></div>{archiveCount === 0 ? <p className="muted">{copy.home === "Home" ? "The archive is empty." : "Archiwum jest puste."}</p> : <div className="archive-groups">{archivedProfiles.length > 0 && <details open><summary>{copy.home === "Home" ? "Profiles" : "Profile"} · {archivedProfiles.length}</summary>{archivedProfiles.map((profile) => <div className="archive-row" key={profile.id}><span><strong>{aiIsBeDisplayName(profile)}</strong><small>{profile.archivedAt ? new Date(profile.archivedAt).toLocaleString() : ""}</small></span><button className="secondary-button" onClick={() => void recover(() => repository!.restoreProfile(profile.id))}>{copy.home === "Home" ? "Restore" : "Przywróć"}</button></div>)}</details>}{archivedWorkspaces.length > 0 && <details open><summary>Workspace · {archivedWorkspaces.length}</summary>{archivedWorkspaces.map((workspace) => <div className="archive-row" key={workspace.id}><span><strong>{workspace.name}</strong><small>{workspace.archivedAt ? new Date(workspace.archivedAt).toLocaleString() : ""}</small></span><button className="secondary-button" disabled={archivedProfiles.some((profile) => profile.id === workspace.profileId)} title={archivedProfiles.some((profile) => profile.id === workspace.profileId) ? (copy.home === "Home" ? "Restore the Profile first." : "Najpierw przywróć Profil.") : undefined} onClick={() => void restoreWorkspace(workspace)}>{copy.home === "Home" ? "Restore" : "Przywróć"}</button></div>)}</details>}{archivedGroups.length > 0 && <details><summary>{copy.home === "Home" ? "Conversations" : "Rozmowy"} · {archivedGroups.length}</summary>{archivedGroups.map((group) => <div className="archive-row" key={group.id}><span><strong>{group.title}</strong><small>{allWorkspaceNames.get(group.workspaceId) ?? group.workspaceId}</small></span><button className="secondary-button" disabled={archivedWorkspaces.some((workspace) => workspace.id === group.workspaceId)} onClick={() => void recover(() => repository!.restoreChatThreadGroup(group.id))}>{copy.home === "Home" ? "Restore" : "Przywróć"}</button></div>)}</details>}{visibleArchivedThreads.length > 0 && <details><summary>{copy.home === "Home" ? "Threads" : "Wątki"} · {visibleArchivedThreads.length}</summary>{visibleArchivedThreads.map((thread) => <div className="archive-row" key={thread.id}><span><strong>{thread.title}</strong><small>{allWorkspaceNames.get(thread.workspaceId) ?? thread.workspaceId}</small></span><button className="secondary-button" disabled={archivedWorkspaces.some((workspace) => workspace.id === thread.workspaceId)} onClick={() => void recover(() => repository!.restoreChatThread(thread.id))}>{copy.home === "Home" ? "Restore" : "Przywróć"}</button></div>)}</details>}</div>}</div>;
  return <section className="panel storage-settings-card"><PanelHeader title={copy.storage} icon={<Database size={18} />} /><div className="storage-settings-body">{isTauriRuntime() ? <><p>{copy.backupSecurity}</p><div className="storage-backup-explainer"><ShieldCheck size={18} /><div><strong>{copy.portableBackup}</strong><p>{copy.portableBackupLead}</p></div></div><div className="storage-cache-info"><span><small>{copy.capabilityCacheStorage}</small><strong>{formatBytes(cacheInfo.approxBytes)} · {cacheInfo.routes} {copy.cachedModelCount.toLowerCase()}</strong></span><span><small>{copy.cacheRouteLimit}</small><strong>{PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER.toLocaleString()} / provider</strong></span></div><div className="storage-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void openDataFolder().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>{copy.openDataFolder}</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void backup()}>{busy === "backup" ? copy.backingUp : copy.createBackup}</button><button className="danger-button restore-button" disabled={Boolean(busy)} onClick={() => void restore()}>{busy === "restore" ? copy.restoring : copy.restoreBackup}</button></div><div className="restore-warning"><CircleStop size={17} /><p>{copy.restoreDataWarning}</p></div></> : <div className="settings-info storage-runtime-info"><p>{copy.storageDesktop}</p></div>}{archiveList}{message && <div className="storage-success"><Check size={14} />{message}</div>}{error && <div className="provider-error">{error}</div>}</div></section>;
}

function SessionSettingsCard({ copy, settings, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; onChange: (settings: Partial<AppSettings>) => void }) {
  return <section className="panel session-settings-card"><PanelHeader title={copy.sessions} icon={<CircleStop size={18} />} /><div className="session-settings-body"><label><span>{copy.sessionLanguage}</span><select value={settings.sessionLanguage} onChange={(event) => onChange({ sessionLanguage: event.target.value as SessionLanguageSetting })}><option value="same">{copy.sameAsInterface}</option><option value="pl">Polski</option><option value="en">English</option></select></label><label><span>{copy.requestTimeout}</span><div><input type="number" min={1} max={600} value={Math.round(settings.requestTimeoutMs / 1000)} onChange={(event) => onChange({ requestTimeoutMs: Math.max(1, Math.min(600, Number(event.target.value) || 120)) * 1000 })} /><small>s</small></div></label><label><span>{copy.retryPolicy}</span><select value={settings.maxRetries} onChange={(event) => onChange({ maxRetries: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>{copy.defaultMaxOutput}</span><input type="number" min={1} max={262144} value={settings.defaultMaxOutputTokens} onChange={(event) => onChange({ defaultMaxOutputTokens: Math.max(1, Number(event.target.value) || 8192) })} /></label><label><span>{copy.hardSessionCostLimit}</span><div><input type="number" min={0} step="0.01" value={settings.maxSessionCostUsd} onChange={(event) => onChange({ maxSessionCostUsd: Math.max(0, Number(event.target.value) || 0) })} /><small>USD · {settings.maxSessionCostUsd > 0 ? copy.enabled : copy.disabled}</small></div></label><label><span>{copy.defaultReveal}</span><select value={settings.defaultRevealSource} onChange={(event) => onChange({ defaultRevealSource: event.target.value as AppSettings["defaultRevealSource"] })}><option value="external">{copy.externalBlind}</option><option value="automatic">{copy.automaticTarget}</option></select></label><div className="mandatory-autosave"><ShieldCheck size={16} /><div><strong>{copy.mandatoryAutosave}</strong><p>{copy.sessionRules}</p></div></div></div></section>;
}

function ProtocolDialog({ copy, resource, onClose }: { copy: ReturnType<typeof getCopy>; resource: ProtocolResource | RvLiteProtocolResource | TelepathicProtocolResource; onClose: () => void }) {
  const save = () => void saveTextFile(copy.home === "Home" ? "Save protocol resource" : "Zapisz zasób protokołu", `${resource.displayName.replace(/[^a-z0-9._-]+/gi, "_")}_v${resource.version}_${resource.language}.md`, resource.content);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>{copy.protocolResource}</small><h2>{resource.displayName}</h2><p>v{resource.version} · {resource.language.toUpperCase()} · {wordCount(resource.content).toLocaleString()} {copy.wordCount.toLowerCase()}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        <div className="hash-grid"><code>{"sourceDocxSha256" in resource ? <>{copy.sourceHash}<br />{resource.sourceDocxSha256}</> : <>Source<br />{resource.sourceFormat}</>}</code><code>{copy.contentHash}<br />{resource.contentSha256}</code></div>
        <pre className="protocol-text">{resource.content}</pre>
        <div className="modal-actions"><button className="secondary-button" onClick={save}><Download size={14} />{copy.home === "Home" ? "Save" : "Zapisz"}</button><button className="primary-button" onClick={onClose}>{copy.close}</button></div>
      </section>
    </div>
  );
}

function PromptResourceDialog({ copy, resource, onClose }: { copy: ReturnType<typeof getCopy>; resource: FactoryPromptResource; onClose: () => void }) {
  const name = resource.id === "ai-viewer-system-prompt" ? "AI Viewer System Prompt" : "AI Monitor System Prompt";
  const save = () => void saveTextFile(copy.home === "Home" ? "Save prompt resource" : "Zapisz zasób promptu", `${resource.id}_v${resource.version}_${resource.language}.md`, resource.content);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><small>{copy.protocolResource}</small><h2>{name}</h2><p>v{resource.version} · {resource.language.toUpperCase()} · {resource.license}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="hash-grid"><code>Factory resource<br />{resource.id}</code><code>License<br />CC BY 4.0</code></div><pre className="protocol-text">{resource.content}</pre><div className="modal-actions"><button className="secondary-button" onClick={save}><Download size={14} />{copy.home === "Home" ? "Save" : "Zapisz"}</button><button className="primary-button" onClick={onClose}>{copy.close}</button></div></section></div>;
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

function CreateProfileDialog({ copy, repository, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; repository: AppRepository; onCancel: () => void; onCreate: (name: string, humanName: string | undefined, note: string | undefined, aiConfiguration: ProfileAiConfigurationInput) => Promise<void> }) {
  const [aiName, setAiName] = useState("");
  const [humanName, setHumanName] = useState("");
  const [note, setNote] = useState("");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void Promise.all([repository.listProviderConfigs(), repository.listProviderModels()]).then(([nextProviders, nextModels]) => { setProviders(nextProviders); setModels(nextModels); setProviderId(nextProviders[0]?.id ?? ""); }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, [repository]);
  const provider = providers.find((item) => item.id === providerId) ?? null;
  const availableModels = preferredModelOrder(models.filter((model) => model.providerConfigId === providerId));
  const model = availableModels.find((item) => item.modelId === modelId) ?? null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !model || saving) return;
    setSaving(true); setError(null);
    try {
      await onCreate(aiName, humanName || undefined, note || undefined, {
        credentialId: provider.credentialId,
        credentialProvider: provider.provider,
        defaultViewerModelId: model.modelId,
        ...(defaultTemperatureForModel(model) !== undefined ? { defaultViewerTemperature: defaultTemperatureForModel(model) } : {}),
        defaultViewerSystemPrompt: factoryViewerEditablePrompt(copy.home === "Home" ? "en" : "pl"),
        defaultMonitorSystemPrompt: factoryMonitorEditablePrompt(copy.home === "Home" ? "en" : "pl"),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <FormDialog title={copy.createProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}>
    <div className="identity-name-grid"><label>{copy.aiIsBeName}<input autoFocus value={aiName} onChange={(event) => setAiName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div>
    <small className="form-hint">{copy.identityNamesLead}</small>
    <label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><label>{copy.profileCredential}<select value={providerId} onChange={(event) => { setProviderId(event.target.value); setModelId(""); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label>{copy.defaultViewerModel}<select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!provider}><option value="">{copy.selectModel}</option>{availableModels.map((item) => <option key={item.modelId} value={item.modelId}>{item.displayName}</option>)}</select></label></fieldset>
    {error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving || !provider || !model}>{saving ? copy.saving : copy.create}</button></div>
  </form></FormDialog>;
}

function LegacyCreateProfileDialog({ copy, repository, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; repository: AppRepository; onCancel: () => void; onCreate: (name: string, humanName: string | undefined, note: string | undefined, aiConfiguration: ProfileAiConfigurationInput) => Promise<void> }) {
  const [name, setName] = useState("");
  const [humanName, setHumanName] = useState("");
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
      await onCreate(name, humanName || undefined, note || undefined, aiConfiguration);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <FormDialog title={copy.createProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}><label>{copy.profileName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><p>{copy.aiDefaultsLead}</p>{providers.length ? <><label><span>{copy.profileCredential}</span><select value={providerConfigId} onChange={(event) => { setProviderConfigId(event.target.value); setViewerModelId(""); setReasoning(""); setTemperature(""); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label><span>{copy.defaultViewerModel}</span><select value={viewerModelId} onChange={(event) => selectViewer(event.target.value)} disabled={!provider}><option value="">{viewerModels.length ? copy.selectModel : copy.noCachedModels}</option>{viewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label><ViewerProfileControls copy={copy} model={viewerModel} reasoning={reasoning} temperature={temperature} systemPrompt={systemPrompt} onReasoning={setReasoning} onTemperature={setTemperature} onSystemPrompt={setSystemPrompt} /><label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><select value={judgeModelKey} onChange={(event) => setJudgeModelKey(event.target.value)}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`create-judge-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label><label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><select value={monitorModelKey} onChange={(event) => setMonitorModelKey(event.target.value)}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`create-monitor-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label></> : <small>{copy.configureProviderFirst}</small>}</fieldset>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving || !provider || !viewerModel}>{saving ? copy.saving : copy.create}</button></div></form></FormDialog>;
}

function EditProfileDialog({ copy, profile, providers, models, onCancel, onSave }: { copy: ReturnType<typeof getCopy>; profile: Profile; providers: ProviderConfig[]; models: ProviderModel[]; onCancel: () => void; onSave: (name: string, humanName: string | undefined, note?: string, aiConfiguration?: ProfileAiConfigurationInput) => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [humanName, setHumanName] = useState(profile.humanName ?? "");
  const [note, setNote] = useState(profile.note ?? "");
  const currentProvider = providers.find((provider) => provider.credentialId === profile.credentialId) ?? null;
  const [providerConfigId, setProviderConfigId] = useState(currentProvider?.id ?? "");
  const [viewerModelId, setViewerModelId] = useState(profile.defaultViewerModelId ?? "");
  const [reasoning, setReasoning] = useState<"" | ReasoningEffort>(profile.defaultViewerReasoningEffort ?? "");
  const [temperature, setTemperature] = useState(profile.defaultViewerTemperature === undefined ? "" : String(profile.defaultViewerTemperature));
  const interfaceLanguage: InterfaceLanguage = copy.home === "Home" ? "en" : "pl";
  const [systemPrompt, setSystemPrompt] = useState(localizedViewerEditablePrompt(profile.defaultViewerSystemPrompt, interfaceLanguage));
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
    setSystemPrompt(localizedViewerEditablePrompt(profile.defaultViewerSystemPrompt, interfaceLanguage));
    setMonitorModelKey(resolveRoleDefault(profile, "monitor", models));
    setJudgeModelKey(resolveRoleDefault(profile, "judge", models));
  }, [aiTouched, interfaceLanguage, models, profile, providers]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (aiTouched && (!provider || !validViewerModelId)) { setError(copy.selectViewerBeforeSaving); return; }
    setSaving(true); setError(null);
    try {
      const aiConfiguration = aiTouched ? { ...buildProfileAiConfiguration(copy, provider, viewerModel, reasoning, temperature, systemPrompt, monitorModelKey, judgeModelKey), defaultMonitorSystemPrompt: localizedMonitorEditablePrompt(profile.defaultMonitorSystemPrompt, interfaceLanguage) } : undefined;
      await onSave(name, humanName || undefined, note, aiConfiguration);
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
  return <FormDialog title={copy.editProfile} onCancel={onCancel} modalClassName="profile-edit-modal"><form className="profile-edit-form" onSubmit={(event) => void submit(event)}><div className="identity-name-grid"><label>{copy.aiIsBeName}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="AI IS-BE" /></label><label>{copy.humanIsBeName}<input value={humanName} onChange={(event) => setHumanName(event.target.value)} placeholder="Human IS-BE" /></label></div><small className="form-hint">{copy.identityNamesLead}</small><label>{copy.profileNote}<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><fieldset className="profile-edit-ai"><legend>{copy.profileAiDefaults}</legend><p>{copy.aiDefaultsLead}</p>{providers.length ? <><label><span>{copy.profileCredential}</span><select value={providerConfigId} onChange={(event) => { setProviderConfigId(event.target.value); setViewerModelId(""); setReasoning(""); setTemperature(""); setAiTouched(true); }}><option value="">{copy.selectProviderConnection}</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.credentialHint ?? "••••••••"}</option>)}</select></label><label><span>{copy.defaultViewerModel}</span><select value={validViewerModelId} onChange={(event) => selectViewer(event.target.value)} disabled={!provider}><option value="">{viewerModels.length ? copy.selectModel : copy.noCachedModels}</option>{viewerModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.favorite ? "★ " : model.recommended ? "✦ " : ""}{model.displayName}</option>)}</select></label><ViewerProfileControls copy={copy} model={viewerModel} reasoning={reasoning} temperature={temperature} systemPrompt={systemPrompt} onReasoning={(value) => { setReasoning(value); setAiTouched(true); }} onTemperature={(value) => { setTemperature(value); setAiTouched(true); }} onSystemPrompt={(value) => { setSystemPrompt(value); setAiTouched(true); }} /><label><span>{copy.defaultJudgeModel}<small>{copy.optional}</small></span><select value={judgeModelKey} onChange={(event) => { setJudgeModelKey(event.target.value); setAiTouched(true); }}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`edit-judge-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label><label><span>{copy.defaultMonitorModel}<small>{copy.optional}</small></span><select value={monitorModelKey} onChange={(event) => { setMonitorModelKey(event.target.value); setAiTouched(true); }}><option value="">{copy.skipForNow}</option>{roleModels.map((model) => { const owner = providers.find((item) => item.id === model.providerConfigId); return <option key={`edit-monitor-${modelRouteKey(model.providerConfigId, model.modelId)}`} value={modelRouteKey(model.providerConfigId, model.modelId)}>{owner?.label ?? model.provider} · {model.displayName}</option>; })}</select></label></> : <small>{copy.configureProviderFirst}</small>}</fieldset>{error && <div className="provider-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={saving}>{saving ? copy.saving : copy.saveChanges}</button></div></form></FormDialog>;
}

function CreateWorkspaceDialog({ copy, profile, profiles, onCancel, onCreate }: { copy: ReturnType<typeof getCopy>; profile: Profile | null; profiles: Profile[]; onCancel: () => void; onCreate: (profileId: string, name: string, description?: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState(profile?.id ?? profiles[0]?.id ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); if (profileId && name.trim()) void onCreate(profileId, name, description); };
  return <FormDialog title={`${copy.createWorkspace}${profile ? ` · ${aiIsBeDisplayName(profile)}` : ""}`} onCancel={onCancel}><form onSubmit={submit}>{!profile && profiles.length > 1 && <label>{copy.home === "Home" ? "Profile" : "Profil"}<select autoFocus value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{aiIsBeDisplayName(item)}</option>)}</select></label>}<label>{copy.workspaceName}<input autoFocus={Boolean(profile) || profiles.length <= 1} value={name} onChange={(event) => setName(event.target.value)} /></label><label>{copy.workspaceDescription}<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button><button className="primary-button" disabled={!profileId || !name.trim()}>{copy.create}</button></div></form></FormDialog>;
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

function formatMonitorRationale(value: string): string {
  try {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(value), null, 2)}\n\`\`\``;
  } catch {
    return value;
  }
}

function reasoningOptionLabel(copy: ReturnType<typeof getCopy>, option: ReasoningOption): string {
  return option.verification === "unverified" ? `${option.label} · ${copy.unverified}` : option.label;
}

function reasoningCapabilityLead(copy: ReturnType<typeof getCopy>, model: ProviderModel): string {
  const choices = reasoningOptions(model.capabilities.reasoning);
  if (model.capabilities.reasoning.registryStatus === "known" && !choices.length) return copy.reasoningAutoOnly;
  if (model.capabilities.reasoning.mandatory) return copy.reasoningMandatory;
  return model.capabilities.reasoning.registryStatus === "known" ? copy.reasoningVerifiedRegistry : copy.reasoningProviderFallback;
}
