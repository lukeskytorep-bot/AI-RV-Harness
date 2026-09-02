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
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { listBuiltinDocuments, readBuiltinDocument, saveBuiltinDocument, type BuiltinDocumentManifest } from "../../attachments/native";
import { ProviderSettings } from "../../components/ProviderSettings";
import { ProtocolDialog } from "../../components/ProtocolDialog";
import { getCopy } from "../../i18n";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { clearProviderDebug, detailedProviderDiagnosticsEnabled, listProviderDebug, setDetailedProviderDiagnostics } from "../../providers/debug";
import { PROVIDER_MODEL_CACHE_LIMIT_PER_PROVIDER } from "../../providers/service";
import { getFullRcp, getRvLite, getTelepathicProtocol, type ProtocolResource, type RvLiteProtocolResource, type TelepathicProtocolResource } from "../../resources/protocolRegistry";
import { getFactoryPromptResources, type FactoryPromptResource } from "../../resources/systemPrompts";
import { isTauriRuntime } from "../../storage";
import { createPortableStorageBackup, restorePortableStorageBackup } from "../../storage/maintenance";
import { chooseDirectory, openDataFolder, openProjectUrl, saveTextFile } from "../../storage/native";
import type { AppRepository } from "../../storage/repository";
import { userTargetKind } from "../../targets/service";
import type { AppSettings, ChatThread, ChatThreadGroup, InterfaceLanguage, Profile, SessionLanguageSetting, Theme, Workspace } from "../../types";
import { APP_VERSION } from "../../version";

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

function StorageSettingsCard({ copy, workspaces, repository, onDataChanged }: { copy: ReturnType<typeof getCopy>; workspaces: Workspace[]; repository: AppRepository | null; onDataChanged: () => Promise<void> }) {
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

function PromptResourceDialog({ copy, resource, onClose }: { copy: ReturnType<typeof getCopy>; resource: FactoryPromptResource; onClose: () => void }) {
  const name = resource.id === "ai-viewer-system-prompt" ? "AI Viewer System Prompt" : "AI Monitor System Prompt";
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

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
