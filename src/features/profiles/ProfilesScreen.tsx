import { Archive, ChevronRight, EllipsisVertical, KeyRound, Pencil, Plus, RadioTower, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "../../components/EmptyState";
import { useAppDialogs } from "../../components/AppDialogProvider";
import { PageHeader } from "../../components/PageHeader";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../../domain/isBeIdentity";
import { canArchiveWorkspace, isWorkspaceCompatible } from "../../domain/workspaceKind";
import type { getCopy } from "../../i18n";
import { resolveViewerDefault } from "../../profileModelDefaults";
import { archiveWorkspaceAndRefresh, renameWorkspaceAndRefresh } from "../../application/workspaceManagement";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { buildCalibrationHistory, type CalibrationHistoryItem } from "../../research/calibration";
import type { AppRepository } from "../../storage/repository";
import type { NewWorkspaceKind, Profile, ProfileAiConfigurationInput, Workspace } from "../../types";
import { EditProfileDialog } from "./ProfileDialogs";
import { archiveProfileAndRefresh, saveProfileAndRefresh } from "./profileOperations";

export interface ProfilesScreenProps {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  onCreateProfile: () => void;
  onCreateWorkspace: (profileId: string, kind: NewWorkspaceKind) => void;
  onOpenWorkspace: (workspace: Workspace, kind: NewWorkspaceKind) => void;
  activeConversationWorkspaceId: string | null;
  activeRvWorkspaceId: string | null;
  repository: AppRepository | null;
  onProfilesChanged: () => Promise<void>;
}

export function ProfilesScreen({ copy, profiles, workspaces, onCreateProfile, onCreateWorkspace, onOpenWorkspace, activeConversationWorkspaceId, activeRvWorkspaceId, repository, onProfilesChanged }: ProfilesScreenProps) {
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [calibrationHistory, setCalibrationHistory] = useState<CalibrationHistoryItem[]>([]);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const dialogs = useAppDialogs();

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
    if (!repository) return;
    const confirmed = await dialogs.confirm({ title: `${copy.archiveProfile}: ${aiIsBeDisplayName(profile)}`, description: copy.archiveProfileConfirm, confirmLabel: copy.dialogArchive, cancelLabel: copy.cancel, severity: "warning" });
    if (!confirmed) return;
    await archiveProfileAndRefresh(repository, profile.id, onProfilesChanged);
  };

  const saveProfile = async (name: string, humanName: string | undefined, note?: string, aiConfiguration?: ProfileAiConfigurationInput) => {
    if (!repository || !editingProfile) return;
    if (aiConfiguration && editingProfile.credentialId && editingProfile.credentialId !== aiConfiguration.credentialId) {
      const confirmed = await dialogs.confirm({ title: copy.dialogWarningTitle, description: copy.calibrationBindingWarning, confirmLabel: copy.dialogContinue, cancelLabel: copy.cancel, severity: "warning" });
      if (!confirmed) return;
    }
    await saveProfileAndRefresh(repository, editingProfile.id, { name, humanName, note, aiConfiguration }, onProfilesChanged, () => setEditingProfile(null));
  };

  const renameWorkspace = async (profile: Profile, workspace: Workspace) => {
    if (!repository) return;
    const requested = await dialogs.prompt({ title: copy.dialogRename, description: copy.home === "Home" ? "Enter a new Workspace name." : "Podaj nową nazwę Workspace.", initialValue: workspace.name, inputLabel: copy.workspaceName, inputRequired: true, confirmLabel: copy.dialogRename, cancelLabel: copy.cancel });
    const name = requested?.trim();
    if (!name || name === workspace.name) return;
    try { await renameWorkspaceAndRefresh(repository, workspace, profile.id, name, onProfilesChanged); }
    catch (cause) { await dialogs.information({ title: copy.dialogErrorTitle, description: cause instanceof Error ? cause.message : String(cause), confirmLabel: copy.dialogOk, severity: "warning" }); }
  };

  const archiveWorkspace = async (profile: Profile, workspace: Workspace) => {
    if (!repository) return;
    const confirmed = await dialogs.confirm({ title: `${copy.dialogArchive}: ${workspace.name}`, description: copy.home === "Home" ? "Its data will be preserved and can be restored in Settings > Data storage." : "Dane zostaną zachowane i będzie można je przywrócić w Ustawienia > Pamięć danych.", confirmLabel: copy.dialogArchive, cancelLabel: copy.cancel, severity: "warning" });
    if (!confirmed) return;
    try { await archiveWorkspaceAndRefresh(repository, workspace, profile.id, onProfilesChanged); }
    catch (cause) { await dialogs.information({ title: copy.dialogErrorTitle, description: cause instanceof Error ? cause.message : String(cause), confirmLabel: copy.dialogOk, severity: "warning" }); }
  };

  return <div className="page">
    <PageHeader title={copy.profiles} subtitle={copy.profileMeaning} action={<button className="primary-button" onClick={onCreateProfile}><Plus size={16} />{copy.createProfile}</button>} />
    {profiles.length === 0 ? <EmptyState icon={<Users size={28} />} title={copy.noProfile} body={copy.profileMeaning} action={<button className="primary-button" onClick={onCreateProfile}><Plus size={16} />{copy.createProfile}</button>} /> : <div className="profile-grid">
      {profiles.map((profile) => {
        const owned = workspaces.filter((workspace) => workspace.profileId === profile.id);
        const conversation = owned.filter((workspace) => isWorkspaceCompatible(workspace, "conversation"));
        const rv = owned.filter((workspace) => isWorkspaceCompatible(workspace, "rv"));
        const boundProvider = providerConfigs.find((provider) => provider.credentialId === profile.credentialId) ?? null;
        const viewerReady = Boolean(resolveViewerDefault(profile, boundProvider, models));
        return <section className="profile-card" key={profile.id}>
          <div className="profile-heading"><span className="avatar large">{profileInitials(aiIsBeDisplayName(profile))}</span><div><h3>{aiIsBeDisplayName(profile)}</h3><p>{humanIsBeDisplayName(profile)} · {profile.note || copy.credentialPending}</p></div><span className={`status-chip ${viewerReady ? "ready" : "next"}`}><KeyRound size={13} />{viewerReady ? copy.aiDefaultsReady : copy.aiDefaultsIncomplete}</span></div>
          <div className="profile-workspace-sections">
            <WorkspaceSection copy={copy} title={copy.conversationWorkspaces} kind="conversation" items={conversation} allOwned={owned} activeId={activeConversationWorkspaceId} onCreate={() => onCreateWorkspace(profile.id, "conversation")} onOpen={(workspace) => onOpenWorkspace(workspace, "conversation")} onRename={(workspace) => renameWorkspace(profile, workspace)} onArchive={(workspace) => archiveWorkspace(profile, workspace)} />
            <WorkspaceSection copy={copy} title={copy.rvWorkspaces} kind="rv" items={rv} allOwned={owned} activeId={activeRvWorkspaceId} onCreate={() => onCreateWorkspace(profile.id, "rv")} onOpen={(workspace) => onOpenWorkspace(workspace, "rv")} onRename={(workspace) => renameWorkspace(profile, workspace)} onArchive={(workspace) => archiveWorkspace(profile, workspace)} />
          </div>
          <CalibrationHistory copy={copy} items={calibrationHistory.filter((item) => item.profileId === profile.id)} />
          <div className="profile-actions"><button className="secondary-button" onClick={() => setEditingProfile(profile)}><Pencil size={14} />{copy.editProfile}</button><button className="secondary-button danger-action" onClick={() => void archiveProfile(profile)}><Archive size={14} />{copy.archiveProfile}</button></div>
        </section>;
      })}
    </div>}
    {editingProfile && <EditProfileDialog copy={copy} profile={editingProfile} providers={providerConfigs} models={models} onCancel={() => setEditingProfile(null)} onSave={saveProfile} />}
  </div>;
}

function WorkspaceSection({ copy, title, kind, items, allOwned, activeId, onCreate, onOpen, onRename, onArchive }: { copy: ReturnType<typeof getCopy>; title: string; kind: NewWorkspaceKind; items: Workspace[]; allOwned: Workspace[]; activeId: string | null; onCreate: () => void; onOpen: (workspace: Workspace) => void; onRename: (workspace: Workspace) => Promise<void>; onArchive: (workspace: Workspace) => Promise<void> }) {
  return <section className="profile-workspace-section">
    <header><div><strong>{title}</strong><small>{items.length}</small></div><button className="secondary-button compact" onClick={onCreate}><Plus size={14} />{copy.createWorkspace}</button></header>
    <div className="workspace-list workspace-tile-grid">
      {items.length === 0 ? <p className="muted">{copy.noCompatibleWorkspace}</p> : items.map((workspace) => <ProfileWorkspaceTile key={`${kind}:${workspace.id}`} copy={copy} workspace={workspace} active={workspace.id === activeId} canArchive={canArchiveWorkspace(workspace, allOwned)} onOpen={() => onOpen(workspace)} onRename={() => onRename(workspace)} onArchive={() => onArchive(workspace)} />)}
    </div>
  </section>;
}

function ProfileWorkspaceTile({ copy, workspace, active, canArchive, onOpen, onRename, onArchive }: { copy: ReturnType<typeof getCopy>; workspace: Workspace; active: boolean; canArchive: boolean; onOpen: () => void; onRename: () => Promise<void>; onArchive: () => Promise<void> }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => { const details = detailsRef.current; if (!details) return; details.open = false; details.querySelector<HTMLElement>("summary")?.focus(); };
  const runAction = async (action: () => Promise<void>) => { await action(); closeMenu(); };
  const typeLabel = workspace.kind === "legacy_combined" ? copy.legacyCombinedWorkspace : workspace.kind === "conversation" ? copy.conversationWorkspace : copy.rvWorkspace;
  return <div className={`profile-workspace-tile${active ? " active" : ""}`}>
    <button className="workspace-tile" onClick={onOpen}><span><RadioTower size={17} /><span><strong>{workspace.name}</strong><small>{workspace.description || typeLabel}</small></span></span><ChevronRight size={16} /></button>
    <details ref={detailsRef} className="workspace-actions profile-workspace-actions" onClick={(event) => event.stopPropagation()}>
      <summary aria-label={copy.home === "Home" ? `Workspace actions: ${workspace.name}` : `Akcje Workspace: ${workspace.name}`} onClick={(event) => event.stopPropagation()}><EllipsisVertical size={18} /></summary>
      <div role="menu" onClick={(event) => event.stopPropagation()}><button role="menuitem" onClick={() => void runAction(onRename)}><Pencil size={14} />{copy.home === "Home" ? "Rename" : "Zmień nazwę"}</button><button role="menuitem" disabled={!canArchive} title={!canArchive ? copy.lastCompatibleWorkspaceRequired : undefined} onClick={() => void runAction(onArchive)}><Archive size={14} />{copy.home === "Home" ? "Archive" : "Archiwizuj"}</button></div>
    </details>
  </div>;
}

function CalibrationHistory({ copy, items }: { copy: ReturnType<typeof getCopy>; items: CalibrationHistoryItem[] }) {
  return <section className="calibration-history"><div className="calibration-history-head"><strong>{copy.calibrationHistory}</strong><small>{items.length}</small></div>{items.length ? <div className="calibration-list">{items.slice(0, 5).map((item) => <article key={item.projectId}><div><strong>{item.modelId}</strong><span className={`status-chip ${item.historical ? "next" : "ready"}`}>{item.historical ? copy.historicalCalibration : copy.currentPairing}</span></div><small>{item.providerLabel}{item.credentialHint ? ` · ${item.credentialHint}` : ""}</small><dl><div><dt>{copy.lastCalibration}</dt><dd>{new Date(item.completedAt).toLocaleDateString()}</dd></div><div><dt>{copy.tested}</dt><dd>{item.tested.join(" / ")}</dd></div><div><dt>{copy.bestObserved}</dt><dd>{item.bestObserved.join(" / ") || "—"}</dd></div><div><dt>n</dt><dd>{item.n}</dd></div></dl></article>)}</div> : <p>{copy.noCalibrationHistory}</p>}</section>;
}

function profileInitials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AI"; }
