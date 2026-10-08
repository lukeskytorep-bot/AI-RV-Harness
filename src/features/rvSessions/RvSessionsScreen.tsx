import { Check, CircleHelp, Crosshair, MessageCircle, X } from "lucide-react";
import { useCallback, useState } from "react";

import { PageHeader } from "../../components/PageHeader";
import { ProfileSelector } from "../../components/ProfileSelector";
import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import { ChatPanel } from "../conversations";
import { RvSessionPanel } from "./RvSessionPanel";

export type RvSessionsView = "manual" | "automatic";

export interface RvSessionsScreenProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
  profiles: Profile[];
  view: RvSessionsView;
  onViewChange: (view: RvSessionsView) => void;
  onProfileChange: (profileId: string) => void;
  createdNotice: { workspaceId: string; workspaceName: string; profileName: string } | null;
  onDismissCreatedNotice: () => void;
  onOperationBusyChange?: (busy: boolean) => void;
}

export function RvSessionsScreen({
  copy,
  settings,
  profile,
  workspace,
  repository,
  profiles,
  view,
  onViewChange,
  onProfileChange,
  createdNotice,
  onDismissCreatedNotice,
  onOperationBusyChange,
}: RvSessionsScreenProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const handleBusyChange = useCallback((busy: boolean) => { setOperationBusy(busy); onOperationBusyChange?.(busy); }, [onOperationBusyChange]);

  return (
    <>
      <div className="page workspace-page rv-sessions-page">
        <PageHeader
          title={copy.rvSessionsNav}
          subtitle={`${workspace.name} · ${profile ? aiIsBeDisplayName(profile) : "—"}`}
          action={<div className="workspace-header-actions"><ProfileSelector profiles={profiles} value={workspace.profileId} onChange={onProfileChange} language={settings.interfaceLanguage} disabled={operationBusy} /><button className="secondary-button" aria-expanded={helpOpen} aria-controls="rv-sessions-help-panel" onClick={() => setHelpOpen((current) => !current)}><CircleHelp size={15} />{settings.interfaceLanguage === "pl" ? "Jak działają sesje RV?" : "How do RV Sessions work?"}</button></div>}
        />
        {helpOpen && <RvSessionsHelpPanel language={settings.interfaceLanguage} />}
        {createdNotice && <div className="workspace-created-notice"><Check size={16} /><span><strong>{copy.workspaceCreated}</strong><small>{createdNotice.profileName} → {createdNotice.workspaceName}</small></span><button className="icon-button" onClick={onDismissCreatedNotice}><X size={14} /></button></div>}
        <div className="module-tabs" aria-label={copy.rvSessionsNav}>
          <button className={view === "manual" ? "module-tab active" : "module-tab"} disabled={operationBusy} onClick={() => onViewChange("manual")}><MessageCircle size={17} />{copy.manualRvTab}</button>
          <button className={view === "automatic" ? "module-tab active" : "module-tab"} disabled={operationBusy} onClick={() => onViewChange("automatic")}><Crosshair size={17} />{copy.automaticRvTab}</button>
        </div>
        {view === "manual"
          ? <ChatPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} fixedMode="manual_rv" onBusyChange={handleBusyChange} />
          : <RvSessionPanel copy={copy} settings={settings} profile={profile} workspace={workspace} repository={repository} onBusyChange={handleBusyChange} />}
      </div>
    </>
  );
}


function RvSessionsHelpPanel({ language }: { language: AppSettings["interfaceLanguage"] }) {
  const pl = language === "pl";
  return <section id="rv-sessions-help-panel" className="panel workspace-help-panel" aria-label={pl ? "Jak działają sesje RV?" : "How do RV Sessions work?"}>
    <h2>{pl ? "Jak działają sesje RV?" : "How do RV Sessions work?"}</h2>
    {pl ? <>
      <p>Sekcja <strong>Sesje RV</strong> obejmuje dwa sposoby pracy: <strong>Manual RV</strong> i sesję automatyczną. Każda sesja używa dokładnie wybranej tożsamości Viewera należącej do aktywnego Profilu. Jeżeli Profil ma kilka dostępnych tożsamości, możesz przełączać się tylko między nimi. Field Guide oraz — gdy są włączone — Viewer Notes są używane wyłącznie do odczytu. Zwykła sesja RV ich nie aktualizuje.</p>
      <p>W <strong>Manual RV</strong> rozmawiasz z Viewerem podobnie jak w Conversation, ale działasz jako Monitor. Możesz dołączyć jeden z wbudowanych protokołów: Full RCP, RV Lite Core, RV Lite Extended albo Protokół Telepatyczny, prowadzić Viewera własnymi wiadomościami oraz dodawać źródła i obrazy. Obecny tryb Manual RV nie uruchamia zapisanego Custom Protocol jako automatycznej sekwencji.</p>
      <p>W trybie automatycznym kontroler aplikacji prowadzi sesję samodzielnie. Możesz wybrać pojedynczą sesję albo serię, działanie bez AI Monitora albo zgodny tryb z AI Monitorem oraz Full RCP, RV Lite, Protokół Telepatyczny lub zapisany Custom Protocol. Dostępność części kombinacji zależy od zgodności wybranego protokołu.</p>
      <p>Dla Full RCP i RV Lite możesz opcjonalnie dodać zadanie specjalne dotyczące konkretnego podmiotu, struktury, obiektu, aktywności lub zdarzenia. Jeżeli używasz oznaczeń takich jak <strong>Subject A</strong> albo <strong>Object A</strong>, Target Reveal musi jednoznacznie wyjaśniać, co każde oznaczenie znaczy. Bez tego Viewer nie może prawidłowo porównać wyniku z celem.</p>
      <p>Cele ogólne są używane przez Full RCP, RV Lite i zgodne Custom Protocols; cele telepatyczne są przeznaczone dla Protokołu Telepatycznego. Reveal pozostaje ukryty podczas części blind i zostaje udostępniony dopiero po jej zakończeniu.</p>
    </> : <>
      <p><strong>RV Sessions</strong> provides two ways of working: <strong>Manual RV</strong> and an automatic session. Every session uses an exact selected Viewer identity belonging to the active Profile. If a Profile has several eligible identities, you may switch only among those identities. The Field Guide and, when enabled, Viewer Notes are read-only. An ordinary RV session never updates them.</p>
      <p>In <strong>Manual RV</strong>, you talk to the Viewer much like in Conversation while acting as the Monitor. You can attach a built-in Full RCP, RV Lite Core, RV Lite Extended, or Telepathic Protocol, guide the Viewer with your own messages, and add sources or images. The current Manual RV mode does not run a saved Custom Protocol as an automatic sequence.</p>
      <p>In automatic mode, the application controller runs the session. You can choose a single session or batch, a controller-only run or a compatible AI Monitor run, and Full RCP, RV Lite, Telepathic Protocol, or a saved Custom Protocol. Some combinations depend on protocol compatibility.</p>
      <p>For Full RCP and RV Lite, you may optionally add a special task concerning a specific subject, structure, object, activity, or event. If you use labels such as <strong>Subject A</strong> or <strong>Object A</strong>, the Target Reveal must clearly define what every label means. Otherwise, the Viewer cannot meaningfully compare the result with the target.</p>
      <p>General targets are used by Full RCP, RV Lite, and compatible Custom Protocols; telepathic targets are intended for the Telepathic Protocol. The Reveal remains hidden during the blind portion and is provided only after that portion ends.</p>
    </>}
  </section>;
}
