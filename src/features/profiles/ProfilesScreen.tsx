import { Archive, ChevronRight, KeyRound, Pencil, Plus, RadioTower, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../../domain/isBeIdentity";
import type { getCopy } from "../../i18n";
import { resolveViewerDefault } from "../../profileModelDefaults";
import type { ProviderConfig, ProviderModel } from "../../providers/types";
import { buildCalibrationHistory, type CalibrationHistoryItem } from "../../research/calibration";
import type { AppRepository } from "../../storage/repository";
import type { Profile, ProfileAiConfigurationInput, Workspace } from "../../types";
import { EditProfileDialog } from "./ProfileDialogs";
import { archiveProfileAndRefresh, saveProfileAndRefresh } from "./profileOperations";

export interface ProfilesScreenProps {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  onCreateProfile: () => void;
  onCreateWorkspace: (profileId: string) => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  repository: AppRepository | null;
  onProfilesChanged: () => Promise<void>;
}

export function ProfilesScreen({
  copy,
  profiles,
  workspaces,
  onCreateProfile,
  onCreateWorkspace,
  onOpenWorkspace,
  repository,
  onProfilesChanged,
}: ProfilesScreenProps) {
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [calibrationHistory, setCalibrationHistory] = useState<CalibrationHistoryItem[]>([]);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!repository) return;
    void (async () => {
      const [configs, cachedModels, projects] = await Promise.all([
        repository.listProviderConfigs(),
        repository.listProviderModels(),
        repository.listResearchProjects(),
      ]);
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
    await archiveProfileAndRefresh(repository, profile.id, onProfilesChanged);
  };

  const saveProfile = async (
    name: string,
    humanName: string | undefined,
    note?: string,
    aiConfiguration?: ProfileAiConfigurationInput,
  ) => {
    if (!repository || !editingProfile) return;
    if (aiConfiguration && editingProfile.credentialId && editingProfile.credentialId !== aiConfiguration.credentialId && !window.confirm(copy.calibrationBindingWarning)) return;
    await saveProfileAndRefresh(
      repository,
      editingProfile.id,
      { name, humanName, note, aiConfiguration },
      onProfilesChanged,
      () => setEditingProfile(null),
    );
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
                  <span className="avatar large">{profileInitials(aiIsBeDisplayName(profile))}</span>
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

function profileInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AI";
}
