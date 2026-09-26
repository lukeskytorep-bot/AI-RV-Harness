import { ArrowRight, RadioTower, X } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "../../components/EmptyState";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { filterWorkspaceDirectory } from "../../domain/workspaceDirectory";
import { getCopy } from "../../i18n";
import type { NewWorkspaceKind, Profile, Workspace } from "../../types";
import { isWorkspaceCompatible } from "../../domain/workspaceKind";

export interface WorkspaceSwitcherDialogProps {
  copy: ReturnType<typeof getCopy>;
  profiles: Profile[];
  workspaces: Workspace[];
  kind: NewWorkspaceKind;
  onOpenWorkspace: (workspace: Workspace) => void;
  onClose: () => void;
}

export function WorkspaceSwitcherDialog({ copy, profiles, workspaces, kind, onOpenWorkspace, onClose }: WorkspaceSwitcherDialogProps) {
  const [query, setQuery] = useState("");
  const compatible = useMemo(() => workspaces.filter((workspace) => isWorkspaceCompatible(workspace, kind)), [workspaces, kind]);
  const groups = useMemo(() => filterWorkspaceDirectory(compatible, profiles, query), [compatible, profiles, query]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal workspace-switcher-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>{copy.workspaces}</small><h2>{copy.switchWorkspace}</h2></div><button className="icon-button" aria-label={copy.cancel} onClick={onClose}><X size={19} /></button></div>
        <div className="workspace-directory">
          <label className="workspace-search"><RadioTower size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchWorkspaces} /></label>
          {groups.length ? (
            <div className="workspace-directory-groups">
              {groups.map((group) => (
                <section key={group.profile.id}>
                  <header><span className="avatar tiny">{initials(aiIsBeDisplayName(group.profile))}</span><div><strong>{aiIsBeDisplayName(group.profile)}</strong><small>{group.workspaces.length} {copy.workspacesCount}</small></div></header>
                  <div>{group.workspaces.map((workspace) => (
                    <div className="workspace-directory-tile" key={workspace.id}>
                      <button className="workspace-open-button" onClick={() => { onClose(); onOpenWorkspace(workspace); }}>
                        <span><RadioTower size={16} /><span><strong>{workspace.name}</strong><small>{workspace.description || (workspace.kind === "legacy_combined" ? copy.legacyCombinedWorkspace : workspace.kind === "conversation" ? copy.conversationWorkspace : copy.rvWorkspace)}</small></span></span><ArrowRight size={15} />
                      </button>
                    </div>
                  ))}</div>
                </section>
              ))}
            </div>
          ) : <EmptyState icon={<RadioTower size={26} />} title={copy.noMatchingWorkspaces} body={copy.allWorkspacesLead} />}
        </div>
      </section>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AI";
}
