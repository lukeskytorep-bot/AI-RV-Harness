import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrainCircuit, Check, Clock3, Database, History, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { AiIdentity, ViewerNoteBundle, ViewerNoteCapacity } from "../aiCenter/types";
import { VIEWER_NOTES_CAPACITIES, currentViewerNotesLabel } from "../aiCenter/viewerNotes";
import { SafeMarkdown } from "./SafeMarkdown";
import type { AppRepository } from "../storage/repository";
import type { AppSettings, Profile, Workspace } from "../types";
import { aiIsBeDisplayName } from "../domain/isBeIdentity";

export type AiCenterView = "overview" | "monitor" | "viewer-notes" | "identities";

export function AiCenterScreen({ settings, profiles, workspaces, activeProfileId, workspaceFilterId, repository, initialView, monitorPanel, onProfileChange }: {
  settings: AppSettings;
  profiles: Profile[];
  workspaces: Workspace[];
  activeProfileId: string | null;
  workspaceFilterId: string | null;
  repository: AppRepository;
  initialView: AiCenterView;
  monitorPanel: ReactNode;
  onProfileChange: (profileId: string) => void;
}) {
  const pl = settings.interfaceLanguage === "pl";
  const [view, setView] = useState<AiCenterView>(initialView);
  const [identities, setIdentities] = useState<AiIdentity[]>([]);
  const [bundles, setBundles] = useState<Record<string, ViewerNoteBundle>>({});
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [monitorRunCount, setMonitorRunCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeProfile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0] ?? null;
  const ownedWorkspaces = workspaces.filter((item) => item.profileId === activeProfile?.id);

  const refresh = async () => {
    if (!activeProfile) { setIdentities([]); setBundles({}); return; }
    const nextIdentities = await repository.listAiIdentities(activeProfile.id);
    const monitorWorkspaces = workspaceFilterId ? ownedWorkspaces.filter((item) => item.id === workspaceFilterId) : ownedWorkspaces;
    const runs = (await Promise.all(monitorWorkspaces.map((workspace) => repository.listMonitorRuns(workspace.id)))).flat();
    const nextBundles = Object.fromEntries((await Promise.all(nextIdentities.filter((item) => item.role === "viewer").map(async (item) => [item.id, await repository.getViewerNoteBundle(item.id)] as const))).filter((entry): entry is readonly [string, ViewerNoteBundle] => Boolean(entry[1])));
    setIdentities(nextIdentities);
    setBundles(nextBundles);
    setMonitorRunCount(runs.length);
    const viewers = nextIdentities.filter((item) => item.role === "viewer");
    setSelectedIdentityId((current) => viewers.some((item) => item.id === current) ? current : viewers[0]?.id ?? null);
  };

  useEffect(() => { setView(initialView); }, [initialView]);
  useEffect(() => { void refresh().catch((cause) => setError(errorText(cause))); }, [activeProfile?.id, repository, workspaceFilterId, workspaces]);

  const filteredIdentities = useMemo(() => identities, [identities]);
  const selectedBundle = selectedIdentityId ? bundles[selectedIdentityId] : undefined;

  const changeCapacity = async (value: ViewerNoteCapacity) => {
    if (!selectedBundle) return;
    if (value > selectedBundle.settings.capacityTokens && !window.confirm(pl
      ? "Zwiększenie pojemności pozwala AI zapisać dłuższe notatki. Późniejsze zmniejszenie będzie możliwe tylko wtedy, gdy aktywna treść zmieści się w niższym limicie. Kontynuować?"
      : "Increasing capacity lets the AI save longer notes. You can reduce it later only if the active content fits the lower limit. Continue?")) return;
    setError(null);
    try { await repository.setViewerNoteCapacity(selectedBundle.identity.id, value); await refresh(); setNotice(pl ? "Pojemność zaktualizowana." : "Capacity updated."); }
    catch (cause) { setError(errorText(cause)); }
  };

  const restore = async (versionId: string) => {
    if (!selectedBundle || versionId === selectedBundle.settings.activeVersionId) return;
    const warning = pl
      ? "Ta wersja została wcześniej utworzona przez to AI, ale jej ponowne aktywowanie jest decyzją człowieka, a nie aktualną decyzją modelu. Co do zasady nie należy zmieniać aktywnych notatek AI bez jego zgody. Użyj tej opcji tylko do odzyskania wcześniejszego stanu albo świadomie zaplanowanego testu. Operacja zostanie zapisana w historii."
      : "This version was previously created by this AI, but reactivating it is a human decision, not the model's current decision. As a rule, active AI notes should not be changed without its consent. Use this only to recover an earlier state or for a deliberate test. The action will be recorded.";
    if (!window.confirm(warning)) return;
    setError(null);
    try { await repository.restoreViewerNoteVersion(selectedBundle.identity.id, versionId, workspaceFilterId ?? undefined); await refresh(); setNotice(pl ? "Przywrócono historyczną wersję." : "Historical version restored."); }
    catch (cause) { setError(errorText(cause)); }
  };

  return <div className="page ai-center-page">
    <header className="page-header ai-center-header"><div><span className="eyebrow"><Sparkles size={14} /> {pl ? "Role, historia i eksperymentalna pamięć AI" : "AI roles, history and experimental memory"}</span><h1>AI Center</h1><p>{pl ? "Narzędzia AI dla aktywnego Profilu, wspólne dla wszystkich jego Workspace’ów." : "AI tools for the active Profile, shared across all of its Workspaces."}</p></div><label><span>{pl ? "Aktywny Profil" : "Active Profile"}</span><select value={activeProfile?.id ?? ""} onChange={(event) => onProfileChange(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{aiIsBeDisplayName(profile)}</option>)}</select></label></header>
    <div className="ai-center-context"><Users size={15} /><span>{activeProfile ? aiIsBeDisplayName(activeProfile) : "—"}</span><small>{workspaceFilterId ? ownedWorkspaces.find((item) => item.id === workspaceFilterId)?.name : (pl ? "Wszystkie Workspace’y Profilu" : "All Profile Workspaces")}</small></div>
    <nav className="module-tabs ai-center-tabs">
      <button className={view === "overview" ? "module-tab active" : "module-tab"} onClick={() => setView("overview")}><Sparkles size={17} />{pl ? "Przegląd" : "Overview"}</button>
      <button className={view === "monitor" ? "module-tab active" : "module-tab"} onClick={() => setView("monitor")}><BrainCircuit size={17} />AI Monitor</button>
      <button className={view === "viewer-notes" ? "module-tab active" : "module-tab"} onClick={() => setView("viewer-notes")}><Database size={17} />Viewer Notes</button>
      <button className={view === "identities" ? "module-tab active" : "module-tab"} onClick={() => setView("identities")}><Users size={17} />AI Identities</button>
    </nav>
    {error && <div className="provider-error">{error}</div>}{notice && <div className="storage-success"><Check size={14} />{notice}</div>}
    {view === "monitor" ? monitorPanel : view === "overview" ? <section className="ai-center-overview">
      <div className="ai-center-cards">
        <AiCard icon={<BrainCircuit size={23} />} title="AI Monitor" status={pl ? "Dostępny" : "Available"} body={pl ? "Istniejący Monitor, jego prompt, runy oraz interwencje." : "The existing Monitor, its prompt, runs and interventions."} meta={`${monitorRunCount} ${pl ? "runów w filtrze" : "runs in filter"}`} action={pl ? "Otwórz AI Monitor" : "Open AI Monitor"} onClick={() => setView("monitor")} />
        <AiCard icon={<Database size={23} />} title="Viewer Notes" status={pl ? "Eksperymentalne" : "Experimental"} body={pl ? "Indywidualna pamięć proceduralna Viewera rozwijana wyłącznie podczas Training." : "Individual Viewer procedural memory developed only during Training."} meta={`${Object.keys(bundles).length} ${pl ? "tożsamości Viewer" : "Viewer identities"}`} action={pl ? "Otwórz Viewer Notes" : "Open Viewer Notes"} onClick={() => setView("viewer-notes")} />
        <AiCard icon={<Users size={23} />} title="AI Identities" status={pl ? "Rejestr" : "Registry"} body={pl ? "Dokładne połączenia Profil + API identity + provider + model route + rola." : "Exact Profile + API identity + provider + model route + role records."} meta={`${filteredIdentities.length} ${pl ? "tożsamości" : "identities"}`} action={pl ? "Pokaż tożsamości" : "View identities"} onClick={() => setView("identities")} />
      </div>
      <div className="ai-center-experimental"><ShieldCheck size={20} /><div><strong>{pl ? "Viewer Notes są eksperymentalne" : "Viewer Notes are experimental"}</strong><p>{pl ? "Mogą pomagać w obsługiwanych sesjach, ale nowe wersje powstają wyłącznie po każdym ukończonym celu Training." : "They may assist in supported sessions, but new versions are created only after each completed Training target."}</p></div></div>
      <details className="panel viewer-notes-help"><summary>{pl ? "Jak działa AI Center" : "How AI Center works"}</summary><div><p>{pl ? "AI Center należy do aktywnego Profilu i obejmuje wszystkie jego Workspace’y. AI Identities rozróżniają dokładne połączenie Profilu, API identity, providera, trasy modelu i roli, dlatego pamięć jednego Viewera nie przechodzi do innego modelu ani klucza." : "AI Center belongs to the active Profile and covers all of its Workspaces. AI Identities distinguish the exact Profile, API identity, provider, model route, and role, so one Viewer's memory never transfers to another model or credential."}</p><p>{pl ? "Viewer, AI Monitor i AI Judge są oddzielnymi rolami. Viewer Notes są pomocniczą pamięcią proceduralną konkretnego Viewera. Mogą być używane w Training oraz obsługiwanych RV Sessions, lecz aktualizuje je wyłącznie Viewer po każdym ukończonym celu Training. Zwykłe RV Sessions, Monitor, Judge i Conversation ich nie zmieniają." : "Viewer, AI Monitor, and AI Judge are separate roles. Viewer Notes are auxiliary procedural memory for one exact Viewer. They may be used in Training and supported RV Sessions, but only the Viewer updates them after each completed Training target. Ordinary RV Sessions, Monitor, Judge, and Conversation never change them."}</p><p>{pl ? "Każda wersja jest niezmienna i ma historię. Program nie pozwala ręcznie redagować treści; można przywrócić wcześniejszą wersję, a pojemności nie można zmniejszyć poniżej aktywnej treści. Research może korzystać z zamrożonej wersji, lecz podczas eksperymentu jej nie aktualizuje." : "Each version is immutable and recorded in history. The app does not allow manual editing; an earlier version can be restored, and capacity cannot be reduced below active content. Research may use a frozen version but never updates it during an experiment."}</p></div></details>
    </section> : view === "identities" ? <section className="panel ai-identities-panel"><div className="panel-header"><span><Users size={18} /></span><h2>AI Identities</h2></div>{filteredIdentities.length ? <div className="ai-identity-list">{filteredIdentities.map((identity) => <article key={identity.id}><span className={`status-chip ${identity.routeStatus === "available" ? "ready" : "next"}`}>{identity.role.toUpperCase()}</span><div><strong>{identity.modelDisplayName}</strong><small>{identity.provider} · {identity.modelRoute}</small><small>API identity {identity.credentialDisplay} · {pl ? "ostatnie użycie" : "last used"}: {formatDate(identity.lastUsedAt, pl)}</small></div></article>)}</div> : <EmptyIdentity pl={pl} />}</section> : <section className="viewer-notes-layout">
      <aside className="panel viewer-notes-identities"><div className="panel-header"><span><Users size={18} /></span><h2>{pl ? "Viewerzy" : "Viewers"}</h2></div>{identities.filter((item) => item.role === "viewer").map((identity) => <button key={identity.id} className={selectedIdentityId === identity.id ? "active" : ""} onClick={() => setSelectedIdentityId(identity.id)}><strong>{identity.modelDisplayName}</strong><small>{identity.provider} · {identity.credentialDisplay}</small><span>{bundles[identity.id] ? currentViewerNotesLabel(bundles[identity.id]) : "—"}</span></button>)}{!identities.some((item) => item.role === "viewer") && <EmptyIdentity pl={pl} />}</aside>
      <div className="viewer-notes-main">{selectedBundle ? <>
        <section className="panel viewer-notes-current"><div className="viewer-notes-title"><div><span className="status-chip next">EXPERIMENTAL</span><h2>{selectedBundle.identity.modelDisplayName}</h2><p>{selectedBundle.identity.provider} · {selectedBundle.identity.modelRoute} · API {selectedBundle.identity.credentialDisplay}</p></div><label><span>{pl ? "Pojemność" : "Capacity"}</span><select value={selectedBundle.settings.capacityTokens} onChange={(event) => void changeCapacity(Number(event.target.value) as ViewerNoteCapacity)}>{VIEWER_NOTES_CAPACITIES.map((capacity) => <option key={capacity} value={capacity}>{capacity} tokens</option>)}</select></label></div><div className="viewer-notes-metrics"><span><small>{pl ? "Aktywna wersja" : "Active version"}</small><strong>{currentViewerNotesLabel(selectedBundle)}</strong></span><span><small>{pl ? "Szacowane tokeny" : "Estimated tokens"}</small><strong>~{selectedBundle.activeVersion?.estimatedTokens ?? 0} / {selectedBundle.settings.capacityTokens}</strong></span><span><small>{pl ? "Domyślnie w sesji" : "Session default"}</small><strong>{selectedBundle.settings.defaultEnabled ? "ON" : "OFF"}</strong></span></div><div className="viewer-notes-document">{selectedBundle.activeVersion ? <SafeMarkdown content={selectedBundle.activeVersion.content} /> : <p>{pl ? "Ten Viewer nie utworzył jeszcze pierwszej wersji notatek. Po kwalifikującej się sesji może wybrać UPDATE albo NO_CHANGE." : "This Viewer has not created its first notes version yet. After an eligible session it may choose UPDATE or NO_CHANGE."}</p>}</div></section>
        <section className="panel"><div className="panel-header"><span><History size={18} /></span><h2>{pl ? "Historia wersji" : "Version history"}</h2></div>{selectedBundle.versions.length ? <div className="viewer-note-history">{selectedBundle.versions.map((version) => <article key={version.id}><div><strong>v{version.versionNumber}</strong><small>{formatDate(version.createdAt, pl)} · ~{version.estimatedTokens} tokens · {version.protocolId}</small><p>{version.changeSummary}</p></div><button className="secondary-button" disabled={version.id === selectedBundle.settings.activeVersionId} onClick={() => void restore(version.id)}>{version.id === selectedBundle.settings.activeVersionId ? (pl ? "Aktywna" : "Active") : (pl ? "Przywróć" : "Restore")}</button></article>)}</div> : <p className="muted">{pl ? "Brak wersji." : "No versions yet."}</p>}</section>
        <section className="panel"><div className="panel-header"><span><Clock3 size={18} /></span><h2>{pl ? "Refleksje po sesjach" : "Post-session reflections"}</h2></div>{selectedBundle.reflectionRuns.length ? <div className="viewer-note-runs">{selectedBundle.reflectionRuns.map((run) => <article key={run.id}><span className={`status-chip ${run.status === "UPDATE" || run.status === "NO_CHANGE" ? "ready" : "next"}`}>{run.status}</span><div><strong>{run.changeSummary || run.failureMessage || (pl ? "Refleksja w toku" : "Reflection pending")}</strong><small>{formatDate(run.createdAt, pl)} · {run.sourceSessionId}</small></div></article>)}</div> : <p className="muted">{pl ? "Brak zapisanych refleksji." : "No recorded reflections."}</p>}</section>
      </> : <EmptyIdentity pl={pl} />}</div>
    </section>}
  </div>;
}

function AiCard({ icon, title, status, body, meta, action, onClick }: { icon: ReactNode; title: string; status: string; body: string; meta: string; action: string; onClick: () => void }) {
  return <article className="panel ai-center-card"><div className="ai-center-card-icon">{icon}</div><span className="status-chip ready">{status}</span><h2>{title}</h2><p>{body}</p><small>{meta}</small><button className="secondary-button" onClick={onClick}>{action}</button></article>;
}
function EmptyIdentity({ pl }: { pl: boolean }) { return <div className="ai-center-empty"><BrainCircuit size={28} /><strong>{pl ? "Brak zapisanej tożsamości AI" : "No AI identity recorded"}</strong><p>{pl ? "Tożsamość pojawi się po pierwszym uruchomieniu obsługiwanej sesji w wersji 0.7.12." : "An identity appears after the first supported session is started in v0.7.12."}</p></div>; }
function formatDate(value: string, pl: boolean) { return new Date(value).toLocaleString(pl ? "pl-PL" : "en-GB", { dateStyle: "medium", timeStyle: "short" }); }
function errorText(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
