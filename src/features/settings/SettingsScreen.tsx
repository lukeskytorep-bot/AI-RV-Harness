import {
  Archive,
  BookOpen,
  BrainCircuit,
  Check,
  CircleStop,
  Crosshair,
  Database,
  Download,
  FileCheck2,
  Languages,
  MessageCircle,
  Moon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { listBuiltinDocuments, readBuiltinDocument, saveBuiltinDocument, type BuiltinDocumentManifest } from "../../attachments/native";
import { ProviderSettings } from "../../components/ProviderSettings";
import { useAppDialogs } from "../../components/AppDialogProvider";
import { ProtocolDialog } from "../../components/ProtocolDialog";
import { getCopy } from "../../i18n";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { clearProviderDebug, detailedProviderDiagnosticsEnabled, listProviderDebug, setDetailedProviderDiagnostics } from "../../providers/debug";
import { PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER } from "../../providers/service";
import { getFullRcp, getRvLite, getTelepathicProtocol, type ProtocolResource, type RvLiteProtocolResource, type TelepathicProtocolResource } from "../../resources/protocolRegistry";
import { getFactoryPromptResources, type FactoryPromptResource } from "../../resources/systemPrompts";
import { isTauriRuntime } from "../../storage";
import { createPortableStorageBackup, restorePortableStorageBackup } from "../../storage/maintenance";
import { chooseDirectory, openDataFolder, saveTextFile } from "../../storage/native";
import type { AppRepository } from "../../storage/repository";
import type { DeletionPreview, PurgeEntityKind } from "../../storage/controlledPurge";
import { userTargetKind } from "../../targets/service";
import type { AppSettings, ChatThread, InterfaceLanguage, Profile, SessionLanguageSetting, Theme, Workspace } from "../../types";
import type { RvSession } from "../../sessions/types";
import type { TrainingRunRecord } from "../../training/types";
import type { ResearchProjectRecord } from "../../research/types";
import type { TargetRecord } from "../../targets/types";
import { APP_VERSION } from "../../version";
import { CreditsCard } from "./CreditsCard";

export interface SettingsScreenProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  workspaces: Workspace[];
  repository: AppRepository | null;
  onDataChanged: () => Promise<void>;
  onChange: (settings: Partial<AppSettings>) => void;
}

export function SettingsScreen({ copy, settings, workspaces, repository, onDataChanged, onChange }: SettingsScreenProps) {
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
        {tab === "storage" && <StorageSettingsCard copy={copy} workspaces={workspaces} repository={repository} onDataChanged={onDataChanged} />}
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

export function AboutProtocolsCard({ copy, onOpen, onOpenPrompt }: { copy: ReturnType<typeof getCopy>; onOpen: (resource: ProtocolResource | RvLiteProtocolResource | TelepathicProtocolResource) => void; onOpenPrompt: (resource: FactoryPromptResource) => void }) {
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
  const promptCards = ([
    { id: "ai-viewer-system-prompt", name: "AI Viewer System Prompt" },
    { id: "ai-monitor-system-prompt", name: "AI Monitor System Prompt" },
    { id: "ai-rv-harness-blind-judge", name: "AI Judge System Prompt" },
  ] as const).map(({ id, name }) => ({ id, name, pl: prompts.find((item) => item.id === id && item.language === "pl")!, en: prompts.find((item) => item.id === id && item.language === "en")! }));
  return <div className="about-settings-grid">
    <section className="panel about-protocol-card"><PanelHeader title={copy.protocolLibrary} icon={<FileCheck2 size={18} />} /><div className="about-card-body"><p>{copy.protocolLibraryLead}</p><div className="about-protocol-list">{protocolCards.map((protocol) => <article key={protocol.id}><span className="resource-orb"><FileCheck2 size={18} /></span><div><small>{copy.readOnly} · CC BY 4.0</small><strong>{protocol.name}</strong><code>v{protocol.version}</code></div><div className="about-protocol-actions"><button className="secondary-button" onClick={() => onOpen(protocol.pl)}>{copy.readPolish}</button><button className="secondary-button" onClick={() => onOpen(protocol.en)}>{copy.readEnglish}</button></div></article>)}{promptCards.map((prompt) => <article key={prompt.id}><span className="resource-orb"><BrainCircuit size={18} /></span><div><small>{copy.readOnly} · CC BY 4.0</small><strong>{prompt.name}</strong><code>v{prompt.pl.version}</code></div><div className="about-protocol-actions"><button className="secondary-button" onClick={() => onOpenPrompt(prompt.pl)}>{copy.readPolish}</button><button className="secondary-button" onClick={() => onOpenPrompt(prompt.en)}>{copy.readEnglish}</button></div></article>)}{documents.map((document) => <article key={document.id}><span className="resource-orb"><BookOpen size={18} /></span><div><small>DOCX · {document.language.toUpperCase()} · SHA-256</small><strong>{document.title}</strong><code>{document.sha256.slice(0, 16)}…</code></div><div className="about-protocol-actions"><button className="secondary-button" disabled={documentBusy} onClick={() => void readDocument(document)}>{copy.home === "Home" ? "Read" : "Czytaj"}</button><button className="secondary-button" disabled={documentBusy} onClick={() => void saveDocument(document)}><Download size={13} />{copy.home === "Home" ? "Save DOCX" : "Zapisz DOCX"}</button></div></article>)}</div>{documentMessage && <div className="storage-success"><Check size={14} />{documentMessage}</div>}{documentError && <div className="provider-error">{documentError}</div>}<div className="content-license-notice"><ShieldCheck size={16} /><div><strong>{copy.home === "Home" ? "Two-license model" : "Model dwóch licencji"}</strong><p>{copy.home === "Home" ? "Source code is licensed under the MIT License. Documentation, bundled prompts, training content, and other non-code visual assets are licensed under CC BY 4.0." : "Kod źródłowy jest objęty licencją MIT. Dokumentacja, dołączone prompty, materiały treningowe i inne niekodowe zasoby wizualne są objęte licencją CC BY 4.0."}</p></div></div></div></section>
    <CreditsCard copy={copy} />
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
  const dialogs = useAppDialogs();
  const [modelCount, setModelCount] = useState(0);
  const [capabilitySummary, setCapabilitySummary] = useState({ vision: 0, reasoning: 0, compatibility: 0 });
  const [debugEntries, setDebugEntries] = useState(() => listProviderDebug());
  const [detailedDiagnostics, setDetailedDiagnostics] = useState(() => detailedProviderDiagnosticsEnabled());
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => { if (repository) void repository.listProviderModels().then((models) => { setModelCount(models.length); setCapabilitySummary({ vision: models.filter((model) => model.capabilities.supportsVision).length, reasoning: models.filter((model) => model.capabilities.reasoning.supported).length, compatibility: models.filter((model) => model.capabilities.source === "compatibility").length }); }); };
  useEffect(refresh, [repository]);
  const reset = async () => {
    if (!repository) return;
    const confirmed = await dialogs.confirm({ title: copy.dialogWarningTitle, description: copy.resetCapabilityCacheConfirm, confirmLabel: copy.dialogConfirm, cancelLabel: copy.cancel, severity: "warning" });
    if (!confirmed) return;
    await repository.clearProviderModelCache();
    setModelCount(0); setCapabilitySummary({ vision: 0, reasoning: 0, compatibility: 0 }); setMessage(copy.resetCapabilityCache);
  };
  const clearDebug = () => { clearProviderDebug(); setDebugEntries([]); };
  const toggleDetailedDiagnostics = async () => {
    const next = !detailedDiagnostics;
    if (next) {
      const confirmed = await dialogs.confirm({
        title: copy.dialogWarningTitle,
        description: copy.home === "Home" ? "Detailed diagnostics can temporarily keep redacted request and response bodies in memory. They may still contain sensitive conversation text. Enable only while troubleshooting." : "Szczegółowa diagnostyka może tymczasowo przechowywać w pamięci zanonimizowane treści żądań i odpowiedzi. Nadal mogą one zawierać poufny tekst rozmowy. Włączaj ją tylko na czas diagnozy.",
        confirmLabel: copy.dialogContinue,
        cancelLabel: copy.cancel,
        severity: "warning",
      });
      if (!confirmed) return;
    }
    setDetailedProviderDiagnostics(next);
    setDetailedDiagnostics(next);
  };
  return <section className="panel advanced-settings-card"><PanelHeader title={copy.advanced} icon={<Settings2 size={18} />} /><div className="advanced-settings-body"><div className="advanced-version"><span><small>{copy.appVersion}</small><strong>v{APP_VERSION}</strong></span><span><small>{copy.cachedModelCount}</small><strong>{modelCount}</strong></span><span><small>{copy.visionRoutes}</small><strong>{capabilitySummary.vision}</strong></span><span><small>{copy.reasoningRoutes}</small><strong>{capabilitySummary.reasoning}</strong></span><span><small>{copy.compatibilityRoutes}</small><strong>{capabilitySummary.compatibility}</strong></span></div><p>{copy.debugSecurity}</p><label className="detailed-diagnostics-toggle"><input type="checkbox" checked={detailedDiagnostics} onChange={() => void toggleDetailedDiagnostics()} /><span><strong>{copy.home === "Home" ? "Detailed request/response diagnostics" : "Szczegółowa diagnostyka żądań i odpowiedzi"}</strong><small>{copy.home === "Home" ? "Off by default and held only in volatile memory." : "Domyślnie wyłączona; dane są przechowywane wyłącznie w pamięci ulotnej."}</small></span></label><button className="secondary-button" disabled={!repository || !modelCount} onClick={() => void reset()}>{copy.resetCapabilityCache}</button>{message && <div className="storage-success"><Check size={14} />{message}</div>}<div className="debug-log-heading"><div><strong>{copy.apiDebugLog}</strong><small>{copy.debugVolatile}</small></div><span><button className="secondary-button" type="button" onClick={() => setDebugEntries(listProviderDebug())}>{copy.refreshDebugLog}</button><button className="secondary-button" type="button" disabled={!debugEntries.length} onClick={clearDebug}>{copy.clearDebugLog}</button></span></div><div className="debug-log-list">{debugEntries.length === 0 ? <p>{copy.noDebugCalls}</p> : debugEntries.map((entry) => <details key={entry.id}><summary><span className={`debug-status ${entry.status}`}>{entry.status.toUpperCase()}</span><strong>{entry.provider} · {entry.modelId}</strong><small>{new Date(entry.capturedAt).toLocaleString()}</small></summary><div className="debug-payload">{entry.endpoint && <code>{entry.endpoint}</code>}{entry.usage && <code>tokens: {entry.usage.inputTokens ?? "?"} + {entry.usage.outputTokens ?? "?"}</code>}{entry.error && <pre>{entry.error}</pre>}{entry.request !== undefined && <><h4>{copy.rawRequest}</h4><pre>{JSON.stringify(entry.request, null, 2)}</pre></>}{entry.response !== undefined && <><h4>{copy.rawResponse}</h4><pre>{JSON.stringify(entry.response, null, 2)}</pre></>}</div></details>)}</div></div></section>;
}

function StorageSettingsCard({ copy, workspaces, repository, onDataChanged }: { copy: ReturnType<typeof getCopy>; workspaces: Workspace[]; repository: AppRepository | null; onDataChanged: () => Promise<void> }) {
  const dialogs = useAppDialogs();
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState({ routes: 0, approxBytes: 0 });
  const [archivedProfiles, setArchivedProfiles] = useState<Profile[]>([]);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<Workspace[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<ChatThread[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<RvSession[]>([]);
  const [archivedTrainingRuns, setArchivedTrainingRuns] = useState<TrainingRunRecord[]>([]);
  const [archivedResearchProjects, setArchivedResearchProjects] = useState<ResearchProjectRecord[]>([]);
  const [archivedTargets, setArchivedTargets] = useState<TargetRecord[]>([]);
  const pl = copy.home !== "Home";

  const refresh = async () => {
    if (!repository) return;
    const [cachedModels, profileRows, workspaceRows, threadRows, sessionRows, trainingRows, researchRows, targetRows] = await Promise.all([
      repository.listProviderModels(),
      repository.listArchivedProfiles(),
      repository.listArchivedWorkspaces(),
      repository.listArchivedChatThreads(),
      repository.listArchivedRvSessions(),
      repository.listArchivedTrainingRuns(),
      repository.listArchivedResearchProjects(),
      repository.listArchivedTargets(),
    ]);
    setCacheInfo({ routes: cachedModels.length, approxBytes: new TextEncoder().encode(JSON.stringify(cachedModels)).byteLength });
    setArchivedProfiles(profileRows);
    setArchivedWorkspaces(workspaceRows);
    setArchivedThreads(threadRows);
    setArchivedSessions(sessionRows);
    setArchivedTrainingRuns(trainingRows);
    setArchivedResearchProjects(researchRows);
    setArchivedTargets(targetRows);
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
    const confirmed = await dialogs.confirm({ title: copy.restoreBackup, description: copy.restoreConfirm, details: [directory], confirmLabel: copy.dialogContinue, cancelLabel: copy.cancel, severity: "destructive" });
    if (!confirmed) return;
    setBusy("restore"); setError(null); setMessage(null);
    try {
      await restorePortableStorageBackup(repository, directory);
      window.location.reload();
    } catch (cause) {
      await dialogs.information({ title: copy.restoreFailed, description: cause instanceof Error ? cause.message : String(cause), confirmLabel: copy.dialogOk, severity: "warning" });
      window.location.reload();
    }
  };

  const recover = async (action: () => Promise<void>) => {
    setError(null);
    try { await action(); await onDataChanged(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const restoreWorkspace = async (workspace: Workspace) => {
    if (!repository) return;
    setError(null);
    try { await repository.restoreWorkspace(workspace.id); await onDataChanged(); await refresh(); }
    catch (cause) {
      const replacement = (await dialogs.prompt({
        title: copy.dialogRename,
        description: copy.home === "Home" ? `The original name may conflict with an active Workspace. Enter a new name for “${workspace.name}”.` : `Pierwotna nazwa może kolidować z aktywnym Workspace. Podaj nową nazwę dla „${workspace.name}”.`,
        initialValue: `${workspace.name} (restored)`,
        inputLabel: copy.workspaceName,
        inputRequired: true,
        confirmLabel: copy.dialogContinue,
        cancelLabel: copy.cancel,
      }))?.trim();
      if (!replacement) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
      await recover(() => repository.restoreWorkspace(workspace.id, replacement));
    }
  };

  const executePurge = async (kind: PurgeEntityKind, id: string) => {
    if (!repository) return;
    if (kind === "profile") await repository.purgeProfile(id);
    else if (kind === "workspace") await repository.purgeWorkspace(id);
    else if (kind === "conversation") await repository.purgeChatThread(id);
    else if (kind === "rv_session") await repository.purgeRvSession(id);
    else if (kind === "training") await repository.purgeTrainingRun(id);
    else if (kind === "research") await repository.purgeResearchProject(id);
    else await repository.purgeTarget(id);
  };

  const permanentDelete = async (kind: PurgeEntityKind, id: string) => {
    if (!repository || purgingId) return;
    setError(null); setMessage(null);
    try {
      const preview = await repository.previewPermanentDelete(kind, id);
      if (preview.blockedReason) {
        await dialogs.information({ title: pl ? "Nie można usunąć trwale" : "Cannot delete permanently", description: preview.blockedReason, confirmLabel: copy.dialogOk, severity: "warning" });
        return;
      }
      if (!preview.archived) throw new Error(pl ? "Trwałe usuwanie jest dostępne wyłącznie dla zarchiwizowanych rekordów." : "Permanent Delete is available only for archived records.");

      if (preview.safetyBackupRecommended && isTauriRuntime()) {
        const backupFirst = await dialogs.confirm({
          title: pl ? "Kopia bezpieczeństwa przed usunięciem" : "Safety backup before deletion",
          description: pl ? "Dla tego dużego pakietu zalecana jest kopia całej bazy. Możesz ją utworzyć teraz albo kontynuować bez niej." : "A full database backup is recommended for this large package. You can create it now or continue without one.",
          details: [pl ? "Anulowanie tego okna oznacza: kontynuuj bez kopii." : "Canceling this prompt means: continue without a backup."],
          confirmLabel: pl ? "Utwórz kopię" : "Create backup",
          cancelLabel: pl ? "Bez kopii" : "Without backup",
          severity: "warning",
        });
        if (backupFirst) {
          const destination = await chooseDirectory(copy.backupChooseFolder);
          if (!destination) return;
          setBusy("backup");
          try {
            const created = await createPortableStorageBackup(repository, destination);
            setMessage(`${copy.backupComplete} · ${created.directory}`);
          } finally { setBusy(null); }
        }
      }

      const confirmed = await dialogs.confirm({
        title: pl ? `Usunąć trwale: ${preview.label}?` : `Delete permanently: ${preview.label}?`,
        description: pl ? "Deletion Preview: poniższe dane zostaną fizycznie usunięte i nie będzie można ich przywrócić." : "Deletion Preview: the data below will be physically deleted and cannot be restored.",
        details: deletionPreviewDetails(preview, pl),
        confirmLabel: pl ? "Usuń trwale" : "Delete permanently",
        cancelLabel: copy.cancel,
        busyLabel: pl ? "Usuwanie…" : "Deleting…",
        severity: "destructive",
        ...(preview.requiresPhrase ? { requiredPhrase: preview.requiresPhrase, requiredPhraseLabel: pl ? `Wpisz ${preview.requiresPhrase}, aby potwierdzić` : `Type ${preview.requiresPhrase} to confirm` } : {}),
        action: async () => {
          setPurgingId(id);
          try { await executePurge(kind, id); }
          finally { setPurgingId(null); }
        },
      });
      if (!confirmed) return;
      await onDataChanged();
      await refresh();
      setMessage(pl ? "Rekord został trwale usunięty." : "The record was permanently deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPurgingId(null); }
  };

  const allWorkspaceNames = new Map([...workspaces, ...archivedWorkspaces].map((item) => [item.id, item.name]));
  const archivedWorkspaceIds = new Set(archivedWorkspaces.map((item) => item.id));
  const archivedProfileIds = new Set(archivedProfiles.map((item) => item.id));
  const parentBlocked = (workspaceId: string, profileId?: string) => archivedWorkspaceIds.has(workspaceId) || Boolean(profileId && archivedProfileIds.has(profileId));
  const archiveCount = archivedProfiles.length + archivedWorkspaces.length + archivedThreads.length + archivedSessions.length + archivedTrainingRuns.length + archivedResearchProjects.length + archivedTargets.length;
  const restoreLabel = pl ? "Przywróć" : "Restore";
  const parentTitle = pl ? "Najpierw przywróć nadrzędny Profil i Workspace." : "Restore the parent Profile and Workspace first.";

  const archiveActions = (kind: PurgeEntityKind, id: string, restoreAction: () => Promise<void>, restoreDisabled = false, restoreTitle?: string) => <span className="archive-row-actions">
    <button className="secondary-button" disabled={restoreDisabled || purgingId === id} title={restoreTitle} onClick={() => void recover(restoreAction)}>{restoreLabel}</button>
    <button className="danger-button" disabled={purgingId === id || Boolean(busy)} onClick={() => void permanentDelete(kind, id)}><Trash2 size={14} />{pl ? "Usuń trwale" : "Delete permanently"}</button>
  </span>;

  const archiveList = <div className="archive-recovery">
    <div className="storage-backup-explainer"><Archive size={18} /><div><strong>{pl ? "Archiwum i odzyskiwanie" : "Archive and recovery"}</strong><p>{pl ? "Zarchiwizowane dane można przywrócić albo, po sprawdzeniu Deletion Preview, usunąć trwale. Permanent Delete nie jest dostępny z aktywnych widoków." : "Archived data can be restored or, after reviewing a Deletion Preview, deleted permanently. Permanent Delete is not available from active views."}</p></div></div>
    {archiveCount === 0 ? <p className="muted">{pl ? "Archiwum jest puste." : "The archive is empty."}</p> : <div className="archive-groups">
      {archivedProfiles.length > 0 && <details open><summary>{pl ? "Profile" : "Profiles"} · {archivedProfiles.length}</summary>{archivedProfiles.map((profile) => <div className="archive-row" key={profile.id}><span><strong>{aiIsBeDisplayName(profile)}</strong><small>{profile.archivedAt ? new Date(profile.archivedAt).toLocaleString() : ""}</small></span>{archiveActions("profile", profile.id, () => repository!.restoreProfile(profile.id))}</div>)}</details>}
      {archivedWorkspaces.length > 0 && <details open><summary>Workspace · {archivedWorkspaces.length}</summary>{archivedWorkspaces.map((workspace) => <div className="archive-row" key={workspace.id}><span><strong>{workspace.name}</strong><small>{workspace.archivedAt ? new Date(workspace.archivedAt).toLocaleString() : ""}</small></span><span className="archive-row-actions"><button className="secondary-button" disabled={archivedProfileIds.has(workspace.profileId) || purgingId === workspace.id} title={archivedProfileIds.has(workspace.profileId) ? parentTitle : undefined} onClick={() => void restoreWorkspace(workspace)}>{restoreLabel}</button><button className="danger-button" disabled={purgingId === workspace.id || Boolean(busy)} onClick={() => void permanentDelete("workspace", workspace.id)}><Trash2 size={14} />{pl ? "Usuń trwale" : "Delete permanently"}</button></span></div>)}</details>}
      {archivedThreads.length > 0 && <details open><summary>{pl ? "Rozmowy / Manual RV" : "Conversations / Manual RV"} · {archivedThreads.length}</summary>{archivedThreads.map((thread) => <div className="archive-row" key={thread.id}><span><strong>{thread.title}</strong><small>{thread.mode === "manual_rv" ? "Manual RV" : (pl ? "Rozmowa" : "Conversation")} · {allWorkspaceNames.get(thread.workspaceId) ?? thread.workspaceId}</small></span>{archiveActions("conversation", thread.id, () => repository!.restoreChatThread(thread.id), archivedWorkspaceIds.has(thread.workspaceId), archivedWorkspaceIds.has(thread.workspaceId) ? parentTitle : undefined)}</div>)}</details>}
      {archivedSessions.length > 0 && <details open><summary>{pl ? "Sesje RV" : "RV Sessions"} · {archivedSessions.length}</summary>{archivedSessions.map((session) => <div className="archive-row" key={session.id}><span><strong>{session.sessionCode}</strong><small>{session.state} · {allWorkspaceNames.get(session.workspaceId) ?? session.workspaceId}</small></span>{archiveActions("rv_session", session.id, () => repository!.restoreRvSession(session.id), parentBlocked(session.workspaceId, session.profileId), parentBlocked(session.workspaceId, session.profileId) ? parentTitle : undefined)}</div>)}</details>}
      {archivedTrainingRuns.length > 0 && <details open><summary>Training · {archivedTrainingRuns.length}</summary>{archivedTrainingRuns.map((run) => <div className="archive-row" key={run.id}><span><strong>#{run.runNumber} · {run.name}</strong><small>{run.status} · {run.sessionIds.length} {pl ? "sesji" : "sessions"} · {allWorkspaceNames.get(run.workspaceId) ?? run.workspaceId}</small></span>{archiveActions("training", run.id, () => repository!.restoreTrainingRun(run.id), parentBlocked(run.workspaceId, run.profileId), parentBlocked(run.workspaceId, run.profileId) ? parentTitle : undefined)}</div>)}</details>}
      {archivedResearchProjects.length > 0 && <details open><summary>Research · {archivedResearchProjects.length}</summary>{archivedResearchProjects.map((project) => <div className="archive-row" key={project.id}><span><strong>{project.name}</strong><small>{project.state} · {allWorkspaceNames.get(project.workspaceId) ?? project.workspaceId}</small></span>{archiveActions("research", project.id, () => repository!.restoreResearchProject(project.id), archivedWorkspaceIds.has(project.workspaceId), archivedWorkspaceIds.has(project.workspaceId) ? parentTitle : undefined)}</div>)}</details>}
      {archivedTargets.length > 0 && <details open><summary>{pl ? "Moje cele" : "My Targets"} · {archivedTargets.length}</summary>{archivedTargets.map((target) => <div className="archive-row" key={target.id}><span><strong>{target.title}</strong><small>{userTargetKind(target) === "telepathic" ? (pl ? "Telepatyczny" : "Telepathic") : (pl ? "Ogólny" : "General")} · {target.archivedAt ? new Date(target.archivedAt).toLocaleString() : ""}</small></span>{archiveActions("target", target.id, () => repository!.restoreTarget(target.id))}</div>)}</details>}
    </div>}
  </div>;

  return <section className="panel storage-settings-card"><PanelHeader title={copy.storage} icon={<Database size={18} />} /><div className="storage-settings-body">{isTauriRuntime() ? <><p>{copy.backupSecurity}</p><div className="storage-backup-explainer"><ShieldCheck size={18} /><div><strong>{copy.portableBackup}</strong><p>{copy.portableBackupLead}</p></div></div><div className="storage-cache-info"><span><small>{copy.capabilityCacheStorage}</small><strong>{formatBytes(cacheInfo.approxBytes)} · {cacheInfo.routes} {copy.cachedModelCount.toLowerCase()}</strong></span><span><small>{copy.cacheRouteLimit}</small><strong>{PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER.toLocaleString()} / provider</strong></span></div><div className="storage-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => void openDataFolder().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>{copy.openDataFolder}</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => void backup()}>{busy === "backup" ? copy.backingUp : copy.createBackup}</button><button className="danger-button restore-button" disabled={Boolean(busy)} onClick={() => void restore()}>{busy === "restore" ? copy.restoring : copy.restoreBackup}</button></div><div className="restore-warning"><CircleStop size={17} /><p>{copy.restoreDataWarning}</p></div></> : <div className="settings-info storage-runtime-info"><p>{copy.storageDesktop}</p></div>}{archiveList}{message && <div className="storage-success"><Check size={14} />{message}</div>}{error && <div className="provider-error">{error}</div>}</div></section>;
}

function SessionSettingsCard({ copy, settings, onChange }: { copy: ReturnType<typeof getCopy>; settings: AppSettings; onChange: (settings: Partial<AppSettings>) => void }) {
  return <section className="panel session-settings-card"><PanelHeader title={copy.sessions} icon={<CircleStop size={18} />} /><div className="session-settings-body"><label><span>{copy.sessionLanguage}</span><select value={settings.sessionLanguage} onChange={(event) => onChange({ sessionLanguage: event.target.value as SessionLanguageSetting })}><option value="same">{copy.sameAsInterface}</option><option value="pl">Polski</option><option value="en">English</option></select></label><label><span>{copy.requestTimeout}</span><div><input type="number" min={1} max={600} value={Math.round(settings.requestTimeoutMs / 1000)} onChange={(event) => onChange({ requestTimeoutMs: Math.max(1, Math.min(600, Number(event.target.value) || 120)) * 1000 })} /><small>s</small></div></label><label><span>{copy.retryPolicy}</span><select value={settings.maxRetries} onChange={(event) => onChange({ maxRetries: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label><span>{copy.defaultMaxOutput}</span><input type="number" min={1} max={262144} value={settings.defaultMaxOutputTokens} onChange={(event) => onChange({ defaultMaxOutputTokens: Math.max(1, Number(event.target.value) || 8192) })} /></label><label><span>{copy.hardSessionCostLimit}</span><div><input type="number" min={0} step="0.01" value={settings.maxSessionCostUsd} onChange={(event) => onChange({ maxSessionCostUsd: Math.max(0, Number(event.target.value) || 0) })} /><small>USD · {settings.maxSessionCostUsd > 0 ? copy.enabled : copy.disabled}</small></div></label><label><span>{copy.defaultReveal}</span><select value={settings.defaultRevealSource} onChange={(event) => onChange({ defaultRevealSource: event.target.value as AppSettings["defaultRevealSource"] })}><option value="external">{copy.externalBlind}</option><option value="automatic">{copy.automaticTarget}</option></select></label><div className="mandatory-autosave"><ShieldCheck size={16} /><div><strong>{copy.mandatoryAutosave}</strong><p>{copy.sessionRules}</p></div></div></div></section>;
}

function PromptResourceDialog({ copy, resource, onClose }: { copy: ReturnType<typeof getCopy>; resource: FactoryPromptResource; onClose: () => void }) {
  const name = resource.id === "ai-viewer-system-prompt"
    ? "AI Viewer System Prompt"
    : resource.id === "ai-monitor-system-prompt"
      ? "AI Monitor System Prompt"
      : "AI Judge System Prompt";
  const save = () => void saveTextFile(copy.home === "Home" ? "Save prompt resource" : "Zapisz zasób promptu", `${resource.id}_v${resource.version}_${resource.language}.md`, resource.content);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal protocol-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><small>{copy.protocolResource}</small><h2>{name}</h2><p>v{resource.version} · {resource.language.toUpperCase()} · {resource.license}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="hash-grid"><code>Factory resource<br />{resource.id}</code><code>License<br />CC BY 4.0</code></div><pre className="protocol-text">{resource.content}</pre><div className="modal-actions"><button className="secondary-button" onClick={save}><Download size={14} />{copy.home === "Home" ? "Save" : "Zapisz"}</button><button className="primary-button" onClick={onClose}>{copy.close}</button></div></section></div>;
}


function SettingRow({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <div className="setting-row"><span className="setting-label">{icon}<strong>{label}</strong></span>{children}</div>;
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></header>;
}

function PanelHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-header"><span>{icon}</span><h2>{title}</h2></div>;
}


function deletionPreviewDetails(preview: DeletionPreview, pl: boolean): string[] {
  const labels: Array<[keyof DeletionPreview["counts"], string, string]> = [
    ["profiles", "Profile", "Profiles"], ["workspaces", "Workspace", "Workspaces"], ["conversations", "Rozmowy / Manual RV", "Conversations / Manual RV"],
    ["messages", "Wiadomości", "Messages"], ["rvSessions", "Sesje RV", "RV Sessions"], ["sessionEvents", "Zdarzenia sesji", "Session events"],
    ["snapshots", "Snapshoty", "Snapshots"], ["reveals", "Reveal", "Reveals"], ["targetClarifications", "Doprecyzowania celu", "Target clarifications"],
    ["monitorRuns", "Monitor runs", "Monitor runs"], ["monitorInterventions", "Interwencje Monitora", "Monitor interventions"], ["judgeRuns", "Judge runs", "Judge runs"],
    ["judgeScores", "Frozen Judge scores", "Frozen Judge scores"], ["trainingRuns", "Training Runs", "Training Runs"], ["researchProjects", "Research projects", "Research projects"],
    ["researchConditions", "Research conditions", "Research conditions"], ["researchAssignments", "Research assignments", "Research assignments"], ["blindingMappings", "Blinding mappings", "Blinding mappings"],
    ["researchResults", "Research results", "Research results"], ["exports", "Eksporty", "Exports"], ["workspaceSources", "Workspace Sources", "Workspace Sources"],
    ["userTargets", "My Targets", "My Targets"], ["viewerNoteIdentities", "AI identities + Viewer Notes", "AI identities + Viewer Notes"], ["viewerNoteVersions", "Viewer Notes versions", "Viewer Notes versions"],
    ["viewerNoteReflectionRuns", "Viewer Notes reflection runs", "Viewer Notes reflection runs"], ["viewerNoteActivationEvents", "Viewer Notes activation history", "Viewer Notes activation history"],
  ];
  const details = labels.filter(([key]) => preview.counts[key] > 0).map(([key, plLabel, enLabel]) => `${pl ? plLabel : enLabel}: ${preview.counts[key]}`);
  if (preview.viewerNotesPreserved > 0) details.push(pl ? `Viewer Notes zachowane mimo usunięcia źródła: ${preview.viewerNotesPreserved}` : `Viewer Notes preserved after source deletion: ${preview.viewerNotesPreserved}`);
  if (preview.viewerNotesDeleted > 0) details.push(pl ? `Viewer Notes usuwane razem z Profile: ${preview.viewerNotesDeleted}` : `Viewer Notes deleted with the Profile: ${preview.viewerNotesDeleted}`);
  details.push(pl ? "Operacja jest nieodwracalna." : "This action cannot be undone.");
  return details;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
