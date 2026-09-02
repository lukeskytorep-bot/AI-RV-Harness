import {
  ArrowRight,
  Clock3,
  Crosshair,
  Languages,
  LockKeyhole,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { getCopy } from "../../i18n";
import type { RvSession } from "../../sessions/types";
import type { Profile, Workspace } from "../../types";

export interface HomeScreenProps {
  copy: ReturnType<typeof getCopy>;
  profile: Profile | null;
  workspace: Workspace | null;
  recent: Workspace[];
  recentSessions: RvSession[];
  profiles: Profile[];
  onCreateProfile: () => void;
  onOpenProfiles: () => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onOpenSession: (session: RvSession) => void;
}

export function HomeScreen({
  copy,
  profile,
  workspace,
  recent,
  recentSessions,
  profiles,
  onCreateProfile,
  onOpenProfiles,
  onOpenWorkspace,
  onOpenSession,
}: HomeScreenProps) {
  return (
    <div className="page home-page">
      <section className="hero-panel">
        <div className="eyebrow"><Sparkles size={14} /> {copy.foundation}</div>
        <h1>{copy.welcomeBack}</h1>
        <p>{copy.welcomeLead}</p>
        <div className="resume-grid">
          <ResumeCard
            label={copy.lastProfile}
            title={profile ? aiIsBeDisplayName(profile) : "AI IS-BE"}
            icon={profile ? <span className="avatar">{initials(aiIsBeDisplayName(profile))}</span> : <Users size={22} />}
            action={profile ? copy.openProfile : copy.createProfile}
            onClick={profile ? onOpenProfiles : onCreateProfile}
          />
          <ResumeCard
            label={copy.lastWorkspace}
            title={workspace?.name ?? copy.noWorkspace}
            icon={<RadioTower size={22} />}
            action={workspace ? copy.openWorkspace : copy.profiles}
            onClick={workspace ? () => onOpenWorkspace(workspace) : onOpenProfiles}
          />
        </div>
      </section>

      <section className="feature-strip">
        <MiniStat icon={<LockKeyhole size={17} />} title={copy.blindIntegrity} value="Viewer ≠ Reveal" />
        <MiniStat icon={<Languages size={17} />} title={copy.versionedResources} value="RCP 1.5a · PL / EN" />
        <MiniStat icon={<ShieldCheck size={17} />} title={copy.secureLocal} value="SQLite · local artifacts" />
      </section>

      <div className="home-columns">
        <section className="panel">
          <HomePanelHeader title={copy.recentWorkspaces} icon={<Clock3 size={18} />} />
          {recent.length === 0 ? <p className="muted empty-copy">{copy.noRecent}</p> : (
            <div className="list-stack">
              {recent.map((item) => {
                const owner = profiles.find((profileItem) => profileItem.id === item.profileId);
                return (
                  <button className="recent-row" key={item.id} onClick={() => onOpenWorkspace(item)}>
                    <span className="recent-icon"><RadioTower size={18} /></span>
                    <span className="recent-copy"><strong>{item.name}</strong><small>{owner ? aiIsBeDisplayName(owner) : "—"}</small></span>
                    <ArrowRight size={16} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel quick-panel">
          <HomePanelHeader title={copy.recentSessions} icon={<Clock3 size={18} />} />
          {recentSessions.length ? <div className="list-stack">{recentSessions.slice(0, 5).map((session) => <button className="recent-row" key={session.id} onClick={() => onOpenSession(session)}><span className="recent-icon"><Crosshair size={17} /></span><span className="recent-copy"><strong>{session.sessionCode}</strong><small>{session.state} · {new Date(session.updatedAt).toLocaleString()}</small></span><ArrowRight size={16} /></button>)}</div> : <p className="muted empty-copy">{copy.noRecent}</p>}
        </section>
      </div>
    </div>
  );
}

function ResumeCard({ label, title, icon, action, onClick }: { label: string; title: string; icon: ReactNode; action: string; onClick: () => void }) {
  return (
    <button className="resume-card" onClick={onClick}>
      <span className="resume-icon">{icon}</span>
      <span className="resume-main"><small>{label}</small><strong>{title}</strong><span>{action} <ArrowRight size={14} /></span></span>
    </button>
  );
}

function MiniStat({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="mini-stat"><span>{icon}</span><div><small>{title}</small><strong>{value}</strong></div></div>;
}

function HomePanelHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-header"><span>{icon}</span><h2>{title}</h2></div>;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AI";
}
