import { FileCheck2, FlaskConical, LockKeyhole, ShieldCheck, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { ModuleHelpButton, ModuleHelpPanel } from "../../components/ModuleHelp";
import { PageHeader } from "../../components/PageHeader";
import { ResearchBuilder, ResearchHelpContent } from "./ResearchBuilder";

type Copy = ReturnType<typeof getCopy>;

export interface ResearchScreenProps {
  copy: Copy;
  settings: AppSettings;
  profiles: Profile[];
  workspaces: Workspace[];
  repository: AppRepository | null;
}

export function ResearchScreen({ copy, settings, profiles, workspaces, repository }: ResearchScreenProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const pl = settings.interfaceLanguage === "pl";
  return (
    <div className="page">
      <PageHeader title={copy.research} subtitle={copy.researchLead} action={<ModuleHelpButton label={pl ? "Jak działa Research?" : "How does Research work?"} icon={FlaskConical} expanded={helpOpen} controlsId="research-help-panel" onToggle={() => setHelpOpen((current) => !current)} />} />
      {helpOpen && <ModuleHelpPanel id="research-help-panel" title={pl ? "Jak działa Research?" : "How does Research work?"} icon={FlaskConical}><ResearchHelpContent language={settings.interfaceLanguage} /></ModuleHelpPanel>}
      <div className="research-guardrails">
        <ResearchGuardrail icon={LockKeyhole} title={copy.blinded} value="Allowlist packets" />
        <ResearchGuardrail icon={ShieldCheck} title={copy.locked} value="Config → immutable" />
        <ResearchGuardrail icon={FileCheck2} title="Scores" value="Freeze → unblind" />
      </div>
      <ResearchBuilder
        copy={copy}
        settings={settings}
        profiles={profiles}
        workspaces={workspaces}
        repository={repository}
      />
    </div>
  );
}

function ResearchGuardrail({ icon: Icon, title, value }: { icon: LucideIcon; title: string; value: string }) {
  return <MiniStat icon={<Icon size={17} />} title={title} value={value} />;
}

function MiniStat({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="mini-stat"><span>{icon}</span><div><small>{title}</small><strong>{value}</strong></div></div>;
}
