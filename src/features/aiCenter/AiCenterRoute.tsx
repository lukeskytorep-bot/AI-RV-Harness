import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { MonitorPanel } from "../monitor";
import { AiCenterScreen, type AiCenterView } from "./AiCenterScreen";

type Copy = ReturnType<typeof getCopy>;

export interface AiCenterRouteProps {
  copy: Copy;
  settings: AppSettings;
  profiles: Profile[];
  workspaces: Workspace[];
  activeProfileId: string | null;
  activeWorkspace: Workspace | null;
  repository: AppRepository;
  initialView: AiCenterView;
  onProfileChange: (profileId: string) => void;
  onProfileChanged: () => Promise<void>;
}

export function AiCenterRoute({
  copy,
  settings,
  profiles,
  workspaces,
  activeProfileId,
  activeWorkspace,
  repository,
  initialView,
  onProfileChange,
  onProfileChanged,
}: AiCenterRouteProps) {
  const monitorWorkspace = activeWorkspace && activeWorkspace.profileId === activeProfileId ? activeWorkspace : null;

  return (
    <AiCenterScreen
      settings={settings}
      profiles={profiles}
      workspaces={workspaces}
      activeProfileId={activeProfileId}
      workspaceFilterId={monitorWorkspace?.id ?? null}
      repository={repository}
      initialView={initialView}
      onProfileChange={onProfileChange}
      monitorPanel={monitorWorkspace ? (
        <MonitorPanel
          copy={copy}
          settings={settings}
          profile={profiles.find((item) => item.id === activeProfileId) ?? null}
          workspace={monitorWorkspace}
          repository={repository}
          onProfileChanged={onProfileChanged}
        />
      ) : (
        <section className="panel">
          <div className="empty-state">
            {settings.interfaceLanguage === "pl"
              ? "Utwórz lub wybierz Workspace tego Profilu, aby otworzyć historię AI Monitora."
              : "Create or select a Workspace for this Profile to open AI Monitor history."}
          </div>
        </section>
      )}
    />
  );
}
