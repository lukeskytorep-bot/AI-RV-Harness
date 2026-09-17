import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, BrainCircuit, Check, Clock3, Database, History, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { AiIdentity, ViewerNoteBundle, ViewerNoteCapacity, ViewerNoteSourceSnapshot } from "../../aiCenter/types";
import { VIEWER_NOTES_CAPACITIES, currentViewerNotesLabel } from "../../aiCenter/viewerNotes";
import { FIELD_GUIDE_CAPACITIES, resolveLegacyFieldGuideBaselineForViewer } from "../../aiCenter/fieldGuide";
import type { FieldGuideBundle, FieldGuideCapacity, FieldGuideLanguage, FieldGuideLegacyBaseline } from "../../aiCenter/fieldGuideTypes";
import { SafeMarkdown } from "../../components/SafeMarkdown";
import { useAppDialogs } from "../../components/AppDialogProvider";
import { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";

export type AiCenterView = "overview" | "monitor" | "viewer-learning" | "identities";

export interface AiCenterScreenProps {
  settings: AppSettings;
  profiles: Profile[];
  workspaces: Workspace[];
  activeProfileId: string | null;
  workspaceFilterId: string | null;
  repository: AppRepository;
  initialView: AiCenterView;
  monitorPanel: ReactNode;
  onProfileChange: (profileId: string) => void;
}

export function AiCenterScreen({ settings, profiles, workspaces, activeProfileId, workspaceFilterId, repository, initialView, monitorPanel, onProfileChange }: AiCenterScreenProps) {
  const dialogs = useAppDialogs();
  const copy = getCopy(settings.interfaceLanguage);
  const pl = settings.interfaceLanguage === "pl";
  const [view, setView] = useState<AiCenterView>(initialView);
  const [identities, setIdentities] = useState<AiIdentity[]>([]);
  const [bundles, setBundles] = useState<Record<string, ViewerNoteBundle>>({});
  const [fieldGuideBundles, setFieldGuideBundles] = useState<Record<string, FieldGuideBundle>>({});
  const [legacyBaselines, setLegacyBaselines] = useState<FieldGuideLegacyBaseline[]>([]);
  const [learningTab, setLearningTab] = useState<"field-guide" | "viewer-notes">("field-guide");
  const [fieldLanguage, setFieldLanguage] = useState<FieldGuideLanguage>(settings.interfaceLanguage === "pl" ? "pl" : "en");
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [monitorRunCount, setMonitorRunCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeProfile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0] ?? null;
  const ownedWorkspaces = workspaces.filter((item) => item.profileId === activeProfile?.id);

  const refresh = async () => {
    if (!activeProfile) { setIdentities([]); setBundles({}); setFieldGuideBundles({}); setLegacyBaselines([]); return; }
    const nextIdentities = await repository.listAiIdentities(activeProfile.id);
    const monitorWorkspaces = workspaceFilterId ? ownedWorkspaces.filter((item) => item.id === workspaceFilterId) : ownedWorkspaces;
    const runs = (await Promise.all(monitorWorkspaces.map((workspace) => repository.listMonitorRuns(workspace.id)))).flat();
    const viewers = nextIdentities.filter((item) => item.role === "viewer");
    const nextBundles = Object.fromEntries((await Promise.all(viewers.map(async (item) => [item.id, await repository.getViewerNoteBundle(item.id)] as const))).filter((entry): entry is readonly [string, ViewerNoteBundle] => Boolean(entry[1])));
    const fieldEntries = await Promise.all(viewers.flatMap((item) => (["pl", "en"] as const).map(async (language) => [`${item.id}:${language}`, await repository.getFieldGuideBundle(item.id, language)] as const)));
    const nextFieldGuideBundles: Record<string, FieldGuideBundle> = {};
    for (const [key, bundle] of fieldEntries) {
      if (bundle) nextFieldGuideBundles[key] = bundle;
    }
    const nextLegacyBaselines = await repository.listFieldGuideLegacyBaselines(activeProfile.id);
    setIdentities(nextIdentities);
    setBundles(nextBundles);
    setFieldGuideBundles(nextFieldGuideBundles);
    setLegacyBaselines(nextLegacyBaselines);
    setMonitorRunCount(runs.length);
    setSelectedIdentityId((current) => viewers.some((item) => item.id === current) ? current : viewers[0]?.id ?? null);
  };

  useEffect(() => { setView(initialView); }, [initialView]);
  useEffect(() => { void refresh().catch((cause) => setError(errorText(cause))); }, [activeProfile?.id, repository, workspaceFilterId, workspaces]);

  const filteredIdentities = useMemo(() => identities, [identities]);
  const selectedBundle = selectedIdentityId ? bundles[selectedIdentityId] : undefined;
  const selectedFieldGuide = selectedIdentityId ? fieldGuideBundles[`${selectedIdentityId}:${fieldLanguage}`] : undefined;
  const selectedIdentity = selectedIdentityId ? identities.find((item) => item.id === selectedIdentityId) : undefined;

  const changeCapacity = async (value: ViewerNoteCapacity) => {
    if (!selectedBundle) return;
    if (value > selectedBundle.settings.capacityTokens) {
      const confirmed = await dialogs.confirm({
        title: copy.dialogWarningTitle,
        description: pl
          ? "Zwiększenie pojemności pozwala AI zapisać dłuższe notatki. Późniejsze zmniejszenie będzie możliwe tylko wtedy, gdy aktywna treść zmieści się w niższym limicie."
          : "Increasing capacity lets the AI save longer notes. You can reduce it later only if the active content fits the lower limit.",
        confirmLabel: copy.dialogContinue,
        cancelLabel: copy.cancel,
        severity: "warning",
      });
      if (!confirmed) return;
    }
    setError(null);
    try { await repository.setViewerNoteCapacity(selectedBundle.identity.id, value); await refresh(); setNotice(pl ? "Pojemność zaktualizowana." : "Capacity updated."); }
    catch (cause) { setError(errorText(cause)); }
  };

  const restore = async (versionId: string) => {
    if (!selectedBundle || versionId === selectedBundle.settings.activeVersionId) return;
    const warning = pl
      ? "Ta wersja została wcześniej utworzona przez to AI, ale jej ponowne aktywowanie jest decyzją człowieka, a nie aktualną decyzją modelu. Co do zasady nie należy zmieniać aktywnych notatek AI bez jego zgody. Użyj tej opcji tylko do odzyskania wcześniejszego stanu albo świadomie zaplanowanego testu. Operacja zostanie zapisana w historii."
      : "This version was previously created by this AI, but reactivating it is a human decision, not the model's current decision. As a rule, active AI notes should not be changed without its consent. Use this only to recover an earlier state or for a deliberate test. The action will be recorded.";
    const confirmed = await dialogs.confirm({ title: copy.dialogWarningTitle, description: warning, confirmLabel: copy.dialogContinue, cancelLabel: copy.cancel, severity: "warning" });
    if (!confirmed) return;
    setError(null);
    try { await repository.restoreViewerNoteVersion(selectedBundle.identity.id, versionId, workspaceFilterId ?? undefined); await refresh(); setNotice(pl ? "Przywrócono historyczną wersję." : "Historical version restored."); }
    catch (cause) { setError(errorText(cause)); }
  };

  const changeFieldGuideCapacity = async (value: FieldGuideCapacity) => {
    if (!selectedFieldGuide) return;
    setError(null);
    try {
      await repository.setFieldGuideCapacity(selectedFieldGuide.identityId, fieldLanguage, value);
      await refresh();
      setNotice(pl ? "Pojemność Przewodnika Pola zaktualizowana." : "Field Guide capacity updated.");
    } catch (cause) { setError(errorText(cause)); }
  };

  const restoreFieldGuide = async (versionId: string) => {
    if (!selectedFieldGuide || versionId === selectedFieldGuide.settings.activeVersionId) return;
    const confirmed = await dialogs.confirm({
      title: pl ? "Przywrócić wersję Przewodnika Pola?" : "Restore Field Guide version?",
      description: pl ? "Historia nie zostanie nadpisana. Zostanie utworzona nowa aktywna wersja z provenance wskazującym przywróconą wersję." : "History will not be overwritten. A new active version will be created with provenance pointing to the restored version.",
      confirmLabel: copy.dialogContinue,
      cancelLabel: copy.cancel,
      severity: "warning",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await repository.restoreFieldGuideVersion(selectedFieldGuide.identityId, fieldLanguage, versionId);
      await refresh();
      setNotice(pl ? "Utworzono nową aktywną wersję z wersji historycznej." : "A new active version was created from the historical version.");
    } catch (cause) { setError(errorText(cause)); }
  };

  const linkLegacyBaseline = async (baseline: FieldGuideLegacyBaseline) => {
    if (!selectedIdentity || !activeProfile) return;
    const confirmed = await dialogs.confirm({
      title: pl ? "Powiązać zachowany prompt?" : "Link preserved prompt?",
      description: pl
        ? `Ta operacja jawnie przypisze zachowaną treść Profilu do tożsamości ${selectedIdentity.modelDisplayName} i języka ${fieldLanguage.toUpperCase()}. Treść źródłowa pozostanie zachowana.`
        : `This explicitly links the preserved Profile content to ${selectedIdentity.modelDisplayName} and ${fieldLanguage.toUpperCase()}. The source content remains preserved.`,
      confirmLabel: copy.dialogContinue,
      cancelLabel: copy.cancel,
      severity: "warning",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await resolveLegacyFieldGuideBaselineForViewer({ repository, baseline, identityId: selectedIdentity.id, language: fieldLanguage, profile: activeProfile });
      await refresh();
      setNotice(pl ? "Legacy baseline został jawnie powiązany." : "Legacy baseline was explicitly linked.");
    } catch (cause) { setError(errorText(cause)); }
  };


  return <div className="page ai-center-page">
    <header className="page-header ai-center-header"><div><span className="eyebrow"><Sparkles size={14} /> {pl ? "Role, historia i eksperymentalna pamięć AI" : "AI roles, history and experimental memory"}</span><h1>AI Center</h1><p>{pl ? "Narzędzia AI dla aktywnego Profilu, wspólne dla wszystkich jego Workspace’ów." : "AI tools for the active Profile, shared across all of its Workspaces."}</p></div><label><span>{pl ? "Aktywny Profil" : "Active Profile"}</span><select value={activeProfile?.id ?? ""} onChange={(event) => onProfileChange(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{aiIsBeDisplayName(profile)}</option>)}</select></label></header>
    <div className="ai-center-context"><Users size={15} /><span>{activeProfile ? aiIsBeDisplayName(activeProfile) : "—"}</span><small>{workspaceFilterId ? ownedWorkspaces.find((item) => item.id === workspaceFilterId)?.name : (pl ? "Wszystkie Workspace’y Profilu" : "All Profile Workspaces")}</small></div>
    <nav className="module-tabs ai-center-tabs">
      <button className={view === "overview" ? "module-tab active" : "module-tab"} onClick={() => setView("overview")}><Sparkles size={17} />{pl ? "Przegląd" : "Overview"}</button>
      <button className={view === "monitor" ? "module-tab active" : "module-tab"} onClick={() => setView("monitor")}><BrainCircuit size={17} />AI Monitor</button>
      <button className={view === "viewer-learning" ? "module-tab active" : "module-tab"} onClick={() => setView("viewer-learning")}><BookOpen size={17} />{pl ? "Nauka Viewera" : "Viewer Learning"}</button>
      <button className={view === "identities" ? "module-tab active" : "module-tab"} onClick={() => setView("identities")}><Users size={17} />AI Identities</button>
    </nav>
    {error && <div className="provider-error">{error}</div>}{notice && <div className="storage-success"><Check size={14} />{notice}</div>}
    {view === "monitor" ? monitorPanel : view === "overview" ? <section className="ai-center-overview">
      <div className="ai-center-cards">
        <AiCard icon={<BrainCircuit size={23} />} title="AI Monitor" status={pl ? "Dostępny" : "Available"} body={pl ? "Istniejący Monitor, jego prompt, runy oraz interwencje." : "The existing Monitor, its prompt, runs and interventions."} meta={`${monitorRunCount} ${pl ? "runów w filtrze" : "runs in filter"}`} action={pl ? "Otwórz AI Monitor" : "Open AI Monitor"} onClick={() => setView("monitor")} />
        <AiCard icon={<BookOpen size={23} />} title={pl ? "Nauka Viewera" : "Viewer Learning"} status={pl ? "Fundament" : "Foundation"} body={pl ? "Przewodnik Pola dla pamięci percepcyjnej oraz istniejące Viewer Notes jako oddzielna pamięć proceduralna." : "Field Guide for perceptual memory plus existing Viewer Notes as a separate procedural memory."} meta={`${identities.filter((item) => item.role === "viewer").length} ${pl ? "tożsamości Viewer" : "Viewer identities"}`} action={pl ? "Otwórz Naukę Viewera" : "Open Viewer Learning"} onClick={() => setView("viewer-learning")} />
        <AiCard icon={<Users size={23} />} title="AI Identities" status={pl ? "Rejestr" : "Registry"} body={pl ? "Dokładne połączenia Profil + API identity + provider + model route + rola." : "Exact Profile + API identity + provider + model route + role records."} meta={`${filteredIdentities.length} ${pl ? "tożsamości" : "identities"}`} action={pl ? "Pokaż tożsamości" : "View identities"} onClick={() => setView("identities")} />
      </div>
      <div className="ai-center-experimental"><ShieldCheck size={20} /><div><strong>{pl ? "Viewer Notes są eksperymentalne" : "Viewer Notes are experimental"}</strong><p>{pl ? "Mogą pomagać w obsługiwanych sesjach, ale nowe wersje powstają wyłącznie po każdym ukończonym celu Training." : "They may assist in supported sessions, but new versions are created only after each completed Training target."}</p></div></div>
      <details className="panel viewer-notes-help"><summary>{pl ? "Jak działa AI Center" : "How AI Center works"}</summary><div><p>{pl ? "AI Center należy do aktywnego Profilu i obejmuje wszystkie jego Workspace’y. AI Identities rozróżniają dokładne połączenie Profilu, API identity, providera, trasy modelu i roli, dlatego pamięć jednego Viewera nie przechodzi do innego modelu ani klucza." : "AI Center belongs to the active Profile and covers all of its Workspaces. AI Identities distinguish the exact Profile, API identity, provider, model route, and role, so one Viewer's memory never transfers to another model or credential."}</p><p>{pl ? "Viewer, AI Monitor i AI Judge są oddzielnymi rolami. Viewer Notes są pomocniczą pamięcią proceduralną konkretnego Viewera. Mogą być używane w Training oraz obsługiwanych RV Sessions, lecz aktualizuje je wyłącznie Viewer po każdym ukończonym celu Training. Zwykłe RV Sessions, Monitor, Judge i Conversation ich nie zmieniają." : "Viewer, AI Monitor, and AI Judge are separate roles. Viewer Notes are auxiliary procedural memory for one exact Viewer. They may be used in Training and supported RV Sessions, but only the Viewer updates them after each completed Training target. Ordinary RV Sessions, Monitor, Judge, and Conversation never change them."}</p><p>{pl ? "Każda wersja jest niezmienna i ma historię. Metadane jej źródła są zachowywane w niezmiennym snapshotcie, dzięki czemu historia Viewer Notes pozostaje czytelna nawet po późniejszym trwałym usunięciu źródłowej Session, Training lub Workspace. Program nie pozwala ręcznie redagować treści; można przywrócić wcześniejszą wersję, a pojemności nie można zmniejszyć poniżej aktywnej treści. Research może korzystać z zamrożonej wersji, lecz podczas eksperymentu jej nie aktualizuje." : "Each version is immutable and recorded in history. Its source metadata is preserved as an immutable snapshot, so the Viewer Notes history remains understandable even if the originating Session, Training, or Workspace is later permanently removed. The app does not allow manual editing; an earlier version can be restored, and capacity cannot be reduced below active content. Research may use a frozen version but never updates it during an experiment."}</p></div></details>
    </section> : view === "identities" ? <section className="panel ai-identities-panel"><div className="panel-header"><span><Users size={18} /></span><h2>AI Identities</h2></div>{filteredIdentities.length ? <div className="ai-identity-list">{filteredIdentities.map((identity) => <article key={identity.id}><span className={`status-chip ${identity.routeStatus === "available" ? "ready" : "next"}`}>{identity.role.toUpperCase()}</span><div><strong>{identity.modelDisplayName}</strong><small>{identity.provider} · {identity.modelRoute}</small><small>API identity {identity.credentialDisplay} · {pl ? "ostatnie użycie" : "last used"}: {formatDate(identity.lastUsedAt, pl)}</small></div></article>)}</div> : <EmptyIdentity pl={pl} />}</section> : <section className="viewer-learning-section">
      <div className="panel viewer-learning-header"><div><span className="eyebrow"><BookOpen size={14} /> {pl ? "Nauka Viewera" : "Viewer Learning"}</span><h2>{pl ? "Nauka Viewera" : "Viewer Learning"}</h2><p>{pl ? "Przewodnik Pola przechowuje pamięć percepcyjną. Viewer Notes pozostają oddzielną, opcjonalną pamięcią proceduralną." : "Field Guide stores perceptual memory. Viewer Notes remain a separate optional procedural memory."}</p></div><nav className="module-tabs"><button className={learningTab === "field-guide" ? "module-tab active" : "module-tab"} onClick={() => setLearningTab("field-guide")}><BookOpen size={16} />{pl ? "Przewodnik Pola" : "Field Guide"}</button><button className={learningTab === "viewer-notes" ? "module-tab active" : "module-tab"} onClick={() => setLearningTab("viewer-notes")}><Database size={16} />{pl ? "Notatki Viewera" : "Viewer Notes"}</button></nav></div>
      <div className="viewer-notes-layout">
        <aside className="panel viewer-notes-identities"><div className="panel-header"><span><Users size={18} /></span><h2>{pl ? "Viewerzy" : "Viewers"}</h2></div>{identities.filter((item) => item.role === "viewer").map((identity) => <button key={identity.id} className={selectedIdentityId === identity.id ? "active" : ""} onClick={() => setSelectedIdentityId(identity.id)}><strong>{identity.modelDisplayName}</strong><small>{identity.provider} · {identity.credentialDisplay}</small><span>{learningTab === "viewer-notes" ? (bundles[identity.id] ? currentViewerNotesLabel(bundles[identity.id]) : "—") : (fieldGuideBundles[`${identity.id}:${fieldLanguage}`]?.activeVersion ? `v${fieldGuideBundles[`${identity.id}:${fieldLanguage}`].activeVersion!.versionNumber}` : "—")}</span></button>)}{!identities.some((item) => item.role === "viewer") && <EmptyIdentity pl={pl} />}</aside>
        <div className="viewer-notes-main">{learningTab === "field-guide" ? (selectedIdentity && selectedFieldGuide ? <>
          <section className="panel viewer-notes-current field-guide-current"><div className="viewer-notes-title"><div><span className="status-chip ready">FIELD GUIDE</span><h2>{selectedIdentity.modelDisplayName}</h2><p>{selectedIdentity.provider} · {selectedIdentity.modelRoute} · API {selectedIdentity.credentialDisplay}</p><small>{selectedIdentity.normalizedBaseUrl ?? (pl ? "domyślny endpoint providera" : "provider default endpoint")} · credential {selectedIdentity.credentialFingerprint.slice(0, 12)}…</small></div><div className="field-guide-controls"><label><span>{pl ? "Język" : "Language"}</span><select value={fieldLanguage} onChange={(event) => setFieldLanguage(event.target.value as FieldGuideLanguage)}><option value="pl">PL</option><option value="en">EN</option></select></label><label><span>{pl ? "Pojemność" : "Capacity"}</span><select value={selectedFieldGuide.settings.capacityTokens} onChange={(event) => void changeFieldGuideCapacity(Number(event.target.value) as FieldGuideCapacity)}>{FIELD_GUIDE_CAPACITIES.map((capacity) => <option key={capacity} value={capacity}>{capacity} tokens</option>)}</select></label></div></div>
            <div className="viewer-notes-metrics"><span><small>{pl ? "Aktywna wersja" : "Active version"}</small><strong>{selectedFieldGuide.activeVersion ? `v${selectedFieldGuide.activeVersion.versionNumber}` : "—"}</strong></span><span><small>{pl ? "Wykorzystanie" : "Usage"}</small><strong>~{selectedFieldGuide.activeVersion?.estimatedTokens ?? 0} / {selectedFieldGuide.settings.capacityTokens}</strong></span><span><small>SHA-256</small><strong className="mono-small">{selectedFieldGuide.activeVersion?.contentSha256.slice(0, 16) ?? "—"}</strong></span></div>
            <div className="viewer-notes-document field-guide-readonly" aria-readonly="true">{selectedFieldGuide.activeVersion ? <SafeMarkdown content={selectedFieldGuide.activeVersion.content} /> : <p>{pl ? "Ta tożsamość nie ma jeszcze aktywnej wersji Przewodnika Pola w tym języku. Pierwsza wersja zostanie utworzona z bezpiecznego bootstrapu przy rozpoczęciu obsługiwanej sesji lub po jawnym powiązaniu zachowanego legacy promptu." : "This identity has no active Field Guide version in this language yet. The first version is created by safe bootstrap when a supported session starts or after an explicit link of a preserved legacy prompt."}</p>}</div>
            {selectedFieldGuide.activeVersion && <div className="field-guide-provenance"><small>{pl ? "Utworzono" : "Created"}: {formatDate(selectedFieldGuide.activeVersion.createdAt, pl)}</small><small>{pl ? "Źródło" : "Source"}: {selectedFieldGuide.activeVersion.sourceSnapshot.sourceKind}</small>{selectedFieldGuide.activeVersion.sourceTrainingRunId && <small>Training: {selectedFieldGuide.activeVersion.sourceTrainingRunId}</small>}{selectedFieldGuide.activeVersion.sourceSessionId && <small>Session: {selectedFieldGuide.activeVersion.sourceSessionId}</small>}{selectedFieldGuide.activeVersion.lexiconId && <small>Lexicon: {selectedFieldGuide.activeVersion.lexiconId} · {selectedFieldGuide.activeVersion.lexiconVersion ?? "—"}</small>}</div>}
          </section>
          {legacyBaselines.some((item) => item.resolutionStatus === "unresolved") && <section className="panel"><div className="panel-header"><span><ShieldCheck size={18} /></span><h2>{pl ? "Zachowane legacy baseline" : "Preserved legacy baseline"}</h2></div><p className="muted">{pl ? "Treść została zachowana bez zgadywania tożsamości ani języka. Powiąż ją jawnie tylko wtedy, gdy wiesz, do którego Viewera i języka należy." : "Content was preserved without guessing identity or language. Link it explicitly only when you know which Viewer and language it belongs to."}</p><div className="viewer-note-history">{legacyBaselines.filter((item) => item.resolutionStatus === "unresolved").map((baseline) => <article key={baseline.id}><div><strong>legacy-profile-baseline</strong><small>{formatDate(baseline.createdAt, pl)}</small><details><summary>{pl ? "Pokaż zachowaną treść" : "Show preserved content"}</summary><pre>{baseline.originalContent}</pre></details></div><button className="secondary-button" onClick={() => void linkLegacyBaseline(baseline)}>{pl ? `Powiąż z ${fieldLanguage.toUpperCase()}` : `Link to ${fieldLanguage.toUpperCase()}`}</button></article>)}</div></section>}
          <section className="panel"><div className="panel-header"><span><History size={18} /></span><h2>{pl ? "Historia Przewodnika Pola" : "Field Guide history"}</h2></div>{selectedFieldGuide.versions.length ? <div className="viewer-note-history">{selectedFieldGuide.versions.map((version) => <article key={version.id}><div><strong>v{version.versionNumber} · {version.activationStatus}</strong><small>{formatDate(version.createdAt, pl)} · ~{version.estimatedTokens} tokens · {version.contentSha256}</small><small>{version.sourceSnapshot.sourceKind}{version.restoredFromVersionId ? ` · restored from ${version.restoredFromVersionId}` : ""}</small></div><button className="secondary-button" disabled={version.id === selectedFieldGuide.settings.activeVersionId} onClick={() => void restoreFieldGuide(version.id)}>{version.id === selectedFieldGuide.settings.activeVersionId ? (pl ? "Aktywna" : "Active") : (pl ? "Przywróć jako nową wersję" : "Restore as new version")}</button></article>)}</div> : <p className="muted">{pl ? "Brak wersji." : "No versions yet."}</p>}</section>
        </> : <EmptyIdentity pl={pl} />) : (selectedBundle ? <>
          <section className="panel viewer-notes-current"><div className="viewer-notes-title"><div><span className="status-chip next">EXPERIMENTAL</span><h2>{selectedBundle.identity.modelDisplayName}</h2><p>{selectedBundle.identity.provider} · {selectedBundle.identity.modelRoute} · API {selectedBundle.identity.credentialDisplay}</p></div><label><span>{pl ? "Pojemność" : "Capacity"}</span><select value={selectedBundle.settings.capacityTokens} onChange={(event) => void changeCapacity(Number(event.target.value) as ViewerNoteCapacity)}>{VIEWER_NOTES_CAPACITIES.map((capacity) => <option key={capacity} value={capacity}>{capacity} tokens</option>)}</select></label></div><div className="viewer-notes-metrics"><span><small>{pl ? "Aktywna wersja" : "Active version"}</small><strong>{currentViewerNotesLabel(selectedBundle)}</strong></span><span><small>{pl ? "Szacowane tokeny" : "Estimated tokens"}</small><strong>~{selectedBundle.activeVersion?.estimatedTokens ?? 0} / {selectedBundle.settings.capacityTokens}</strong></span><span><small>{pl ? "Domyślnie w sesji" : "Session default"}</small><strong>{selectedBundle.settings.defaultEnabled ? "ON" : "OFF"}</strong></span></div><div className="viewer-notes-document">{selectedBundle.activeVersion ? <SafeMarkdown content={selectedBundle.activeVersion.content} /> : <p>{pl ? "Ten Viewer nie utworzył jeszcze pierwszej wersji notatek. Po kwalifikującej się sesji może wybrać UPDATE albo NO_CHANGE." : "This Viewer has not created its first notes version yet. After an eligible session it may choose UPDATE or NO_CHANGE."}</p>}</div></section>
          <section className="panel"><div className="panel-header"><span><History size={18} /></span><h2>{pl ? "Historia wersji" : "Version history"}</h2></div>{selectedBundle.versions.length ? <div className="viewer-note-history">{selectedBundle.versions.map((version) => <article key={version.id}><div><strong>v{version.versionNumber}</strong><small>{formatDate(version.createdAt, pl)} · ~{version.estimatedTokens} tokens · {version.protocolId}</small><small>{viewerNoteSourceLabel(version.sourceSnapshot, Boolean(version.sourceSessionId), pl)}</small><p>{version.changeSummary}</p></div><button className="secondary-button" disabled={version.id === selectedBundle.settings.activeVersionId} onClick={() => void restore(version.id)}>{version.id === selectedBundle.settings.activeVersionId ? (pl ? "Aktywna" : "Active") : (pl ? "Przywróć" : "Restore")}</button></article>)}</div> : <p className="muted">{pl ? "Brak wersji." : "No versions yet."}</p>}</section>
          <section className="panel"><div className="panel-header"><span><Clock3 size={18} /></span><h2>{pl ? "Refleksje po sesjach" : "Post-session reflections"}</h2></div>{selectedBundle.reflectionRuns.length ? <div className="viewer-note-runs">{selectedBundle.reflectionRuns.map((run) => <article key={run.id}><span className={`status-chip ${run.status === "UPDATE" || run.status === "NO_CHANGE" ? "ready" : "next"}`}>{run.status}</span><div><strong>{run.changeSummary || run.failureMessage || (pl ? "Refleksja w toku" : "Reflection pending")}</strong><small>{formatDate(run.createdAt, pl)} · {viewerNoteSourceLabel(run.sourceSnapshot, Boolean(run.sourceSessionId), pl)}</small></div></article>)}</div> : <p className="muted">{pl ? "Brak zapisanych refleksji." : "No recorded reflections."}</p>}</section>
        </> : <EmptyIdentity pl={pl} />)}</div>
      </div>
    </section>}
  </div>;
}

function AiCard({ icon, title, status, body, meta, action, onClick }: { icon: ReactNode; title: string; status: string; body: string; meta: string; action: string; onClick: () => void }) {
  return <article className="panel ai-center-card"><div className="ai-center-card-icon">{icon}</div><span className="status-chip ready">{status}</span><h2>{title}</h2><p>{body}</p><small>{meta}</small><button className="secondary-button" onClick={onClick}>{action}</button></article>;
}
function EmptyIdentity({ pl }: { pl: boolean }) { return <div className="ai-center-empty"><BrainCircuit size={28} /><strong>{pl ? "Brak zapisanej tożsamości AI" : "No AI identity recorded"}</strong><p>{pl ? "Tożsamość pojawi się po pierwszym uruchomieniu obsługiwanej sesji w wersji 0.7.13." : "An identity appears after the first supported session is started in v0.7.13."}</p></div>; }
function viewerNoteSourceLabel(snapshot: ViewerNoteSourceSnapshot, liveSessionAvailable: boolean, pl: boolean) {
  const training = snapshot.trainingRunName ? `${snapshot.trainingRunName}${snapshot.trainingRunNumber ? ` (#${snapshot.trainingRunNumber})` : ""}` : undefined;
  const session = snapshot.sessionCode || snapshot.sessionId || (pl ? "nieznana sesja" : "unknown session");
  const workspace = snapshot.workspaceName || snapshot.workspaceId;
  const base = [training, session, workspace].filter(Boolean).join(" · ");
  return liveSessionAvailable ? base : `${base} · ${pl ? "rekord źródłowy usunięty" : "source record deleted"}`;
}
function formatDate(value: string, pl: boolean) { return new Date(value).toLocaleString(pl ? "pl-PL" : "en-GB", { dateStyle: "medium", timeStyle: "short" }); }
function errorText(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
