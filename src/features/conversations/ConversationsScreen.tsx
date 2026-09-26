import { Check, RadioTower, X } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../../components/PageHeader";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { WorkspaceSwitcherDialog } from "../workspaces";
import { ChatPanel } from "./ChatPanel";

export interface ConversationsScreenProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
  profiles: Profile[];
  workspaces: Workspace[];
  onOpenWorkspace: (workspace: Workspace) => void;
  createdNotice: { workspaceId: string; workspaceName: string; profileName: string } | null;
  onDismissCreatedNotice: () => void;
}

export function ConversationsScreen({
  copy,
  settings,
  profile,
  workspace,
  repository,
  profiles,
  workspaces,
  onOpenWorkspace,
  createdNotice,
  onDismissCreatedNotice,
}: ConversationsScreenProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <>
      <div className="page workspace-page conversations-page">
        <PageHeader
          title={copy.conversationsNav}
          subtitle={`${workspace.name} · ${profile ? aiIsBeDisplayName(profile) : "—"}`}
          action={<button className="secondary-button" onClick={() => setSwitcherOpen(true)}><RadioTower size={15} />{copy.switchWorkspace}</button>}
        />
        {createdNotice && <div className="workspace-created-notice"><Check size={16} /><span><strong>{copy.workspaceCreated}</strong><small>{createdNotice.profileName} → {createdNotice.workspaceName}</small></span><button className="icon-button" onClick={onDismissCreatedNotice}><X size={14} /></button></div>}
        <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode="conversation" />
      </div>
      {switcherOpen && <WorkspaceSwitcherDialog copy={copy} profiles={profiles} workspaces={workspaces} onOpenWorkspace={onOpenWorkspace} onClose={() => setSwitcherOpen(false)} />}
    </>
  );
}
