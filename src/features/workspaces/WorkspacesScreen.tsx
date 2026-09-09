import { ArrowRight, Archive, EllipsisVertical, Pencil, Plus, RadioTower, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { EmptyState } from "../../components/EmptyState";
import { useAppDialogs } from "../../components/AppDialogProvider";
import { PageHeader } from "../../components/PageHeader";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { filterWorkspaceDirectory } from "../../domain/workspaceDirectory";
import { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { Profile, Workspace } from "../../types";
import { archiveWorkspaceAndRefresh, renameWorkspaceAndRefresh } from "./workspaceOperations";

export interface WorkspacesScreenProps {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  repository: AppRepository | null;
  activeWorkspaceId: string | null;
  onChanged: () => Promise<void>;
  onActiveArchived: (nextId: string | null) => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onCreateWorkspace: () => void;
  onCreateProfile: () => void;
}

export function WorkspacesScreen({ copy, profiles, workspaces, repository, activeWorkspaceId, onChanged, onActiveArchived, onOpenWorkspace, onCreateWorkspace, onCreateProfile }: WorkspacesScreenProps) {
  const dialogs = useAppDialogs();
  const createAction = profiles.length ? <button className="primary-button" onClick={onCreateWorkspace}><Plus size={16} />{copy.createWorkspace}</button> : <button className="primary-button" onClick={onCreateProfile}><Plus size={16} />{copy.createProfile}</button>;
  const rename = async (workspace: Workspace) => {
    if (!repository) return;
    const requested = await dialogs.prompt({
      title: copy.dialogRename,
      description: copy.home === "Home" ? "Enter a new Workspace name." : "Podaj nową nazwę Workspace.",
      initialValue: workspace.name,
      inputLabel: copy.workspaceName,
      inputRequired: true,
      confirmLabel: copy.dialogRename,
      cancelLabel: copy.cancel,
    });
    const name = requested?.trim();
    if (!name || name === workspace.name) return;
    try { await renameWorkspaceAndRefresh(repository, workspace.id, name, onChanged); }
    catch (cause) { await dialogs.information({ title: copy.dialogErrorTitle, description: cause instanceof Error ? cause.message : String(cause), confirmLabel: copy.dialogOk, severity: "warning" }); }
  };
  const archive = async (workspace: Workspace) => {
    if (!repository) return;
    const confirmed = await dialogs.confirm({
      title: `${copy.dialogArchive}: ${workspace.name}`,
      description: copy.home === "Home" ? "Its data will be preserved and can be restored in Settings > Data storage." : "Dane zostaną zachowane i będzie można je przywrócić w Ustawienia > Pamięć danych.",
      confirmLabel: copy.dialogArchive,
      cancelLabel: copy.cancel,
      severity: "warning",
    });
    if (!confirmed) return;
    try {
      await archiveWorkspaceAndRefresh(repository, workspace, workspaces, activeWorkspaceId, onActiveArchived, onChanged);
    } catch (cause) { await dialogs.information({ title: copy.dialogErrorTitle, description: cause instanceof Error ? cause.message : String(cause), confirmLabel: copy.dialogOk, severity: "warning" }); }
  };
  return <div className="page"><PageHeader title={copy.allWorkspaces} subtitle={copy.allWorkspacesLead} action={createAction} /><section className="panel workspace-directory-panel"><WorkspaceDirectoryList copy={copy} profiles={profiles} workspaces={workspaces} onOpenWorkspace={onOpenWorkspace} onRename={rename} onArchive={archive} emptyAction={createAction} /></section></div>;
}

interface WorkspaceDirectoryListProps {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  onOpenWorkspace: (workspace: Workspace) => void;
  onRename?: (workspace: Workspace) => void;
  onArchive?: (workspace: Workspace) => void;
  emptyAction?: ReactNode;
}

function WorkspaceDirectoryList({ copy, profiles, workspaces, onOpenWorkspace, onRename, onArchive, emptyAction }: WorkspaceDirectoryListProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => filterWorkspaceDirectory(workspaces, profiles, query), [workspaces, profiles, query]);
  const activeWorkspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workspace of workspaces) counts.set(workspace.profileId, (counts.get(workspace.profileId) ?? 0) + 1);
    return counts;
  }, [workspaces]);

  return (
    <div className="workspace-directory">
      <label className="workspace-search">
        <RadioTower size={16} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchWorkspaces} />
      </label>
      {groups.length ? (
        <div className="workspace-directory-groups">
          {groups.map((group) => (
            <section key={group.profile.id}>
              <header>
                <span className="avatar tiny">{initials(aiIsBeDisplayName(group.profile))}</span>
                <div><strong>{aiIsBeDisplayName(group.profile)}</strong><small>{group.workspaces.length} {copy.workspacesCount}</small></div>
              </header>
              <div>
                {group.workspaces.map((workspace) => {
                  const canArchive = (activeWorkspaceCounts.get(workspace.profileId) ?? 0) > 1;
                  return (
                    <div className="workspace-directory-tile" key={workspace.id}>
                      <button className="workspace-open-button" onClick={() => onOpenWorkspace(workspace)}>
                        <span><RadioTower size={16} /><span><strong>{workspace.name}</strong><small>{workspace.description || new Date(workspace.lastOpenedAt).toLocaleString()}</small></span></span>
                        <ArrowRight size={15} />
                      </button>
                      {onRename && onArchive && (
                        <details className="workspace-actions">
                          <summary aria-label={copy.home === "Home" ? "Workspace actions" : "Akcje Workspace"}><EllipsisVertical size={18} /></summary>
                          <div>
                            <button onClick={() => onRename(workspace)}><Pencil size={14} />{copy.home === "Home" ? "Rename" : "Zmień nazwę"}</button>
                            <button disabled={!canArchive} title={!canArchive ? copy.lastActiveWorkspaceRequired : undefined} onClick={() => onArchive(workspace)}><Archive size={14} />{copy.home === "Home" ? "Archive" : "Archiwizuj"}</button>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState icon={<RadioTower size={26} />} title={copy.noMatchingWorkspaces} body={copy.allWorkspacesLead} action={emptyAction} />
      )}
    </div>
  );
}

export interface WorkspaceSwitcherDialogProps {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  onOpenWorkspace: (workspace: Workspace) => void;
  onClose: () => void;
}

export function WorkspaceSwitcherDialog({ copy, profiles, workspaces, onOpenWorkspace, onClose }: WorkspaceSwitcherDialogProps) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal workspace-switcher-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><small>{copy.workspaces}</small><h2>{copy.switchWorkspace}</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><WorkspaceDirectoryList copy={copy} profiles={profiles} workspaces={workspaces} onOpenWorkspace={(workspace) => { onClose(); onOpenWorkspace(workspace); }} /></section></div>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AI";
}
